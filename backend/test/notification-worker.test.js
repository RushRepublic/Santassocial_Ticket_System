import { test } from "node:test";
import assert from "node:assert/strict";
import { startNotificationWorker } from "../src/notification-worker.js";
import { dispatchNotifications } from "../src/providers.js";
import { openDatabase, migrate } from "../src/db.js";
import { seed } from "../src/setup.js";
import {
  approveCash,
  createBooking,
  getBooking,
  now,
  settleCaptured,
} from "../src/services.js";
import { createApp } from "../src/app.js";
import { qrToken, signSession } from "../src/security.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { config } from "../src/config.js";

const input = {
  name: "Delivery Guest",
  email: "qa@example.com",
  eventDate: "2026-11-21",
  discoverySource: "google",
  adults: 1,
  kids: 0,
  method: "CASH",
};
async function fixture(work) {
  process.env.DEMO_DB_PATH = resolve(
    `data/notifications-${randomUUID()}.sqlite`,
  );
  const db = await openDatabase();
  try {
    await migrate(db);
    await seed(db);
    await work(db);
  } finally {
    await db.close();
  }
}

test("two outbox dispatchers cannot send the same queued cash QR concurrently", () =>
  fixture(async (db) => {
    const booking = await createBooking(db, input, "9876543210", randomUUID());
    const delivered = [];
    const provider = {
      sendNotification: async (message) => {
        delivered.push(message);
        await new Promise((r) => setImmediate(r));
      },
    };
    await Promise.all([
      dispatchNotifications(db, provider),
      dispatchNotifications(db, provider),
    ]);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].mobile, "9876543210");
    assert.match(
      delivered[0].ticketLink,
      new RegExp("/ticket/" + booking.id + "#ss_"),
    );
    await dispatchNotifications(db, provider);
    assert.equal(delivered.length, 1);
  }));

test("cash and captured online bookings each send once, even after scanner approval and retries", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const [admin] = await db.all("SELECT id FROM users WHERE role = 'ADMIN'");
    const cookie =
      "santa_staff_session=" + (await signSession({ userId: admin.id }));
    const post = (path, body, key = randomUUID()) =>
      request(app)
        .post("/api" + path)
        .set("Origin", config.origin)
        .set("Cookie", cookie)
        .set("Idempotency-Key", key)
        .send(body);
    const mobile = "9876543210";
    const cashKey = randomUUID();
    const cash = await createBooking(db, input, mobile, cashKey);
    assert.equal((await createBooking(db, input, mobile, cashKey)).id, cash.id);
    const online = await createBooking(
      db,
      { ...input, method: "RAZORPAY" },
      mobile,
      randomUUID(),
    );
    const delivered = [];
    const provider = { sendNotification: async (m) => delivered.push(m) };
    await dispatchNotifications(db, provider);
    assert.deepEqual(
      delivered.map(({ reference, status }) => [reference, status]),
      [[cash.reference, "PENDING_CASH"]],
    );
    await db.run("UPDATE payments SET orderId = ? WHERE bookingId = ?", [
      "order_notice_test",
      online.id,
    ]);
    const capture = (event) =>
      settleCaptured(
        db,
        "order_notice_test",
        "pay_notice_test",
        online.amount,
        "INR",
        event,
      );
    const event = { id: "evt_notice_test", type: "payment.captured" };
    await capture(event);
    await capture(event);
    await capture(); // Browser confirmation alongside the webhook.
    await dispatchNotifications(db, provider);
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1].reference, online.reference);
    assert.equal(delivered[1].status, "PAID");
    for (const [booking, payment] of [
      [cash, { amountReceived: cash.amount, cashAcknowledged: true }],
      [online, {}],
    ]) {
      const token = qrToken(booking);
      const key = randomUUID();
      await post("/scanner/verify", { token }).expect(200);
      await post("/scanner/checkin", { token, ...payment }, key).expect(200);
      await post("/scanner/checkin", { token, ...payment }, key).expect(200);
      await post("/scanner/checkin", { token, ...payment }).expect(409);
      await post("/scanner/verify", { token }).expect(409);
      await post(`/admin/bookings/${booking.id}/notify`, {}).expect(200, {
        queued: false,
      });
      const [row, ...duplicates] = await db.all(
        "SELECT type, status, sentAt FROM notification_logs WHERE bookingId = ?",
        [booking.id],
      );
      assert.deepEqual(duplicates, []);
      assert.equal(
        row.type,
        booking.method === "CASH" ? "CASH_PENDING" : "TICKET",
      );
      assert.equal(row.status, "DEMO_SENT");
      assert.ok(row.sentAt);
    }
    await dispatchNotifications(db, provider);
    assert.equal(delivered.length, 2);
    assert.equal((await db.all("SELECT id FROM checkins")).length, 2);
  }));

test("legacy cash outbox rows send at most one confirmation and preserve a sole pending delivery", () =>
  fixture(async (db) => {
    const [admin] = await db.all("SELECT id FROM users WHERE role = 'ADMIN'");
    const delivered = [];
    const provider = { sendNotification: async (m) => delivered.push(m) };
    for (const previous of ["QUEUED", "DEMO_SENT", "SUPERSEDED"]) {
      const booking = await createBooking(
        db,
        input,
        "9876543210",
        randomUUID(),
      );
      await approveCash(db, booking.id, booking.amount, admin.id);
      await db.run(
        "UPDATE notification_logs SET status = ?, sentAt = ? WHERE bookingId = ?",
        [previous, previous === "DEMO_SENT" ? now() : null, booking.id],
      );
      await db.run(
        "INSERT INTO notification_logs (id,bookingId,type,status,nextAttemptAt) VALUES (?,?,?,?,?)",
        [randomUUID(), booking.id, "TICKET", "QUEUED", now()],
      );
      await Promise.all([
        dispatchNotifications(db, provider),
        dispatchNotifications(db, provider),
      ]);
      const messages = delivered.filter(
        (m) => m.reference === booking.reference,
      );
      assert.deepEqual(
        messages.map(({ type, status }) => [type, status]),
        previous === "DEMO_SENT"
          ? []
          : [[previous === "QUEUED" ? "CASH_PENDING" : "TICKET", "PAID"]],
      );
    }
  }));

test("provider failures retry the same outbox row up to the existing limit", () =>
  fixture(async (db) => {
    const booking = await createBooking(db, input, "9876543210", randomUUID());
    const getLog = async () => {
      const rows = await db.all(
        "SELECT * FROM notification_logs WHERE bookingId = ?",
        [booking.id],
      );
      assert.equal(rows.length, 1);
      return rows[0];
    };
    const { id } = await getLog();
    let calls = 0;
    const provider = {
      async sendNotification() {
        calls++;
        throw Error("Mocked provider failure");
      },
    };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await db.run(
        "UPDATE notification_logs SET nextAttemptAt = ? WHERE id = ?",
        [now(), id],
      );
      await dispatchNotifications(db, provider);
      const job = await getLog();
      assert.equal(job.id, id);
      assert.equal(job.attempts, attempt);
      assert.equal(job.status, attempt < 5 ? "RETRY" : "FAILED");
      assert.equal(job.sentAt, null);
    }
    await dispatchNotifications(db, provider);
    assert.equal(calls, 5);
    const [admin] = await db.all("SELECT id FROM users WHERE role = 'ADMIN'");
    await request(createApp(db))
      .post(`/api/admin/bookings/${booking.id}/notify`)
      .set(
        "Cookie",
        "santa_staff_session=" + (await signSession({ userId: admin.id })),
      )
      .set("Origin", config.origin)
      .expect(200, { queued: true });
    await dispatchNotifications(db, { sendNotification: async () => {} });
    const retried = await getLog();
    assert.equal(retried.id, id);
    assert.equal(retried.status, "DEMO_SENT");
  }));

test("successful booking responses wake the worker after commit; failed requests do not", () =>
  fixture(async (db) => {
    const delivered = [];
    const worker = startNotificationWorker(db, {
      dispatch: (db) =>
        dispatchNotifications(db, {
          sendNotification: async (m) => delivered.push(m),
        }),
    });
    let wakes = 0;
    const app = createApp(db, {
      notify: () => {
        wakes++;
        return worker.wake();
      },
    });
    try {
      const cookie =
        "santa_session=" + (await signSession({ mobile: "9876543210" }));
      const response = await request(app)
        .post("/api/bookings")
        .set("Cookie", cookie)
        .set("Origin", config.origin)
        .set("Idempotency-Key", randomUUID())
        .send(input)
        .expect(201);
      // A queued wake already running coalesces safely; the periodic worker is
      // the fallback if its initial snapshot predates a newly committed job.
      await worker.wake();
      for (let i = 0; i < 20 && !delivered.length; i++) {
        await new Promise((r) => setImmediate(r));
        await worker.wake();
      }
      assert.equal(wakes, 1);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].reference, response.body.reference);
      assert.equal(
        (await getBooking(db, response.body.id)).status,
        "PENDING_CASH",
      );
      await request(app)
        .post("/api/bookings")
        .set("Origin", config.origin)
        .send(input)
        .expect(401);
      assert.equal(wakes, 1);
      assert.equal(delivered.length, 1);
    } finally {
      await worker.close();
    }
  }));

test("notification worker starts automatically, coalesces wakes and stops without losing in-flight work", async () => {
  let release;
  let calls = 0;
  const work = new Promise((resolve) => {
    release = resolve;
  });
  const worker = startNotificationWorker(
    {},
    {
      dispatch: async () => {
        calls++;
        await work;
      },
    },
  );
  const first = worker.wake();
  const second = worker.wake();
  assert.equal(first, second);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  let closed = false;
  const closing = worker.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  release();
  await closing;
  await worker.wake();
  assert.equal(calls, 1);
});

test("a worker failure retries on the next wake without exposing provider details", async () => {
  let calls = 0;
  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(message);
  const worker = startNotificationWorker(
    {},
    {
      dispatch: async () => {
        calls++;
        if (calls === 1) throw Error("private-token");
      },
    },
  );
  try {
    await worker.wake();
    await worker.wake();
    assert.equal(calls, 2);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /private-token/);
  } finally {
    await worker.close();
    console.error = original;
  }
});

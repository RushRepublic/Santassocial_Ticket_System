import { test } from "node:test";
import assert from "node:assert/strict";
import { startNotificationWorker } from "../src/notification-worker.js";
import { dispatchNotifications } from "../src/providers.js";
import { openDatabase, migrate } from "../src/db.js";
import { seed } from "../src/setup.js";
import { createBooking, getBooking } from "../src/services.js";
import { createApp } from "../src/app.js";
import { signSession } from "../src/security.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { config } from "../src/config.js";

const input = {
  name: "Delivery Guest",
  email: "qa@example.com",
  eventDate: "2026-11-13",
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { openDatabase, migrate } from "../src/db.js";
import { seed } from "../src/setup.js";
import { createApp } from "../src/app.js";
import {
  createBooking,
  approveCash,
  getBooking,
  publicBooking,
  checkin,
  verifyTicket,
  settleCaptured,
  availability,
  expire,
  istCalendarDate,
} from "../src/services.js";
import { equal, hash, hmac, qrToken, signSession } from "../src/security.js";
import { config } from "../src/config.js";
import { dispatchNotifications } from "../src/providers.js";
async function fixture(work) {
  process.env.DEMO_DB_PATH = resolve(`data/test-${randomUUID()}.sqlite`);
  const db = await openDatabase();
  try {
    await migrate(db);
    await seed(db);
    await work(db);
  } finally {
    await db.close();
  }
}
const booking = (extra = {}) => ({
  name: "Test Guest",
  email: "guest@example.com",
  eventDate: "2026-11-05",
  adults: 2,
  kids: 1,
  method: "CASH",
  ...extra,
});

test("cash QR is issued immediately but only admin collection can atomically approve and admit", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const adminId = await staff(db);
    const scannerId = await staff(db, "SCANNER");
    const headers = async (userId, role) =>
      `santa_staff_session=${await signSession({ userId, role }, true)}`;
    const adminCookie = await headers(adminId, "ADMIN");
    const scannerCookie = await headers(scannerId, "SCANNER");
    const b = await createBooking(db, booking(), "9876543210", randomUUID());
    await db.run("UPDATE bookings SET holdUntil = ? WHERE id = ?", [
      "2000-01-01T00:00:00.000Z",
      b.id,
    ]);
    await expire(db);
    assert.equal((await getBooking(db, b.id)).status, "PENDING_CASH");
    assert.equal(publicBooking(await getBooking(db, b.id)).holdUntil, null);
    const token = publicBooking(b).qrToken;
    assert.match(token, /^ss_[a-f0-9]{64}$/);
    const customerCookie = `santa_session=${await signSession({ mobile: b.mobile })}`;
    await request(app)
      .get(`/api/tickets/${b.id}`)
      .set("Cookie", customerCookie)
      .expect(200);
    await request(app)
      .get(`/api/tickets/${b.id}/download?format=png`)
      .set("Cookie", customerCookie)
      .expect(200)
      .expect("Content-Type", /png/);
    await request(app)
      .get(`/api/tickets/${b.id}/download`)
      .set("Cookie", customerCookie)
      .expect(200)
      .expect("Content-Type", /pdf/);
    const scan = (cookie, url, body, key = randomUUID()) =>
      request(app)
        .post(url)
        .set("Origin", config.origin)
        .set("Cookie", cookie)
        .set("Idempotency-Key", key)
        .send({ token, ...body });
    const inspected = await scan(adminCookie, "/api/scanner/verify", {}).expect(
      200,
    );
    assert.equal(inspected.body.paymentStatus, "DUE");
    assert.equal(inspected.body.amount, 200);
    assert.equal(inspected.body.mobile, b.mobile);
    await scan(customerCookie, "/api/scanner/verify", {}).expect(403);
    await scan(scannerCookie, "/api/scanner/checkin", {}).expect(403);
    await scan(scannerCookie, "/api/scanner/checkin", {
      amountReceived: b.amount,
    }).expect(403);
    await scan(adminCookie, "/api/scanner/checkin", {
      amountReceived: b.amount - 1,
    }).expect(400);
    assert.equal((await getBooking(db, b.id)).status, "PENDING_CASH");
    const key = randomUUID();
    const results = await Promise.all([
      scan(
        adminCookie,
        "/api/scanner/checkin",
        { amountReceived: b.amount },
        key,
      ),
      scan(adminCookie, "/api/scanner/checkin", { amountReceived: b.amount }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winningKey = results[0].status === 200 ? key : null;
    if (winningKey)
      await scan(
        adminCookie,
        "/api/scanner/checkin",
        { amountReceived: b.amount },
        winningKey,
      ).expect(200);
    const paid = await getBooking(db, b.id);
    assert.equal(paid.status, "PAID");
    assert.equal(publicBooking(paid).qrToken, token);
    assert.ok(paid.checkedInAt);
    assert.equal(
      (await db.all("SELECT * FROM checkins WHERE bookingId = ?", [b.id]))
        .length,
      1,
    );
    assert.equal(
      (
        await db.all(
          "SELECT * FROM audit_logs WHERE entityId = ? AND action = 'CASH_APPROVED'",
          [b.id],
        )
      ).length,
      1,
    );
    await scan(adminCookie, "/api/scanner/verify", {}).expect(409);
  }));

test("expired, cancelled and wrong-day cash QR cannot collect money or admit; legacy QR is backfilled", () =>
  fixture(async (db) => {
    const adminId = await staff(db);
    for (const kind of ["expired", "cancelled", "wrong-day"]) {
      const b = await createBooking(
        db,
        booking(kind === "wrong-day" ? { eventDate: "2026-11-06" } : {}),
        "9876543210",
        randomUUID(),
      );
      if (kind === "expired")
        await db.run("UPDATE bookings SET status = 'EXPIRED' WHERE id = ?", [
          b.id,
        ]);
      if (kind === "cancelled")
        await db.run("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?", [
          b.id,
        ]);
      await assert.rejects(
        checkin(db, qrToken(b), adminId, randomUUID(), b.amount),
      );
      assert.notEqual((await getBooking(db, b.id)).status, "PAID");
      assert.equal(
        (await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id]))[0]
          .status,
        "PENDING",
      );
    }
    const legacy = await createBooking(
      db,
      booking(),
      "9876543210",
      randomUUID(),
    );
    await db.run("UPDATE bookings SET qrHash = NULL WHERE id = ?", [legacy.id]);
    await migrate(db);
    const upgraded = await getBooking(db, legacy.id);
    assert.equal(upgraded.qrHash, hash(qrToken(legacy)));
  }));

test("staff filters work without parameter-to-literal collation comparisons", () =>
  fixture(async (db) => {
    const adminId = await staff(db);
    const scannerId = await staff(db, "SCANNER");
    const record = await createBooking(
      db,
      booking(),
      "9876543210",
      randomUUID(),
    );
    const second = await createBooking(
      db,
      booking({ eventDate: "2026-11-06", name: "Sunday Guest" }),
      "9876543211",
      randomUUID(),
    );
    await approveCash(db, record.id, record.amount, adminId);
    await checkin(
      db,
      publicBooking(await getBooking(db, record.id)).qrToken,
      scannerId,
      randomUUID(),
    );
    const guardedDb = {
      ...db,
      all: (sql, values) => {
        if (/\?\s*=\s*'/.test(sql))
          throw Object.assign(
            new Error("Incompatible parameter/literal collations"),
            {
              code: "ER_CANT_AGGREGATE_2COLLATIONS",
            },
          );
        return db.all(sql, values);
      },
    };
    const app = createApp(guardedDb);
    const cookie = async (id, role) =>
      `santa_staff_session=${await signSession({ userId: id, role }, true)}`;
    const adminCookie = await cookie(adminId, "ADMIN");
    for (const [date, count] of [
      ["all", 2],
      ["2026-11-05", 1],
      ["2026-11-06", 1],
    ]) {
      const result = await request(app)
        .get(`/api/admin/dashboard?date=${date}`)
        .set("Cookie", adminCookie)
        .expect(200);
      assert.equal(result.body.bookings, count);
    }
    for (const [query, ids] of [
      ["", [record.id, second.id]],
      ["?date=2026-11-05&status=PAID", [record.id]],
      ["?date=2026-11-06&q=Sunday", [second.id]],
      ["?status=PENDING_CASH", [second.id]],
    ]) {
      const result = await request(app)
        .get(`/api/admin/bookings${query}`)
        .set("Cookie", adminCookie)
        .expect(200);
      assert.deepEqual(result.body.rows.map((r) => r.id).sort(), ids.sort());
    }
    await request(app)
      .get("/api/admin/bookings?format=csv&date=2026-11-05")
      .set("Cookie", adminCookie)
      .expect(200);
    const own = await request(app)
      .get("/api/admin/checkins")
      .set("Cookie", await cookie(scannerId, "SCANNER"))
      .expect(200);
    assert.equal(own.body.length, 1);
    const otherScanner = randomUUID();
    await db.run(
      "INSERT INTO users (id,name,email,passwordHash,role,createdAt) SELECT ?,name,?,passwordHash,role,createdAt FROM users WHERE id = ?",
      [otherScanner, "other-scanner@example.com", scannerId],
    );
    const other = await request(app)
      .get("/api/admin/checkins")
      .set("Cookie", await cookie(otherScanner, "SCANNER"))
      .expect(200);
    assert.equal(other.body.length, 0);
    const all = await request(app)
      .get("/api/admin/checkins")
      .set("Cookie", adminCookie)
      .expect(200);
    assert.equal(all.body.length, 1);
  }));

test("admin database failures log safe diagnostics without exposing SQL or customer data", () =>
  fixture(async (db) => {
    const adminId = await staff(db);
    const token = await signSession({ userId: adminId, role: "ADMIN" }, true);
    const logs = [];
    const originalError = console.error;
    const failingDb = {
      ...db,
      all: async (sql, values) => {
        if (sql.includes("p.status AS paymentStatus"))
          throw Object.assign(new Error("private password and guest details"), {
            code: "ER_BAD_FIELD_ERROR",
            errno: 1054,
            sqlState: "42S22",
            sql: "private SQL and values",
          });
        return db.all(sql, values);
      },
    };
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const response = await request(createApp(failingDb))
        .get("/api/admin/dashboard")
        .set("Cookie", `santa_staff_session=${token}`)
        .expect(500);
      assert.match(response.body.requestId, /^[a-f0-9-]{36}$/);
      assert.match(logs[0], /ER_BAD_FIELD_ERROR/);
      assert.match(logs[0], /1054/);
      assert.match(logs[0], /42S22/);
      assert.ok(logs[0].includes(response.body.requestId));
      assert.doesNotMatch(logs[0], /private|password|guest details/);
      assert.doesNotMatch(
        JSON.stringify(response.body),
        /ER_BAD_FIELD_ERROR|private/,
      );
    } finally {
      console.error = originalError;
    }
  }));

test("staff and customer sessions coexist in one browser without replacing admin permissions", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const browser = request.agent(app);
    const login = () =>
      browser
        .post("/api/auth/login")
        .set("Origin", config.origin)
        .send({ email: "admin@santasocial.local", password: "SantaDemo2026!" })
        .expect(200);
    await login();
    const sent = await browser
      .post("/api/otp/send")
      .set("Origin", config.origin)
      .send({ mobile: "9876543210" })
      .expect(200);
    await browser
      .post("/api/otp/verify")
      .set("Origin", config.origin)
      .send({
        mobile: "9876543210",
        challengeId: sent.body.challengeId,
        otp: sent.body.demoCode,
      })
      .expect(200);
    await browser.get("/api/admin/dashboard").expect(200);
    const staffIdentity = await browser
      .get("/api/auth/me?scope=staff")
      .expect(200);
    assert.equal(staffIdentity.body.role, "ADMIN");
    const customerIdentity = await browser
      .get("/api/auth/me?scope=customer")
      .expect(200);
    assert.equal(customerIdentity.body.mobile, "9876543210");
    const otherBooking = await createBooking(
      db,
      booking(),
      "9123456789",
      randomUUID(),
    );
    await browser.get(`/api/bookings/${otherBooking.id}`).expect(200);
    await browser
      .post("/api/auth/logout")
      .set("Origin", config.origin)
      .send({ scope: "staff" })
      .expect(200);
    await browser.get("/api/auth/me?scope=staff").expect(401);
    await browser.get("/api/auth/me?scope=customer").expect(200);
    await browser.get("/api/admin/dashboard").expect(403);
    await browser.get(`/api/bookings/${otherBooking.id}`).expect(403);
    await login();
    await browser.get("/api/auth/me?scope=customer").expect(200);
    await browser
      .post("/api/auth/logout")
      .set("Origin", config.origin)
      .send({ scope: "customer" })
      .expect(200);
    await browser.get("/api/auth/me?scope=customer").expect(401);
    await browser.get("/api/admin/dashboard").expect(200);
  }));

test("legacy staff cookies migrate without extending the signed session and staff logout revokes them", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const browser = request.agent(app);
    const token = await signSession(
      { userId: await staff(db), role: "ADMIN", name: "Legacy admin" },
      true,
    );
    const result = await browser
      .get("/api/auth/me?scope=staff")
      .set("Cookie", `santa_session=${token}`)
      .expect(200);
    assert.ok(
      result.headers["set-cookie"].some((cookie) =>
        cookie.startsWith(`santa_staff_session=${token};`),
      ),
    );
    await browser.get("/api/admin/dashboard").expect(200);
    await browser
      .post("/api/auth/logout")
      .set("Origin", config.origin)
      .set("Cookie", `santa_session=${token}`)
      .send({ scope: "staff" })
      .expect(200);
    await browser.get("/api/auth/me?scope=staff").expect(401);
  }));
async function staff(db, role = "ADMIN") {
  return (await db.all("SELECT id FROM users WHERE role = ?", [role]))[0].id;
}
test("one QR per group; cash requires approval; simultaneous entry has exactly one winner", () =>
  fixture(async (db) => {
    const b = await createBooking(db, booking(), "9876543210", randomUUID());
    assert.equal(publicBooking(b).qrToken, qrToken(b));
    await assert.rejects(verifyTicket(db, qrToken(b)), /PAYMENT PENDING/);
    await assert.rejects(approveCash(db, b.id, 1, await staff(db)), /match/);
    await approveCash(db, b.id, 200, await staff(db));
    const paid = await getBooking(db, b.id);
    assert.equal(paid.people, 3);
    assert.match(publicBooking(paid).qrToken, /^ss_[a-f\d]{64}$/);
    assert.equal((await db.all("SELECT * FROM payments")).length, 1);
    const scanner = await staff(db, "SCANNER");
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(
      keys.map((key) => checkin(db, qrToken(paid), scanner, key)),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await db.all("SELECT * FROM checkins")).length, 1);
    assert.equal((await db.all("SELECT * FROM checkins"))[0].people, 3);
    const won = results.findIndex((r) => r.status === "fulfilled");
    assert.equal(
      (await checkin(db, qrToken(paid), scanner, keys[won])).people,
      3,
    );
    await assert.rejects(verifyTicket(db, qrToken(paid)), /ALREADY CHECKED IN/);
    assert.ok(publicBooking(await getBooking(db, b.id)).qrToken);
  }));
test("registration exceeds the old attendance estimate and ignores legacy daily limits", () =>
  fixture(async (db) => {
    await db.run(
      "UPDATE events SET capacity = 20000, day5Capacity = 12, day6Capacity = 12 WHERE id = ?",
      ["santa-2026"],
    );
    const results = await Promise.allSettled(
      Array.from({ length: 1001 }, (_, i) =>
        createBooking(
          db,
          booking({
            adults: 19,
            kids: 1,
            eventDate: i % 2 ? "2026-11-05" : "2026-11-06",
          }),
          `98${String(i).padStart(8, "0")}`,
          randomUUID(),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1001);
    assert.equal(
      Number((await db.all("SELECT SUM(people) AS n FROM bookings"))[0].n),
      20020,
    );
    const available = await availability(db);
    assert.equal(available.unlimited, true);
    assert.equal(available.capacity, null);
    assert.equal(available.remaining, null);
    assert.ok(available.days.every((day) => day.remaining === null));
    const app = createApp(db);
    const event = await request(app).get("/api/events").expect(200);
    assert.equal(event.body.event.capacity, null);
    assert.equal(event.body.event.cashHoldMinutes, null);
    const userId = await staff(db);
    const cookie = `santa_staff_session=${await signSession({ userId, role: "ADMIN" }, true)}`;
    const updated = await request(app)
      .put("/api/admin/settings")
      .set("Origin", config.origin)
      .set("Cookie", cookie)
      .send({
        capacity: 1,
        day5Capacity: 1,
        day6Capacity: 1,
        maxGroup: 20,
        holdMinutes: 5,
        cashHoldMinutes: 5,
        allowKidsOnly: 0,
      })
      .expect(200);
    assert.equal(updated.body.unlimited, true);
    assert.equal(updated.body.capacity, null);
    assert.equal(updated.body.holdMinutes, null);
    await createBooking(db, booking(), "9876543210", randomUUID());
  }));

test("idempotent registration, duplicate payment callbacks and duplicate webhook settlement", () =>
  fixture(async (db) => {
    const key = randomUUID();
    const input = booking({ method: "RAZORPAY" });
    const b = await createBooking(db, input, "9876543210", key);
    assert.equal((await createBooking(db, input, "9876543210", key)).id, b.id);
    await assert.rejects(
      createBooking(db, { ...input, kids: 4 }, "9876543210", key),
      /already in use/,
    );
    await db.run("UPDATE payments SET orderId = ? WHERE bookingId = ?", [
      "order_test",
      b.id,
    ]);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        settleCaptured(db, "order_test", "pay_test", 200, "INR", {
          id: "evt_one",
          type: "payment.captured",
        }),
      ),
    );
    await settleCaptured(db, "order_test", "pay_test", 200, "INR");
    assert.equal((await getBooking(db, b.id)).status, "PAID");
    assert.equal((await db.all("SELECT * FROM notification_logs")).length, 1);
    assert.equal((await db.all("SELECT * FROM webhook_events")).length, 1);
    await assert.rejects(
      settleCaptured(db, "order_test", "pay_fake", 1, "INR"),
      /match/,
    );
  }));
test("old payment deadlines do not expire bookings or reject captured payments", () =>
  fixture(async (db) => {
    await db.run("UPDATE events SET capacity = 3 WHERE id = ?", ["santa-2026"]);
    const first = await createBooking(
      db,
      booking({ method: "RAZORPAY" }),
      "9876543210",
      randomUUID(),
    );
    await db.run("UPDATE payments SET orderId = ? WHERE bookingId = ?", [
      "order_expired",
      first.id,
    ]);
    await db.run("UPDATE bookings SET holdUntil = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      first.id,
    ]);
    const replacement = await createBooking(
      db,
      booking(),
      "9876543211",
      randomUUID(),
    );
    assert.equal((await getBooking(db, first.id)).status, "PENDING_PAYMENT");
    await settleCaptured(db, "order_expired", "pay_expired", 200, "INR");
    assert.equal((await getBooking(db, first.id)).status, "PAID");
    assert.ok(publicBooking(await getBooking(db, first.id)).qrToken);
    assert.equal((await availability(db)).remaining, null);
    assert.equal(replacement.people, 3);
  }));
test("late captured payment stays valid and wrong event date is rejected", () =>
  fixture(async (db) => {
    const b = await createBooking(
      db,
      booking({ method: "RAZORPAY", eventDate: "2026-11-06" }),
      "9876543210",
      randomUUID(),
    );
    await db.run("UPDATE payments SET orderId = ? WHERE bookingId = ?", [
      "order_late",
      b.id,
    ]);
    await db.run("UPDATE bookings SET holdUntil = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      b.id,
    ]);
    await settleCaptured(db, "order_late", "pay_late", 200, "INR");
    assert.equal((await getBooking(db, b.id)).status, "PAID");
    await assert.rejects(verifyTicket(db, qrToken(b)), /cannot be used/);
    await expire(db);
    assert.equal((await getBooking(db, b.id)).status, "PAID");
  }));
test("children-only free admission remains policy-controlled", () =>
  fixture(async (db) => {
    await assert.rejects(
      createBooking(
        db,
        booking({ adults: 0, kids: 2 }),
        "9876543210",
        randomUUID(),
      ),
      /supervising/,
    );
    await db.run("UPDATE events SET allowKidsOnly = 1 WHERE id = ?", [
      "santa-2026",
    ]);
    const b = await createBooking(
      db,
      booking({ adults: 0, kids: 2 }),
      "9876543210",
      randomUUID(),
    );
    assert.equal(b.status, "FREE");
    assert.equal(b.amount, 0);
    assert.ok(publicBooking(b).qrToken);
    assert.equal((await availability(db)).remaining, null);
  }));
test("API journey: OTP, booking, demo payment, ticket retrieval, PDF and role restrictions", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const customer = request.agent(app);
    const mutate = (path, body) =>
      customer.post(path).set("Origin", config.origin).send(body);
    await customer.get("/api/admin/bookings").expect(401);
    await customer
      .post("/api/otp/send")
      .send({ mobile: "9876543210" })
      .expect(403);
    const otp = await mutate("/api/otp/send", { mobile: "9876543210" });
    assert.equal(otp.status, 200);
    const verify = await mutate("/api/otp/verify", {
      mobile: "9876543210",
      challengeId: otp.body.challengeId,
      otp: otp.body.demoCode,
    });
    assert.equal(verify.status, 200);
    await mutate("/api/otp/verify", {
      mobile: "9876543210",
      challengeId: otp.body.challengeId,
      otp: otp.body.demoCode,
    }).then((r) => assert.equal(r.status, 400));
    const response = await customer
      .post("/api/bookings")
      .set("Origin", config.origin)
      .set("Idempotency-Key", randomUUID())
      .send(booking({ method: "RAZORPAY", amount: 1 }));
    assert.equal(response.status, 201);
    const b = response.body;
    assert.equal(b.amount, 200);
    assert.equal(b.qrToken, null);
    await customer.get(`/api/tickets/${b.id}`).expect(403);
    await mutate("/api/payments/razorpay/order", { bookingId: b.id }).then(
      (r) => assert.equal(r.status, 200),
    );
    const paid = await mutate("/api/demo/payments/complete", {
      bookingId: b.id,
    });
    assert.equal(paid.body.status, "PAID");
    assert.ok(paid.body.qrToken);
    await request(app)
      .get(`/api/tickets/${b.id}/download?format=png`)
      .set("Authorization", `Bearer ${paid.body.qrToken}`)
      .expect(200)
      .expect("Content-Type", /png/);
    await request(app).get(`/api/tickets/${b.id}/download`).expect(403);
    await request(app)
      .get(`/api/tickets/${b.id}/download`)
      .set("Authorization", `Bearer ss_${"0".repeat(64)}`)
      .expect(403);
    await customer
      .get(`/api/tickets/${b.id}/download`)
      .expect(200)
      .expect("Content-Type", /pdf/);
    const recovered = await mutate("/api/tickets/retrieve", {});
    assert.equal(recovered.body.length, 1);
    const stranger = request.agent(app);
    await stranger.get(`/api/tickets/${b.id}`).expect(403);
    await stranger
      .get(`/api/tickets/${b.id}`)
      .set("Authorization", `Bearer ${paid.body.qrToken}`)
      .expect(200);
    await mutate("/api/admin/bookings/" + b.id + "/approve", {
      amountReceived: 200,
    }).then((r) => assert.equal(r.status, 403));
    const gate = request.agent(app);
    await gate
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({ email: "scanner@santasocial.local", password: "SantaDemo2026!" })
      .expect(200);
    await gate.get("/api/admin/bookings").expect(403);
    await gate
      .post("/api/scanner/verify")
      .set("Origin", config.origin)
      .send({ token: paid.body.qrToken })
      .expect(200);
    await gate
      .post("/api/scanner/checkin")
      .set("Origin", config.origin)
      .set("Idempotency-Key", randomUUID())
      .send({ token: paid.body.qrToken })
      .expect(200);
    await gate
      .post("/api/scanner/verify")
      .set("Origin", config.origin)
      .send({ token: paid.body.qrToken })
      .expect(409);
  }));
test("15 scanning requests remain correct for independent groups", () =>
  fixture(async (db) => {
    const scanner = await staff(db, "SCANNER");
    const admin = await staff(db);
    const bookings = [];
    for (let i = 0; i < 15; i++) {
      const b = await createBooking(db, booking(), "9876543210", randomUUID());
      await approveCash(db, b.id, 200, admin);
      bookings.push(b);
    }
    const entered = await Promise.all(
      bookings.map((b) => checkin(db, qrToken(b), scanner, randomUUID())),
    );
    assert.equal(
      entered.reduce((n, b) => n + b.people, 0),
      45,
    );
  }));
test("signature comparison rejects malformed values and authenticates the original bytes", () => {
  const signature = hmac('{"event":"payment.captured"}', "secret");
  assert.ok(equal(signature, hmac('{"event":"payment.captured"}', "secret")));
  assert.equal(
    equal(signature, hmac('{ "event":"payment.captured" }', "secret")),
    false,
  );
  assert.equal(equal(signature, "invalid"), false);
});
test("failed WhatsApp delivery is retryable and cannot invalidate a paid ticket", () =>
  fixture(async (db) => {
    const b = await createBooking(db, booking(), "9876543210", randomUUID());
    await approveCash(db, b.id, 200, await staff(db));
    const original = publicBooking(await getBooking(db, b.id)).qrToken;
    await dispatchNotifications(db, {
      async sendOtp() {},
      async sendNotification() {
        throw new Error("provider unavailable");
      },
    });
    const logs = await db.all("SELECT * FROM notification_logs");
    assert.ok(
      logs.some(
        (log) =>
          log.type === "TICKET" && log.status === "RETRY" && log.attempts === 1,
      ),
    );
    assert.ok(
      logs.some(
        (log) => log.type === "CASH_PENDING" && log.status === "SUPERSEDED",
      ),
    );
    assert.equal((await getBooking(db, b.id)).status, "PAID");
    assert.equal(publicBooking(await getBooking(db, b.id)).qrToken, original);
  }));
test("expired OTP cannot verify a mobile or authorise a booking", () =>
  fixture(async (db) => {
    const customer = request.agent(createApp(db));
    const sent = await customer
      .post("/api/otp/send")
      .set("Origin", config.origin)
      .send({ mobile: "9876543218" })
      .expect(200);
    await db.run("UPDATE otp_verifications SET expiresAt = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      sent.body.challengeId,
    ]);
    await customer
      .post("/api/otp/verify")
      .set("Origin", config.origin)
      .send({
        mobile: "9876543218",
        challengeId: sent.body.challengeId,
        otp: sent.body.demoCode,
      })
      .expect(400);
    await customer.get("/api/auth/me").expect(401);
    await customer
      .post("/api/bookings")
      .set("Origin", config.origin)
      .set("Idempotency-Key", randomUUID())
      .send(booking())
      .expect(401);
  }));

test("OTP maximum attempts is enforced even if the final submitted code is correct", () =>
  fixture(async (db) => {
    const app = createApp(db);
    const customer = request.agent(app);
    const send = await customer
      .post("/api/otp/send")
      .set("Origin", config.origin)
      .send({ mobile: "9876543219" })
      .expect(200);
    const body = {
      mobile: "9876543219",
      challengeId: send.body.challengeId,
      otp: "000000",
    };
    for (let i = 0; i < 5; i++)
      await customer
        .post("/api/otp/verify")
        .set("Origin", config.origin)
        .send(body)
        .expect(400);
    await customer
      .post("/api/otp/verify")
      .set("Origin", config.origin)
      .send({ ...body, otp: send.body.demoCode })
      .expect(400);
    await customer.get("/api/auth/me").expect(401);
  }));

test("IST calendar date uses the server instant across midnight, independent of device timezone", () => {
  assert.equal(istCalendarDate(new Date("2026-11-04T18:29:59Z")), "2026-11-04");
  assert.equal(istCalendarDate(new Date("2026-11-04T18:30:00Z")), "2026-11-05");
  assert.equal(istCalendarDate(new Date("2026-11-05T18:29:59Z")), "2026-11-05");
  assert.equal(istCalendarDate(new Date("2026-11-05T18:30:00Z")), "2026-11-06");
});

test("scanner and direct approval APIs enforce both event days without consuming invalid QR tickets", () =>
  fixture(async (db) => {
    const originalDate = config.demoDate;
    try {
      const app = createApp(db);
      const admin = await staff(db);
      const cookie = `santa_staff_session=${await signSession({ userId: admin, role: "ADMIN" }, true)}`;
      const post = (path, body, key = randomUUID()) =>
        request(app)
          .post(path)
          .set("Origin", config.origin)
          .set("Cookie", cookie)
          .set("Idempotency-Key", key)
          .send(body);
      for (const ticketDay of ["2026-11-05", "2026-11-06"]) {
        for (const scanDay of [
          "2026-11-05",
          "2026-11-06",
          "2026-11-04",
          "2026-11-07",
        ]) {
          for (const method of ["CASH", "RAZORPAY"]) {
            config.demoDate = ticketDay;
            const b = await createBooking(
              db,
              booking({ eventDate: ticketDay, method }),
              "9876543210",
              randomUUID(),
            );
            if (method === "RAZORPAY") {
              const order = `order_date_${randomUUID()}`;
              await db.run(
                "UPDATE payments SET orderId = ? WHERE bookingId = ?",
                [order, b.id],
              );
              await settleCaptured(
                db,
                order,
                `pay_date_${randomUUID()}`,
                b.amount,
                "INR",
              );
            }
            const token = publicBooking(await getBooking(db, b.id)).qrToken;
            const body = {
              token,
              ...(method === "CASH" ? { amountReceived: b.amount } : {}),
            };
            config.demoDate = scanDay;
            const valid = ticketDay === scanDay;
            const scan = await post("/api/scanner/verify", { token }).expect(
              valid ? 200 : 400,
            );
            if (!valid) {
              assert.equal(scan.body.details.eventDate, ticketDay);
              assert.equal(scan.body.details.scanningDate, scanDay);
              assert.equal(
                scan.body.details.code,
                !["2026-11-05", "2026-11-06"].includes(scanDay)
                  ? "NOT_EVENT_DAY"
                  : ticketDay < scanDay
                    ? "PAST_EVENT_DATE"
                    : "FUTURE_EVENT_DATE",
              );
              assert.match(
                scan.body.error,
                /This ticket is registered for November/,
              );
              await post("/api/scanner/checkin", body).expect(400);
              if (method === "CASH")
                await post(`/api/admin/bookings/${b.id}/approve`, {
                  amountReceived: b.amount,
                }).expect(400);
              const unchanged = await getBooking(db, b.id);
              assert.equal(
                unchanged.status,
                method === "CASH" ? "PENDING_CASH" : "PAID",
              );
              assert.equal(unchanged.checkedInAt, null);
              assert.equal(
                (
                  await db.all("SELECT * FROM checkins WHERE bookingId = ?", [
                    b.id,
                  ])
                ).length,
                0,
              );
            }
            config.demoDate = ticketDay;
            await post("/api/scanner/verify", { token }).expect(200);
            await post("/api/scanner/checkin", body).expect(200);
            await post("/api/scanner/checkin", body).expect(409);
          }
        }
      }
    } finally {
      config.demoDate = originalDate;
    }
  }));

test("date rollover preserves historical bookings, payment evidence and original QR while rejecting old dates for new bookings", () =>
  fixture(async (db) => {
    const b = await createBooking(db, booking(), "9876543210", randomUUID());
    // Historical fixture only: emulate a pre-change customer record, never migrate it.
    const historicalDate = "2026-12-05";
    await db.run("UPDATE bookings SET eventDate = ? WHERE id = ?", [
      historicalDate,
      b.id,
    ]);
    const before = await getBooking(db, b.id);
    const paymentsBefore = await db.all(
      "SELECT * FROM payments WHERE bookingId = ?",
      [b.id],
    );
    await migrate(db);
    const after = await getBooking(db, b.id);
    assert.deepEqual(after, before);
    assert.deepEqual(
      await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id]),
      paymentsBefore,
    );
    assert.equal(publicBooking(after).qrToken, publicBooking(before).qrToken);
    const app = createApp(db);
    const adminId = await staff(db);
    const adminCookie = `santa_staff_session=${await signSession({ userId: adminId, role: "ADMIN" }, true)}`;
    const customerCookie = `santa_session=${await signSession({ mobile: b.mobile })}`;
    for (const eventDate of [
      historicalDate,
      "2026-12-06",
      "2026-11-10",
      "2026-11-11",
    ]) {
      await request(app)
        .post("/api/bookings")
        .set("Origin", config.origin)
        .set("Cookie", customerCookie)
        .set("Idempotency-Key", randomUUID())
        .send(booking({ eventDate }))
        .expect(400);
    }
    const history = await request(app)
      .get(`/api/admin/bookings?date=${historicalDate}`)
      .set("Cookie", adminCookie)
      .expect(200);
    assert.equal(history.body.rows[0].eventDate, historicalDate);
    const scan = await request(app)
      .post("/api/scanner/verify")
      .set("Origin", config.origin)
      .set("Cookie", adminCookie)
      .send({ token: publicBooking(after).qrToken })
      .expect(400);
    assert.equal(scan.body.details.eventDate, historicalDate);
    assert.deepEqual(await getBooking(db, b.id), before);
    const dates = await request(app).get("/api/events").expect(200);
    assert.deepEqual(
      dates.body.event.days.map((d) => d.date),
      ["2026-11-05", "2026-11-06"],
    );
  }));

test("previous November bookings retain their payment state and QR and cannot be admitted on new dates", () =>
  fixture(async (db) => {
    const admin = await staff(db);
    const previousDate = config.demoDate;
    try {
      for (const oldDate of ["2026-11-10", "2026-11-11"]) {
        const b = await createBooking(
          db,
          booking(),
          "9876543210",
          randomUUID(),
        );
        await db.run("UPDATE bookings SET eventDate = ? WHERE id = ?", [
          oldDate,
          b.id,
        ]);
        const before = await getBooking(db, b.id);
        const payments = await db.all(
          "SELECT * FROM payments WHERE bookingId = ?",
          [b.id],
        );
        await migrate(db);
        assert.deepEqual(await getBooking(db, b.id), before);
        for (const newDate of ["2026-11-05", "2026-11-06"]) {
          config.demoDate = newDate;
          await assert.rejects(
            checkin(
              db,
              publicBooking(before).qrToken,
              admin,
              randomUUID(),
              b.amount,
            ),
            /cannot be used/,
          );
          await assert.rejects(
            approveCash(db, b.id, b.amount, admin),
            /cannot be used/,
          );
          assert.deepEqual(await getBooking(db, b.id), before);
          assert.deepEqual(
            await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id]),
            payments,
          );
        }
      }
    } finally {
      config.demoDate = previousDate;
    }
  }));

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
} from "../src/services.js";
import { equal, hmac, qrToken, signSession } from "../src/security.js";
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
  eventDate: "2026-12-05",
  adults: 2,
  kids: 1,
  method: "CASH",
  ...extra,
});

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
      booking({ eventDate: "2026-12-06", name: "Sunday Guest" }),
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
      ["2026-12-05", 1],
      ["2026-12-06", 1],
    ]) {
      const result = await request(app)
        .get(`/api/admin/dashboard?date=${date}`)
        .set("Cookie", adminCookie)
        .expect(200);
      assert.equal(result.body.bookings, count);
    }
    for (const [query, ids] of [
      ["", [record.id, second.id]],
      ["?date=2026-12-05&status=PAID", [record.id]],
      ["?date=2026-12-06&q=Sunday", [second.id]],
      ["?status=PENDING_CASH", [second.id]],
    ]) {
      const result = await request(app)
        .get(`/api/admin/bookings${query}`)
        .set("Cookie", adminCookie)
        .expect(200);
      assert.deepEqual(result.body.rows.map((r) => r.id).sort(), ids.sort());
    }
    await request(app)
      .get("/api/admin/bookings?format=csv&date=2026-12-05")
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
    assert.equal(publicBooking(b).qrToken, null);
    await assert.rejects(verifyTicket(db, qrToken(b)), /INVALID TICKET/);
    await assert.rejects(approveCash(db, b.id, 1, await staff(db)), /match/);
    await approveCash(db, b.id, 40000, await staff(db));
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
test("100 simultaneous reservations never exceed combined or daily capacity; free kids count", () =>
  fixture(async (db) => {
    await db.run(
      "UPDATE events SET capacity = 17, day5Capacity = 12 WHERE id = ?",
      ["santa-2026"],
    );
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        createBooking(
          db,
          booking({
            adults: 1,
            kids: 1,
            eventDate: i % 2 ? "2026-12-05" : "2026-12-06",
          }),
          `98${String(i).padStart(8, "0")}`,
          randomUUID(),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 8);
    assert.equal((await availability(db)).remaining, 1);
    const counts = await db.all(
      "SELECT eventDate,SUM(people) AS n FROM bookings GROUP BY eventDate",
    );
    for (const c of counts) assert.ok(c.n <= 12);
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
        settleCaptured(db, "order_test", "pay_test", 40000, "INR", {
          id: "evt_one",
          type: "payment.captured",
        }),
      ),
    );
    await settleCaptured(db, "order_test", "pay_test", 40000, "INR");
    assert.equal((await getBooking(db, b.id)).status, "PAID");
    assert.equal((await db.all("SELECT * FROM notification_logs")).length, 1);
    assert.equal((await db.all("SELECT * FROM webhook_events")).length, 1);
    await assert.rejects(
      settleCaptured(db, "order_test", "pay_fake", 1, "INR"),
      /match/,
    );
  }));
test("expired holds release capacity; captured payments without room enter review", () =>
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
    assert.equal((await getBooking(db, first.id)).status, "EXPIRED");
    await settleCaptured(db, "order_expired", "pay_expired", 40000, "INR");
    assert.equal((await getBooking(db, first.id)).status, "PAYMENT_REVIEW");
    assert.equal(publicBooking(await getBooking(db, first.id)).qrToken, null);
    assert.equal((await availability(db)).remaining, 0);
    assert.equal(replacement.people, 3);
  }));
test("late captured payment reacquires available inventory and wrong event date is rejected", () =>
  fixture(async (db) => {
    const b = await createBooking(
      db,
      booking({ method: "RAZORPAY", eventDate: "2026-12-06" }),
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
    await settleCaptured(db, "order_late", "pay_late", 40000, "INR");
    assert.equal((await getBooking(db, b.id)).status, "PAID");
    await assert.rejects(verifyTicket(db, qrToken(b)), /WRONG EVENT DATE/);
    await expire(db);
    assert.equal((await getBooking(db, b.id)).status, "PAID");
  }));
test("children-only free admission is policy-controlled and still reserves people", () =>
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
    assert.equal((await availability(db)).remaining, 19998);
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
    assert.equal(b.amount, 40000);
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
      amountReceived: 40000,
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
      await approveCash(db, b.id, 40000, admin);
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
    await approveCash(db, b.id, 40000, await staff(db));
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

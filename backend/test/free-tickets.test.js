import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { createAdmin, provisionStaff } from "../src/admin-accounts.js";
import { createApp } from "../src/app.js";
import { config, databaseDriver } from "../src/config.js";
import { migrate, openDatabase } from "../src/db.js";
import { signSession } from "../src/security.js";
import { complimentaryIssueAction } from "../src/services.js";

test("only Mathu issues idempotent, auditable free group tickets that staff can admit", async () => {
  assert.equal(databaseDriver, "sqlite");
  process.env.DEMO_DB_PATH = resolve(
    `data/free-tickets-${randomUUID()}.sqlite`,
  );
  const db = await openDatabase();
  const previousDate = config.demoDate;
  config.demoDate = "2026-11-21";
  try {
    await migrate(db);
    const email = "mathu.y@thinkcodesoft.com";
    const password = "Local free ticket QA password!";
    const mathu = await createAdmin(db, { name: "Mathu", email, password });
    const other = await createAdmin(db, {
      name: "Other admin",
      email: "other-admin@example.test",
      password,
    });
    const staff = await provisionStaff(db, {
      name: "Gate staff",
      email: "sivaraj@therushrepublic.com",
      password,
    });
    const scanner = await createAdmin(db, {
      name: "Scanner operator",
      email: "scanner-qa@example.test",
      password,
    });
    await db.run("UPDATE users SET role = ? WHERE id = ?", ["SCANNER", scanner.id]);
    const app = createApp(db);
    const login = async (accountEmail) => {
      const response = await request(app)
        .post("/api/auth/login")
        .set("Origin", config.origin)
        .send({ email: accountEmail, password })
        .expect(200);
      return response.headers["set-cookie"]
        .find((cookie) => cookie.startsWith("santa_staff_session="))
        .split(";")[0];
    };
    const mathuCookie = await login(email);
    const otherCookie = await login(other.email);
    const staffCookie = await login(staff.email);
    const scannerCookie = await login(scanner.email);
    const customerCookie = `santa_session=${await signSession({ mobile: "9876543210" })}`;
    const route = "/api/admin/free-tickets";
    const input = {
      name: "Sample Guest",
      mobile: "9876543210",
      eventDate: "2026-11-21",
      adults: 3,
      kids: 2,
    };
    const post = (path, payload, cookie, key = randomUUID()) =>
      request(app)
        .post(path)
        .set("Origin", config.origin)
        .set("Cookie", cookie)
        .set("Idempotency-Key", key)
        .send(payload);

    await request(app).get(route).expect(401);
    await post(route, input, "").expect(401);
    for (const cookie of [otherCookie, staffCookie, scannerCookie, customerCookie]) {
      await request(app).get(route).set("Cookie", cookie).expect(403);
      await post(route, { ...input, email }, cookie).expect(403);
    }
    for (const [cookie, allowed] of [
      [mathuCookie, true],
      [otherCookie, false],
      [staffCookie, false],
    ]) {
      const { body } = await request(app)
        .get("/api/auth/me?scope=staff")
        .set("Cookie", cookie)
        .expect(200);
      assert.equal(body.canIssueFreeTickets, allowed);
    }
    // The role is reloaded from the account even when a previous admin cookie is used.
    await db.run("UPDATE users SET role = ? WHERE id = ?", ["staff", mathu.id]);
    await post(route, input, mathuCookie).expect(403);
    await db.run("UPDATE users SET role = ? WHERE id = ?", ["ADMIN", mathu.id]);

    await db.run("UPDATE users SET active = 0 WHERE id = ?", [mathu.id]);
    await post(route, input, mathuCookie).expect(401);
    await db.run("UPDATE users SET active = 1 WHERE id = ?", [mathu.id]);

    const { body: settings } = await request(app)
      .get(route)
      .set("Cookie", mathuCookie)
      .expect(200);
    assert.deepEqual(
      settings.days.map(({ date, bookable }) => [date, bookable]),
      [
        ["2026-11-21", true],
        ["2026-11-22", true],
      ],
    );
    for (const change of [
      { name: " " },
      { mobile: "1234567890" },
      { adults: -1 },
      { adults: 0, kids: 0 },
      { adults: 0, kids: 2 },
      { adults: settings.maxGroup, kids: 1 },
      { eventDate: "2026-11-19" },
      { eventDate: "2026-11-20" },
      { eventDate: "2026-11-23" },
    ]) {
      await post(route, { ...input, ...change }, mathuCookie).expect(400);
    }
    await post(
      "/api/bookings",
      { ...input, method: "FREE" },
      customerCookie,
    ).expect(400);

    const key = randomUUID();
    const [first, retry] = await Promise.all([
      post(
        route,
        { ...input, amount: 999, method: "RAZORPAY" },
        mathuCookie,
        key,
      ).expect(201),
      post(route, input, mathuCookie, key).expect(201),
    ]);
    assert.deepEqual(first.body, retry.body);
    await post(route, { ...input, kids: 1 }, mathuCookie, key).expect(409);
    const { id, qrToken } = first.body;
    assert.match(qrToken, /^ss_[a-f\d]{64}$/);
    const [booking] = await db.all("SELECT * FROM bookings");
    assert.deepEqual(
      [
        booking.id,
        booking.people,
        booking.amount,
        booking.method,
        booking.status,
      ],
      [id, 5, 0, "FREE", "FREE"],
    );
    assert.equal((await db.all("SELECT id FROM bookings")).length, 1);
    assert.equal(
      (await db.all("SELECT bookingId FROM ticket_batches")).length,
      0,
    );
    assert.equal((await db.all("SELECT id FROM individual_tickets")).length, 0);
    assert.equal((await db.all("SELECT id FROM otp_verifications")).length, 0);
    assert.equal((await db.all("SELECT id FROM notification_logs")).length, 0);
    const [payment] = await db.all("SELECT * FROM payments");
    assert.deepEqual(
      [payment.amount, payment.status, payment.orderId, payment.paymentId],
      [0, "FREE", null, null],
    );
    const [audit] = await db.all("SELECT * FROM audit_logs WHERE action = ?", [
      complimentaryIssueAction,
    ]);
    assert.equal(audit.userId, mathu.id);
    assert.equal(audit.entityId, id);
    assert.ok(Date.parse(audit.createdAt));
    assert.equal(
      (
        await db.all("SELECT id FROM audit_logs WHERE action = ?", [
          complimentaryIssueAction,
        ])
      ).length,
      1,
    );

    const receipt = `/api/tickets/${id}`;
    await request(app).get(receipt).expect(403);
    const { body: ticket } = await request(app)
      .get(receipt)
      .set("Authorization", `Bearer ${qrToken}`)
      .expect(200);
    assert.deepEqual(
      [
        ticket.ticketSubtotal,
        ticket.platformFee,
        ticket.amount,
        ticket.entryMode,
      ],
      [0, 0, 0, "GROUP"],
    );
    const { body: details } = await request(app)
      .get(`/api/admin/bookings/${id}`)
      .set("Cookie", otherCookie)
      .expect(200);
    assert.equal(details.issuance.name, "Mathu");
    assert.equal(details.issuance.createdAt, audit.createdAt);

    const verify = () =>
      post("/api/scanner/verify", { token: qrToken }, staffCookie);
    const checkin = (cookie) =>
      post("/api/scanner/checkin", { token: qrToken }, cookie);
    config.demoDate = "2026-11-22";
    assert.equal(
      (await verify().expect(400)).body.details.eventDate,
      input.eventDate,
    );
    await checkin(staffCookie).expect(400);
    await post(route, input, mathuCookie).expect(400);
    const overdueRetry = await post(route, input, mathuCookie, key).expect(201);
    assert.deepEqual(overdueRetry.body, first.body);
    config.demoDate = "2026-11-21";
    const { body: scan } = await verify().expect(200);
    assert.equal(scan.status, "FREE");
    assert.equal(scan.people, 5);
    assert.ok(!scan.ticket);
    const attempts = await Promise.all([
      checkin(scannerCookie),
      checkin(staffCookie),
    ]);
    assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(
      (await verify().expect(409)).body.details.code,
      "ALREADY_CHECKED_IN",
    );
    const [entry] = await db.all("SELECT * FROM checkins");
    assert.deepEqual([entry.adults, entry.kids, entry.people], [3, 2, 5]);
    const { body: counts } = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", otherCookie)
      .expect(200);
    assert.deepEqual(
      [
        counts.bookings,
        counts.attendees,
        counts.entered,
        counts.revenue,
        counts.pendingCash,
        counts.approvedGroupEntries,
      ],
      [1, 5, 5, 0, 0, 1],
    );

    const { body: sunday } = await post(
      route,
      { ...input, eventDate: "2026-11-22" },
      mathuCookie,
    ).expect(201);
    const { body: sundayTicket } = await request(app)
      .get(`/api/tickets/${sunday.id}`)
      .set("Authorization", `Bearer ${sunday.qrToken}`)
      .expect(200);
    assert.equal(sundayTicket.eventDate, "2026-11-22");
    assert.equal(sundayTicket.amount, 0);
    const sundayScan = (path) =>
      post(path, { token: sunday.qrToken }, staffCookie);
    await sundayScan("/api/scanner/verify").expect(400);
    config.demoDate = "2026-11-22";
    assert.equal(
      (await sundayScan("/api/scanner/verify").expect(200)).body.eventDate,
      sundayTicket.eventDate,
    );
    await sundayScan("/api/scanner/checkin").expect(200);
    await sundayScan("/api/scanner/verify").expect(409);
  } finally {
    config.demoDate = previousDate;
    await db.close();
  }
});

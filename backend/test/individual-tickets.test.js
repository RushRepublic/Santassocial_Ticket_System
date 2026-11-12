import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import sharp from "sharp";
import jsQR from "jsqr";
import { openDatabase, migrate } from "../src/db.js";
import { seed } from "../src/setup.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import {
  createBooking,
  getBooking,
  publicBooking,
  checkin,
  inspectTicket,
  settleCaptured,
} from "../src/services.js";
import { receiptTickets } from "../src/individual-tickets.js";
import { signSession, qrToken } from "../src/security.js";
import { renderTicketPng } from "../src/ticket-artwork.js";
async function fixture(work) {
  process.env.DEMO_DB_PATH = resolve(`data/individual-${randomUUID()}.sqlite`);
  const db = await openDatabase();
  const date = config.demoDate;
  config.demoDate = "2026-11-11";
  try {
    await migrate(db);
    await seed(db);
    const admin = (await db.all("SELECT id FROM users WHERE role='ADMIN'"))[0]
      .id;
    await work(db, admin);
  } finally {
    config.demoDate = date;
    await db.close();
  }
}
const input = (extra = {}) => ({
  name: "Individual QA",
  eventDate: "2026-11-11",
  adults: 3,
  kids: 2,
  method: "CASH",
  ...extra,
});
const book = (db, extra) =>
  createBooking(db, input(extra), "9876543210", randomUUID());
test("five unique tickets, atomic partial entry, remaining tickets, duplicate and audit history", () =>
  fixture(async (db, admin) => {
    const b = await book(db);
    const original = await receiptTickets(db, b);
    assert.equal(original.length, 5);
    assert.equal(new Set(original.map((t) => t.qrToken)).size, 5);
    assert.deepEqual(
      original.map((t) => t.category),
      ["ADULT", "ADULT", "ADULT", "KID", "KID"],
    );
    await assert.rejects(inspectTicket(db, qrToken(b)), /individual ticket/);
    await assert.rejects(
      checkin(db, qrToken(b), admin, randomUUID()),
      /individual ticket/,
    );
    const scanner = randomUUID();
    await db.run(
      "INSERT INTO users (id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,?,?)",
      [
        scanner,
        "Scanner",
        "individual-scanner@example.test",
        "unused-test-hash",
        "SCANNER",
        1,
        new Date().toISOString(),
      ],
    );
    await assert.rejects(
      checkin(db, original[0].qrToken, scanner, randomUUID(), b.amount),
      /Only an admin/,
    );
    assert.equal((await getBooking(db, b.id)).status, "PENDING_CASH");
    await assert.rejects(
      checkin(db, original[0].qrToken, admin, randomUUID(), b.amount - 1),
      /exact/,
    );
    const key = randomUUID();
    await checkin(db, original[0].qrToken, admin, key, b.amount);
    await checkin(db, original[0].qrToken, admin, key, b.amount); // network retry must not double-count
    for (const t of original.slice(1, 3))
      await checkin(db, t.qrToken, admin, randomUUID());
    let current = await getBooking(db, b.id);
    assert.equal(current.status, "PAID");
    assert.equal(current.entryStatus, "PARTIALLY_ENTERED");
    assert.equal(current.checkedInAt, null);
    assert.equal(current.approvedTickets, 3);
    let pending = await inspectTicket(db, original[3].qrToken);
    assert.equal(pending.pendingTickets.length, 2);
    assert.ok(pending.pendingTickets.every((t) => t.status === "NOT_SCANNED"));
    await assert.rejects(
      inspectTicket(db, original[0].qrToken),
      (e) =>
        e.details.code === "ALREADY_APPROVED" && Boolean(e.details.approvedAt),
    );
    const race = await Promise.allSettled([
      checkin(db, original[3].qrToken, admin, randomUUID()),
      checkin(db, original[3].qrToken, admin, randomUUID()),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    await checkin(db, original[4].qrToken, admin, randomUUID());
    current = await getBooking(db, b.id);
    assert.equal(current.entryStatus, "FULLY_ENTERED");
    assert.equal(current.approvedTickets, 5);
    assert.equal(
      (await db.all("SELECT people FROM checkins WHERE bookingId=?", [b.id]))[0]
        .people,
      5,
    );
    assert.equal(
      (
        await db.all(
          "SELECT id FROM audit_logs WHERE action='INDIVIDUAL_CHECKIN'",
        )
      ).length,
      5,
    );
    assert.deepEqual(
      (await receiptTickets(db, current)).map((t) => t.qrToken),
      original.map((t) => t.qrToken),
    );
    const app = createApp(db);
    const cookie = `santa_staff_session=${await signSession({ userId: admin, role: "ADMIN" }, true)}`;
    const dashboard = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookie)
      .expect(200);
    assert.equal(dashboard.body.entered, 5);
    const history = await request(app)
      .get("/api/admin/checkins")
      .set("Cookie", cookie)
      .expect(200);
    assert.equal(history.body.length, 5);
    assert.ok(history.body.every((t) => t.people === 1));
  }));
test("both IST event dates and wrong/outside days enforce API restrictions without consuming tickets", () =>
  fixture(async (db, admin) => {
    const app = createApp(db);
    const cookie = `santa_staff_session=${await signSession({ userId: admin, role: "ADMIN" }, true)}`;
    const bookings = [
      await book(db, { eventDate: "2026-11-11", adults: 1, kids: 0 }),
      await book(db, { eventDate: "2026-11-12", adults: 1, kids: 0 }),
    ];
    for (const day of ["2026-11-11", "2026-11-12", "2026-11-13"]) {
      config.demoDate = day;
      for (const b of bookings) {
        const [t] = await receiptTickets(db, b);
        const valid = day === b.eventDate;
        const verify = await request(app)
          .post("/api/scanner/verify")
          .set("Cookie", cookie)
          .set("Origin", config.origin)
          .send({ token: t.qrToken });
        assert.equal(verify.status, valid ? 200 : 400);
        if (!valid) {
          const approve = await request(app)
            .post("/api/scanner/checkin")
            .set("Cookie", cookie)
            .set("Origin", config.origin)
            .set("Idempotency-Key", randomUUID())
            .send({ token: t.qrToken, amountReceived: b.amount });
          assert.equal(approve.status, 400);
          assert.equal((await receiptTickets(db, b))[0].status, "NOT_SCANNED");
        }
      }
    }
    for (const b of bookings) {
      config.demoDate = b.eventDate;
      const [t] = await receiptTickets(db, b);
      await checkin(db, t.qrToken, admin, randomUUID(), b.amount);
    }
  }));
test("online issuance waits for server capture; receipt bearer protects all tickets and exports", () =>
  fixture(async (db) => {
    const b = await book(db, { method: "RAZORPAY" });
    assert.equal((await receiptTickets(db, b)).length, 0);
    await db.run("UPDATE payments SET orderId=? WHERE bookingId=?", [
      "order_individual",
      b.id,
    ]);
    await settleCaptured(
      db,
      "order_individual",
      "pay_individual",
      b.amount,
      "INR",
    );
    await settleCaptured(
      db,
      "order_individual",
      "pay_individual",
      b.amount,
      "INR",
    );
    const paid = await getBooking(db, b.id);
    const tickets = await receiptTickets(db, paid);
    assert.equal(tickets.length, 5);
    assert.equal(
      (await db.all("SELECT id FROM payments WHERE bookingId=?", [b.id]))
        .length,
      1,
    );
    const app = createApp(db);
    const bearer = publicBooking(paid).qrToken;
    await request(app).get(`/api/tickets/${b.id}`).expect(403);
    await request(app)
      .get(`/api/tickets/${b.id}`)
      .set("Authorization", `Bearer ${tickets[0].qrToken}`)
      .expect(403);
    const response = await request(app)
      .get(`/api/tickets/${b.id}`)
      .set("Authorization", `Bearer ${bearer}`)
      .expect(200);
    assert.equal(response.body.tickets.length, 5);
    await request(app)
      .get(`/api/tickets/${b.id}/download?format=png&ticketId=${randomUUID()}`)
      .set("Authorization", `Bearer ${bearer}`)
      .expect(404);
    const png = await renderTicketPng({
      ...paid,
      individualTicket: tickets[4],
    });
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(
      jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
      tickets[4].qrToken,
    );
    const pdf = await request(app)
      .get(`/api/tickets/${b.id}/download?format=pdf`)
      .set("Authorization", `Bearer ${bearer}`)
      .expect(200);
    assert.equal(
      (pdf.body.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
      5,
    );
  }));
test("single-ticket issuance and legacy used group remain unchanged through additive migration", () =>
  fixture(async (db, admin) => {
    const single = await book(db, { adults: 1, kids: 0 });
    assert.equal((await receiptTickets(db, single)).length, 1);
    // Simulate a record issued by the previous release, before the new tables existed.
    await db.run("DELETE FROM individual_tickets WHERE bookingId=?", [
      single.id,
    ]);
    await db.run("DELETE FROM ticket_batches WHERE bookingId=?", [single.id]);
    await checkin(db, qrToken(single), admin, randomUUID(), single.amount);
    const before = await getBooking(db, single.id);
    await migrate(db);
    const after = await getBooking(db, single.id);
    assert.equal(after.checkedInAt, before.checkedInAt);
    assert.equal(after.entryMode, "GROUP");
    assert.equal((await receiptTickets(db, after)).length, 0);
    await assert.rejects(
      inspectTicket(db, qrToken(after)),
      /ALREADY CHECKED IN/,
    );
  }));

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import request from "supertest";
import { createAdmin } from "../src/admin-accounts.js";
import { createApp } from "../src/app.js";
import { config, databaseDriver } from "../src/config.js";
import { migrate, openDatabase } from "../src/db.js";

const dayOne = "2026-12-05";
const dayTwo = "2026-12-06";

test("admin overview counts confirmed and total bookings and eligible sources by event day", async () => {
  assert.equal(databaseDriver, "sqlite");
  const folder = await mkdtemp(join(tmpdir(), "santa-dashboard-"));
  process.env.DEMO_DB_PATH = join(folder, "overview.sqlite");
  const db = await openDatabase();
  try {
    await migrate(db);
    const email = "overview@example.test";
    const password = "A unique test password 123";
    await createAdmin(db, { name: "Overview admin", email, password });

    let duplicateRow = false;
    const app = createApp({
      ...db,
      async all(sql, values) {
        const rows = await db.all(sql, values);
        if (duplicateRow && sql.startsWith("SELECT b.*,p.status AS paymentStatus,")) {
          const booking = rows.find((row) => row.status === "PAID");
          if (booking) rows.push({ ...booking });
        }
        return rows;
      },
    });
    await request(app).get("/api/admin/dashboard").expect(401);
    const admin = request.agent(app);
    await admin.post("/api/auth/login").set("Origin", config.origin)
      .send({ email, password }).expect(200);
    const dashboard = async (date = "all") =>
      (await admin.get("/api/admin/dashboard").query({ date }).expect(200)).body;
    const assertBookingCounts = ({ confirmedBookings, totalBookings }, expected) => {
      assert.deepEqual([confirmedBookings, totalBookings], expected);
      assert.ok(confirmedBookings <= totalBookings);
    };
    const empty = await dashboard();
    assert.deepEqual(empty.sources, []);
    assert.deepEqual(empty.discoverySources, []);
    assert.equal(empty.discoveryTotal, 0);
    assertBookingCounts(empty, [0, 0]);

    async function addBooking({
      source, eventDate = dayOne, method = "RAZORPAY", status = "PAID",
      paymentStatus = "CAPTURED", people = 1, discovery = "google",
    }) {
      const id = randomUUID();
      const createdAt = "2026-11-27T10:00:00.000Z";
      await db.run(
        `INSERT INTO bookings (id, reference, eventId, eventDate, name, mobile,
          email, adults, kids, people, amount, method, status, holdUntil,
          ticketNonce, createdAt, updatedAt, discoverySource, leadAttribution)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, id, "santa-2026", eventDate, "Test customer", "9876543210", "",
          people, 0, people, method === "FREE" ? 0 : 22000, method, status,
          createdAt, id, createdAt, createdAt, discovery,
          source ? JSON.stringify({ source, method: "utm" }) : null],
      );
      await db.run(
        "INSERT INTO payments (id, bookingId, amount, status) VALUES (?, ?, ?, ?)",
        [randomUUID(), id, method === "FREE" ? 0 : 22000, paymentStatus],
      );
    }

    await addBooking({ source: "Instagram", people: 4, discovery: " instagram " });
    await addBooking({ source: "Facebook", method: "CASH", people: 2, discovery: "word_of_mouth" });
    await addBooking({ source: "Google Ads" });
    await addBooking({ source: "Direct", discovery: "previous_visitor" });
    await addBooking({ discovery: null });
    await addBooking({ source: "Instagram", eventDate: dayTwo, discovery: "Instagram" });
    await addBooking({ source: "WhatsApp", eventDate: dayTwo, people: 6, discovery: "Word of Mouth" });
    await addBooking({ source: "Google Organic", eventDate: dayTwo });
    await addBooking({ source: "linktr.ee", eventDate: dayTwo, discovery: "<invalid>" });
    await addBooking({ source: "Pending online", status: "PENDING_PAYMENT", paymentStatus: "PENDING" });
    await addBooking({ source: "Failed online", status: "CANCELLED", paymentStatus: "FAILED" });
    await addBooking({ source: "Uncaptured online", status: "PAID", paymentStatus: "PENDING" });
    await addBooking({ source: "Pending cash", method: "CASH", status: "PENDING_CASH", paymentStatus: "PENDING" });
    await addBooking({ source: "Excluded free", method: "FREE", status: "FREE", paymentStatus: "FREE" });
    await addBooking({ status: "EXPIRED", paymentStatus: "PENDING" });
    await addBooking({ status: "PAYMENT_REVIEW" });
    await addBooking({ source: "Earlier event", eventDate: "2026-11-21" });

    const count = (source, bookings = 1) => ({ source, bookings });
    const bothDays = await dashboard();
    const firstDay = await dashboard(dayOne);
    const secondDay = await dashboard(dayTwo);
    const responses = (count, ...labels) => labels.map((label) => ({ label, count }));
    const common = ["Friends & Referrals", "Google", "Instagram", "Not specified"];
    assert.deepEqual(bothDays.discoverySources, [
      ...responses(2, ...common),
      ...responses(1, "Already visited Santa's Social"),
    ]);
    assert.deepEqual(firstDay.discoverySources, responses(1, "Already visited Santa's Social", ...common));
    assert.deepEqual(secondDay.discoverySources, responses(1, ...common));
    for (const summary of [bothDays, firstDay, secondDay]) {
      assert.equal(summary.discoveryTotal, summary.sources.reduce((sum, row) => sum + row.bookings, 0));
      assert.equal(summary.discoveryTotal, summary.discoverySources.reduce((sum, row) => sum + row.count, 0));
    }
    assertBookingCounts(bothDays, [10, 16]);
    assertBookingCounts(firstDay, [6, 12]);
    assertBookingCounts(secondDay, [4, 4]);
    assert.deepEqual(bothDays.sources, [
      count("Instagram", 2), count("Direct Website"), count("Facebook"),
      count("Google Ads"), count("Google Organic"), count("linktr.ee"),
      count("Unknown"), count("WhatsApp"),
    ]);
    assert.deepEqual(firstDay.sources, [
      count("Direct Website"), count("Facebook"), count("Google Ads"), count("Instagram"), count("Unknown"),
    ]);
    assert.deepEqual(secondDay.sources, [
      count("Google Organic"), count("Instagram"), count("linktr.ee"), count("WhatsApp"),
    ]);
    assert.equal(bothDays.bookings, 17);
    assert.equal(bothDays.attendees, 21);
    assert.equal(bothDays.pendingCash, 1);
    assert.equal(bothDays.revenue, 242000);

    // The schema already makes payments.bookingId unique. Simulate a repeated
    // joined row to exercise the aggregation guard without weakening the schema.
    duplicateRow = true;
    const withDuplicate = await dashboard();
    assert.deepEqual(withDuplicate.sources, bothDays.sources);
    assert.deepEqual(withDuplicate.discoverySources, bothDays.discoverySources);
    assert.equal(withDuplicate.discoveryTotal, bothDays.discoveryTotal);
    assertBookingCounts(withDuplicate, [10, 16]);
  } finally {
    await db.close();
    await rm(folder, { recursive: true, force: true });
  }
});

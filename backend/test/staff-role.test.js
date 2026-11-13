import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { jwtVerify, SignJWT } from "jose";
import { openDatabase, migrate } from "../src/db.js";
import { createAdmin, provisionStaff } from "../src/admin-accounts.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { readSession, passwordMatches, signSession } from "../src/security.js";
import { createBooking, getBooking } from "../src/services.js";
import { receiptTickets } from "../src/individual-tickets.js";
import { staffDestination } from "../../frontend/lib/staff.js";

test("staff provisioning, database-authoritative RBAC, individual cash entry and fixed sessions", async () => {
  process.env.DEMO_DB_PATH = resolve(`data/staff-${randomUUID()}.sqlite`);
  const db = await openDatabase();
  const previousDate = config.demoDate;
  config.demoDate = "2026-11-13";
  try {
    await migrate(db);
    const password = "Local staff test password 2026!";
    const admin = await createAdmin(db, {
      name: "Admin",
      email: "admin-role@example.test",
      password,
    });
    const originalAdmin = (
      await db.all("SELECT * FROM users WHERE id=?", [admin.id])
    )[0];
    const staff = await provisionStaff(db, {
      name: "Staff",
      email: " SIVARAJ@therushrepublic.com ",
      password,
    });
    const stored = (
      await db.all("SELECT * FROM users WHERE id=?", [staff.id])
    )[0];
    assert.equal(staff.email, "sivaraj@therushrepublic.com");
    assert.equal(staff.role, "staff");
    assert.ok(passwordMatches(password, stored.passwordHash));
    await provisionStaff(db, {
      email: "Sivaraj@therushrepublic.com",
      password: "must never replace existing hash",
    });
    assert.deepEqual(
      (await db.all("SELECT * FROM users WHERE id=?", [staff.id]))[0],
      stored,
    );
    assert.equal((await db.all("SELECT id FROM users")).length, 2);
    assert.deepEqual(
      (await db.all("SELECT * FROM users WHERE id=?", [admin.id]))[0],
      originalAdmin,
    );
    await assert.rejects(
      provisionStaff(db, { name: "No password", email: "new@example.test" }),
    );
    await assert.rejects(
      provisionStaff(db, {
        name: "Weak",
        email: "weak@example.test",
        password: "short",
      }),
    );
    // Converting an existing account retains its credentials and identity.
    const converted = await createAdmin(db, {
      name: "Existing",
      email: "convert@example.test",
      password,
    });
    const oldHash = (
      await db.all("SELECT passwordHash FROM users WHERE id=?", [converted.id])
    )[0].passwordHash;
    assert.equal(
      (await provisionStaff(db, { email: "CONVERT@example.test" })).id,
      converted.id,
    );
    assert.equal(
      (
        await db.all("SELECT passwordHash FROM users WHERE id=?", [
          converted.id,
        ])
      )[0].passwordHash,
      oldHash,
    );
    const app = createApp(db);
    const login = (email, pass = password) =>
      request(app)
        .post("/api/auth/login")
        .set("Origin", config.origin)
        .send({ email, password: pass });
    await login(staff.email, "incorrect").expect(401);
    const response = await login(" SIVARAJ@THERUSHREPUBLIC.COM ").expect(200);
    assert.equal(response.body.role, "staff");
    const header = response.headers["set-cookie"].find((s) =>
      s.startsWith("santa_staff_session="),
    );
    assert.match(header, /Max-Age=86400/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    const cookie = header.split(";")[0];
    const payload = await readSession(decodeURIComponent(cookie.split("=")[1]));
    assert.equal(payload.exp - payload.iat, 86400);
    const key = new TextEncoder().encode(config.sessionSecret);
    await jwtVerify(decodeURIComponent(cookie.split("=")[1]), key, {
      currentDate: new Date((payload.exp - 1) * 1000),
    });
    await assert.rejects(
      jwtVerify(decodeURIComponent(cookie.split("=")[1]), key, {
        currentDate: new Date(payload.exp * 1000),
      }),
    );
    const read = (route, c = cookie) =>
      request(app).get(route).set("Cookie", c);
    await read("/api/admin/dashboard").expect(403);
    const adminResponse = await login(admin.email).expect(200);
    await read(
      "/api/admin/dashboard",
      adminResponse.headers["set-cookie"][0].split(";")[0],
    ).expect(200);
    // Even a still-valid ADMIN claim cannot bypass the account's database role.
    const oldClaim = `santa_staff_session=${await signSession({ userId: staff.id, role: "ADMIN" }, true)}`;
    await read("/api/admin/dashboard", oldClaim).expect(403);
    for (const route of [
      "/api/auth/me?scope=staff",
      "/api/admin/bookings",
      "/api/admin/checkins",
      "/api/admin/payments",
      "/api/admin/settings",
    ]) {
      const r = await read(route).expect(200);
      assert.equal(r.headers["set-cookie"], undefined);
    }
    assert.equal(staffDestination("staff"), "/admin/bookings");
    assert.equal(
      staffDestination("staff", "/admin/dashboard"),
      "/admin/bookings",
    );
    assert.equal(staffDestination("staff", "/scanner"), "/scanner");
    assert.equal(
      staffDestination("ADMIN", "/admin/dashboard"),
      "/admin/dashboard",
    );
    const booking = await createBooking(
      db,
      {
        name: "Local staff QA",
        eventDate: "2026-11-13",
        adults: 3,
        kids: 2,
        method: "CASH",
      },
      "9876543210",
      randomUUID(),
    );
    const tickets = await receiptTickets(db, booking);
    await read(`/api/admin/bookings/${booking.id}`).expect(200);
    const post = (route, data, c = cookie) =>
      request(app)
        .post(route)
        .set("Cookie", c)
        .set("Origin", config.origin)
        .set("Idempotency-Key", randomUUID())
        .send(data);
    config.demoDate = "2026-11-14";
    await post("/api/scanner/verify", { token: tickets[0].qrToken }).expect(
      400,
    );
    await post("/api/scanner/checkin", {
      token: tickets[0].qrToken,
      amountReceived: booking.amount,
    }).expect(400);
    assert.equal((await getBooking(db, booking.id)).approvedTickets, 0);
    config.demoDate = "2026-11-13";
    await post("/api/scanner/verify", { token: tickets[0].qrToken }).expect(
      200,
    );
    await post("/api/scanner/checkin", {
      token: tickets[0].qrToken,
      amountReceived: booking.amount,
    }).expect(200);
    assert.equal((await getBooking(db, booking.id)).approvedTickets, 1);
    await post("/api/scanner/checkin", { token: tickets[0].qrToken }).expect(
      409,
    );
    await post("/api/scanner/checkin", { token: tickets[1].qrToken }).expect(
      200,
    );
    assert.equal((await getBooking(db, booking.id)).approvedTickets, 2);
    const expired = await new SignJWT({ userId: staff.id, role: "staff" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("santa-social")
      .setAudience("santa-social-web")
      .setIssuedAt(payload.iat - 86401)
      .setExpirationTime(payload.iat - 1)
      .sign(key);
    await post(
      "/api/scanner/checkin",
      { token: tickets[2].qrToken },
      `santa_staff_session=${expired}`,
    ).expect(401);
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://untrusted.invalid")
      .send({ scope: "staff" })
      .expect(403);
    await post("/api/auth/logout", { scope: "staff" }).expect(200);
    await read("/api/admin/bookings").expect(401);
    await post("/api/scanner/verify", { token: tickets[2].qrToken }).expect(
      401,
    );
    assert.equal((await getBooking(db, booking.id)).approvedTickets, 2);
  } finally {
    config.demoDate = previousDate;
    await db.close();
  }
});

test("staff CLI refuses password arguments and non-interactive input", () => {
  const result = spawnSync(process.execPath, [resolve("src/staff-cli.js")], {
    encoding: "utf8",
    input: "secret",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
  assert.doesNotMatch(result.stderr, /secret/);
});

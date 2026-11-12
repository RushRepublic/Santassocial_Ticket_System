import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import request from "supertest";
import { SignJWT, jwtVerify } from "jose";
import { openDatabase, migrate } from "../src/db.js";
import { seed } from "../src/setup.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { signSession, readSession } from "../src/security.js";

test("fixed 24-hour persistent staff session, restoration, roles, CSRF and durable logout", async () => {
  process.env.DEMO_DB_PATH = resolve(`data/session-${randomUUID()}.sqlite`);
  const db = await openDatabase();
  try {
    await migrate(db);
    await seed(db);
    let app = createApp(db);
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({
        email: process.env.ADMIN_EMAIL || "admin@santasocial.local",
        password: process.env.ADMIN_PASSWORD || "SantaDemo2026!",
      })
      .expect(200);
    const header = login.headers["set-cookie"].find((s) =>
      s.startsWith("santa_staff_session="),
    );
    assert.match(header, /Max-Age=86400/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\/api/);
    const cookie = header.split(";")[0];
    const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    const value = await readSession(token);
    assert.equal(value.exp - value.iat, 86400);
    assert.ok(value.jti);
    assert.notEqual(
      (await readSession(await signSession({ userId: value.userId }, true)))
        .jti,
      value.jti,
    );
    const key = new TextEncoder().encode(config.sessionSecret);
    await jwtVerify(token, key, {
      currentDate: new Date((value.exp - 1) * 1000),
    });
    await assert.rejects(
      jwtVerify(token, key, { currentDate: new Date(value.exp * 1000) }),
      { code: "ERR_JWT_EXPIRED" },
    );
    for (const route of [
      "/api/auth/me?scope=staff",
      "/api/admin/dashboard",
      "/api/admin/checkins",
    ]) {
      const result = await request(app)
        .get(route)
        .set("Cookie", cookie)
        .expect(200);
      assert.equal(
        result.headers["set-cookie"],
        undefined,
        "Requests must not renew the cookie",
      );
    }
    await request(app)
      .get("/api/admin/checkins")
      .set("Cookie", cookie)
      .expect(200);
    await request(app)
      .get("/api/auth/me?scope=customer")
      .set("Cookie", cookie)
      .expect(401);
    await request(app).get("/api/admin/dashboard").expect(401);
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.invalid")
      .send({ scope: "staff" })
      .expect(403);
    await request(app)
      .get("/api/auth/me?scope=staff")
      .set("Cookie", cookie)
      .expect(200);
    const scanner = (
      await db.all("SELECT id FROM users WHERE role='SCANNER'")
    )[0];
    const restricted = `santa_staff_session=${await signSession({ userId: scanner.id }, true)}`;
    await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", restricted)
      .expect(403);
    const expired = await new SignJWT({ userId: value.userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("santa-social")
      .setAudience("santa-social-web")
      .setIssuedAt(value.iat - 86401)
      .setExpirationTime(value.iat - 1)
      .sign(key);
    await request(app)
      .post("/api/scanner/checkin")
      .set("Origin", config.origin)
      .set("Cookie", `santa_staff_session=${expired}`)
      .send({ token: "invalid" })
      .expect(401);
    await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/auth/logout")
          .set("Origin", config.origin)
          .set("Cookie", cookie)
          .send({ scope: "staff" })
          .expect(200),
      ),
    );
    app = createApp(db); // Revocation survives process/app reconstruction.
    await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookie)
      .expect(401);
    await request(app)
      .post("/api/scanner/verify")
      .set("Origin", config.origin)
      .set("Cookie", cookie)
      .send({ token: "invalid" })
      .expect(401);
    await db.run("UPDATE users SET active=0 WHERE id=?", [scanner.id]);
    await request(app)
      .get("/api/auth/me?scope=staff")
      .set("Cookie", restricted)
      .expect(401);
  } finally {
    await db.close();
  }
});

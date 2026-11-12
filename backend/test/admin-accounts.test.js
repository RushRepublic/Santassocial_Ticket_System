import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { openDatabase, migrate } from "../src/db.js";
import { createAdmin } from "../src/admin-accounts.js";
import { passwordMatches } from "../src/security.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

test("backend-created admins have separate credentials and the same dashboard access", async () => {
  process.env.DEMO_DB_PATH = resolve(`data/test-${randomUUID()}.sqlite`);
  const db = await openDatabase();
  try {
    await migrate(db);
    const password = "A unique test password 123";
    const first = await createAdmin(db, {
      name: "First admin",
      email: "FIRST@example.com",
      password,
    });
    const second = await createAdmin(db, {
      name: "Second admin",
      email: "second@example.com",
      password: `${password}!`,
    });
    assert.equal(first.email, "first@example.com");
    const stored = (
      await db.all("SELECT * FROM users WHERE id = ?", [first.id])
    )[0];
    assert.notEqual(stored.passwordHash, password);
    assert.ok(passwordMatches(password, stored.passwordHash));
    assert.equal(stored.role, "ADMIN");
    await assert.rejects(
      createAdmin(db, {
        name: "Duplicate",
        email: "FIRST@example.com",
        password,
      }),
      /already exists/,
    );
    await assert.rejects(
      createAdmin(db, {
        name: "Weak",
        email: "weak@example.com",
        password: "short",
      }),
    );
    await assert.rejects(
      createAdmin(db, { name: "Bad email", email: "invalid", password }),
    );
    assert.equal((await db.all("SELECT id FROM users")).length, 2);
    assert.equal(
      (
        await db.all(
          "SELECT id FROM audit_logs WHERE action = 'CLI_CREATE_ADMIN'",
        )
      ).length,
      2,
    );

    const app = createApp(db);
    const login = (email, pass) =>
      request(app)
        .post("/api/auth/login")
        .set("Origin", config.origin)
        .send({ email, password: pass });
    const a = await login(first.email, password).expect(200);
    const b = await login(second.email, `${password}!`).expect(200);
    const cookieA = a.headers["set-cookie"][0].split(";")[0];
    const cookieB = b.headers["set-cookie"][0].split(";")[0];
    assert.notEqual(cookieA, cookieB);
    const dashboardA = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookieA)
      .expect(200);
    const dashboardB = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookieB)
      .expect(200);
    assert.deepEqual(dashboardA.body, dashboardB.body);
    await request(app).get("/api/admin/dashboard").expect(401);
    await db.run("UPDATE users SET active = 0 WHERE id = ?", [first.id]);
    await login(first.email, password).expect(401);
    await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookieA)
      .expect(401);
    await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", cookieB)
      .expect(200);
  } finally {
    await db.close();
  }
});

test("admin CLI refuses non-interactive password input", () => {
  const result = spawnSync(process.execPath, [resolve("src/admin-cli.js")], {
    encoding: "utf8",
    input: "secret\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
  assert.doesNotMatch(result.stderr, /secret/);
});

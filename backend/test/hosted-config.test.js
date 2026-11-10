import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const settings = {
  ...process.env,
  NODE_ENV: "production",
  APP_MODE: "demo",
  PAYMENT_MODE: "demo",
  ALLOW_HOSTED_DEMO: "true",
  FRONTEND_ORIGIN: "https://prototype.example.org",
  DB_DRIVER: "mysql",
  DATABASE_URL: "mysql://test:password@127.0.0.1/santa_hosted_test",
  DB_HOST: "",
  DB_PORT: "",
  DB_USER: "",
  DB_PASSWORD: "",
  DB_NAME: "",
  SESSION_SECRET: "a".repeat(64),
  TICKET_SECRET: "b".repeat(64),
  OTP_SECRET: "c".repeat(64),
  ADMIN_EMAIL: "admin@example.org",
  ADMIN_PASSWORD: "hosted-admin-test-password",
  CASHIER_EMAIL: "cashier@example.org",
  CASHIER_PASSWORD: "hosted-cashier-test-password",
  SCANNER_EMAIL: "scanner@example.org",
  SCANNER_PASSWORD: "hosted-scanner-test-password",
  MAINTENANCE_MODE: "cron",
};

function load(overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const c = await import('./src/config.js'); console.log(JSON.stringify({demo:c.demo,production:c.production,maintenance:c.maintenanceMode,database:c.databaseDriver}))",
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...settings, ...overrides },
      encoding: "utf8",
    },
  );
}

test("hosted prototype requires MySQL while retaining simulated providers and secure configuration", () => {
  const allowed = load();
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout.trim()), {
    demo: true,
    production: true,
    maintenance: "cron",
    database: "mysql",
  });
  for (const invalid of [
    { ALLOW_HOSTED_DEMO: "false" },
    { FRONTEND_ORIGIN: "http://prototype.example.org" },
    { FRONTEND_ORIGIN: "https://prototype.example.org/" },
    { DB_DRIVER: "sqlite" },
    { DB_DRIVER: "unknown" },
    { DATABASE_URL: "" },
    { DATABASE_URL: "postgresql://test:password@127.0.0.1/santa_test" },
    { SESSION_SECRET: "" },
    { TICKET_SECRET: settings.SESSION_SECRET },
    { ADMIN_PASSWORD: "" },
    { CASHIER_PASSWORD: "short" },
    { SCANNER_EMAIL: "" },
    { MAINTENANCE_MODE: "disabled" },
  ])
    assert.notEqual(
      load(invalid).status,
      0,
      JSON.stringify(Object.keys(invalid)),
    );
  const live = load({
    APP_MODE: "live",
    ALLOW_HOSTED_DEMO: "false",
    ASKEVA_API_KEY: "synthetic-key-for-config-test",
  });
  assert.equal(live.status, 0, live.stderr);
  assert.equal(JSON.parse(live.stdout.trim()).demo, false);
  const automatic = load({ DB_DRIVER: "" });
  assert.equal(automatic.status, 0, automatic.stderr);
  assert.equal(JSON.parse(automatic.stdout.trim()).database, "mysql");
  const adminOnly = load({
    CASHIER_EMAIL: "",
    CASHIER_PASSWORD: "",
    SCANNER_EMAIL: "",
    SCANNER_PASSWORD: "",
  });
  assert.equal(adminOnly.status, 0, adminOnly.stderr);
  const individual = load({
    DATABASE_URL: "",
    DB_USER: "user",
    DB_PASSWORD: "synthetic@#%password",
    DB_NAME: "santa_hosted_test",
  });
  assert.equal(individual.status, 0, individual.stderr);
});

test(
  "MySQL hosted demo issues secure verified sessions and finite maintenance exits",
  {
    skip:
      !process.env.MYSQL_TEST_DATABASE_URL &&
      "Set MYSQL_TEST_DATABASE_URL to a dedicated MySQL database ending in _test.",
  },
  () => {
    assert.match(
      new URL(process.env.MYSQL_TEST_DATABASE_URL).pathname,
      /_test$/,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import assert from 'node:assert/strict';
    import { randomInt } from 'node:crypto';
    import { spawnSync } from 'node:child_process';
    import request from 'supertest';
    const mobile = '9' + randomInt(100000000, 1000000000);
    const { openDatabase, migrate } = await import('./src/db.js');
    const { seed } = await import('./src/setup.js');
    const { createApp } = await import('./src/app.js');
    const db = await openDatabase();
    try {
      await migrate(db);
      await seed(db);
      const app = createApp(db);
      const health = await request(app).get('/api/health').expect(200);
      assert.equal(health.body.mode, 'demo');
      const login = await request(app).post('/api/auth/login')
        .set('Origin', process.env.FRONTEND_ORIGIN)
        .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
      const staffCookie = login.headers['set-cookie'].find((value) => value.startsWith('santa_staff_session=')).split(';')[0];
      for (const date of ['all', '2026-12-05', '2026-12-06'])
        await request(app).get('/api/admin/dashboard?date=' + date).set('Cookie', staffCookie).expect(200);
      for (const suffix of ['', '?date=2026-12-05&status=PAID', '?date=2026-12-06&format=csv'])
        await request(app).get('/api/admin/bookings' + suffix).set('Cookie', staffCookie).expect(200);
      await request(app).get('/api/admin/checkins').set('Cookie', staffCookie).expect(200);
      const sent = await request(app).post('/api/otp/send')
        .set('Origin', process.env.FRONTEND_ORIGIN).send({ mobile }).expect(200);
      assert.match(sent.body.demoCode, /^\\d{6}$/);
      const verified = await request(app).post('/api/otp/verify')
        .set('Origin', process.env.FRONTEND_ORIGIN)
        .send({ mobile, challengeId: sent.body.challengeId, otp: sent.body.demoCode }).expect(200);
      const cookie = verified.headers['set-cookie'][0];
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      const me = await request(app).get('/api/auth/me').set('Cookie', cookie.split(';')[0]).expect(200);
      assert.equal(me.body.mobile, mobile);
      const cron = spawnSync(process.execPath, ['src/run-maintenance.js'], { env: process.env, encoding: 'utf8' });
      assert.equal(cron.status, 0, cron.stderr);
      assert.match(cron.stdout, /maintenance complete/);
    } finally {
      await db.close();
    }
  `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...settings, DATABASE_URL: process.env.MYSQL_TEST_DATABASE_URL },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
  },
);

test("hosted scanner uses server IST even when demo event date is configured", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { eventToday, istCalendarDate } from './src/services.js';
    assert.equal(eventToday(), istCalendarDate());
    assert.notEqual(eventToday(), '2040-01-01');
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...settings, DEMO_EVENT_DATE: "2040-01-01" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

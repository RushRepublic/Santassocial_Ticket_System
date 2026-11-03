import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import { createHttpHandler } from "../src/http-handler.js";
import { staffDestination } from "../../frontend/lib/staff.js";

test("single-site routing keeps API requests and raw webhook bytes out of the page handler", async () => {
  const api = express();
  api.post(
    "/api/webhooks/razorpay",
    express.raw({ type: "application/json" }),
    (req, res) => {
      res.json({
        bytes: req.body.toString("hex"),
        signature: req.headers["x-razorpay-signature"],
      });
    },
  );
  api.get("/api/auth/me", (req, res) =>
    res.json({ cookie: req.headers.cookie }),
  );
  api.use((_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  const server = createServer(
    createHttpHandler(api, (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<h1>Santa Social</h1>");
    }),
  );
  await request(server)
    .get("/login")
    .expect(200)
    .expect(/Santa Social/);
  await request(server).get("/_next/example.js").expect(200);
  const raw = '{ "amount": 40000, "test": true }';
  const webhook = await request(server)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", "unchanged")
    .send(raw)
    .expect(200);
  assert.equal(webhook.body.bytes, Buffer.from(raw).toString("hex"));
  assert.equal(webhook.body.signature, "unchanged");
  const me = await request(server)
    .get("/api/auth/me?test=1")
    .set("Cookie", "santa_session=test")
    .expect(200);
  assert.equal(me.body.cookie, "santa_session=test");
  await request(server)
    .get("/api/missing")
    .expect(404)
    .expect("Content-Type", /json/);
});

test("one staff login routes admins across modules and restricts unsafe return URLs", () => {
  assert.equal(staffDestination("ADMIN"), "/admin/dashboard");
  assert.equal(
    staffDestination("ADMIN", "/scanner/history"),
    "/scanner/history",
  );
  assert.equal(staffDestination("ADMIN", "/admin/settings"), "/admin/settings");
  assert.equal(staffDestination("SCANNER", "/admin/settings"), "/scanner");
  assert.equal(staffDestination("CASHIER", "/scanner"), "/admin/dashboard");
  assert.equal(
    staffDestination("CASHIER", "/admin/settings"),
    "/admin/dashboard",
  );
  assert.equal(staffDestination(undefined, "/scanner"), "/login");
  for (const value of [
    "https://outside.invalid",
    "//outside.invalid",
    "/admin/../../",
    "/admin/%2e%2e/",
    "/admin/login",
    "/scanner/login",
    "/admin/\\outside.invalid",
  ])
    assert.equal(staffDestination("ADMIN", value), "/admin/dashboard");
});

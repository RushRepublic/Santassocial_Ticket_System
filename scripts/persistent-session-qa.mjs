import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3119";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Only run against the isolated local test server.");
const executablePath =
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const profile = resolve(`test-results/session-profile-${randomUUID()}`);
mkdirSync("test-results", { recursive: true });
const options = {
  headless: true,
  viewport: { width: 390, height: 844 },
  ...(existsSync(executablePath) ? { executablePath } : {}),
};
let context = await chromium.launchPersistentContext(profile, options);
try {
  let page = await context.newPage();
  const health = await (await page.request.get(origin + "/api/health")).json();
  if (health.paymentMode !== "demo" || health.whatsappMode !== "demo")
    throw Error("Require mocked external providers.");
  await page.goto(origin + "/admin/dashboard");
  await page
    .getByRole("heading", { name: "Admin Login", exact: true })
    .waitFor();
  await page
    .getByLabel("Email address")
    .fill(process.env.QA_ADMIN_EMAIL || "session-qa@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.QA_ADMIN_PASSWORD || "Session-QA-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.locator(".admin-sidebar").waitFor({ state: "attached" });
  const original = (await context.cookies()).find(
    (c) => c.name === "santa_staff_session",
  );
  expect(original.httpOnly).toBe(true);
  expect(original.expires).toBeGreaterThan(Date.now() / 1000 + 86300);
  await page.reload();
  await page.locator(".admin-sidebar").waitFor({ state: "attached" });
  const scanner = await context.newPage();
  await scanner.goto(origin + "/scanner");
  await scanner.locator(".scanner-main").waitFor();
  await scanner.reload();
  await scanner.locator(".scanner-main").waitFor();
  await page.close();
  page = await context.newPage();
  await page.goto(origin + "/admin/bookings");
  await page.locator(".admin-sidebar").waitFor({ state: "attached" });
  expect(
    (await context.cookies()).find((c) => c.name === original.name).expires,
  ).toBe(original.expires);
  await page.screenshot({
    path: "test-results/session-dashboard-mobile.png",
    fullPage: true,
  });
  await context.close();
  // Reopen an actual browser process with its persistent cookie profile.
  context = await chromium.launchPersistentContext(profile, options);
  page = await context.newPage();
  await page.goto(origin + "/admin/dashboard");
  await page.locator(".admin-sidebar").waitFor({ state: "attached" });
  const other = await context.newPage();
  await other.goto(origin + "/scanner");
  await other.locator(".scanner-main").waitFor();
  expect(
    (await context.cookies()).find((c) => c.name === original.name).value,
  ).toBe(original.value);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "test-results/session-dashboard-desktop.png",
    fullPage: true,
  });
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await other.waitForURL((u) => u.pathname === "/login");
  await page.waitForURL((u) => u.pathname === "/login");
  const replay = await page.request.get(origin + "/api/admin/dashboard", {
    headers: { Cookie: `${original.name}=${original.value}` },
  });
  expect(replay.status()).toBe(401);
  await page.reload();
  await page
    .getByRole("heading", { name: "Admin Login", exact: true })
    .waitFor();
  console.log(
    "PASS: dashboard/scanner refresh, tab closure, new tabs, actual browser restart, fixed cookie expiry, shared permissions, cross-tab logout and revoked-cookie replay.",
  );
} finally {
  await context.close();
}

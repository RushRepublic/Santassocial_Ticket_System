import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import {
  auditResponsive,
  assertResponsiveAudits,
} from "./responsive-ui-qa.mjs";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3109";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Use an isolated local demo server.");
const executablePath =
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({
  ...(existsSync(executablePath) ? { executablePath } : {}),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const health = await (await page.request.get(origin + "/api/health")).json();
  if (
    health.paymentMode !== "demo" ||
    health.otpMode !== "demo" ||
    health.whatsappMode !== "demo"
  )
    throw Error("Live providers must not be used.");
  await page.goto(origin);
  await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
  await auditResponsive(page, "registration");
  await page.getByPlaceholder("Your full name").fill("UI QA Guest");
  await page
    .getByPlaceholder("10-digit mobile number")
    .fill("98" + String(Date.now()).slice(-8));
  await page.getByRole("button", { name: "Add kids", exact: true }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  const code = await page.locator(".demo-code b").innerText();
  await auditResponsive(page, "inline-otp");
  await page.getByLabel("Enter your 6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify OTP", exact: true }).click();
  await page.locator(".mobile-verified").waitFor();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL(origin + "/checkout");
  await page
    .getByRole("heading", { name: "Booking summary", exact: true })
    .waitFor();
  await auditResponsive(page, "checkout");
  await page
    .getByRole("button", { name: "Terms and Conditions.", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await auditResponsive(page, "terms-dialog");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Pay cash at the counter/ }).click();
  await page.getByRole("button", { name: /Pay online/ }).click();
  await page.goto(origin + "/login?next=%2Fadmin%2Fdashboard");
  await page
    .getByRole("heading", { name: "Admin Login", exact: true })
    .waitFor();
  await auditResponsive(page, "admin-login");
  await page.getByLabel("Email address").fill("individual-qa@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Individual-QA-2026!");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  await page.waitForURL(origin + "/admin/dashboard");
  await expect(page.locator(".stat-card").first()).toBeVisible();
  await auditResponsive(page, "admin-overview");
  for (const section of ["bookings", "checkins"]) {
    // Use client navigation so the existing in-memory staff login grant remains intact.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(`.admin-sidebar a[href="/admin/${section}"]`).click();
    await page.waitForURL(origin + "/admin/" + section);
    await page.locator(".table-scroll").waitFor();
    await auditResponsive(page, "admin-" + section);
    if (section === "bookings") {
      const booking = page.locator('a[href^="/admin/bookings/"]').first();
      if (await booking.count()) {
        await booking.click();
        await page
          .getByRole("heading", { name: "Booking details", exact: true })
          .waitFor();
        await auditResponsive(page, "admin-booking-detail");
      }
    }
  }
  assertResponsiveAudits();
  console.log(
    "Registration, inline OTP, checkout, policy dialog, admin login/overview/bookings/check-ins: responsive and accessibility checks passed.",
  );
} finally {
  await browser.close();
}

import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
const executable =
  process.env.PLAYWRIGHT_EXECUTABLE ||
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3000";
try {
  const health = await page.request
    .get(`${origin}/api/health`)
    .then((response) => response.json());
  if (health.mode !== "demo")
    throw Error("Browser QA requires an isolated demo server.");
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Checkout", exact: true })
      .isDisabled())
  )
    throw Error("Checkout must require a verified mobile number.");
  if ((await page.locator(".steps > div").count()) !== 2)
    throw Error("Expected only Your booking and Checkout steps.");
  if (await page.locator(".hero, .home-red").count())
    throw Error("Promotional homepage is still in the customer journey.");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".wordmark img")].every(
      (img) =>
        img.complete && img.naturalWidth === 1328 && img.naturalHeight === 1184,
    ),
  );
  if (
    (await page
      .locator('.wordmark img[src="/brand/santa-social-9th-edition.png"]')
      .count()) !== 1
  )
    throw Error("The supplied brand logo is missing from the public header.");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => {
        img.loading = "eager";
        return img.decode().catch(() => {});
      }),
    );
  });
  await page.screenshot({ path: "docs/booking-desktop.png", fullPage: true });
  await page.getByPlaceholder("Your full name").fill("Browser Test Guest");
  await page
    .getByPlaceholder("10-digit mobile number")
    .fill(`98${String(Date.now()).slice(-8)}`);
  await page
    .getByPlaceholder("you@example.com")
    .fill("browser-test@example.com");
  await page.getByRole("button", { name: "Add kids" }).click();
  const otpResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/otp/send") &&
      response.request().method() === "POST",
  );
  if (await page.locator("footer").count())
    throw Error("The removed public footer is still rendered.");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  const sentOtp = await otpResponse;
  if (!sentOtp.ok())
    throw Error(
      `OTP request failed (${sentOtp.status()}): ${(await sentOtp.json()).error}`,
    );
  const code = await page.locator(".demo-code b").innerText();
  await page.getByLabel("Enter your 6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify OTP", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: /Incorrect, expired, or exhausted/ })
    .waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Checkout", exact: true })
      .isDisabled())
  )
    throw Error("An incorrect OTP enabled checkout.");
  await page.getByLabel("Enter your 6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify OTP", exact: true }).click();
  await page.locator(".mobile-verified").waitFor();
  if (new URL(page.url()).pathname !== "/")
    throw Error("Mobile verification left the booking page.");
  const originalMobile = await page
    .getByPlaceholder("10-digit mobile number")
    .inputValue();
  const verifiedCookies = await context.cookies(`${origin}/api/auth/me`);
  await page.request.post(`${origin}/api/auth/logout`, {
    headers: { Origin: origin },
    data: {},
  });
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.locator(".mobile-verified").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Verify", exact: true }).waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Checkout", exact: true })
      .isDisabled())
  )
    throw Error("Lost verification session did not lock checkout.");
  await context.addCookies(verifiedCookies);
  await page
    .getByPlaceholder("10-digit mobile number")
    .fill(`97${String(Date.now()).slice(-8)}`);
  await page.locator(".mobile-verified").waitFor({ state: "hidden" });
  if (
    !(await page
      .getByRole("button", { name: "Checkout", exact: true })
      .isDisabled())
  )
    throw Error("Changing the verified number did not lock checkout.");
  await page.getByPlaceholder("10-digit mobile number").fill(originalMobile);
  await page.locator(".mobile-verified").waitFor();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL("**/checkout");
  await page.getByRole("link", { name: "Edit booking" }).waitFor();
  if (
    await page
      .locator(
        ".demo-banner, .page-intro, .booking-sidebar .event-details, .site-header nav, .site-header .menu-button",
      )
      .count()
  )
    throw Error(
      "Checkout still displays the removed banner, introduction, venue or navigation.",
    );
  await page.screenshot({ path: "docs/checkout-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/checkout-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Checkout mobile overflow.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Edit booking" }).click();
  await page.waitForURL(origin + "/");
  await page.locator(".mobile-verified").waitFor();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL("**/checkout");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await page
    .getByRole("heading", { name: "You’re on the guest list!" })
    .waitFor();
  await page.getByRole("link", { name: "View your group ticket" }).click();
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  await page.screenshot({ path: "docs/ticket-desktop.png", fullPage: true });
  const bookingId = new URL(page.url()).pathname.split("/").pop();
  const booking = await page.request
    .get(`${origin}/api/bookings/${bookingId}`)
    .then((r) => r.json());
  if (booking.amount !== 20000 || booking.people !== 2)
    throw Error("Incorrect group price/count");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  if (!(await download).suggestedFilename().endsWith(".pdf"))
    throw Error("Missing PDF download");
  await page.goto(`${origin}/admin/login`);
  await page.waitForURL(`${origin}/login`);
  await page.goto(`${origin}/scanner/login`);
  await page.waitForURL(`${origin}/login`);
  let staffLogins = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/auth/login"
    )
      staffLogins++;
  });
  await page
    .getByLabel("Email address", { exact: true })
    .fill("admin@santasocial.local");
  await page.getByLabel("Password", { exact: true }).fill("SantaDemo2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page
    .getByRole("heading", { name: "Let’s make it a merry one." })
    .waitFor();
  await page.locator(".stat-card").first().waitFor();
  await page.screenshot({ path: "docs/admin-desktop.png", fullPage: true });
  for (const status of [403, 500]) {
    const pattern = "**/api/admin/dashboard?*";
    await page.route(pattern, (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary admin request failure" }),
      }),
    );
    await page.goto(`${origin}/admin`);
    await page
      .getByText("Temporary admin request failure", { exact: true })
      .waitFor();
    if (await page.locator(".admin-content .loading").count())
      throw Error("Failed admin requests must stop showing a loading spinner.");
    await page.unroute(pattern);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.locator(".stat-card").first().waitFor();
  }
  const registrationTab = await context.newPage();
  await registrationTab.goto(origin);
  await registrationTab
    .getByLabel("WhatsApp mobile number", { exact: false })
    .fill("9012345678");
  const secondOtpResponse = registrationTab.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/otp/send" &&
      response.request().method() === "POST",
  );
  await registrationTab
    .getByRole("button", { name: "Verify", exact: true })
    .click();
  const secondOtp = await (await secondOtpResponse).json();
  if (!secondOtp.demoCode)
    throw Error("Missing simulated OTP in second registration tab.");
  const secondVerified = await registrationTab.request.post(
    `${origin}/api/otp/verify`,
    {
      headers: { Origin: origin },
      data: {
        mobile: "9012345678",
        challengeId: secondOtp.challengeId,
        otp: secondOtp.demoCode,
      },
    },
  );
  if (!secondVerified.ok())
    throw Error("Second-tab customer OTP verification failed.");
  await registrationTab.close();
  const preservedStaff = await page.request.get(
    `${origin}/api/auth/me?scope=staff`,
  );
  if ((await preservedStaff.json()).role !== "ADMIN")
    throw Error("Customer verification replaced the admin session.");
  for (const [label, section] of [
    ["Bookings", "bookings"],
    ["Payments", "payments"],
    ["Check-ins", "checkins"],
    ["Event settings", "settings"],
    ["Overview", "dashboard"],
  ]) {
    await page
      .locator(".admin-sidebar")
      .getByRole("link", { name: label, exact: true })
      .click();
    await page.waitForURL(`${origin}/admin/${section}`);
    await page.locator(".admin-sidebar").waitFor();
  }
  await page.goto(`${origin}/login`);
  await page.waitForURL(`${origin}/admin/dashboard`);
  await page.getByRole("link", { name: "Open gate scanner" }).click();
  await page.waitForURL(`${origin}/scanner`);
  await page
    .getByLabel("Or paste a secure ticket token / link")
    .fill(booking.qrToken);
  await page
    .getByRole("button", { name: "Verify ticket", exact: true })
    .click();
  await page.getByText("VALID TICKET", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Confirm group entry" }).click();
  await page
    .getByRole("heading", { name: "Welcome to Santa Social!" })
    .waitFor();
  await page
    .getByLabel("Or paste a secure ticket token / link")
    .fill(booking.qrToken);
  await page
    .getByRole("button", { name: "Verify ticket", exact: true })
    .click();
  await page.getByText(/ALREADY CHECKED IN:/).waitFor();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await page.waitForURL(`${origin}/admin/dashboard`);
  if (staffLogins !== 1)
    throw Error("Admin modules and scanner must share one login session.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => {
        img.loading = "eager";
        return img.decode().catch(() => {});
      }),
    );
  });
  await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
  await page.screenshot({ path: "docs/booking-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Booking landing page mobile overflow");
  await page.goto(`${origin}/register`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/")
    throw Error(
      "Legacy registration link did not redirect to the booking form.",
    );
  await page.screenshot({ path: "docs/register-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Registration mobile overflow");
  await page.goto(`${origin}/admin/dashboard`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Let’s make it a merry one." })
    .waitFor();
  await page.locator(".stat-card").first().waitFor();
  await page.screenshot({ path: "docs/admin-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Admin mobile overflow");
  if (errors.length) throw Error(`Browser errors: ${errors.join("; ")}`);
  await page.getByRole("button", { name: "Toggle menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(`${origin}/login`);
  const denied = await page.request.get(`${origin}/api/admin/bookings`);
  if (denied.status() !== 403)
    throw Error("Logout must revoke access to staff APIs.");
  if (!(await page.request.get(`${origin}/api/auth/me?scope=customer`)).ok())
    throw Error("Staff logout must preserve the customer session.");
  console.log(
    "PASS: direct booking landing page, legacy redirect, desktop/mobile layouts, OTP, online demo payment, group QR, PDF download, admin authentication, scanner entry and duplicate rejection.",
  );
} catch (error) {
  await page
    .screenshot({ path: "docs/browser-qa-failure.png", fullPage: true })
    .catch(() => {});
  console.error("Failed page:", new URL(page.url()).pathname);
  console.error(
    "Visible errors:",
    await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []),
  );
  throw error;
} finally {
  await browser.close();
}

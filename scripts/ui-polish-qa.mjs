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
  await expect(page.locator(".form-section .section-label")).toHaveText([
    "01Pick your day",
    "02Registration Details",
    "03How did you hear about us?",
    "04Tickets",
  ]);
  const discovery = page.getByRole("radiogroup", {
    name: "How did you hear about us?",
  });
  const radios = discovery.getByRole("radio");
  await expect(radios).toHaveCount(4);
  for (const width of [360, 390, 430, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".quantity-row").filter({ hasText: "Adults" })).toContainText("₹200");
    await expect(page.locator(".quantity-row").filter({ hasText: "Little ones" })).toContainText("Free");
    const layout = await discovery.evaluate((group) => ({
      columns: getComputedStyle(group).gridTemplateColumns.split(" ").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      options: [...group.querySelectorAll("label")].map((label) => ({
        height: label.getBoundingClientRect().height,
        fits: label.scrollWidth <= label.clientWidth,
      })),
    }));
    expect(layout.columns).toBe(width < 600 ? 1 : 2);
    expect(layout.overflow).toBe(false);
    expect(layout.options.every(({ height, fits }) => height >= 44 && fits)).toBe(true);
    if (process.env.QA_DISCOVERY_SCREENSHOTS === "1")
      await discovery.locator("..").screenshot({
        path: `test-results/discovery-${width}.png`,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByPlaceholder("Your full name").fill("UI QA Guest");
  await page
    .getByPlaceholder("10-digit mobile number")
    .fill("98" + String(Date.now()).slice(-8));
  for (let i = 0; i < 10; i++)
    await page.getByRole("button", { name: "Add adults", exact: true }).click();
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Add kids", exact: true }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  const code = await page.locator(".demo-code b").innerText();
  await auditResponsive(page, "inline-otp");
  await page.getByLabel("Enter your 6-digit code").fill(code);
  await page.locator(".mobile-verified").waitFor();
  const validation = page.getByText("Please select how you heard about Santa Social.", {
    exact: true,
  });
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await expect(validation).toBeVisible();
  await expect(radios.first()).toBeFocused();
  await discovery.getByText("Instagram", { exact: true }).click();
  await expect(radios.first()).toBeChecked();
  await discovery.getByText("Google", { exact: true }).click();
  await expect(discovery.locator("input:checked")).toHaveCount(1);
  const google = discovery.getByRole("radio", { name: "Google", exact: true });
  await expect(google).toBeChecked();
  await google.press("ArrowLeft");
  const friendsAndReferrals = discovery.getByRole("radio", { name: "Friends & Referrals", exact: true });
  await expect(friendsAndReferrals).toBeChecked();
  await expect(validation).toHaveCount(0);
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL(origin + "/checkout");
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(origin + "/");
  await expect(friendsAndReferrals).toBeChecked();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL(origin + "/checkout");
  await page
    .getByRole("heading", { name: "Booking summary", exact: true })
    .waitFor();
  await auditResponsive(page, "checkout");
  const summary = page.locator(".booking-sidebar .summary");
  for (const width of [360, 390, 430, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(summary.getByText("Ticket Subtotal", { exact: true })).toHaveCount(0);
    await expect(summary.locator("p").filter({ hasText: "11 × Adult ticket" }).locator("b")).toHaveText("₹2,200");
    await expect(summary.locator("p").filter({ hasText: "5 × Kids ticket" }).locator("b")).toHaveText("Free");
    await expect(summary.locator("p").filter({ hasText: "Platform Fee (2.5%)" }).locator("b")).toHaveText("₹55");
    await expect(summary.locator(".summary-total strong")).toHaveText("₹2,255");
    await expect(page.getByRole("button", { name: "Continue to payment · ₹2,255", exact: true })).toBeVisible();
    expect(await summary.evaluate((el) => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.QA_PRICING_SCREENSHOTS === "1")
      await summary.screenshot({ path: `test-results/checkout-platform-fee-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Terms and Conditions.", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await auditResponsive(page, "terms-dialog");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Pay cash at the counter/ }).click();
  await page.getByRole("button", { name: /Pay online/ }).click();
  await page.getByRole("checkbox").check();
  const orderResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/payments/razorpay/order"),
  );
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  expect((await (await orderResponse).json()).amount).toBe(225_500);
  await page.getByRole("button", { name: "Simulate unsuccessful payment" }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(origin + "/");
  await expect(friendsAndReferrals).toBeChecked();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL(origin + "/checkout");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await page.waitForURL("**/ticket/*");
  const paidId = new URL(page.url()).pathname.split("/").at(-1);
  const paid = await (await page.request.get(`${origin}/api/bookings/${paidId}`)).json();
  expect(paid.status).toBe("PAID");
  expect(paid).toMatchObject({ ticketSubtotal: 220_000, platformFee: 5_500, amount: 225_500, people: 16 });
  await expect(page.locator(".ticket-status")).toContainText("₹2,255");
  expect(paid.discoverySource).toBe("word_of_mouth");

  await page.goto(origin);
  await page.getByPlaceholder("Your full name").fill("Cash QA Guest");
  await page.getByPlaceholder("10-digit mobile number").fill(paid.mobile);
  await discovery.getByText("Already visited Santa's Social", { exact: true }).click();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL(origin + "/checkout");
  await page.getByRole("button", { name: /Pay cash at the counter/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Reserve & pay at counter/ }).click();
  await page.waitForURL("**/booking-pending?id=*");
  const cashId = new URL(page.url()).searchParams.get("id");
  const cash = await (await page.request.get(`${origin}/api/bookings/${cashId}`)).json();
  expect(cash.status).toBe("PENDING_CASH");
  expect(cash).toMatchObject({ ticketSubtotal: 220_000, platformFee: 5_500, amount: 225_500, people: 16 });
  await expect(page.locator(".ticket-status")).toContainText("₹2,255");
  expect(cash.discoverySource).toBe("previous_visitor");
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
  await page.goto(`${origin}/admin/bookings/${paidId}`);
  await expect(page.getByText("Ticket Subtotal", { exact: true })).toBeVisible();
  await expect(page.getByText("How did you hear about us?", { exact: true })).toBeVisible();
  await expect(page.getByText("Friends & Referrals", { exact: true })).toBeVisible();
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

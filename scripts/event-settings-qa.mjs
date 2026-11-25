import { chromium, expect } from "@playwright/test";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3219";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Use an isolated local demo server.");

const browser = await chromium.launch({
  executablePath: process.env.QA_CHROMIUM_PATH,
  headless: true,
});
try {
  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const health = await (await customer.request.get(origin + "/api/health")).json();
  expect(health).toMatchObject({
    mode: "demo", paymentMode: "demo", otpMode: "demo", whatsappMode: "demo", database: "sqlite",
  });

  const admin = await browser.newPage();
  await admin.goto(origin + "/admin/event-settings");
  await admin.getByLabel("Email address").fill("mathu.y@thinkcodesoft.com");
  await admin.getByLabel("Password", { exact: true }).fill(process.env.QA_ADMIN_PASSWORD);
  await admin.getByRole("button", { name: /Sign in securely/ }).click();
  await admin.waitForURL("**/admin/event-settings");
  await expect(admin.getByRole("navigation", { name: "Event management" }).getByRole("link")).toHaveText([
    "Overview", "Bookings", "Check-ins", "Open gate scanner", "Free Tickets", "Event Settings",
  ]);
  const toggle = admin.getByRole("switch", { name: "Cash Payment" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await customer.goto(origin);
  await customer.getByPlaceholder("Your full name").fill("Event Settings QA");
  await customer.getByPlaceholder("10-digit mobile number").fill("9876543210");
  await customer.getByRole("button", { name: "Verify", exact: true }).click();
  const code = await customer.locator(".demo-code b").innerText();
  await customer.getByLabel("Enter your 6-digit code").fill(code);
  await customer.locator(".mobile-verified").waitFor();
  await customer.getByRole("radio", { name: "Google", exact: true }).check();
  await customer.getByRole("button", { name: "Checkout", exact: true }).click();
  await customer.waitForURL("**/checkout");
  const online = customer.getByRole("button", { name: /Pay online/ });
  const cash = customer.getByRole("button", { name: /Pay cash at the counter/ });
  await expect(online).toHaveAttribute("aria-pressed", "true");
  await expect(cash).toHaveCount(0);

  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(admin.getByText("Payment settings saved.")).toBeVisible();
  await admin.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.getByRole("button", { name: "Toggle menu" }).click();
  const settingsLink = admin.getByRole("link", { name: "Event Settings" });
  await expect(settingsLink).toHaveAttribute("aria-current", "page");
  await settingsLink.click();
  await expect(toggle).toBeVisible();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await customer.bringToFront();
  await customer.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(cash).toBeVisible();
  await cash.click();
  const summary = customer.locator(".summary");
  await expect(summary.locator(".summary-total strong")).toHaveText("₹220");
  await expect(summary.getByText(/Platform Fee/)).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await customer.setViewportSize({ width, height: 844 });
    await expect(online).toBeVisible();
    await expect(cash).toBeVisible();
    expect(await customer.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await customer.getByRole("checkbox").check();

  // An open checkout can still have the previous value when the server switches OFF.
  await customer.route("**/api/events", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), publicCashPaymentEnabled: true } });
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const rejected = customer.waitForResponse((response) =>
    response.url().endsWith("/api/bookings") && response.request().method() === "POST");
  await customer.getByRole("button", { name: /Reserve & pay/ }).click();
  expect((await rejected).status()).toBe(400);
  await customer.unroute("**/api/events");
  await expect(cash).toHaveCount(0);
  await expect(online).toHaveAttribute("aria-pressed", "true");
  await expect(summary.locator(".summary-total strong")).toHaveText("₹225.50");
  await expect(customer.getByRole("checkbox")).not.toBeChecked();
  await expect(customer.getByText(/Review the online total/)).toBeVisible();
  console.log("Event Settings and Checkout passed in Chromium, including refresh and stale cash submission.");
} finally {
  await browser.close();
}

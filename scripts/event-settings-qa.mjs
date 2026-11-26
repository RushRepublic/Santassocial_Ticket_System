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
  const track = toggle.locator(".cash-payment-track");
  const status = admin.locator("#cash-payment-status");
  async function verifySwitch(enabled) {
    await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    await expect(status).toHaveText(
      enabled ? "ON — Cash Payment Enabled" : "OFF — Cash Payment Disabled",
    );
    await expect(track).toHaveCSS(
      "background-color", enabled ? "rgb(138, 29, 35)" : "rgb(101, 103, 92)",
    );
    await expect(track).toHaveCSS("height", "30px");
    await expect(track).toHaveCSS("width", "54px");
    await expect(toggle).toHaveCSS("height", "44px");
    await expect.poll(() => track.evaluate((element) => {
      const thumb = getComputedStyle(element, "::after");
      return [thumb.width, thumb.height, thumb.backgroundColor, thumb.transform];
    })).toEqual(["24px", "24px", "rgb(255, 255, 255)", enabled ? "matrix(1, 0, 0, 1, 24, 0)" : "none"]);
  }

  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 844 });
    await verifySwitch(false);
    const row = await admin.locator(".cash-setting-row").boundingBox();
    const button = await toggle.boundingBox();
    const copy = await admin.locator(".cash-setting-copy").boundingBox();
    expect(button.x + button.width).toBeCloseTo(row.x + row.width, 0);
    expect(button.y + button.height / 2).toBeCloseTo(row.y + row.height / 2, 0);
    expect(copy.x + copy.width).toBeLessThan(button.x);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await expect(track).toHaveCSS("transition-duration", "0.18s");
  await admin.emulateMedia({ reducedMotion: "reduce" });
  await expect(track).toHaveCSS("transition-duration", "0s");
  expect(await track.evaluate((element) => getComputedStyle(element, "::after").transitionDuration)).toBe("0s");
  await admin.emulateMedia({ reducedMotion: "no-preference" });

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

  await toggle.focus();
  await admin.keyboard.press("Shift+Tab");
  await admin.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS("outline-style", "solid");
  await admin.keyboard.press("Space");
  await verifySwitch(true);
  await expect(admin.getByText("Payment settings saved.")).toBeVisible();
  if (process.env.QA_EVENT_SETTINGS_SCREENSHOTS === "1") {
    for (const width of [390, 1440]) {
      await admin.setViewportSize({ width, height: 844 });
      await admin.locator(".event-settings").screenshot({ path: `test-results/cash-switch-on-${width}.png` });
    }
  }
  await admin.reload();
  await verifySwitch(true);
  let attempts = 0;
  let finishSave;
  const delayedSave = new Promise((resolve) => { finishSave = resolve; });
  const settingsApi = "**/api/admin/event-settings";
  const failSave = async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts += 1;
    await delayedSave;
    await route.fulfill({ status: 500, json: { error: "Simulated save failure." } });
  };
  await admin.route(settingsApi, failSave);
  try {
    await toggle.click();
    await expect(toggle).toBeDisabled();
    await expect(admin.getByText("Saving payment settings…")).toBeVisible();
    await toggle.evaluate((button) => button.click());
  } finally {
    finishSave();
  }
  await expect(admin.getByText("Simulated save failure.")).toBeVisible();
  await expect(toggle).toBeEnabled();
  await verifySwitch(true);
  expect(attempts).toBe(1);
  await admin.unroute(settingsApi, failSave);
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
  await verifySwitch(false);
  if (process.env.QA_EVENT_SETTINGS_SCREENSHOTS === "1")
    await admin.locator(".event-settings").screenshot({ path: "test-results/cash-switch-off-390.png" });
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

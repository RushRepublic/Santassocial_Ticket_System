import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3220";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Use an isolated local demo server.");
const browser = await chromium.launch({
  executablePath: process.env.QA_CHROMIUM_PATH,
});

try {
  const context = await browser.newContext();
  const online = await context.newPage();
  const cash = await context.newPage();
  const admin = await browser.newPage();
  const health = await (
    await online.request.get(origin + "/api/health")
  ).json();
  expect(health).toMatchObject({
    mode: "demo",
    paymentMode: "demo",
    otpMode: "demo",
    whatsappMode: "demo",
    database: "sqlite",
  });
  expect(
    await (await online.request.get(origin + "/api/events")).json(),
  ).toMatchObject({
    publicCashPaymentEnabled: true,
  });

  const register = async (page, name) => {
    await page.getByPlaceholder("Your full name").fill(name);
    await page.getByPlaceholder("10-digit mobile number").fill("9876543210");
    const verified = page.locator(".mobile-verified");
    if (page === online) {
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      const code = await page.locator(".demo-code b").innerText();
      await page.getByLabel("Enter your 6-digit code").fill(code);
    }
    await expect(verified).toBeVisible();
    await page.getByRole("radio", { name: "Google", exact: true }).check();
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
    await page.waitForURL("**/checkout");
  };

  await online.addInitScript(() => {
    if (location.pathname === "/" && location.search)
      history.replaceState(history.state, "", "/");
  });
  await online.goto(
    origin +
      "/?UTM_SOURCE=ig&utm_medium=paid_social&utm_campaign=santa_2026&utm_content=reel_01&utm_term=Coimbatore",
    { referer: "https://l.facebook.com/" },
  );
  await expect
    .poll(() =>
      online.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("santa-lead-signals"))?.utm?.source,
      ),
    )
    .toBe("ig");
  expect(new URL(online.url()).search).toBe("");
  await online.reload();
  await register(online, "Online Attribution QA");
  const refreshed = await context.newPage();
  await refreshed.addInitScript(() => {
    if (
      location.pathname === "/" &&
      performance.getEntriesByType("navigation")[0]?.type === "reload"
    ) {
      Object.defineProperty(document, "referrer", {
        value: "https://l.facebook.com/",
      });
    }
  });
  await refreshed.goto(origin);
  await refreshed.reload();
  await expect
    .poll(() =>
      refreshed.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("santa-lead-signals"))
            ?.referrerHost,
      ),
    )
    .toBe("l.facebook.com");
  await refreshed.close();

  await cash.goto(origin + "/register", {
    referer: "https://l.facebook.com/path?private=value",
  });
  expect(new URL(cash.url()).pathname).toBe("/");
  expect(new URL(cash.url()).hash).toBe("#lead-ref=l.facebook.com");
  await register(cash, "Cash Attribution QA");
  await cash.reload();
  await cash.getByRole("button", { name: /Pay cash at the counter/ }).click();
  await cash.getByRole("checkbox").check();
  await cash.getByRole("button", { name: /Reserve & pay/ }).click();
  await cash.waitForURL("**/booking-pending?id=*");
  const cashId = new URL(cash.url()).searchParams.get("id");

  await online.reload();
  await online.getByRole("checkbox").check();
  const created = online.waitForResponse(
    (res) =>
      res.url().endsWith("/api/bookings") && res.request().method() === "POST",
  );
  await online.getByRole("button", { name: /Continue to payment/ }).click();
  const { id: onlineId } = await (await created).json();
  await online
    .getByRole("button", { name: "Simulate unsuccessful payment" })
    .click();
  await online.goto(`${origin}/checkout?id=${onlineId}&payment=failed`);
  await expect(
    online.getByText(/Payment could not be confirmed/),
  ).toBeVisible();
  await online.getByRole("checkbox").check();
  await online.getByRole("button", { name: /Continue to payment/ }).click();
  await online
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await online.waitForURL(`**/ticket/${onlineId}`);

  await admin.goto(origin + "/login");
  await admin.getByLabel("Email address").fill("mathu.y@thinkcodesoft.com");
  await admin
    .getByLabel("Password", { exact: true })
    .fill(process.env.QA_ADMIN_PASSWORD);
  await admin.getByRole("button", { name: /Sign in securely/ }).click();
  await admin.waitForURL("**/admin/dashboard");
  const create = async (path, data) => {
    const response = await admin.request.post(`${origin}/api${path}`, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await create(`/admin/bookings/${cashId}/approve`, { amountReceived: 22_000 });
  const free = await create("/admin/free-tickets", {
    name: "Free Attribution QA",
    mobile: "9876543210",
    eventDate: "2026-12-05",
    adults: 1,
    kids: 0,
    leadSignals: { utm: { source: "yt", campaign: "exclude" } },
  });
  const value = (label) =>
    admin
      .locator(".detail-list")
      .getByText(label, { exact: true })
      .locator("xpath=following-sibling::dd[1]");

  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 844 });
    await admin.goto(`${origin}/admin/bookings/${onlineId}`);
    for (const [label, text] of Object.entries({
      "Lead Source": "Instagram",
      Medium: "Paid Social",
      Campaign: "santa_2026",
      Content: "reel_01",
      Keyword: "Coimbatore",
    }))
      await expect(value(label)).toHaveText(text);
    await expect(value("How did you hear about us?")).toHaveText("Google");
    expect(
      await admin.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }
  await admin.goto(`${origin}/admin/bookings/${cashId}`);
  await expect(value("Lead Source")).toHaveText("Facebook");
  await expect(value("Campaign")).toHaveCount(0);
  for (const [query, source] of [
    ["?utm_source=facebook&utm_medium=paid_social", "Facebook"],
    ["?utm_source=whatsapp&utm_medium=message", "WhatsApp"],
    ["?utm_source=google&utm_medium=cpc", "Google Ads"],
    ["?utm_source=youtube&utm_medium=video", "YouTube"],
    ["", "Unknown"],
  ]) {
    const visitor = await context.newPage();
    const landing = source === "WhatsApp" ? "/register" : "/";
    await visitor.goto(`${origin}${landing}${query}`);
    await register(visitor, `${source} Attribution QA`);
    await visitor.getByRole("checkbox").check();
    await visitor.getByRole("button", { name: /Continue to payment/ }).click();
    await visitor
      .getByRole("button", { name: "Simulate successful payment" })
      .click();
    await visitor.waitForURL("**/ticket/*");
    const id = new URL(visitor.url()).pathname.split("/").at(-1);
    await admin.goto(`${origin}/admin/bookings/${id}`);
    await expect(value("Lead Source")).toHaveText(source);
    await visitor.close();
  }
  await admin.goto(`${origin}/admin/bookings/${free.id}`);
  await expect(
    admin.getByRole("heading", { name: "Free Attribution QA" }),
  ).toBeVisible();
  await expect(value("Lead Source")).toHaveCount(0);
  await expect(value("Campaign")).toHaveCount(0);
  console.log(
    "Attribution passed through OTP, refresh, separate tabs, demo payment return, cash approval and admin details.",
  );
} finally {
  await browser.close();
}

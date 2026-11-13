import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3109";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error(
    "Payment QA creates records and must use an isolated local server.",
  );
const executable =
  process.env.PLAYWRIGHT_EXECUTABLE ||
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  headless: true,
});
try {
  const page = await browser.newPage();
  const health = await (await page.request.get(`${origin}/api/health`)).json();
  if (health.paymentMode !== "demo")
    throw Error("Payment QA requires simulated payments.");
  const api = async (path, body) => {
    const response = await page.request.post(`${origin}/api${path}`, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data: body,
    });
    if (!response.ok())
      throw Error(`QA setup failed: ${path} (${response.status()})`);
    return response.json();
  };
  const mobile = `9${randomInt(100000000, 1000000000)}`;
  const challenge = await api("/otp/send", { mobile });
  await api("/otp/verify", {
    mobile,
    challengeId: challenge.challengeId,
    otp: challenge.demoCode,
  });
  const booking = await api("/bookings", {
    name: "Payment QA Guest",
    method: "RAZORPAY",
    eventDate: "2026-11-13",
    adults: 1,
    kids: 0,
  });
  // Mock only the external checkout callbacks, never production application code.
  // Server sessions, booking state and final capture still use the real local API.
  await page.addInitScript(() => {
    window.Razorpay = class {
      constructor(options) {
        this.options = options;
        window.__qaCheckoutOptions = options;
        this.events = {};
      }
      on(name, handler) {
        this.events[name] = handler;
      }
      open() {
        if (window.__qaPaymentOutcome === "failed")
          this.events["payment.failed"]({});
        else if (window.__qaPaymentOutcome === "cancelled")
          this.options.modal.ondismiss();
        else if (window.__qaPaymentOutcome !== "external")
          this.options.handler({
            razorpay_order_id: this.options.order_id,
            razorpay_payment_id: "qa-pending",
            razorpay_signature: "qa-signature",
          });
      }
    };
  });
  await page.route("**/api/payments/razorpay/order", async (route) => {
    const response = await route.fetch();
    const order = await response.json();
    await route.fulfill({
      response,
      json: { ...order, demo: false, keyId: "qa-checkout-key" },
    });
  });
  let captureOnVerify = false;
  await page.route("**/api/payments/razorpay/verify", async (route) => {
    if (captureOnVerify) {
      const { bookingId } = route.request().postDataJSON();
      const paid = await api("/demo/payments/complete", { bookingId });
      return route.fulfill({ json: paid });
    }
    return route.fulfill({
      status: 202,
      json: { pending: true, message: "Awaiting capture" },
    });
  });
  for (const outcome of ["failed", "cancelled", "pending"]) {
    await page.goto(`${origin}/checkout?id=${booking.id}`);
    await page
      .getByRole("heading", { name: "How would you like to pay?" })
      .waitFor();
    await page.evaluate((value) => {
      window.__qaPaymentOutcome = value;
    }, outcome);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Continue to payment/ }).click();
    await page
      .getByText(
        outcome === "failed"
          ? /Payment unsuccessful\./
          : outcome === "cancelled"
            ? /Payment cancelled\./
            : /Payment is not confirmed yet\./,
      )
      .waitFor({ timeout: 20000 });
    if (
      new URL(page.url()).pathname !== "/checkout" ||
      (await page.locator(".digital-ticket").count())
    )
      throw Error(`${outcome} payment displayed a ticket before capture`);
    const unpaid = await (
      await page.request.get(`${origin}/api/bookings/${booking.id}`)
    ).json();
    if (unpaid.status !== "PENDING_PAYMENT" || unpaid.qrToken)
      throw Error(`${outcome} payment activated a booking`);
  }
  await api("/demo/payments/complete", { bookingId: booking.id });
  await page
    .getByRole("button", { name: "Check payment status", exact: true })
    .click();
  await page.waitForURL(`${origin}/ticket/${booking.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  await page.goto(`${origin}/booking-success?id=${booking.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  if (
    await page
      .getByRole("link", { name: "View your group ticket", exact: true })
      .count()
  )
    throw Error("Legacy success link still requires another ticket click");
  // A UPI app can suppress the browser handler entirely. Returning to checkout
  // must discover captured payment without another pay/status-button click.
  await page.setViewportSize({ width: 375, height: 812 });
  const resumed = await api("/bookings", {
    name: "Mobile Return QA",
    method: "RAZORPAY",
    eventDate: "2026-11-13",
    adults: 1,
    kids: 0,
  });
  await page.goto(`${origin}/checkout?id=${resumed.id}`);
  await page.getByRole("checkbox").check();
  await page.evaluate(() => {
    window.__qaPaymentOutcome = "external";
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "iPhone",
    });
  });
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForFunction(() => Boolean(window.__qaCheckoutOptions));
  const mobileOptions = await page.evaluate(() => ({
    redirect: window.__qaCheckoutOptions.redirect,
    callback: window.__qaCheckoutOptions.callback_url,
    hasHandler: typeof window.__qaCheckoutOptions.handler === "function",
  }));
  if (
    mobileOptions.redirect ||
    mobileOptions.callback ||
    !mobileOptions.hasHandler
  )
    throw Error(
      "Mobile browser checkout must use its success handler without a competing redirect",
    );
  // Model a browser that keeps executing while the external app is foregrounded.
  // No focus/visibility event or manual status click should be necessary here.
  await page.evaluate(() =>
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    }),
  );
  await api("/demo/payments/complete", { bookingId: resumed.id });
  await page.waitForURL(`${origin}/ticket/${resumed.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  await page.evaluate(() => delete document.hidden);
  await page.goto(`${origin}/checkout?id=${resumed.id}`);
  await page.waitForURL(`${origin}/ticket/${resumed.id}`);
  console.log(
    "PASS: mobile handler configuration, background payment recovery without focus/status clicks and reloaded paid checkout open the QR automatically.",
  );
  // Exercise the ordinary mobile SDK success handler, not just polling.
  const handled = await api("/bookings", {
    name: "Mobile SDK Handler QA",
    method: "RAZORPAY",
    eventDate: "2026-11-13",
    adults: 1,
    kids: 0,
  });
  await page.goto(`${origin}/checkout?id=${handled.id}`);
  await page.getByRole("checkbox").check();
  captureOnVerify = true;
  await page.evaluate(() => {
    window.__qaPaymentOutcome = "success";
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "iPhone",
    });
  });
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.waitForURL(`${origin}/ticket/${handled.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  captureOnVerify = false;
  console.log(
    "PASS: mobile SDK success verifies with the server and opens the ticket without a success screen or manual click.",
  );
  // Returning from a cash ticket must restore interactive choices, including on phones.
  const cash = await api("/bookings", {
    name: "Switch Payment QA",
    method: "CASH",
    eventDate: "2026-11-13",
    adults: 1,
    kids: 0,
  });
  await page.goto(`${origin}/checkout?id=${cash.id}`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Reserve & pay at counter/ }).click();
  await page.waitForURL(`${origin}/booking-pending?id=${cash.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  await page.goBack();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".payment-option").first().waitFor();
    if (
      !(await page.locator(".payment-option").first().isEnabled()) ||
      !(await page.locator(".payment-option").last().isEnabled())
    )
      throw Error("Returning from a cash ticket leaves payment methods locked");
  }
  await page.locator(".payment-option").first().click();
  await page.evaluate(() => {
    window.__qaPaymentOutcome = "cancelled";
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page.getByText(/Payment cancelled\./).waitFor();
  const switched = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("santa-draft")),
  );
  if (switched.bookingId === cash.id || switched.method !== "RAZORPAY")
    throw Error("Switching payment method reused the cash reservation");
  const oldCash = await (
    await page.request.get(`${origin}/api/bookings/${cash.id}`)
  ).json();
  if (oldCash.status !== "CANCELLED" || oldCash.qrToken)
    throw Error("Old cash QR stayed active after changing method");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".payment-option").last().click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Reserve & pay at counter/ }).click();
  await page.waitForURL(/\/booking-pending\?id=/);
  const finalId = new URL(page.url()).searchParams.get("id");
  if (finalId === cash.id || finalId === switched.bookingId)
    throw Error(
      "Changing back to cash failed to reserve with the selected method",
    );
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  const oldOnline = await (
    await page.request.get(`${origin}/api/bookings/${switched.bookingId}`)
  ).json();
  if (oldOnline.status !== "CANCELLED" || oldOnline.qrToken)
    throw Error("Abandoned online reservation remained active");
  console.log(
    "PASS: cash ticket/back, desktop/mobile choices, cancelled online payment/reload and cash switch; old reservations cannot admit.",
  );
  console.log(
    "PASS: failed/cancelled/pending payments stay on checkout without QR; server capture opens the ticket directly; legacy success URLs show the ticket.",
  );
} finally {
  await browser.close();
}

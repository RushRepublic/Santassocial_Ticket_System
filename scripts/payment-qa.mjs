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
    email: "payment-qa@example.com",
    method: "RAZORPAY",
    eventDate: "2026-11-06",
    adults: 1,
    kids: 0,
  });
  // Mock only the external checkout callbacks, never production application code.
  // Server sessions, booking state and final capture still use the real local API.
  await page.addInitScript(() => {
    window.Razorpay = class {
      constructor(options) {
        this.options = options;
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
        else
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
  await page.route("**/api/payments/razorpay/verify", (route) =>
    route.fulfill({
      status: 202,
      json: { pending: true, message: "Awaiting capture" },
    }),
  );
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
  console.log(
    "PASS: failed/cancelled/pending payments stay on checkout without QR; server capture opens the ticket directly; legacy success URLs show the ticket.",
  );
} finally {
  await browser.close();
}

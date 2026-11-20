import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3109";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Use an isolated local demo server.");
const health = await (await fetch(origin + "/api/health")).json();
if (health.mode !== "demo" || health.paymentMode !== "demo" || health.whatsappMode !== "demo")
  throw Error("Use simulated providers.");
const executable = process.env.PLAYWRIGHT_EXECUTABLE ||
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch(existsSync(executable) ? { executablePath: executable } : {});
mkdirSync("test-results", { recursive: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      window.__qaCameraStarts = (window.__qaCameraStarts || 0) + 1;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 640;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      let current;
      const stream = canvas.captureStream(10);
      const timer = setInterval(() => {
        if (stream.getTracks().every((track) => track.readyState === "ended")) {
          clearInterval(timer);
          return;
        }
        if (current !== window.__qaQr) {
          current = window.__qaQr;
          img.src = current || "";
        }
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 640, 640);
        if (current && img.complete && img.naturalWidth)
          ctx.drawImage(img, 140, 140, 360, 360);
      }, 100);
      return stream;
    };
  });
  const page = await context.newPage();
  const post = async (path, data) => {
    const response = await page.request.post(origin + "/api" + path, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data,
    });
    if (!response.ok()) throw Error(`${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const mobile = "9" + randomInt(100000000, 1000000000);
  const otp = await post("/otp/send", { mobile });
  await post("/otp/verify", { mobile, challengeId: otp.challengeId, otp: otp.demoCode });
  const input = {
    name: "Group QR QA",
    discoverySource: "google",
    eventDate: "2026-11-21",
    adults: 3,
    kids: 2,
  };
  const online = await post("/bookings", { ...input, method: "RAZORPAY" });
  expect(online.qrToken).toBeNull();
  const order = await post("/payments/razorpay/order", { bookingId: online.id });
  expect(order.amount).toBe(308);
  const paid = await post("/demo/payments/complete", { bookingId: online.id });
  const cash = await post("/bookings", { ...input, method: "CASH" });
  expect(cash).toMatchObject({ ticketSubtotal: 300, platformFee: 8, amount: 308 });
  const counterCash = await post("/bookings", { ...input, method: "CASH" });
  const fallbackCash = await post("/bookings", { ...input, method: "CASH" });
  const future = await post("/bookings", { ...input, eventDate: "2026-11-22", method: "CASH" });

  // Open the secure receipt with no customer session, as from WhatsApp.
  const receipt = await browser.newPage();
  for (const [booking, label] of [[paid, "online"], [cash, "cash"]]) {
    await receipt.goto(`${origin}/ticket/${booking.id}#${booking.qrToken}`);
    await expect(receipt.getByRole("heading", { name: "Group Ticket", exact: true })).toBeVisible();
    await expect(receipt.locator(".ticket-status")).toContainText("₹3.08");
    await expect(receipt.locator(".ticket-carousel")).toHaveCount(0);
    await expect(receipt.getByText(/Ticket 1 of/)).toHaveCount(0);
    const qr = receipt.getByAltText("Secure group booking QR", { exact: true });
    await expect(qr).toHaveCount(1);
    for (const width of [360, 768, 1440]) {
      await receipt.setViewportSize({ width, height: 900 });
      expect(await receipt.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(receipt.locator(".ticket-counts strong")).toHaveText(["3", "2", "5"]);
      const { data, info } = await sharp(await qr.screenshot()).ensureAlpha()
        .raw().toBuffer({ resolveWithObject: true });
      expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(booking.qrToken);
      await receipt.locator(".digital-ticket").screenshot({
        path: `test-results/group-${label}-${width}.png`,
      });
    }
    await expect(receipt.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  }
  await receipt.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/login?next=%2Fscanner");
  await page.getByLabel("Email address").fill(process.env.QA_ADMIN_EMAIL || "individual-qa@example.test");
  await page.getByLabel("Password", { exact: true }).fill(process.env.QA_ADMIN_PASSWORD || "Individual-QA-2026!");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  await page.waitForURL(origin + "/scanner");
  await post(`/admin/bookings/${counterCash.id}/approve`, { amountReceived: counterCash.amount });
  const scan = async (booking) => {
    await page.evaluate(() => { window.__qaQr = ""; });
    await page.waitForTimeout(1700);
    await page.evaluate((qr) => { window.__qaQr = qr; }, await QRCode.toDataURL(booking.qrToken));
  };
  const approve = page.getByRole("button", { name: "Approve Group Entry", exact: true });
  await scan(future);
  await expect(page.getByRole("heading", { name: "Invalid Ticket", exact: true })).toBeVisible();
  await expect(page.getByText("Registered Event Date: Sunday, 22 November 2026")).toBeVisible();
  await expect(approve).toHaveCount(0);
  await scan(cash);
  const approveCash = page.getByRole("button", { name: "Approve Group Ticket", exact: true });
  const acknowledge = page.getByRole("checkbox", { name: "I have collected ₹3.08 in cash.", exact: true });
  const pending = page.locator(".scan-result.cash-due");
  await expect(pending.getByText("CASH PAYMENT PENDING", { exact: true })).toBeVisible();
  await expect(pending.getByRole("heading", { name: "Collect ₹3.08 before approving group entry." })).toBeVisible();
  await expect(acknowledge).not.toBeChecked();
  await expect(approveCash).toBeDisabled();
  await expect(approve).toHaveCount(0);
  await expect(page.getByText("PAYMENT VERIFIED", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Guests in this booking").locator("b")).toHaveText(["3", "2", "5"]);
  for (const width of [360, 375, 390, 414, 430, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await pending.evaluate((card) => (
      document.documentElement.scrollWidth <= innerWidth &&
      card.scrollWidth <= card.clientWidth &&
      card.querySelector(".button").getBoundingClientRect().height >= 44
    ))).toBe(true);
    await pending.screenshot({ path: `test-results/group-cash-scanner-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await acknowledge.check();
  await expect(approveCash).toBeEnabled();
  let approvalRequests = 0;
  let firstKey;
  let releaseFailure;
  const failure = new Promise((resolve) => { releaseFailure = resolve; });
  await page.route("**/api/scanner/checkin", async (route) => {
    approvalRequests++;
    const request = route.request();
    expect(request.postDataJSON()).toMatchObject({ token: cash.qrToken, amountReceived: cash.amount, cashAcknowledged: true });
    if (approvalRequests === 1) {
      firstKey = request.headers()["idempotency-key"];
      await failure;
      await route.fulfill({ status: 500, json: { error: "Simulated approval failure." } });
    } else {
      expect(request.headers()["idempotency-key"]).toBe(firstKey);
      await route.continue();
    }
  });
  await approveCash.evaluate((button) => { button.click(); button.click(); });
  const busy = page.getByRole("button", { name: "Approving Group Ticket...", exact: true });
  await expect(busy).toBeDisabled();
  await expect.poll(() => approvalRequests).toBe(1);
  releaseFailure();
  await expect(pending.getByRole("alert")).toHaveText("Simulated approval failure.");
  await expect(acknowledge).toBeChecked();
  await expect(approveCash).toBeEnabled();
  const unchanged = await (await page.request.get(`${origin}/api/bookings/${cash.id}`)).json();
  expect(unchanged).toMatchObject({ status: "PENDING_CASH", checkedInAt: null });
  const starts = await page.evaluate(() => window.__qaCameraStarts);
  const video = page.locator("video");
  await video.evaluate((preview) => preview.pause());
  await approveCash.click();
  await expect(page.getByText("Cash payment confirmed and the whole group is checked in. No re-entry.")).toBeVisible();
  const collected = await (await page.request.get(`${origin}/api/bookings/${cash.id}`)).json();
  expect(collected).toMatchObject({ status: "PAID", qrToken: cash.qrToken, approvedTickets: 5 });
  expect(collected.checkedInAt).toBeTruthy();
  await expect(pending).toHaveCount(0);
  await expect(page.getByText("PAYMENT VERIFIED", { exact: true })).toHaveCount(0);
  await expect(acknowledge).toHaveCount(0);
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((preview) => !preview.paused && preview.srcObject?.active)).toBe(true);
  expect(await page.evaluate(() => window.__qaCameraStarts)).toBe(starts);
  expect(approvalRequests).toBe(2);
  await page.unroute("**/api/scanner/checkin");
  await scan(cash);
  await expect(page.getByRole("heading", { name: "Already Approved", exact: true })).toBeVisible();
  await expect(page.getByText(`Booking ID: ${cash.reference}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/Approved At:/)).toBeVisible();
  await expect(page.getByLabel("Previously entered guests").locator("b")).toHaveText(["3", "2", "5"]);
  await expect(approveCash).toHaveCount(0);
  await expect(approve).toHaveCount(0);
  for (const booking of [paid, counterCash]) {
    await scan(booking);
    await expect(page.getByText("PAYMENT VERIFIED", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await approve.click();
    await expect(page.getByText("The whole group is checked in. No re-entry.", { exact: true })).toBeVisible();
  }
  await scan(fallbackCash);
  await expect(acknowledge).not.toBeChecked();
  await acknowledge.check();
  await video.evaluate((preview) => {
    window.__qaPriorTrack = preview.srcObject.getTracks()[0];
    preview.pause();
    preview.play = async () => { throw new DOMException("Playback blocked", "NotAllowedError"); };
  });
  await approveCash.click();
  await expect(page.getByText("Camera could not resume automatically. Tap Start camera scanner.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__qaPriorTrack.readyState)).toBe("ended");
  await page.getByRole("button", { name: "Start camera scanner" }).click();
  await expect.poll(() => video.evaluate((preview) => !preview.paused && preview.srcObject?.active)).toBe(true);
  console.log("Group receipts, atomic cash approval and retry, camera resume, already-paid and online entry, duplicate and invalid-date UI passed.");
} finally {
  await browser.close();
}

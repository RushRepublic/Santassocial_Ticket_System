import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
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
// Exercise the real QR decoder with a synthetic camera stream, without adding
// manual token controls or test hooks to the application.
await context.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 640;
    const drawing = canvas.getContext("2d");
    const qr = new Image();
    qr.src = window.__qaCameraQr;
    await qr.decode();
    const draw = () => {
      drawing.fillStyle = "white";
      drawing.fillRect(0, 0, 640, 640);
      drawing.drawImage(qr, 160, 160, 320, 320);
    };
    draw();
    const stream = canvas.captureStream(10);
    const timer = setInterval(() => {
      if (!stream.getVideoTracks().some((track) => track.readyState === "live"))
        clearInterval(timer);
      else draw();
    }, 100);
    return stream;
  };
});
const page = await context.newPage();
async function verifyTicketImage(input, token) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width < 1000 || info.height < info.width * 1.5)
    throw Error(
      "Ticket image must contain the full high-resolution portrait ticket.",
    );
  const pixel = (40 * info.width + Math.floor(info.width / 2)) * 4;
  if (data[pixel] !== 138 || data[pixel + 1] !== 29 || data[pixel + 2] !== 35)
    throw Error("Ticket export is missing its red brand header.");
  if (
    jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !== token
  )
    throw Error(
      "The branded image QR does not decode to the original group ticket.",
    );
}
async function saveAndVerifyImage(token) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save QR image", exact: true })
    .click();
  const file = await download;
  if (!file.suggestedFilename().endsWith("-ticket.png"))
    throw Error("Expected a complete ticket PNG.");
  await verifyTicketImage(await file.path(), token);
}
async function verifyAdminBookingQr(booking) {
  await page.locator(`a[href="/admin/bookings/${booking.id}"]`).first().click();
  await page
    .getByRole("heading", { name: "Customer QR code", exact: true })
    .waitFor();
  if (
    await page
      .getByRole("heading", { name: "Booking actions", exact: true })
      .count()
  )
    throw Error("Booking actions must be replaced by the customer QR.");
  const qr = page.getByAltText("Unique QR code for this booking", {
    exact: true,
  });
  if (!booking.qrToken) {
    await page
      .getByText("The QR ticket will be available after successful payment.", {
        exact: true,
      })
      .waitFor();
    if (await qr.count())
      throw Error("An unpaid online booking must not expose an admission QR.");
    return;
  }
  await qr.waitFor();
  const bytes = Buffer.from(
    (await qr.getAttribute("src")).split(",")[1],
    "base64",
  );
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !==
    booking.qrToken
  )
    throw Error("Admin QR differs from the customer's original booking QR.");
}
async function verifyStickyScanner() {
  const shortcut = page.locator(".admin-scanner-shortcut");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shortcut.waitFor();
    const before = await shortcut.boundingBox();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const after = await shortcut.boundingBox();
    if (
      !before ||
      !after ||
      Math.abs(before.y - after.y) > 1 ||
      after.x < 0 ||
      after.x + after.width > width ||
      after.y + after.height > 844 ||
      (await shortcut.evaluate((node) => getComputedStyle(node).position)) !==
        "fixed"
    )
      throw Error(
        "Open Gate Scanner must stay visible while scrolling on desktop/mobile.",
      );
  }
  await shortcut.click();
  await page.waitForURL(`${origin}/scanner`);
  await page
    .getByRole("button", { name: "Start camera scanner", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Back to dashboard", exact: true })
    .click();
  await page.waitForURL(`${origin}/admin/dashboard`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function verifyTermsPopup() {
  const terms = page.getByRole("button", {
    name: "Terms and Conditions.",
    exact: true,
  });
  const agreed = await page.getByRole("checkbox").isChecked();
  if (
    (await terms.evaluate((node) => getComputedStyle(node).color)) !==
    "rgb(21, 101, 192)"
  )
    throw Error("Terms and Conditions must appear in blue.");
  await terms.click();
  const popup = page.getByRole("dialog", {
    name: "TERMS AND CONDITION",
    exact: true,
  });
  await popup.waitFor();
  const cancellation = popup.getByRole("region", {
    name: "Ticket Cancellation Policy",
    exact: true,
  });
  const refund = popup.getByRole("region", {
    name: "Ticket Refund Policy",
    exact: true,
  });
  if (
    (await cancellation.locator("h4").count()) !== 6 ||
    (await refund.locator("h4").count()) !== 7 ||
    (await refund.locator("li").count()) !== 6
  )
    throw Error("The popup is missing cancellation/refund policy sections.");
  const policyBody = popup.locator(".terms-policy-body");
  const scroll = await policyBody.evaluate((node) => ({
    top: node.scrollTop,
    height: node.clientHeight,
    contentHeight: node.scrollHeight,
    overflow: node.scrollWidth > node.clientWidth,
  }));
  if (
    scroll.top !== 0 ||
    scroll.contentHeight <= scroll.height ||
    scroll.overflow
  )
    throw Error(
      "The long policy must open at the top and scroll within the dialog.",
    );
  await policyBody.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const finalParagraph = refund.getByText(
    "For payment-related queries or assistance with your booking, please reach out to the Rush Republic management team through the official communication channels listed on our website.",
    { exact: true },
  );
  await finalParagraph.scrollIntoViewIfNeeded();
  await popup.getByRole("button", { name: "Close", exact: true }).waitFor();
  const bounds = await popup.boundingBox();
  if (
    !bounds ||
    bounds.x < 0 ||
    bounds.x + bounds.width > page.viewportSize().width ||
    bounds.y < 0 ||
    bounds.y + bounds.height > page.viewportSize().height
  )
    throw Error("Terms popup overflows the viewport.");
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  if (!(await terms.evaluate((node) => node === document.activeElement)))
    throw Error("Closing terms must restore focus to the link.");
  await terms.click();
  if ((await policyBody.evaluate((node) => node.scrollTop)) !== 0)
    throw Error("Reopening the policy must start at the top.");
  await popup.getByRole("button", { name: "Close", exact: true }).click();
  await popup.waitFor({ state: "hidden" });
  if ((await page.getByRole("checkbox").isChecked()) !== agreed)
    throw Error("Opening/closing terms changed the customer's consent.");
}
async function scanCameraToken(token) {
  if (await page.locator(".manual-token").count())
    throw Error("Manual scanner token entry must not be visible.");
  await page.evaluate(
    (data) => {
      window.__qaCameraQr = data;
    },
    await QRCode.toDataURL(token, { width: 320, margin: 4 }),
  );
  await page
    .getByRole("button", { name: "Start camera scanner", exact: true })
    .click();
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3000";
try {
  const health = await page.request
    .get(`${origin}/api/health`)
    .then((response) => response.json());
  if (health.mode !== "demo" || health.paymentMode !== "demo")
    throw Error("Browser QA requires an isolated demo server.");
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
  if (await page.locator(".booking-sidebar").count())
    throw Error("Your booking must not show the checkout summary.");
  const formBounds = await page.locator(".registration-layout").boundingBox();
  if (!formBounds || Math.abs(formBounds.x + formBounds.width / 2 - 720) > 2)
    throw Error("Registration form must be centered on desktop.");
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
  await page
    .locator(".booking-sidebar")
    .getByRole("heading", { name: "Booking summary" })
    .waitFor();
  const summaryBounds = await page.locator(".booking-sidebar").boundingBox();
  const paymentBounds = await page
    .getByRole("heading", { name: "How would you like to pay?" })
    .boundingBox();
  if (
    !summaryBounds ||
    !paymentBounds ||
    summaryBounds.y + summaryBounds.height > paymentBounds.y
  )
    throw Error("Checkout summary must appear above payment choices.");
  await page.getByRole("link", { name: "Edit", exact: true }).waitFor();
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
  await verifyTermsPopup();
  await page.screenshot({ path: "docs/checkout-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await verifyTermsPopup();
  await page.screenshot({ path: "docs/checkout-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Checkout mobile overflow.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(origin + "/");
  await page.locator(".mobile-verified").waitFor();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.waitForURL("**/checkout");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page
    .getByRole("button", { name: "Simulate unsuccessful payment", exact: true })
    .click();
  await page
    .getByText(
      "Payment unsuccessful. No successful payment was confirmed. Please try again.",
      { exact: true },
    )
    .waitFor();
  if (
    new URL(page.url()).pathname !== "/checkout" ||
    (await page.locator(".digital-ticket").count())
  )
    throw Error("An unsuccessful payment must not open a ticket.");
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page
    .getByRole("button", { name: "Cancel demo payment", exact: true })
    .click();
  await page
    .getByText(
      "Payment cancelled. No successful payment was confirmed. Please try again.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await page.waitForURL(/\/ticket\/[^/]+$/);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  await page.screenshot({ path: "docs/ticket-desktop.png", fullPage: true });
  const bookingId = new URL(page.url()).pathname.split("/").pop();
  const booking = await page.request
    .get(`${origin}/api/bookings/${bookingId}`)
    .then((r) => r.json());
  if (booking.amount !== 100 || booking.people !== 2)
    throw Error("Incorrect group price/count");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  if (!(await download).suggestedFilename().endsWith(".pdf"))
    throw Error("Missing PDF download");
  await saveAndVerifyImage(booking.qrToken);
  await page.exposeFunction("verifySharedTicket", async (bytes) =>
    verifyTicketImage(Buffer.from(bytes), booking.qrToken),
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: ({ files }) => files?.length === 1,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ files }) => {
        if (files?.[0]?.type !== "image/png")
          throw Error("Share must attach the complete branded PNG.");
        await window.verifySharedTicket(
          Array.from(new Uint8Array(await files[0].arrayBuffer())),
        );
        window.sharedTicketVerified = true;
      },
    });
  });
  await page.getByRole("button", { name: "Share ticket", exact: true }).click();
  await page.waitForFunction(() => window.sharedTicketVerified);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text) => {
        window.copiedTicketUrl = text;
      },
    });
  });
  await page.getByRole("button", { name: "Share ticket", exact: true }).click();
  await page.waitForFunction(
    (token) => window.copiedTicketUrl?.endsWith(`#${token}`),
    booking.qrToken,
  );
  await page.goto(`${origin}/admin/login`);
  await page.waitForURL(`${origin}/login`);
  await page.goto(`${origin}/scanner/login`);
  await page.waitForURL(`${origin}/login`);
  let staffLogins = 0;
  async function signIn() {
    await page
      .getByRole("heading", { name: "Admin Login", exact: true })
      .waitFor();
    await page
      .getByLabel("Email address", { exact: true })
      .fill("admin@santasocial.local");
    await page.getByLabel("Password", { exact: true }).fill("SantaDemo2026!");
    await page.getByRole("button", { name: "Sign in securely" }).click();
  }
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
  await verifyAdminBookingQr(booking);
  await page.getByRole("link", { name: "All bookings", exact: true }).click();
  await verifyAdminBookingQr(booking);
  const unpaidResponse = await page.request.post(`${origin}/api/bookings`, {
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
    data: {
      name: "Unpaid QR QA Guest",
      email: "unpaid-qr@example.com",
      eventDate: "2026-12-05",
      adults: 1,
      kids: 0,
      method: "RAZORPAY",
    },
  });
  if (!unpaidResponse.ok())
    throw Error("Unable to create unpaid QR regression booking.");
  const unpaidBooking = await unpaidResponse.json();
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "Bookings", exact: true })
    .click();
  await verifyAdminBookingQr(unpaidBooking);
  await page
    .locator(".admin-sidebar")
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  for (const status of [403, 500]) {
    const pattern = "**/api/admin/dashboard?*";
    await page.route(pattern, (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary admin request failure" }),
      }),
    );
    await page
      .locator(".admin-sidebar")
      .getByRole("link", { name: "Bookings", exact: true })
      .click();
    await page
      .locator(".admin-sidebar")
      .getByRole("link", { name: "Overview", exact: true })
      .click();
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
  // Existing cookies must not skip login on a fresh admin/scanner document.
  for (const path of ["/admin/dashboard", "/scanner"]) {
    await registrationTab.goto(origin + path);
    await registrationTab.waitForURL(
      (url) =>
        url.pathname === "/login" && url.searchParams.get("next") === path,
    );
    await registrationTab
      .getByRole("heading", { name: "Admin Login", exact: true })
      .waitFor();
    if (await registrationTab.locator(".admin-sidebar, .scanner-main").count())
      throw Error("A saved staff cookie bypassed the login screen.");
  }
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
    ["Check-ins", "checkins"],
    ["Overview", "dashboard"],
  ]) {
    await page
      .locator(".admin-sidebar")
      .getByRole("link", { name: label, exact: true })
      .click();
    await page.waitForURL(`${origin}/admin/${section}`);
    await page.locator(".admin-sidebar").waitFor();
    await verifyStickyScanner();
  }
  await page.goto(`${origin}/login`);
  await signIn();
  await page.waitForURL(`${origin}/admin/dashboard`);
  for (const name of ["Payments", "Event settings"])
    if (
      await page
        .locator(".admin-sidebar")
        .getByRole("link", { name, exact: true })
        .count()
    )
      throw Error("Removed admin sections must not appear in navigation.");
  for (const path of ["payments", "settings"]) {
    const response = await page.request.get(`${origin}/admin/${path}`, {
      maxRedirects: 0,
    });
    if (
      response.status() !== 307 ||
      response.headers().location !== "/admin/dashboard"
    )
      throw Error("Removed admin sections must redirect to the overview.");
  }
  await page.locator(".admin-scanner-shortcut").click();
  await page.waitForURL(`${origin}/scanner`);
  const futureResponse = await page.request.post(`${origin}/api/bookings`, {
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
    data: {
      name: "Date QA Guest",
      email: "date-qa@example.com",
      eventDate: "2026-12-06",
      adults: 1,
      kids: 0,
      method: "CASH",
    },
  });
  if (!futureResponse.ok()) throw Error("Future-date QA booking failed.");
  const futureBooking = await futureResponse.json();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await scanCameraToken(futureBooking.qrToken);
    await page
      .locator(".scanner-error h2")
      .filter({ hasText: "Future Event Date" })
      .waitFor();
    await page
      .getByText(
        "This ticket is registered for December 6, 2026, and cannot be used on December 5, 2026.",
        { exact: true },
      )
      .waitFor();
    if (!(await page.locator(".scanner-error button").isDisabled()))
      throw Error("Invalid-date approval must be disabled.");
    await page.getByText("Registered event date:", { exact: false }).waitFor();
  }
  const futureUnchanged = await page.request
    .get(`${origin}/api/bookings/${futureBooking.id}`)
    .then((r) => r.json());
  if (futureUnchanged.status !== "PENDING_CASH" || futureUnchanged.checkedInAt)
    throw Error("Invalid scan consumed the future ticket.");
  await scanCameraToken(booking.qrToken);
  await page.getByText("PAYMENT VERIFIED", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Paid Rs. 1. Approve the Ticket." })
    .waitFor();
  if (await page.locator(".scan-result.payment-paid .cash-due-banner").count())
    throw Error("Paid ticket must use the green result state.");
  await page
    .getByRole("button", { name: "Approve ticket & group entry" })
    .click();
  await page
    .getByRole("heading", { name: "Welcome to Santa Social!" })
    .waitFor();
  await scanCameraToken(booking.qrToken);
  await page.getByText(/ALREADY CHECKED IN:/).waitFor();
  const cashResponse = await page.request.post(`${origin}/api/bookings`, {
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
    data: {
      name: "Cash QA Guest",
      email: "cash-qa@example.com",
      eventDate: "2026-12-05",
      adults: 2,
      kids: 1,
      method: "CASH",
    },
  });
  if (!cashResponse.ok()) throw Error("Cash QA booking creation failed.");
  const cashBooking = await cashResponse.json();
  if (!cashBooking.qrToken)
    throw Error("Cash booking must immediately issue a QR.");
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await verifyAdminBookingQr(cashBooking);
  await page
    .getByText(/Cash due:.*Payment approval is required before entry\./)
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/booking-pending?id=${cashBooking.id}`);
  await page
    .getByAltText("One secure QR code for this entire group booking")
    .waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Cash QR mobile layout overflow.");
  await page.getByText(/CASH DUE.*APPROVAL REQUIRED/).waitFor();
  if (/GROUP|ADMISSION/i.test(await page.locator(".digital-ticket .ticket-top").innerText()))
    throw Error("Ticket header must not show Group Admission wording.");
  await page.locator(".digital-ticket .ticket-top img").waitFor();
  const cashTicketText = await page.locator(".digital-ticket").innerText();
  if (
    /Pay before|One QR = One group/i.test(cashTicketText) ||
    (await page.locator(".ticket-qr .lucide-users").count())
  )
    throw Error(
      "Tickets must not show payment deadlines, group QR captions or people icons.",
    );
  await saveAndVerifyImage(cashBooking.qrToken);
  await page.goto(`${origin}/scanner`);
  await signIn();
  await page.waitForURL(`${origin}/scanner`);
  await scanCameraToken(cashBooking.qrToken);
  await page
    .getByRole("heading", { name: "Collect Rs. 2 & Approve the Ticket." })
    .waitFor();
  await page.locator(".scan-result.cash-due .cash-due-banner").waitFor();
  const approveCash = page.getByRole("button", {
    name: "Approve cash payment & group entry",
  });
  if (!(await approveCash.isDisabled()))
    throw Error("Cash collection must require explicit confirmation.");
  await page.getByRole("checkbox").check();
  await approveCash.click();
  await page
    .getByRole("heading", { name: "Welcome to Santa Social!" })
    .waitFor();
  const collected = await page.request
    .get(`${origin}/api/bookings/${cashBooking.id}`)
    .then((r) => r.json());
  if (
    collected.status !== "PAID" ||
    !collected.checkedInAt ||
    collected.qrToken !== cashBooking.qrToken
  )
    throw Error(
      "Cash approval and entry must preserve the same QR and save together.",
    );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await page.waitForURL(`${origin}/admin/dashboard`);
  await verifyAdminBookingQr(collected);
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Admin booking QR mobile layout overflow.");
  if (staffLogins !== 3)
    throw Error(
      "Fresh documents require login; module navigation must share that sign-in.",
    );
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
  await signIn();
  await page.waitForURL(`${origin}/admin/dashboard`);
  await page.reload();
  await page.waitForURL((url) => url.pathname === "/login");
  await signIn();
  await page.waitForURL(`${origin}/admin/dashboard`);
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

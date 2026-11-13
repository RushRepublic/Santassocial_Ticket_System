import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  auditResponsive,
  assertResponsiveAudits,
} from "./responsive-ui-qa.mjs";
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3109";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Use an isolated local demo server.");
const executable =
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  headless: true,
});
mkdirSync("test-results", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  // Same synthetic camera technique as browser-qa.mjs; actual QR decoder remains enabled.
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 640;
      const c = canvas.getContext("2d");
      const img = new Image();
      let previous = "";
      const stream = canvas.captureStream(10);
      const timer = setInterval(() => {
        if (stream.getTracks().every((t) => t.readyState === "ended")) {
          clearInterval(timer);
          return;
        }
        if (previous !== window.__qr) {
          previous = window.__qr;
          img.src = previous || "";
        }
        c.fillStyle = "white";
        c.fillRect(0, 0, 640, 640);
        if (previous && img.complete && img.naturalWidth)
          c.drawImage(img, 140, 140, 360, 360);
      }, 100);
      return stream;
    };
  });
  const page = await context.newPage();
  const health = await (await page.request.get(origin + "/api/health")).json();
  if (health.paymentMode !== "demo" || health.whatsappMode !== "demo")
    throw Error("No live provider requests permitted.");
  const post = async (path, data) => {
    const r = await page.request.post(origin + "/api" + path, {
      headers: { Origin: origin, "Idempotency-Key": randomUUID() },
      data,
    });
    if (!r.ok()) throw Error(`${path} ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const mobile = "9" + randomInt(100000000, 1000000000);
  const otp = await post("/otp/send", { mobile });
  await post("/otp/verify", {
    mobile,
    challengeId: otp.challengeId,
    otp: otp.demoCode,
  });
  const b = await post("/bookings", {
    name: "Individual Browser QA",
    eventDate: "2026-11-13",
    adults: 3,
    kids: 2,
    method: "CASH",
  });
  let receipt = await (
    await page.request.get(origin + `/api/tickets/${b.id}`)
  ).json();
  if (receipt.tickets.length !== 5)
    throw Error("Expected five individual tickets");
  await page.goto(origin + `/ticket/${b.id}#${b.qrToken}`);
  await expect(page.getByText("Ticket 1 of 5", { exact: true })).toBeAttached();
  await expect(page.getByText("Ticket 1 of 5", { exact: true })).toHaveClass("sr-only");
  await expect(page.locator(".ticket-navigation")).toHaveCount(0);
  await expect(page.getByText(/tickets remaining/)).toHaveCount(0);
  // Decode the rendered QR at the narrowest viewport, including its quiet zone.
  await page.setViewportSize({ width: 320, height: 900 });
  const qrImage = page
    .locator(".ticket-slide")
    .first()
    .locator(".ticket-qr img");
  await qrImage.scrollIntoViewIfNeeded();
  const { data, info } = await sharp(await qrImage.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !==
    receipt.tickets[0].qrToken
  )
    throw Error("Rendered mobile QR is clipped or cannot be decoded.");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await auditResponsive(page, `individual-receipt-${width}`);
    for (let i = 1; i < 5; i++) {
      await page.locator(".ticket-carousel").focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByText(`Ticket ${i + 1} of 5`, { exact: true }),
      ).toBeAttached();
    }
    const region = page.getByRole("region", {
      name: "Your tickets. Swipe or use arrow keys.",
    });
    await region.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByText("Ticket 4 of 5", { exact: true }),
    ).toBeAttached();
    await region.evaluate((el) => el.scrollTo({ left: 0 }));
    await expect(
      page.getByText("Ticket 1 of 5", { exact: true }),
    ).toBeAttached();
    await page.screenshot({
      path: `test-results/individual-receipt-${width}.png`,
      fullPage: true,
    });
  }
  // Real touch events on the same native scroll-snap view.
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  const box = await page.locator(".ticket-carousel").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width - 30, y: 500 }],
  });
  for (let x = box.x + box.width - 60; x > box.x + 30; x -= 25)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: 500 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByText("Ticket 2 of 5", { exact: true })).toBeAttached();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save QR image", exact: true })
    .click();
  await (await download).saveAs("test-results/individual-ticket.png");
  await page.goto(origin + "/login?next=%2Fscanner");
  await page.getByLabel("Email address").fill("individual-qa@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Individual-QA-2026!");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  await page.waitForURL(origin + "/scanner");
  async function scan(t) {
    await page.evaluate(
      (q) => {
        window.__qr = q;
      },
      await QRCode.toDataURL(t.qrToken, { width: 640, margin: 4 }),
    );
  }
  await scan(receipt.tickets[0]);
  await expect(
    page.getByText(`Ticket Number: ${receipt.tickets[0].number}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Entry Status: Not Scanned", { exact: true }),
  ).toBeVisible();
  await page.locator(".cash-collection-confirm input").check();
  await page
    .getByRole("button", { name: "Approve ticket", exact: true })
    .click();
  await expect(
    page.getByText(
      "This ticket is approved. Remaining tickets can enter separately.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const t of receipt.tickets.slice(1, 3)) {
    await scan(t);
    await expect(
      page.getByText(`Ticket Number: ${t.number}`, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve ticket", exact: true })
      .click();
    await expect(
      page.getByText(
        "This ticket is approved. Remaining tickets can enter separately.",
        { exact: true },
      ),
    ).toBeVisible();
  }
  await scan(receipt.tickets[0]);
  await expect(
    page.getByRole("heading", { name: "Already Approved", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve ticket", exact: true }),
  ).toHaveCount(0);
  await auditResponsive(page, "individual-already-approved");
  await scan(receipt.tickets[3]);
  await expect(
    page.getByText("Total Tickets: 5 | Approved: 3 | Pending: 2", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".pending-ticket-list li")).toHaveCount(2);
  const partialReceipt = await context.newPage();
  await partialReceipt.goto(origin + `/ticket/${b.id}#${b.qrToken}`);
  await expect(
    partialReceipt.getByText("2 tickets remaining", { exact: true }),
  ).toHaveCount(0);
  await expect(partialReceipt.locator(".ticket-slide").first()).toContainText(
    receipt.tickets[3].number,
  );
  await expect(partialReceipt.locator(".ticket-slide")).toHaveCount(5);
  await partialReceipt.close();
  await auditResponsive(page, "individual-scanner-mobile");
  await page.screenshot({
    path: "test-results/individual-scanner-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Approve ticket", exact: true })
    .click();
  await scan(receipt.tickets[4]);
  await expect(
    page.getByText(`Ticket Number: ${receipt.tickets[4].number}`, {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve ticket", exact: true })
    .click();
  const future = await post("/bookings", {
    name: "Future QR QA",
    eventDate: "2026-11-14",
    adults: 1,
    kids: 0,
    method: "CASH",
  });
  const ft = await (
    await page.request.get(origin + `/api/tickets/${future.id}`)
  ).json();
  await scan(ft.tickets[0]);
  await expect(
    page.getByRole("heading", { name: "Invalid Ticket", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Registered Event Date: Saturday, 14 November 2026", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve ticket", exact: true }),
  ).toHaveCount(0);
  await auditResponsive(page, "individual-invalid-date");
  await page.goto(origin + `/ticket/${b.id}#${b.qrToken}`);
  await expect(page.getByText("Fully entered", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Status: Approved / Already Used")).toHaveCount(5);
  await expect(
    page.getByText("Status: Approved / Already Used").first(),
  ).toBeVisible();
  assertResponsiveAudits();
  console.log(
    "Individual receipt: touch swipe, keyboard, mobile/tablet/desktop, export, actual camera QR decoder, partial 3/5 then 5/5, duplicate and future-date UI passed.",
  );
} finally {
  await browser.close();
}

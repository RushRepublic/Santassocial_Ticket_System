import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const origin = new URL(process.env.QA_ORIGIN || "http://127.0.0.1:3109");
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw Error("Use an isolated local demo server.");
const health = await (await fetch(new URL("/api/health", origin))).json();
expect(health).toMatchObject({ database: "sqlite", otpMode: "demo", paymentMode: "demo" });
const executable = process.env.PLAYWRIGHT_EXECUTABLE ||
  "C:/Users/aaa/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch(existsSync(executable) ? { executablePath: executable } : {});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 720 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("santa-draft")) {
      sessionStorage.setItem("santa-draft", JSON.stringify({
        eventDate: "", name: "", mobile: "", discoverySource: "",
        adults: 1, kids: 0, method: "RAZORPAY",
      }));
    }
  });
  await page.goto(origin.href);
  const checkout = page.getByRole("button", { name: "Checkout", exact: true });
  const firstDay = page.locator(".date-option").first();
  const name = page.getByPlaceholder("Your full name");
  const mobile = page.getByPlaceholder("10-digit mobile number");
  const verify = page.getByRole("button", { name: "Verify", exact: true });
  const code = page.getByLabel("Enter your 6-digit code");
  const firstRadio = page.getByRole("radio", { name: "Instagram", exact: true });
  const addAdult = page.getByRole("button", { name: "Add adults", exact: true });
  let otpRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/otp/send") otpRequests++;
  });
  await expect(firstDay).toBeEnabled();
  await expect(checkout).toBeEnabled();
  await expect(checkout).toHaveCSS("opacity", "0.45");
  await expect(checkout).toHaveAccessibleDescription(/first field that needs attention/);

  async function blocked(control, message, key) {
    if (key) await checkout.press(key);
    else await checkout.click();
    await expect(control).toBeFocused();
    await expect(control).toBeInViewport({ ratio: 0.98 });
    const error = page.getByRole("alert").filter({ hasText: message });
    await expect(error).toHaveCount(1);
    await expect(error).toBeInViewport({ ratio: 0.98 });
    await expect(page).toHaveURL(origin.href);
  }
  await blocked(firstDay, "Please select an event date.", "Enter");
  await firstDay.click();
  await expect(page.getByText("Please select an event date.")).toHaveCount(0);

  for (const width of [320, 360, 375, 390, 414, 430, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 720 });
    await blocked(name, "Please enter your full name.", width === 320 ? "Space" : undefined);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 720 });
  await name.fill("Registration QA Guest");
  await mobile.fill("123");
  await blocked(mobile, "Please enter a valid Indian mobile number.");
  await mobile.fill("9876543204");
  await blocked(verify, "Please verify your WhatsApp mobile number before continuing.");
  await blocked(verify, "Please verify your WhatsApp mobile number before continuing.");
  expect(otpRequests).toBe(0);
  await verify.click();
  await expect(code).toBeVisible();
  await blocked(code, "Please verify your WhatsApp mobile number before continuing.");
  expect(otpRequests).toBe(1);
  await code.fill(await page.locator(".demo-code b").innerText());
  await expect(page.locator(".mobile-verified")).toBeVisible();
  await blocked(firstRadio, "Please select how you heard about Santa Social.");
  await firstRadio.check();
  await expect(page.getByText("Please select how you heard about Santa Social.")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove adults", exact: true }).click();
  await blocked(addAdult, "Please select at least one guest.");
  await addAdult.click();
  await expect(checkout).toHaveCSS("opacity", "1");

  let identityRequests = 0;
  let releaseIdentity;
  const holdIdentity = new Promise((resolve) => { releaseIdentity = resolve; });
  await page.route("**/api/auth/me?scope=customer", async (route) => {
    identityRequests++;
    await holdIdentity;
    await route.continue();
  });
  await checkout.click();
  await expect.poll(() => identityRequests).toBe(1);
  await page.locator(".registration-layout form").evaluate((form) => form.requestSubmit());
  expect(identityRequests).toBe(1);
  releaseIdentity();
  await page.waitForURL(new URL("/checkout", origin).href);
  await expect(page.getByRole("heading", { name: "Booking summary", exact: true })).toBeVisible();
  console.log("Registration field order, inline errors, keyboard focus, scrolling at 10 widths, OTP and duplicate-submission protection passed.");
} finally {
  await browser.close();
}

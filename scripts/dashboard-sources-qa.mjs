import { chromium, expect } from "@playwright/test";

const origin = process.env.QA_ORIGIN || "http://127.0.0.1:3226";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Use a local Next.js server.");

const browser = await chromium.launch({
  executablePath: process.env.QA_CHROMIUM_PATH,
});
const source = (label, bookings) => ({ source: label, bookings });
const longLabel = "long-referral-source-without-spaces.example";
const totals = {
  all: [source("Instagram", 2), source(longLabel, 1), source("Unknown", 1)],
  "2026-12-05": [source("Instagram", 1)],
  "2026-12-06": [],
};
let delayDayOne = false;
let releaseDayOne;
let failDayTwo = true;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me")
      return route.fulfill({
        json: { name: "QA Admin", role: "ADMIN", sessionExpiresIn: 86400000 },
      });
    if (url.pathname === "/api/admin/bookings")
      return route.fulfill({ json: { rows: [], total: 0, pages: 0 } });
    if (url.pathname !== "/api/admin/dashboard") return route.abort();

    const date = url.searchParams.get("date");
    if (date === "2026-12-05" && delayDayOne)
      await new Promise((resolve) => { releaseDayOne = resolve; });
    if (date === "2026-12-06" && failDayTwo) {
      failDayTwo = false;
      return route.fulfill({ status: 500, json: { error: "Fixture failure" } });
    }
    return route.fulfill({
      json: {
        bookings: 4, attendees: 7, adults: 6, kids: 1, revenue: 90200,
        cashRevenue: 0, onlineRevenue: 90200, entered: 0, groupTickets: 4,
        approvedGroupEntries: 0, pendingCash: 0, notificationFailures: 0,
        sources: totals[date],
      },
    });
  });
  await page.goto(origin + "/admin/dashboard");
  const card = page.getByRole("region", { name: "Source", exact: true });
  await expect(card.locator("dt")).toHaveText(["Instagram", longLabel, "Unknown"]);
  await expect(card.locator("dd")).toHaveText(["2", "1", "1"]);
  await expect(page.locator(".stat-card")).toHaveCount(5);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await card.evaluate((section) => {
      const left = section.getBoundingClientRect().left;
      const right = section.getBoundingClientRect().right;
      return {
        fits: left >= 0 && right <= innerWidth &&
          document.documentElement.scrollWidth <= innerWidth,
        rowsFit: [...section.querySelectorAll("dl > div")].every((row) => {
          const [label, count] = row.children;
          return label.scrollWidth <= label.clientWidth &&
            label.getBoundingClientRect().right <= count.getBoundingClientRect().left &&
            count.getBoundingClientRect().right <= right;
        }),
      };
    });
    expect(geometry, `Source card at ${width}px`).toEqual({ fits: true, rowsFit: true });
  }

  const date = (name) => page.locator(".admin-page-heading").getByRole("button", { name });
  delayDayOne = true;
  await date("Dec 5").click();
  await expect.poll(() => typeof releaseDayOne).toBe("function");
  await expect(page.getByRole("status").filter({ hasText: "Getting things ready" })).toBeVisible();
  await expect(card).toHaveCount(0);
  await date("Dec 6").click();
  await expect(page.locator(".admin-content").getByRole("alert")).toHaveText(
    "Unable to load dashboard statistics. Please try again.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(card).toHaveText(/No lead source data available yet\./);
  const staleResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("date") === "2026-12-05" &&
      response.url().includes("/api/admin/dashboard"),
    { timeout: 1000 },
  ).catch(() => null);
  releaseDayOne();
  await staleResponse;
  await expect(card).toHaveText(/No lead source data available yet\./);

  delayDayOne = false;
  await date("Dec 5").click();
  await expect(card.locator("dt")).toHaveText(["Instagram"]);
  await expect(card.locator("dd")).toHaveText(["1"]);
  await date("Both days").click();
  await expect(card.locator("dd")).toHaveText(["2", "1", "1"]);
  console.log("Source card passed desktop, tablet, mobile, and date-filter checks.");
} finally {
  releaseDayOne?.();
  await browser.close();
}

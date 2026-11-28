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
const bookingCounts = {
  all: { confirmedBookings: 4, totalBookings: 7 },
  "2026-12-05": { confirmedBookings: 4, totalBookings: 6 },
  "2026-12-06": { confirmedBookings: 0, totalBookings: 1 },
};
const guestCounts = {
  all: { attendees: 7, adults: 6, kids: 1 },
  "2026-12-05": { attendees: 5, adults: 4, kids: 1 },
  "2026-12-06": { attendees: 2, adults: 2, kids: 0 },
};
const discovery = {
  all: [
    { label: "Instagram", count: 4 },
    { label: "Friends & Referrals", count: 2 },
    { label: "Not specified", count: 1 },
  ],
  "2026-12-05": [
    { label: "Instagram", count: 4 },
    { label: "Friends & Referrals", count: 2 },
  ],
  "2026-12-06": [{ label: "Not specified", count: 1 }],
};
let delayDayOne = false;
let releaseDayOne;
let failDayTwo = true;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
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
        bookings: 4, revenue: 90200,
        cashRevenue: 0, onlineRevenue: 90200, entered: 0, groupTickets: 4,
        approvedGroupEntries: 0, pendingCash: 0, notificationFailures: 0,
        sources: totals[date],
        discoverySources: discovery[date],
        discoveryTotal: discovery[date].reduce((sum, row) => sum + row.count, 0),
        ...bookingCounts[date],
        ...guestCounts[date],
      },
    });
  });
  await page.goto(origin + "/admin/dashboard");
  const card = page.getByRole("region", { name: "Source", exact: true });
  const discoveryCard = page.getByRole("region", { name: "How did you hear about us?" });
  const pie = discoveryCard.locator(".discovery-pie");
  const details = discoveryCard.getByRole("status");
  const bookingsCard = page.locator(".stat-card").filter({
    has: page.getByText("Total bookings", { exact: true }),
  });
  const bookingValue = bookingsCard.locator("strong");
  const cards = page.locator(".stat-grid > .stat-card");
  const guestCard = cards.first();
  const adults = guestCard.locator(".stat-adult-count");
  await expect(bookingValue).toHaveText("4 / 7");
  await expect(bookingsCard.locator("small")).toHaveText("4 group QR tickets issued");
  await expect(card.locator("dt")).toHaveText(["Instagram", longLabel, "Unknown"]);
  await expect(card.locator("dd")).toHaveText(["2", "1", "1"]);
  await expect(discoveryCard.locator(".discovery-total")).toHaveText("Total bookings 7");
  await expect(discoveryCard.getByRole("button")).toHaveText([
    "Instagram4 bookings (57.1%)",
    "Friends & Referrals2 bookings (28.6%)",
    "Not specified1 booking (14.3%)",
  ]);
  await expect(pie.locator("path")).toHaveCount(3);
  await pie.hover({ position: { x: 124, y: 52 } });
  await expect(details).toHaveText(/Instagram.*4 bookings \(57\.1%\)/);
  await discoveryCard.getByRole("heading").hover();
  const referrals = discoveryCard.getByRole("button", { name: /Friends & Referrals/ });
  await referrals.focus();
  await referrals.press("Enter");
  await expect(details).toHaveText(/Friends & Referrals.*2 bookings \(28\.6%\)/);
  await page.setViewportSize({ width: 390, height: 900 });
  await pie.tap({ position: { x: 124, y: 52 } });
  await expect(details).toHaveText(/Instagram.*4 bookings \(57\.1%\)/);
  await expect(cards.locator(":scope > div > span")).toHaveText([
    "Confirmed guests", "Captured revenue", "Total bookings",
    "People welcomed", "A little follow-up.",
  ]);
  await expect(cards.locator(":scope > strong")).toHaveText([
    "7", "₹902", "4 / 7", "0", "0",
  ]);
  await expect(adults).toHaveText("6 adults");
  await expect(adults).toHaveCSS("color", "rgb(21, 53, 30)");
  await expect(adults).toHaveCSS("font-weight", "600");
  await expect(guestCard.locator("small")).toHaveText("6 adults · 1 kids");
  expect(await adults.evaluate((element) => {
    const subtitle = element.parentElement;
    const normal = getComputedStyle(subtitle.closest(".stat-grid").querySelector(".stat-card:nth-child(2) > small"));
    const actual = getComputedStyle(subtitle);
    return element.nextSibling.nodeType === Node.TEXT_NODE &&
      ["color", "font-size", "font-weight"].every((key) =>
        actual.getPropertyValue(key) === normal.getPropertyValue(key));
  })).toBe(true);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const leftCard = await card.boundingBox();
    const rightCard = await discoveryCard.boundingBox();
    const recent = await page.getByRole("heading", { name: /Recent bookings/ }).boundingBox();
    expect(recent.y).toBeGreaterThan(rightCard.y + rightCard.height);
    if (width >= 1024) {
      expect(rightCard.x).toBeGreaterThan(leftCard.x + leftCard.width);
      expect(rightCard.y).toBe(leftCard.y);
      expect(Math.abs(rightCard.width - leftCard.width)).toBeLessThan(1);
      expect(rightCard.height).toBe(leftCard.height);
    } else {
      expect(rightCard.x).toBe(leftCard.x);
      expect(rightCard.y).toBeGreaterThan(leftCard.y + leftCard.height);
    }
    expect(await cards.evaluateAll((elements) => {
      const rects = elements.map((element) => element.getBoundingClientRect());
      const sourceTop = document.querySelector(".source-card").getBoundingClientRect().top;
      return rects.every((rect, index) => {
        const prior = rects[index - 1];
        return rect.bottom <= sourceTop && (!prior ||
          (rect.top === prior.top
            ? rect.left >= prior.right && rect.height === prior.height
            : rect.top >= prior.bottom));
      });
    }), `Summary card layout at ${width}px`).toBe(true);
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
    expect(await bookingValue.evaluate((value) => {
      const range = document.createRange();
      range.selectNodeContents(value);
      const text = range.getBoundingClientRect();
      const card = value.closest(".stat-card").getBoundingClientRect();
      return range.getClientRects().length === 1 &&
        text.left >= card.left && text.right <= card.right;
    }), `Booking count at ${width}px`).toBe(true);
  }

  const date = (name) => page.locator(".admin-page-heading").getByRole("button", { name });
  delayDayOne = true;
  await date("Dec 5").click();
  await expect.poll(() => typeof releaseDayOne).toBe("function");
  await expect(page.getByRole("status").filter({ hasText: "Getting things ready" })).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(discoveryCard).toHaveCount(0);
  await date("Dec 6").click();
  await expect(page.locator(".admin-content").getByRole("alert")).toHaveText(
    "Unable to load dashboard statistics. Please try again.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(card).toHaveText(/No lead source data available yet\./);
  await expect(discoveryCard).toContainText("No customer discovery data available yet.");
  await expect(discoveryCard).toContainText("1 booking not specified");
  await expect(pie).toHaveCount(0);
  await expect(bookingValue).toHaveText("0 / 1");
  await expect(adults).toHaveText("2 adults");
  await expect(guestCard.locator("small")).toHaveText("2 adults · 0 kids");
  const staleResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("date") === "2026-12-05" &&
      response.url().includes("/api/admin/dashboard"),
    { timeout: 1000 },
  ).catch(() => null);
  releaseDayOne();
  await staleResponse;
  await expect(card).toHaveText(/No lead source data available yet\./);
  await expect(discoveryCard).toContainText("1 booking not specified");
  await expect(bookingValue).toHaveText("0 / 1");

  delayDayOne = false;
  await date("Dec 5").click();
  await expect(card.locator("dt")).toHaveText(["Instagram"]);
  await expect(card.locator("dd")).toHaveText(["1"]);
  await expect(bookingValue).toHaveText("4 / 6");
  await expect(adults).toHaveText("4 adults");
  await expect(pie.locator("path")).toHaveCount(2);
  await expect(discoveryCard.locator(".discovery-total")).toHaveText("Total bookings 6");
  await expect(discoveryCard.getByRole("button")).toHaveText([
    "Instagram4 bookings (66.7%)",
    "Friends & Referrals2 bookings (33.3%)",
  ]);
  await date("Both days").click();
  await expect(card.locator("dd")).toHaveText(["2", "1", "1"]);
  await expect(bookingValue).toHaveText("4 / 7");
  await expect(discoveryCard.locator(".discovery-total")).toHaveText("Total bookings 7");
  await expect(adults).toHaveText("6 adults");
  console.log("Overview card order, guest styling, Source, and date filters passed across viewport sizes.");
} finally {
  releaseDayOne?.();
  await browser.close();
}

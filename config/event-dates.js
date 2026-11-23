export const EVENT_DATES = Object.freeze(["2026-12-05", "2026-12-06"]);
const eventMonthYear = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const eventDays = EVENT_DATES.map((date) => Number(date.slice(-2))).join(" & ");
export const EVENT_DATE_LABEL = `${eventDays} ${eventMonthYear.format(new Date(EVENT_DATES[0]))}`;

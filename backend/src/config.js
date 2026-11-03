import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
export const demo = process.env.APP_MODE !== "live";
export const production = process.env.NODE_ENV === "production";
export const hostedDemo = production && demo;
// Storage is independent of simulated providers. Hosted test deployments use MySQL.
export const databaseDriver =
  process.env.DB_DRIVER || (production || !demo ? "mysql" : "sqlite");
if (!["mysql", "sqlite"].includes(databaseDriver))
  throw Error("DB_DRIVER must be mysql or sqlite.");
if ((production || !demo) && databaseDriver !== "mysql")
  throw Error("Hosted deployments and live mode require DB_DRIVER=mysql.");
if (databaseDriver === "mysql") {
  let valid = false;
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    valid =
      url.protocol === "mysql:" &&
      Boolean(url.hostname && url.username && url.pathname.length > 1);
  } catch {}
  if (!valid)
    throw Error("Set a valid mysql:// DATABASE_URL when DB_DRIVER=mysql.");
}
if (hostedDemo && process.env.ALLOW_HOSTED_DEMO !== "true")
  throw new Error(
    "Production requires APP_MODE=live, or explicit ALLOW_HOSTED_DEMO=true for a test prototype.",
  );
if (hostedDemo) {
  const origin = new URL(process.env.FRONTEND_ORIGIN || "http://localhost");
  if (
    origin.protocol !== "https:" ||
    origin.origin !== process.env.FRONTEND_ORIGIN
  )
    throw new Error(
      "Hosted prototypes require an exact HTTPS FRONTEND_ORIGIN without a trailing slash.",
    );
  for (const role of ["ADMIN", "CASHIER", "SCANNER"]) {
    if (
      role !== "ADMIN" &&
      !process.env[`${role}_EMAIL`] &&
      !process.env[`${role}_PASSWORD`]
    )
      continue;
    if (
      !process.env[`${role}_EMAIL`] ||
      (process.env[`${role}_PASSWORD`] || "").length < 12
    )
      throw new Error(
        `Set ${role}_EMAIL and a ${role}_PASSWORD of at least 12 characters for this staff account.`,
      );
  }
}
function secret(name, fallback) {
  const value = process.env[name];
  if (
    (!demo || production) &&
    (!value || value.length < 32 || /^replace[-_]/i.test(value))
  )
    throw new Error(
      `${name} must be a unique random secret of at least 32 characters.`,
    );
  return value || fallback;
}
export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
  origin: process.env.FRONTEND_ORIGIN || "http://127.0.0.1:3000",
  sessionSecret: secret(
    "SESSION_SECRET",
    "local-demo-session-secret-change-before-live",
  ),
  ticketSecret: secret(
    "TICKET_SECRET",
    "local-demo-ticket-secret-change-before-live",
  ),
  otpSecret: secret("OTP_SECRET", "local-demo-otp-secret-change-before-live"),
  demoDate: process.env.DEMO_EVENT_DATE || "2026-12-05",
};
if (
  (!demo || production) &&
  new Set([config.sessionSecret, config.ticketSecret, config.otpSecret])
    .size !== 3
)
  throw Error("Use separate secrets.");
export const maintenanceMode = process.env.MAINTENANCE_MODE || "interval";
if (!["interval", "cron"].includes(maintenanceMode))
  throw Error("MAINTENANCE_MODE must be interval or cron.");

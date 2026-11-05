export function staffDestination(role, requested = "") {
  const home = role === "SCANNER" ? "/scanner" : "/admin/dashboard";
  if (!["ADMIN", "CASHIER", "SCANNER"].includes(role)) return "/login";
  if (!/^\/(admin|scanner)(\/|$)/.test(requested) || requested.includes("\\"))
    return home;
  const path = requested.split(/[?#]/)[0];
  if (path === "/admin/login" || path === "/scanner/login") return home;
  if (/^\/admin\/(payments|settings)(\/|$)/.test(path)) return home;
  if (role === "SCANNER" && !/^\/scanner(\/|$)/.test(path)) return home;
  if (
    role === "CASHIER" &&
    (/^\/scanner(\/|$)/.test(path) || path.startsWith("/admin/settings"))
  )
    return home;
  if (new URL(requested, "https://staff.invalid").pathname !== path)
    return home;
  return requested;
}

export const staffLoginUrl = (path) =>
  `/login?next=${encodeURIComponent(path)}`;

// A saved cookie still needs server validation, but must not skip the login
// screen on a fresh document load. Keep this UI grant in memory only so it
// survives client navigation, never reloads, new tabs or browser restarts.
let signedInThisVisit = false;
export const hasStaffLogin = () => signedInThisVisit;
export function setStaffLogin(value) {
  signedInThisVisit = value === true;
}

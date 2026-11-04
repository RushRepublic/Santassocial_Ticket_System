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

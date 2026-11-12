export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Unable to connect. Check your connection and try again.");
  }
  const data = await response
    .json()
    .catch(() => ({ error: "The service is temporarily unavailable." }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      /^\/(admin|scanner)(\/|$)/.test(window.location.pathname) &&
      /^\/(admin|scanner)(\/|\?|$)/.test(path)
    )
      window.location.replace(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}&expired=1`,
      );
    throw Object.assign(new Error(data.error || "The request failed."), {
      status: response.status,
      details: data.details,
    });
  }
  return data;
}
export const post = (path, body, headers) =>
  api(path, { method: "POST", body: JSON.stringify(body), headers });
export const money = (paise) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
export const eventDate = (value) =>
  new Date(`${value}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "—";

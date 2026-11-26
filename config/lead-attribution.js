const utmFields = {
  source: 64,
  medium: 64,
  campaign: 160,
  content: 160,
  term: 160,
};

function tag(value, field, limit) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text.length > limit || /[<>\uFFFD\p{Cc}\p{Cf}]/u.test(value)) return "";
  if (field === "source" && !/^[\p{L}\p{N}\p{M} ._()-]+$/u.test(text))
    return "";
  return text;
}

const platforms = [
  ["Instagram", ["instagram", "ig", "instagram.com"], ["instagram.com"]],
  ["Facebook", ["facebook", "fb", "facebook.com"], ["facebook.com", "fb.com"]],
  ["WhatsApp", ["whatsapp", "wa", "whatsapp.com"], ["whatsapp.com", "wa.me"]],
  [
    "YouTube",
    ["youtube", "yt", "youtube.com"],
    ["youtube.com", "youtu.be", "youtube-nocookie.com"],
  ],
  [
    "Google",
    ["google", "google.com"],
    [
      "google.com",
      "google.co.in",
      "google.co.uk",
      "google.ca",
      "google.com.au",
      "google.de",
      "google.fr",
    ],
  ],
  ["Bing", ["bing", "bing.com"], ["bing.com"]],
  ["LinkedIn", ["linkedin", "linkedin.com"], ["linkedin.com", "lnkd.in"]],
  ["Direct", ["direct", "(direct)"], []],
  ["Unknown", ["unknown", "(not set)", "(none)"], []],
];

function hostname(value) {
  if (typeof value !== "string" || value.length > 254) return "";
  const host = value.toLowerCase().replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
    host,
  )
    ? host
    : "";
}

function externalHost(value, ownHost = "") {
  const host = hostname(value);
  const withoutWww = (name) => name.replace(/^www\./, "");
  return host &&
    !["tickets.santassocial.com", withoutWww(ownHost)].includes(
      withoutWww(host),
    )
    ? host
    : "";
}

export function readLandingSignals(search, referrer, ownHost) {
  const utm = {};
  for (const [name, value] of new URLSearchParams(search)) {
    const field = name.toLowerCase().slice(4);
    if (
      !name.toLowerCase().startsWith("utm_") ||
      !Object.hasOwn(utmFields, field) ||
      utm[field]
    )
      continue;
    const text = tag(value, field, utmFields[field]);
    if (text) utm[field] = text;
  }
  let referrerHost = "";
  try {
    const url = new URL(referrer);
    if (["https:", "http:"].includes(url.protocol))
      referrerHost = externalHost(url.hostname, ownHost);
  } catch {
    // Some browsers suppress referrers or provide no usable URL.
  }
  return { utm, referrerHost };
}

export function resolveLeadAttribution(signals, ownHost) {
  const utm = Object.fromEntries(
    Object.entries(utmFields).flatMap(([field, limit]) => {
      const text = tag(signals?.utm?.[field], field, limit);
      return text ? [[field, text]] : [];
    }),
  );
  const platform = platforms.find(([, aliases]) =>
    aliases.includes(utm.source?.toLowerCase()),
  )?.[0];
  if (utm.source && platform !== "Unknown") {
    let source = platform || utm.source;
    if (source === "Google") {
      const medium = utm.medium?.toLowerCase().replace(/[ -]/g, "_");
      if (
        [
          "cpc",
          "ppc",
          "paid",
          "paid_search",
          "paidsearch",
          "sem",
          "display",
          "cpm",
        ].includes(medium)
      )
        source = "Google Ads";
      if (["organic", "organic_search"].includes(medium))
        source = "Google Organic";
    }
    return { source, method: "utm", utm };
  }
  const host = externalHost(signals?.referrerHost, ownHost);
  const referral = platforms.find(([, , domains]) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  )?.[0];
  if (host)
    return {
      source: referral === "Google" ? "Google Referral" : referral || host,
      method: "referrer",
      utm,
    };
  return Object.keys(utm).length
    ? { source: "Unknown", method: "unknown", utm }
    : null;
}

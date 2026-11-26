import {
  readLandingSignals,
  resolveLeadAttribution,
} from "../../../config/lead-attribution.js";

export function GET(request) {
  const { search, hostname } = new URL(request.url);
  const signals = readLandingSignals(
    search,
    request.headers.get("referer"),
    hostname,
  );
  const attribution = resolveLeadAttribution(signals, hostname);
  // A cross-site referrer can disappear during the redirect. Forward only the
  // validated hostname, in a fragment that browsers do not send to the server.
  const fragment =
    attribution?.method === "referrer"
      ? `#lead-ref=${signals.referrerHost}`
      : "";
  return new Response(null, {
    status: 307,
    headers: {
      Location: `/${search}${fragment}`,
      "Cache-Control": "private, no-store",
    },
  });
}

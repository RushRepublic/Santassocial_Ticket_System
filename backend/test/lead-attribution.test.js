import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readLandingSignals,
  resolveLeadAttribution,
} from "../../config/lead-attribution.js";

const domain = "tickets.santassocial.com";
const attribution = (search, referrer = "") =>
  resolveLeadAttribution(readLandingSignals(search, referrer, domain), domain);

test("UTM attribution normalizes known sources and retains bounded campaign metadata", () => {
  for (const [source, medium, label] of [
    ["iG", "paid_social", "Instagram"],
    ["FB", "", "Facebook"],
    ["wa", "", "WhatsApp"],
    ["YT", "", "YouTube"],
    ["Google", "CPC", "Google Ads"],
    ["google", "organic", "Google Organic"],
    ["google", "", "Google"],
    ["linkedin", "", "LinkedIn"],
    ["direct", "", "Direct"],
    ["Local Newsletter", "", "Local Newsletter"],
  ]) {
    const search = new URLSearchParams({
      UTM_SOURCE: source,
      UtM_MeDiUm: medium,
      utm_campaign: "Santa 2026",
      utm_content: 'Creative "A"',
      utm_term: "carnival Coimbatore",
    });
    assert.deepEqual(
      attribution(search, "https://m.facebook.com/page?secret=123"),
      {
        source: label,
        method: "utm",
        utm: {
          source,
          ...(medium && { medium }),
          campaign: "Santa 2026",
          content: 'Creative "A"',
          term: "carnival Coimbatore",
        },
      },
    );
  }
});

test("referrer attribution uses hostname boundaries and drops paths and query strings", () => {
  for (const [host, source] of [
    ["l.instagram.com", "Instagram"],
    ["m.facebook.com", "Facebook"],
    ["web.whatsapp.com", "WhatsApp"],
    ["wa.me", "WhatsApp"],
    ["youtu.be", "YouTube"],
    ["www.google.co.in", "Google Referral"],
    ["www.bing.com", "Bing"],
    ["www.linkedin.com", "LinkedIn"],
    ["instagram.com.example.org", "instagram.com.example.org"],
    ["fakefacebook.com", "fakefacebook.com"],
  ]) {
    assert.deepEqual(attribution("", `https://${host}/path?secret=123`), {
      source,
      method: "referrer",
      utm: {},
    });
  }
  for (const referrer of [
    "",
    "://",
    "https://tickets.santassocial.com/path",
    "data:text/html,test",
  ])
    assert.equal(attribution("", referrer), null);
  assert.equal(
    attribution("", "https://www.example.test/path")?.source,
    "www.example.test",
  );
  assert.equal(
    resolveLeadAttribution(
      { referrerHost: "www.example.test" },
      "example.test",
    ),
    null,
  );
});

test("malformed or oversized values fall back safely without inventing a source", () => {
  assert.equal(
    attribution("?utm_source=%3Cscript%3E", "https://facebook.com").source,
    "Facebook",
  );
  assert.equal(attribution("?utm_source=%FF"), null);
  assert.equal(attribution(`?utm_source=${"a".repeat(65)}`), null);
  assert.equal(attribution("?utm_source=%0AYouTube"), null);
  assert.equal(
    attribution("?utm_source=(not+set)", "https://bing.com").source,
    "Bing",
  );
  assert.equal(
    attribution("?gclid=unverified", "https://www.google.com").source,
    "Google Referral",
  );
  assert.deepEqual(attribution("?utm_campaign=untagged"), {
    source: "Unknown",
    method: "unknown",
    utm: { campaign: "untagged" },
  });
  assert.equal(
    resolveLeadAttribution(
      {
        source: "Facebook",
        method: "utm",
        utm: { source: [] },
        referrerHost: "https://facebook.com",
      },
      domain,
    ),
    null,
  );
});

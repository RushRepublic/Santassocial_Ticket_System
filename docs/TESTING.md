# Verification evidence

## Admin permission and loading regression

A regression test reproduced the admin dashboard's 403 after customer OTP verification replaced the shared session cookie. Staff now use `santa_staff_session`; customer verification retains `santa_session`. Backend tests cover concurrent identities, independent logout, owner/admin access and legacy-cookie migration without extending the signed session. Browser QA verifies registration in a second tab preserves admin permissions, and that dashboard 403/500 responses stop loading and recover through Try again. Staff-only expired requests return to the shared login rather than leaving a loading screen. The local browser run uses the SQLite test adapter; the MySQL integration scenario remains conditional on a dedicated test database.

## Single-subdomain server and shared staff login

The current combined entry is root `server.js`, serving the built Next.js site and Express API on one port. `npm run check` passed for 41 authored files; `npm test` passed 15 scenarios with one MySQL integration scenario explicitly skipped because no test MySQL server/URL was available. `npm run build` passed. Routing tests verify raw webhook bytes and API cookies survive the shared listener, API misses remain JSON, and login return paths reject external/dot-segment destinations while respecting staff roles.

The existing Chromium workflow passed against an isolated combined server on port 3107. It verified registration, inline OTP, simulated payment, one group QR/PDF, legacy login redirects to `/login`, one admin login across bookings/payments/check-ins/settings/scanner, returning from scanner to dashboard, authenticated login-page restoration, duplicate entry rejection and shared logout. Desktop 1440px and mobile 390px checks passed without browser JavaScript errors or horizontal overflow. The combined server used the local SQLite test adapter for this browser run; hosted deployments still require MySQL. Hostinger process routing, real MySQL connectivity/concurrency and physical camera access are not established by that run.

Deployment instructions are in [the single-site guide](HOSTINGER-SINGLE-SITE.md). Earlier sections below retain historical verification evidence and counts.

## Inline mobile verification

Registration now has two steps: Your booking and Checkout. OTP entry is part of the WhatsApp mobile field on `/`; the old `/verify-otp` route redirects to `/`. The Checkout button stays disabled without a verified matching mobile. The browser workflow covers an incorrect code, successful inline verification, editing the mobile, losing the server session, restoring a still-valid session, editing from checkout, demo payment, ticket download and staff entry. `scripts/inline-otp-qa.mjs` checks the five-minute UI deadline, resend cooldown and 390px/320px layouts. The backend suite now has 12 scenarios, including rejection of a correctly entered but expired OTP and prevention of unauthenticated booking creation. Live WhatsApp delivery remains unverified without provider credentials/templates.

## Supplied 9th Edition logo

The owner-supplied `santa.png` replaces the text wordmark across customer, ticket, admin and scanner screens, the favicon, and browser/server PDF tickets. SHA-256 checks confirm the web, backend and favicon assets are byte-identical to the original artwork. JavaScript checks, the production build, all 11 backend workflow tests (including server PDF download), and the desktop/mobile browser journey (including branded client PDF download) passed. Updated booking/ticket/admin screenshots show the actual supplied logo. Logo sizing preserves its aspect ratio; registration form styling and admission QR logic are unchanged.

## Direct booking landing update

`/` serves the original booking form immediately and `/register` redirects permanently to it. JavaScript checks, all 11 API/workflow tests, the production build and the updated browser journey passed. The booking form screenshot was byte-for-byte identical before/after at 1440px and 390px; no registration CSS or form markup was redesigned. See `BOOKING-LANDING.md` for evidence and the production-browser verification context.

The shared public registration QR is intentionally deferred during local development at the owner's request. It is not a development blocker. The generator refuses to produce final files without a real deployed HTTPS URL. Public registration PNG/SVG decoding is therefore **not yet verified**, and no public URL has been guessed from localhost settings, the sample Nginx domain or the marketing reference website. Unique per-booking admission QR generation and verification remain active and covered by the existing tests.

## Completed locally

Revalidated after the JavaScript conversion:

- `npm run check`: passed for all 29 authored JavaScript/JSX/tooling files. No authored `.ts`, `.tsx`, or declaration files remain; generated `.next` output and dependency internals are excluded.
- `npm test`: all 11 unchanged workflow scenarios pass under `node --test test/*.test.js`.
- `npm run build`: passed with `next.config.mjs` and the `jsconfig.json` alias. Next.js prints a generic “Running TypeScript” stage label, but no TypeScript project configuration, compiler dependency or authored TypeScript source is present.
- `npm run db:migrate` and `npm run db:seed`: passed through the JavaScript setup entrypoint against the existing demo database; the SQL schema was not changed.
- `node scripts/browser-qa.mjs`: passed against `next start` and the API running directly from `backend/src/server.js`. Verified desktop/mobile layouts, demo OTP, online demo checkout, group QR/PDF, organiser login, scanner entry and duplicate rejection. Cash approval and recovery remain covered by the API suite.
- `npm ls typescript tsx --all`: empty; compiler/runner dependencies and unnecessary direct `@types/*` packages were removed from manifests, lockfile and installation.

The frontend still uses Next.js App Router. The JavaScript check validates syntax and forbids authored TypeScript; it does not replace static type analysis. Existing MySQL/live-provider/physical-camera limitations below still apply.

- `npm run check`: validates authored JavaScript and JSX syntax and checks non-JSX modules with Node.js. This replaces the removed TypeScript check; it does not claim static type checking.
- `npm run build`: backend JavaScript syntax check and Next.js production build. The backend runs its `.js` source directly.
- `npm test`: **11 backend regression tests passed** on the isolated SQLite demo adapter.
- `node scripts/browser-qa.mjs`: Chromium end-to-end customer/admin/scanner flow passed at desktop 1440px and mobile 390px. No page JavaScript errors were observed in that run; horizontal overflow checks passed for homepage, registration and admin overview.

The backend suite covers:

1. One group QR, pending-cash rejection, exact cash approval and atomic duplicate-entry prevention.
2. **100 concurrent service-level registration attempts** against deliberately small combined/daily capacity, including free kids in counts.
3. Idempotent registration, duplicate captured-payment settlement and repeated webhook-event IDs.
4. Expired holds releasing capacity and late captures going to review when capacity is unavailable.
5. Late capture reacquiring available capacity, paid bookings surviving expiry maintenance, and wrong-date rejection.
6. Default adult-supervision enforcement and explicitly configured free bookings.
7. API-origin protection, mobile OTP one-time consumption, owner-only recovery, server price calculation, demo order/payment, PDF generation, staff roles, secure ticket bearer links, scanner check-in and used-ticket rejection.
8. **15 simultaneous service-level check-in operations** for independent paid groups.
9. Constant-time signature comparison inputs and byte-sensitive HMAC authentication.

Additional tests document failed-notification isolation and maintenance behavior as implemented. Test files are the authoritative scenario definitions and actual test output gives the count.

The recorded 300-request local demo browsing run produced **299 HTTP 200 responses and one expected HTTP 429** (the initial health request also consumed the per-minute shared-IP allowance). Elapsed time was about 844 ms; p95 was about 764 ms. Raw results are in `load-demo.json`. These are local development observations, not production capacity measurements.

Browser QA exercises the visible registration form, demo OTP, checkout consent, explicitly simulated online capture, success page, one QR, downloadable client PDF, staff login, admin dashboard, gate verification, final group entry and duplicate rejection. Screenshots are stored in this directory. It creates demo records; use an isolated demo database. It does not contact real payment or messaging services.

## Re-run

```sh
npm run check
npm test
npm run build
npm run dev
```

In another terminal, with Playwright Chromium available:

```sh
node scripts/browser-qa.mjs
node scripts/load.mjs
```

`scripts/load.mjs` generates **300 concurrent browsing requests** to the demo event endpoint, reports statuses, elapsed time and p95 latency, and refuses live mode. Rate limits remain enabled; a shared-IP burst may produce 429s depending on preceding traffic. This is not 300 independently verified WhatsApp/checkout sessions and not a substitute for VPS load testing. A production browser test must use approved test merchant accounts and templates, not this demo script.

## Remaining required staging checks

These have not been demonstrated in this environment:

- Real MySQL 8 migrations, row-lock contention, deadlock/reconnection handling, backup restoration, and concurrent writes across database connections.
- 100 concurrent registrations and 300 realistic end-to-end sessions on the actual VPS with isolated test users, mobile-verification limits, gateway timing and measured response budgets.
- 15 physical scanning devices over the event network; camera permission, focus, QR decoding speed and poor-connectivity handling.
- Actual Razorpay Checkout, valid/invalid raw webhook deliveries, duplicate remote events, delayed captures, out-of-order notifications and dashboard-to-database reconciliation.
- Actual AskEva OTP authentication templates, wrong/expired OTP delivery, failed WhatsApp retries, SMTP fallback and sender authentication.
- Database restart/reconnect while a booking, captured-payment settlement or group entry is in progress.
- Screen-reader and physical-device accessibility review. Automated mobile viewport and form checks do not establish full accessibility compliance.

No claim of supporting 20,000 attendees under production load is made from these local tests. The data model/limits support that configured capacity; acceptable production throughput requires measured staging results.

# Hosted admin error diagnostics

Unexpected API failures now log a request ID, route and allowlisted database error identifiers (`code`, `errno`, `sqlState`). Responses include only the generic error and request ID. A regression test verifies that SQL text, error messages and customer details are excluded.

The hosted dashboard reported `ER_CANT_AGGREGATE_2COLLATIONS` (1267). Dashboard date filters, booking date/status filters and check-in role filters now select optional SQL clauses in JavaScript and bind only column values. The MySQL connection explicitly uses the schema's `utf8mb4_unicode_ci` collation. A regression test first reproduced the failure by rejecting the conflicting parameter/literal comparisons, then passed for both dates, all dates, search, status, CSV and scanner ownership after the fix. The optional MySQL integration test now exercises these staff routes too; it requires a dedicated MySQL test database and is not a claim of authenticated verification on Hostinger.

## Immediate cash QR and gate approval

Cash bookings now expose the same unique QR before and after payment approval, with provisional PDF/PNG downloads and cash-due wording. Backend regressions cover immediate QR delivery, owner access, red-state lookup data, admin-only exact collection, atomic payment plus check-in, concurrent duplicate rejection, idempotent retries, legacy hash backfill and expired/cancelled/wrong-date rejection without recording payment. Existing online-payment and scanner restrictions remain covered. `npm run check`, `npm test` (23 passed, one MySQL integration test skipped), and `npm run build` passed. Extended browser QA passed on an isolated local combined server using SQLite: customer cash QR and pending ticket on mobile, cash-due red scanner result, explicit cash confirmation, same QR after approval/entry, green online-paid result, and the existing registration/admin/retrieval/scanner journey. Real WhatsApp/SMTP delivery and hosted MySQL transaction testing remain outside this local verification.

## Centered booking form

The registration landing page now uses a centered single-column form with no booking summary. Checkout retains the existing summary. Syntax checks, 23 backend tests (one MySQL integration test skipped), production build and existing desktop/mobile browser QA passed; browser checks explicitly verify desktop centering, no summary on registration and summary visibility on Checkout.

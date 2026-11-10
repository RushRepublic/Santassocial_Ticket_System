# Responsive UI verification

This change refines the existing Santa Social interface. It preserves the logo,
Roboto Condensed font, red/green/cream identity, component structure, event dates,
prices, API contracts, database, payment integration and QR validation rules.

## Changes

- `frontend/app/globals.css`: smaller form/progress margins and consistent card
  spacing; readable mobile metadata; 16px inputs and primary buttons; 48px inputs;
  44px quantity and icon controls; clearer keyboard focus and text contrast.
- The two event choices remain side by side. Below 480px their contents reflow
  within each card, preserving the date, time and selected indicator.
- Checkout retains the summary above payment choices. Long names, contact details
  and ticket information wrap inside their containers. Ticket exports and QR
  generation are unchanged.
- Admin cards adapt to available width. Wide tables scroll within their cards
  and can receive keyboard focus. Closed mobile navigation is hidden from keyboard
  navigation. The existing scanner shortcut remains available.
- Scanner preview uses a bounded aspect ratio. Paid/cash/invalid results keep
  their existing colors, messages and approval restrictions.
- Customer/admin navigation exposes expanded/current state; date and payment
  choices expose selected state; booking, checkout and scanner have page headings.
  The mobile number uses a telephone input without changing validation.

## Verification

The isolated local demo server used a fresh SQLite QA database, simulated OTP and
payments. No production bookings or paid transactions were created.

- `npm run check`: passed.
- `npm test`: 36 passed, one optional MySQL integration test skipped because no
  dedicated `MYSQL_TEST_DATABASE_URL` was configured.
- `npm run build`: passed with the existing Next.js/Express architecture.
- `scripts/browser-qa.mjs`: passed customer verification, checkout, failed and
  cancelled payment handling, ticket PDF/PNG/sharing, admin login and navigation,
  cash collection, date mismatch restrictions and duplicate-entry protection.
- `scripts/payment-qa.mjs`: passed callback/capture checks and returning to
  checkout to change payment method on desktop/mobile.
- Responsive checks: 18 rendered screen/state combinations at 320, 360, 375, 390,
  414, 430, 768, 1024, 1440 and 1920 CSS pixels: 180 checks with no document
  horizontal overflow, undersized inputs or primary-control height failures.
- Accessibility: 36 axe-core WCAG A/AA scans at 320 and 1440px, with no detected
  violations in the tested states. Checked keyboard menu activation, terms dialog
  focus/escape behavior and reduced motion.
- Reflow checked at 384 CSS pixels, equivalent to a 768px browser viewport at
  200% zoom. This is an equivalent-layout check, not a native Safari zoom test.
- Screenshots were generated and representative registration, checkout, ticket,
  admin, scanner and policy-dialog images were visually inspected.

Covered screens/states: registration, inline OTP, terms dialog, checkout, paid
ticket, cash ticket, ticket retrieval, admin login, overview, booking list,
booking details, check-ins, scanner idle, paid, cash, future-date and past-date
results. Overview is also checked after client navigation to the dashboard.

## Running the responsive checks

Start the existing custom server against an isolated local demo database using
`APP_MODE=demo`, `PAYMENT_MODE=demo`, `DB_DRIVER=sqlite` and
`DEMO_EVENT_DATE=2026-12-05`. Do not point the workflow at production.

Install axe-core in a temporary tools directory outside the project, then set
`AXE_PATH` to its `axe.min.js` if it is not installed under
`%TEMP%/santa-ui-qa-tools/node_modules/axe-core/axe.min.js`.

```powershell
$env:QA_ORIGIN='http://127.0.0.1:3109'
$env:QA_RESPONSIVE='1'
node scripts/browser-qa.mjs
node scripts/payment-qa.mjs
```

Reports and screenshots are written to `test-results/responsive-ui/` (gitignored).
The accessibility tool is test-only; no application dependency was added.

Automated audits are not a complete WCAG certification. Physical iOS/Android
keyboards, real camera hardware, screen-reader behavior, authenticated production
workflows and live MySQL/provider operations still require device/integration QA.

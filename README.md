![Santa’s Social 9th Edition brand logo](santa.png)

# Santa Social · 9th Edition

Next.js customer site, modular Express API, MySQL production storage, and mobile group-ticket verification for December 5–6, 2026, at Park Grounds–CODISSIA, Coimbatore. Event hours are **11 AM–9 PM IST** as specified in the supplied brief.

For Hostinger, deploy one Node.js app using the root `server.js`: `npm run build`, then `npm start`. It serves registration, staff modules and `/api/*` on one subdomain. Staff sign in once at `/login`; admins can use every module including the gate scanner, while limited roles retain their permissions. The old admin/scanner login URLs redirect to `/login`. Follow [the single-subdomain Hostinger guide](docs/HOSTINGER-SINGLE-SITE.md) for MySQL, simulated providers, environment variables and cron setup. Only admin credentials are required for access to all modules.

Author application code in **JavaScript**: `.jsx` for React components and App Router pages/layouts, and `.js` for application logic, utilities, backend modules and tests. The backend runs directly with Node.js; there is no TypeScript compilation or `tsx` runner. Next.js configuration uses `.mjs`, and `frontend/jsconfig.json` preserves the `@/*` path alias. Project instructions are in `AGENTS.md`.

The customer landing page `/` opens the existing Book Tickets form immediately. The promotional homepage has been removed. `/register` redirects permanently to `/`; edit-booking, change-mobile and new-booking links also go directly to `/`. The registration form's styling, images, layout and behavior are preserved.

Mobile verification now happens inside **Your booking**: enter the WhatsApp number, choose **Verify**, enter the six-digit OTP below the field, then use **Verify OTP**. A green verified tick appears next to the number. The progress bar contains only **Your booking → Checkout**, and the final booking-form button is **Checkout**. The old `/verify-otp` page redirects to `/`. OTPs expire after five minutes; resend cooldowns and attempt limits remain server-enforced. Changing the number or losing the verification session locks checkout again. Verified state is restored from the server session when editing a booking, rather than trusted from browser storage. Ticket retrieval retains its own mobile-verification flow.

The interface uses the reference website’s locally downloaded Roboto Condensed fonts, deep red `#8A1D23`, cream `#FFFAF0`, forest green `#15351E`, experience artwork, and gallery imagery. See [DESIGN.md](DESIGN.md) for source evidence and fidelity differences. The actual 9th Edition brand logo supplied in `santa.png` replaces the temporary text wordmark throughout the app, favicon and PDF tickets. The web and backend PNG copies are byte-identical to the supplied artwork, including its background. The older 8th Edition logo is retained only as reference in `docs/`.

## Run locally

Use **Node.js 24 LTS**. No database server or paid API account is needed for the labelled demo.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Use this exact host because mutation requests are checked against `FRONTEND_ORIGIN`. The Express API runs on `127.0.0.1:4000`. Local demo defaults to creating and seeding `backend/data/demo.sqlite`. Set `DB_DRIVER=mysql` and `DATABASE_URL` to use MySQL with the same simulated providers. Hosted demo and live deployments require MySQL; SQLite remains a local development adapter. `APP_MODE=demo` controls provider simulation independently of storage. No real payments, WhatsApp messages, emails, or admission tickets are produced in demo mode.

Optional configuration: copy `.env.example` to `backend/.env`. Next.js proxies `/api` requests to Express using `frontend/next.config.mjs`; backend secrets never belong in frontend environment variables.

| Local demo role | Email                     | Password       |
| --------------- | ------------------------- | -------------- |
| Admin           | admin@santasocial.local   | SantaDemo2026! |
| Cashier         | cashier@santasocial.local | SantaDemo2026! |
| Scanner         | scanner@santasocial.local | SantaDemo2026! |

The demo OTP is generated randomly and displayed on the verification screen. The scanner’s simulated event date defaults to **December 5, 2026**; set `DEMO_EVENT_DATE=2026-12-06` on the backend to test the second day. This override is ignored in live mode.

## Main routes

| Experience | Routes                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer   | `/`, `/checkout`, `/booking-pending`, `/booking-success`, `/ticket/[bookingId]`, `/retrieve-ticket` (legacy `/register` and `/verify-otp` redirect to `/`) |
| Organiser  | `/admin/login`, `/admin/dashboard`, `/admin/bookings`, `/admin/bookings/[id]`, `/admin/payments`, `/admin/checkins`, `/admin/settings`                     |
| Gate staff | `/scanner/login`, `/scanner`, `/scanner/history`                                                                                                           |

Customer and staff interfaces use the same API/database. `/admin` also opens the dashboard. Staff permissions are enforced in Express, not just hidden in the UI. Signing in as staff replaces the customer session in the same browser; use separate browser profiles for concurrent roles.

## Booking-to-entry behavior

- Select one event date, supply the primary guest’s details, verify the mobile by OTP, and choose a payment method. Age 5+ costs ₹200; under 5 is free. Prices are calculated on the server in integer paise.
- Every adult and child counts against the **combined 20,000-person capacity**. Optional daily limits, group limits, and reservation expiry are configurable. Adult supervision is required by default; children-only free bookings require an explicitly enabled policy.
- Online reservations activate only after captured payment evidence. Razorpay signatures use server-stored order IDs. Raw webhook signatures are verified before parsing; event IDs and payment IDs prevent duplicate settlement. A background process reconciles pending gateway orders.
- Cash bookings remain provisional and have **no active QR** until an admin/cashier records the exact amount and approves payment. Receipt, approving staff, and timestamps are stored. Expired cash reservations can be restored only if capacity permits.
- Each paid/free booking has **one opaque group QR**. Personal details are not embedded. Only the token hash is indexed for verification; a server secret and random booking nonce allow secure regeneration.
- Staff verify the QR, count everyone, and separately confirm entry. Final confirmation locks the inventory row and atomically checks the booking again. There is one unique check-in record per booking. Idempotent retries cannot admit another group. No partial entry or re-entry.
- A captured payment after an expired reservation reacquires capacity if available. Otherwise it becomes `PAYMENT_REVIEW`, retaining payment evidence and issuing no ticket. Organisers must resolve capacity or refund through Razorpay; arbitrary payment approval is unavailable.
- OTP-verified retrieval recovers bookings on another device, including pending online payment resumption. Secure share links hold the ticket bearer token in the URL fragment, not a server query string.

## Project layout

```text
frontend/app/              Next.js App Router, CSS and metadata
frontend/components/       Customer, organiser and scanner interfaces
frontend/lib/              JavaScript API client and formatting utilities
frontend/public/brand/     Local fonts and official reference imagery
backend/src/app.js         HTTP API, validation and role enforcement
backend/src/services.js    Booking, capacity, settlement and check-in rules
backend/src/db.js          MySQL connection pool / isolated demo adapter
backend/src/providers.js   Razorpay reconciliation, messaging, SMTP fallback
backend/migrations/       Initial relational SQL schema
backend/test/             API and concurrency regression tests
deploy/                   Nginx and process-manager examples
docs/                     Setup, integrations, API and verification evidence
```

This implementation uses **mysql2 with explicit SQL transactions and row locks** rather than Prisma. The initial SQL migration is shared with the demo adapter. The single event settings row stores the two optional day capacities; each booking/check-in records its validated event date. There is no Redis, Kubernetes, or microservice dependency. Keep one API process initially because the maintenance dispatcher and rate limits are process-local.

## Checks

```sh
npm run check
npm test
npm run build
```

With the local server running and a Playwright Chromium installation available:

```sh
node scripts/browser-qa.mjs
node scripts/load.mjs
```

Set `PLAYWRIGHT_EXECUTABLE` if an existing Chromium executable should be used. Browser QA creates **demo** bookings and a demo check-in in the local database. It must not target a live event. See [testing](docs/TESTING.md) for verification scope and remaining production checks.

`npm run check` parses authored JavaScript/JSX, checks non-JSX modules with Node.js, and rejects TypeScript source. It is a syntax check, not a static type checker. `npm run build` checks backend JavaScript and builds Next.js; production API startup is `node src/server.js` from `backend/`. `npm test` runs the existing workflow suite with Node's test runner. No generated `.next` files need manual edits.

## Go live

### One shared public registration QR

Public registration QR generation is intentionally deferred at the owner's request while the system is built and tested locally. It does not block development or per-booking admission QR generation. `config/public-registration.json` intentionally contains `bookingUrl: null` until deployment and receipt of the actual HTTPS booking URL. The existing localhost origin and sample Nginx domain are not public deployment evidence; the reference website is not assumed to host this application.

Once the deployed HTTPS root booking URL is confirmed, save it as `bookingUrl` in that configuration file and run:

```sh
npm run qr:registration
```

This validates the public destination and deployed form, generates the same public QR as a 2400-pixel PNG and scalable SVG, and independently decodes both before writing final files to `artifacts/public-registration-qr/`. Both use black modules, an opaque white background, a four-module quiet zone and high error correction. See that folder's README for filenames. No final QR files are generated while the deployment URL is unknown.

The public registration QR opens `/` for every customer; it carries no booking or admission credential. Unique admission QR generation and scanner verification remain separate and unchanged.

See [deployment](docs/DEPLOYMENT.md), [integration setup](docs/INTEGRATIONS.md), and [API documentation](docs/API.md). Supply real MySQL access, independent secrets, Razorpay credentials/webhook configuration, approved AskEva authentication/utility templates and a confirmed adapter, and SMTP configuration for real sales. Keep `backend/assets/` in the deployment for branded PDF tickets. Production refuses demo mode unless explicitly opted into the isolated [Hostinger test prototype](docs/HOSTINGER-SINGLE-SITE.md) with `ALLOW_HOSTED_DEMO=true`, MySQL and strong credentials. That prototype simulates providers while storing real test records in MySQL. Actual event sales require `APP_MODE=live`. Live integrations and MySQL concurrency have **not** been verified in this workspace; this is a working implementation, not a claim of production readiness.

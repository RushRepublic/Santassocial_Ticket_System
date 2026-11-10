# Hostinger Business: one subdomain, one staff login

Deploy the entire JavaScript project as **one Node.js app** at `https://tickets.santassocial.com`. The root `server.js` starts a built Next.js site and the existing Express API on one managed port. This guide replaces the earlier two-app prototype instructions.

| Purpose | Path |
| --- | --- |
| Public registration | `/` |
| Shared staff login | `/login` |
| Admin dashboard | `/admin/dashboard` |
| Bookings and cash approval | `/admin/bookings` |
| Check-in history | `/admin/checkins` |
| Scanner and scanner history | `/scanner`, `/scanner/history` |
| API | `/api/*` |

An admin signs in once and can access every staff module, including the scanner and its dashboard return link. Cashier and scanner accounts, if created, use the same login form with their existing restricted permissions. Both `/admin/login` and `/scanner/login` redirect to `/login`. Authenticated staff visiting `/login` are returned to an allowed module; unauthenticated module visits go to `/login?next=...`. Logout invalidates the same shared staff session.

## 1. Push the changes

Commit and push the latest project changes to `RushRepublic/Santassocial_Ticket_System`. Exclude actual `.env` files, credentials and database dumps. `npm run build` builds the Next.js frontend and checks the backend; `npm start` runs the combined application. Do not use static export, Vite, `npm run dev`, two separate managed apps, or `frontend/.next` alone as the deployment artifact.

## 2. Create one Node.js website

In hPanel, choose **Websites → Create site → Web App → Import Git Repository**, authorize the repository and choose branch `main`. Assign `tickets.santassocial.com` and enable HTTPS. A Hostinger temporary HTTPS address also works for initial testing if that exact origin is configured below.

If the subdomain already hosts another app, back it up before changing or replacing it. You do not need `api.santassocial.com` for this deployment. Use one canonical hostname and one app instance; redirect alternate hostnames rather than running extra copies. The database and staff session are shared by all modules.

## 3. Create the MySQL database

Open **Databases → Management** in the hosting dashboard. Create a database, user and password. Record the complete names, including Hostinger's account prefix. Use Hostinger's local MySQL host `127.0.0.1`, port `3306`. Prefer the individual environment fields below: paste the actual database password into `DB_PASSWORD` without encoding it. The previous `DATABASE_URL` format remains supported as an alternative, with a URL-encoded password.

The first demo startup creates all ten application tables, indexes, event settings and staff accounts automatically. New MySQL tables use InnoDB. No manual SQL import or SQLite folder is required. Test records persist across app redeployments when the same database is used. Earlier local SQLite records are not automatically copied into MySQL.

## 4. Configure build and startup

| hPanel setting | Value |
| --- | --- |
| Framework | Other / custom Node.js server; use Express.js if an explicit entry file can be selected |
| Node.js | 24.x |
| Root directory | `./` |
| Build command | `npm ci --include=dev && npm run build` |
| Entry file | `server.js` |
| Start command, if offered | `npm start` |
| Output directory, if required | `.` |

Keep the whole repository and installed workspace dependencies, including `frontend/.next`, `frontend/public`, backend sources, migrations and assets. Do not let framework auto-detection replace the custom entry with `next start`: the root `server.js` is what combines the API and frontend. No standalone Next.js output is used. Let Hostinger supply its managed port; do not expose custom ports 3000/4000.

The frontend build script uses `next build --webpack` for Hostinger compatibility. Keep hPanel's root build command as `npm run build`; it invokes this frontend script after checking the backend. Hostinger documents Turbopack CSS worker failures and a system-library limitation for Next.js 16.3.3 and newer. If an old build log still shows Turbopack, confirm the deployment uses the latest GitHub commit and redeploy.

## 5. Add environment variables

Generate three different application secrets by running the following command three times on your computer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In the app's **Environment Variables** section, enter:

```dotenv
NODE_ENV=production
APP_MODE=demo
ALLOW_HOSTED_DEMO=true
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=YOUR_FULL_DB_USER
DB_PASSWORD=YOUR_ACTUAL_DB_PASSWORD
DB_NAME=YOUR_FULL_DB_NAME
FRONTEND_ORIGIN=https://tickets.santassocial.com
HOST=0.0.0.0
MAINTENANCE_MODE=cron
DEMO_EVENT_DATE=2026-11-11
SESSION_SECRET=REPLACE_FIRST_RANDOM_SECRET
TICKET_SECRET=REPLACE_SECOND_RANDOM_SECRET
OTP_SECRET=REPLACE_THIRD_RANDOM_SECRET
ADMIN_EMAIL=YOUR_ADMIN_EMAIL
ADMIN_PASSWORD=REPLACE_ADMIN_PASSWORD
```

Replace every sample value. The admin password must contain at least 12 characters. The three secrets must differ and contain at least 32 characters each. Keep them unchanged between redeployments to retain session/ticket validity. `FRONTEND_ORIGIN` must exactly match the browser's HTTPS origin, without a trailing slash.

Enter `DB_PASSWORD` directly into Hostinger's value field: no URL encoding, surrounding quotes or PowerShell command. The individual database fields take precedence over `DATABASE_URL`; remove the old URL row when switching to avoid confusion. The credentials remain private and must not be included in screenshots or GitHub. An `Access denied for user ...` runtime error means MySQL rejected the supplied login: verify the full database username, actual password, deployed environment and database user permissions.

Only the admin account is required for full module access. If limited staff accounts are wanted later, add matching pairs `CASHIER_EMAIL`/`CASHIER_PASSWORD` and `SCANNER_EMAIL`/`SCANNER_PASSWORD`; their passwords also require at least 12 characters. They all use `/login`. Leave both values of an unused pair unset. Existing account passwords are not overwritten by seeding on subsequent startups.

Do not set `API_ORIGIN` for the combined deployment. `/api/*` is served directly by Express on the same origin before Next.js handles pages. Existing Next.js proxy settings are retained only for separate local development servers. No AskEva, Razorpay, SMTP or `NEXT_PUBLIC_*` credentials are needed: OTP, payments and delivery remain simulated.

For live AskEVA activation, follow [AskEVA setup](ASKEVA-SETUP.md). With
`WHATSAPP_MODE=live`, the app sends queued ticket links automatically after
successful booking/payment changes and polls every 15 seconds, even when
`MAINTENANCE_MODE=cron`. A separate cron job is not required for WhatsApp ticket
messages. Retain other maintenance/reconciliation scheduling as configured.

## 6. Deploy and verify MySQL

Click **Deploy** and inspect the build and runtime logs. Open:

```text
https://tickets.santassocial.com/api/health
```

Expected response after a successful database query:

```json
{"ok":true,"mode":"demo","database":"mysql"}
```

Use phpMyAdmin to confirm the application tables and test records. Open `/` and `/login` to verify both the Next.js pages and Express API are served by the same website. A 503 requires inspecting runtime logs and checking the custom entry, database credentials and complete deployment files. A 403 on mutations usually means `FRONTEND_ORIGIN` differs from the actual browser origin. Never set `API_ORIGIN` to the same domain to solve routing errors; the combined server handles the API directly.

## 7. Schedule finite maintenance

Open the website's **Advanced → Cron Jobs** and choose once per minute. Use the real account username/domain in:

```sh
/opt/alt/alt-nodejs24/root/bin/node --env-file=/home/u123456789/domains/tickets.santassocial.com/hbuilds/config/.env /home/u123456789/domains/tickets.santassocial.com/hbuilds/current/nodejs/backend/src/run-maintenance.js
```

Verify the environment/script paths in File Manager. Cron does not inherit the app's variables automatically. Hostinger limits the command to 255 characters; use a short private wrapper if actual paths exceed that limit. Successful output is `Santa Social maintenance complete.` This handles expiration and queued work without an always-running worker.

## 8. Test the full flow

Use synthetic guest details. Verify the displayed demo OTP within five minutes, proceed to checkout, complete simulated payment and download the test group QR/PDF. No WhatsApp messages, emails or real charges are sent. Create a separate cash booking: its QR should appear immediately. Scan it as admin to see cash due in red, confirm exact collection and approve group entry. Online-paid bookings show green. Scanner-only accounts cannot collect cash. Entry remains blocked for expired, cancelled, wrong-date or previously entered bookings.

Customer mobile verification and staff login use independent cookies, so registration in another tab does not replace staff access. Sign in at `/login` with the admin account, approve cash, view bookings and check-in history, open the scanner, then use its dashboard return link. Payments and Event settings pages have been removed; their legacy URLs redirect to Overview. Payment records remain in booking details and backend configuration still applies. No second staff login should appear. Staff logout revokes admin/scanner access while preserving a separate verified customer session. Old staff sessions migrate automatically to the staff cookie without extending their signed expiry. On phones use HTTPS and allow camera permission.

Production always uses the backend server date in Asia/Kolkata, including hosted demos. `DEMO_EVENT_DATE=2026-11-11` (Wednesday) or `2026-11-12` (Thursday) is supported only in isolated local demo/testing. It cannot override the hosted scanner date. Verify duplicate and wrong-day scans are rejected. Check records in MySQL and restart/redeploy to verify persistence.

Local syntax/build/workflow/browser tests do not establish that Hostinger runtime routing or MySQL connectivity has been verified. The optional MySQL integration test needs `MYSQL_TEST_DATABASE_URL` pointing to a dedicated database ending in `_test`. Real sales require a separate database, `APP_MODE=live`, verified providers and acceptance testing. Public registration QR generation remains deferred.

## References

- [Hostinger Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Hostinger MySQL connections](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
- [Hostinger environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Hostinger Node.js cron jobs](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/)
- [Next.js custom server](https://nextjs.org/docs/app/guides/custom-server)
- [Hostinger Next.js Turbopack build compatibility](https://www.hostinger.com/support/how-to-fix-next-js-16-turbopack-build-errors-on-hostinger/)

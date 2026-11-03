# Hostinger Business: one subdomain, one staff login

Deploy the entire JavaScript project as **one Node.js app** at `https://tickets.santassocial.com`. The root `server.js` starts a built Next.js site and the existing Express API on one managed port. This guide replaces the earlier two-app prototype instructions.

| Purpose | Path |
| --- | --- |
| Public registration | `/` |
| Shared staff login | `/login` |
| Admin dashboard | `/admin/dashboard` |
| Bookings and cash approval | `/admin/bookings` |
| Payments | `/admin/payments` |
| Check-in history | `/admin/checkins` |
| Event settings | `/admin/settings` |
| Scanner and scanner history | `/scanner`, `/scanner/history` |
| API | `/api/*` |

An admin signs in once and can access every staff module, including the scanner and its dashboard return link. Cashier and scanner accounts, if created, use the same login form with their existing restricted permissions. Both `/admin/login` and `/scanner/login` redirect to `/login`. Authenticated staff visiting `/login` are returned to an allowed module; unauthenticated module visits go to `/login?next=...`. Logout invalidates the same shared staff session.

## 1. Push the changes

Commit and push the latest project changes to `RushRepublic/Santassocial_Ticket_System`. Exclude actual `.env` files, credentials and database dumps. `npm run build` builds the Next.js frontend and checks the backend; `npm start` runs the combined application. Do not use static export, Vite, `npm run dev`, two separate managed apps, or `frontend/.next` alone as the deployment artifact.

## 2. Create one Node.js website

In hPanel, choose **Websites → Create site → Web App → Import Git Repository**, authorize the repository and choose branch `main`. Assign `tickets.santassocial.com` and enable HTTPS. A Hostinger temporary HTTPS address also works for initial testing if that exact origin is configured below.

If the subdomain already hosts another app, back it up before changing or replacing it. You do not need `api.santassocial.com` for this deployment. Use one canonical hostname and one app instance; redirect alternate hostnames rather than running extra copies. The database and staff session are shared by all modules.

## 3. Create the MySQL database

Open **Databases → Management** in the hosting dashboard. Create a dedicated prototype database, user and password. Record the complete names, including Hostinger's account prefix. Use Hostinger's local MySQL host `127.0.0.1`, port `3306`. URL-encode special characters in the password when building `DATABASE_URL`; never put passwords into an online encoder.

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
DATABASE_URL=mysql://YOUR_FULL_DB_USER:URL_ENCODED_DB_PASSWORD@127.0.0.1:3306/YOUR_FULL_DB_NAME
FRONTEND_ORIGIN=https://tickets.santassocial.com
HOST=0.0.0.0
MAINTENANCE_MODE=cron
DEMO_EVENT_DATE=2026-12-05
SESSION_SECRET=REPLACE_FIRST_RANDOM_SECRET
TICKET_SECRET=REPLACE_SECOND_RANDOM_SECRET
OTP_SECRET=REPLACE_THIRD_RANDOM_SECRET
ADMIN_EMAIL=YOUR_ADMIN_EMAIL
ADMIN_PASSWORD=REPLACE_ADMIN_PASSWORD
```

Replace every sample value. The admin password must contain at least 12 characters. The three secrets must differ and contain at least 32 characters each. Keep them unchanged between redeployments to retain session/ticket validity. `FRONTEND_ORIGIN` must exactly match the browser's HTTPS origin, without a trailing slash.

Only the admin account is required for full module access. If limited staff accounts are wanted later, add matching pairs `CASHIER_EMAIL`/`CASHIER_PASSWORD` and `SCANNER_EMAIL`/`SCANNER_PASSWORD`; their passwords also require at least 12 characters. They all use `/login`. Leave both values of an unused pair unset. Existing account passwords are not overwritten by seeding on subsequent startups.

Do not set `API_ORIGIN` for the combined deployment. `/api/*` is served directly by Express on the same origin before Next.js handles pages. Existing Next.js proxy settings are retained only for separate local development servers. No AskEva, Razorpay, SMTP or `NEXT_PUBLIC_*` credentials are needed: OTP, payments and delivery remain simulated.

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

Use synthetic guest details. Verify the displayed demo OTP within five minutes, proceed to checkout, complete simulated payment and download the test group QR/PDF. No WhatsApp messages, emails or real charges are sent. Create a separate cash booking and verify its QR activates only after approval.

Use a separate browser profile for staff so customer mobile verification does not replace the staff login cookie. Sign in at `/login` with the admin account, approve cash, view bookings/payments/settings/history, open the scanner, then use its dashboard return link. No second staff login should appear. Log out and confirm both admin/scanner API access is denied. On phones use HTTPS and allow camera permission.

The simulated scanner event day is `DEMO_EVENT_DATE`. Use `2026-12-05` for Saturday tickets and `2026-12-06` for Sunday; restart after changing it. Verify duplicate scans and wrong-day tickets are rejected. Check records in MySQL and restart/redeploy to verify persistence.

Local syntax/build/workflow/browser tests do not establish that Hostinger runtime routing or MySQL connectivity has been verified. The optional MySQL integration test needs `MYSQL_TEST_DATABASE_URL` pointing to a dedicated database ending in `_test`. Real sales require a separate database, `APP_MODE=live`, verified providers and acceptance testing. Public registration QR generation remains deferred.

## References

- [Hostinger Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Hostinger MySQL connections](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
- [Hostinger environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Hostinger Node.js cron jobs](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/)
- [Next.js custom server](https://nextjs.org/docs/app/guides/custom-server)

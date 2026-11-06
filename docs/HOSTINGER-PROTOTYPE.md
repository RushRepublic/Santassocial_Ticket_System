# Hostinger Business: simulated full-stack prototype

**Superseded:** use [the single-subdomain, shared-login guide](HOSTINGER-SINGLE-SITE.md) for the current deployment. The two-app instructions below describe the earlier setup and are retained as reference only.

This walkthrough is for **Business Web Hosting**, using a real MySQL database with simulated OTP, payments and notifications. It keeps Next.js, Express and JavaScript. It does not send WhatsApp messages, charge cards, or issue valid event admission. Real sales remain a separate `APP_MODE=live` deployment with verified providers and a separate database.

The hosting configuration below has not been deployed or verified in a Hostinger account. Verify build/runtime logs and MySQL connectivity there. Hostinger's current managed Node hosting supports multiple apps from a monorepo, but not guaranteed always-running background workers.

## 1. Push the prepared code

Commit the hosted prototype preparation and push it to the existing GitHub repository. Do not commit actual `.env` files, secrets or database dumps. This preparation separates provider simulation (`APP_MODE=demo`) from storage (`DB_DRIVER=mysql`), requires HTTPS/unique secrets/individual staff credentials, supports managed host binding, and provides a finite maintenance command. Default production still refuses demo mode without explicit `ALLOW_HOSTED_DEMO=true`.

Run locally before pushing:

```sh
npm run check
npm test
npm run build
```

## 2. Choose two HTTPS addresses

For example, use `https://test-tickets.YOUR_DOMAIN` for the customer site and `https://test-api.YOUR_DOMAIN` for the API. Replace these examples everywhere with your actual addresses. Add each subdomain as a **separate Node.js website**, not a folder in an existing PHP site. Hostinger-generated temporary HTTPS domains are also usable: record both actual URLs before finalizing the environment.

Use one canonical hostname per app and one API instance. Redirect alternate hostnames to it. The UI calls `/api` on the frontend, which Next.js proxies to the separate backend; customers do not need to visit the API domain.

## 3. Create the MySQL database and secrets

In the API site's hPanel dashboard, open **Databases → Management**. Create a database such as `santa_prototype`, a dedicated database user, and a strong database password. Record the full database/user names including Hostinger's account prefix. If no database screen is available until the API website exists, create that website first, then return to this step before its final deployment.

```dotenv
DB_DRIVER=mysql
DATABASE_URL=mysql://u123456789_santauser:URL_ENCODED_PASSWORD@127.0.0.1:3306/u123456789_santa_prototype
```

Replace these sample credentials with the database's actual values. Hostinger documents `127.0.0.1` and port `3306` for Node.js apps connecting to its local MySQL service; do not use `localhost`. URL-encode special password characters in the connection string. Enter a password only in a trusted local tool, never a public encoder website. The app reads `DATABASE_URL`, not separate `DB_HOST`/`DB_USER` variables.

Use a dedicated prototype database, separate from actual event sales. The application creates its ten tables, indexes and initial event/staff data on first startup in demo mode; you do not need to import SQL manually. Newly created MySQL tables use InnoDB for transactional booking/payment/check-in operations. MySQL stores the bookings independently of deployment folders, so no `DEMO_DB_PATH` or private SQLite directory is needed. Old SQLite demo records are not automatically copied into MySQL.

Generate three independent secrets by running this command three times on your own computer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Create three different staff passwords, each at least 12 characters. Hosted prototypes refuse the local demo defaults. Keep the same secrets across redeployments, and keep this prototype's database and secrets separate from any real event deployment.

## 4. Create the Express API app

In hPanel, use **Websites → Create site → Web App → Import Git Repository**. Authorize the Hostinger GitHub app for `RushRepublic/Santassocial_Ticket_System`, choose `main`, and assign the API hostname.

Configure:

| Setting | Value |
| --- | --- |
| Framework | Express.js (select manually if necessary) |
| Node.js | 24.x |
| Repository root directory | `./` |
| Build command | `npm ci --include=dev && npm run build -w backend` |
| Entry file | `backend/src/server.js` |
| Start command, if offered | `npm run start -w backend` |
| Output directory, if required | `.` (source files; there is no backend `dist` build) |

Keep the whole repository available: the backend checking script uses `scripts/check-js.mjs`, and runtime needs `backend/migrations/` and `backend/assets/`. Do not run `npm run dev`, `concurrently`, PM2 or the root all-app build as the hosted API entry.

In **Environment Variables**, enter:

```dotenv
NODE_ENV=production
APP_MODE=demo
ALLOW_HOSTED_DEMO=true
DB_DRIVER=mysql
DATABASE_URL=mysql://YOUR_FULL_DB_USER:URL_ENCODED_DB_PASSWORD@127.0.0.1:3306/YOUR_FULL_DB_NAME
MAINTENANCE_MODE=cron
HOST=0.0.0.0
FRONTEND_ORIGIN=https://test-tickets.YOUR_DOMAIN
DEMO_EVENT_DATE=2026-11-05
SESSION_SECRET=REPLACE_FIRST_RANDOM_SECRET
TICKET_SECRET=REPLACE_SECOND_RANDOM_SECRET
OTP_SECRET=REPLACE_THIRD_RANDOM_SECRET
ADMIN_EMAIL=YOUR_ADMIN_EMAIL
ADMIN_PASSWORD=REPLACE_ADMIN_PASSWORD
CASHIER_EMAIL=YOUR_CASHIER_EMAIL
CASHIER_PASSWORD=REPLACE_CASHIER_PASSWORD
SCANNER_EMAIL=YOUR_SCANNER_EMAIL
SCANNER_PASSWORD=REPLACE_SCANNER_PASSWORD
```

Replace every sample value. `FRONTEND_ORIGIN` must be the exact HTTPS origin without a trailing slash. Leave `PORT` to Hostinger's runtime routing; do not manually expose port 4000. MySQL credentials are required. Razorpay, AskEva, SMTP and `NEXT_PUBLIC_*` credentials are not needed for this simulated prototype. Leave all real provider credentials unset.

Deploy, then open `https://YOUR_ACTUAL_API_DOMAIN/api/health`. It should return `{"ok":true,"mode":"demo","database":"mysql"}` after successfully querying MySQL. First startup creates the schema, event configuration and staff accounts automatically. Redeployment preserves existing data if `DATABASE_URL` points to the same MySQL database. Seeding does not overwrite passwords for existing accounts when environment values change. In hPanel phpMyAdmin, confirm the ten application tables exist, including `events`, `users`, `bookings`, `payments`, `otp_verifications` and `checkins`.

## 5. Create the Next.js frontend app

Create a second Node.js website from the same repository and branch, with the frontend hostname.

| Setting | Value |
| --- | --- |
| Framework | Next.js, server application |
| Node.js | 24.x |
| Root directory | `frontend` |
| Build command | `cd .. && npm ci --include=dev && npm run build -w frontend` |
| Output directory | `.next`, relative to `frontend` |
| Start command, if offered | `npm start`, from `frontend` |

The explicit build command installs the root workspace lockfile, then builds the frontend. The whole repository must be retained by the monorepo deployment. If logs show the parent `package.json` or root lockfile is missing, the app was packaged as an isolated folder: correct its monorepo settings before proceeding. An alternative is repository root `./`, build `npm ci --include=dev && npm run build -w frontend`, output `frontend/.next`, and start `npm run start -w frontend`, **only if the dashboard supports configuring that start command**. Do not accept a successful build followed by startup from the wrong directory.

Set frontend environment variables before building:

```dotenv
NODE_ENV=production
API_ORIGIN=https://test-api.YOUR_DOMAIN
```

Use the real API HTTPS address, without `/api` or a trailing slash. Do not put backend secrets in this app. Deploy and check both `/` and `/api/health` on the frontend hostname. Both API health addresses should return the same demo result. Changing `API_ORIGIN` requires rebuilding; it is embedded into the Next.js rewrite configuration.

## 6. Schedule maintenance

In the API site's **Advanced → Cron Jobs**, select a once-per-minute schedule (`* * * * *` if entering cron fields manually). Use Node 24, loading the API environment explicitly. For the repository-root API deployment above, the command is:

```sh
/opt/alt/alt-nodejs24/root/bin/node --env-file=/home/u123456789/domains/test-api.YOUR_DOMAIN/hbuilds/config/.env /home/u123456789/domains/test-api.YOUR_DOMAIN/hbuilds/current/nodejs/backend/src/run-maintenance.js
```

Substitute the actual account/domain and confirm both filesystem paths in File Manager. Cron does not inherit the site's variables automatically. Hostinger limits the command to 255 characters, so use the actual short domain/account paths; if those exceed the limit, use a short private wrapper script rather than truncating the command. This finite script performs reservation expiry and queued maintenance, then closes the database and exits. It replaces the app's 15-second timer for managed hosting; maintenance therefore runs on a one-minute schedule in this prototype. Check cron output for `Santa Social maintenance complete.`

## 7. Verify the hosted flow

1. Open the frontend `/`: the registration form should appear immediately, with the existing logo and layout.
2. Enter a test guest and a valid-format test mobile number. Click **Verify**. The generated demo OTP appears below the mobile field; it is not sent to WhatsApp. Enter it within five minutes and confirm the verified indicator.
3. Continue to Checkout, choose the labelled simulated online payment and complete it. Confirm a test ticket, one group QR and a downloadable PDF. No real card details or Razorpay credentials are needed.
4. Make a second booking using cash. Confirm it has no active admission QR before approval.
5. Use a separate browser profile for staff so its login does not replace the customer's session. Open `/admin/login` using the admin credentials. Approve the cash booking for the exact amount. Verify that its group QR becomes available. The cashier can use the same staff login page with its own role.
6. Open `/scanner/login` on a phone using HTTPS and scanner credentials. Allow camera access. Hosted scanning always uses the server IST date. `DEMO_EVENT_DATE` works only for isolated local demo tests (November 5 or 6, 2026). Confirm wrong-day and duplicate scans are rejected; never change the host clock for testing.
7. Test ticket recovery, mobile layout and an app restart/redeployment. In phpMyAdmin, confirm the `bookings`, `payments` and `checkins` records match your test flow. Verify the same bookings still exist after redeployment and cron completes successfully. Use Hostinger's database backup/export tools to retain test history.

If API mutations return 403, compare the browser's exact HTTPS origin with backend `FRONTEND_ORIGIN`. If `/api/health` on the API works but the frontend version fails, check `API_ORIGIN`, rebuild the frontend and inspect its runtime logs. A 429 means an OTP/login rate limit has been reached; wait for the limit window rather than disabling protection. MySQL connection errors require checking the full account-prefixed credentials, URL encoding, user permissions, `127.0.0.1` and port `3306`. Hosted demo cannot fall back to SQLite if MySQL is unavailable.

No shared public registration QR is generated by these steps. The unique test admission QR remains separate. Do not reuse this demo database for actual sales: use a separate MySQL database, `APP_MODE=live`, real integrations and fresh acceptance testing.

For optional local MySQL integration verification, set `MYSQL_TEST_DATABASE_URL` to a dedicated database whose name ends in `_test`, then run `npm test`. The MySQL smoke test creates schema and synthetic OTP/staff records in that database. Without this URL, that integration test is explicitly skipped; local SQLite workflow tests are not evidence of MySQL integration verification.

## Official Hostinger references

- [Create a Node.js app and connect GitHub](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Deploy apps from a monorepo](https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/)
- [Environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Create and connect a Hostinger MySQL database](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
- [Node.js limits and background worker restrictions](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [Node.js cron jobs, environment and command limits](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/)

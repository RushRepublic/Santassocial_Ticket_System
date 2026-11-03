# Deployment and database setup

## Local development

Node 24 LTS is required for the built-in `node:sqlite` demo adapter. `npm ci` installs the lockfile’s versions. `npm run dev` starts the frontend and API. No Docker dependency is needed.

The demo database lives in `backend/data/` and is ignored by source control. To start a clean demo, stop the API and move its database aside before restarting. Do not use the demo database for actual event sales. Generated test databases are separate files and can be removed after tests while the processes are stopped.

## MySQL production database

Provision MySQL 8 on the VPS or a reachable private database host. Create a dedicated database and least-privilege application account. Example SQL (replace the password; execute as the database administrator):

```sql
CREATE DATABASE santa_social CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'santa'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_UNIQUE_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON santa_social.* TO 'santa'@'127.0.0.1';
```

For a remote database, use its appropriate restricted host/user grant and TLS policy. Restrict database network access. URL-encode special password characters in `DATABASE_URL`. Configure `backend/.env` with `APP_MODE=live`, the three independent secrets, `DATABASE_URL`, and `FRONTEND_ORIGIN=https://YOUR_DOMAIN`.

From the repository root:

```sh
npm run db:migrate
npm run db:seed
```

`backend/migrations/001_initial.sql` is the initial idempotent relational schema; the migration runner also creates query indexes and seeds the event’s combined capacity. Run the migration runner rather than only importing the SQL file, so indexes and event settings are installed too. `db:seed` creates staff accounts using `ADMIN_*`, `CASHIER_*`, and `SCANNER_*` environment values; live passwords must be at least 12 characters. There are **no default live passwords**. Existing users are not silently overwritten by seeding. Rotate/disable accounts through an approved database operation until an account-management UI is added. Application roles are admin, cashier, scanner.

MySQL transactions lock the shared event row before capacity-affecting changes; booking approval/check-in and captured-payment settlement all follow that lock order. Unique payment/order, QR hash, booking request and check-in constraints provide additional protection. The server uses ten pooled MySQL connections, UTC ISO timestamps, integer paise, and Asia/Kolkata display dates. Verify MySQL behavior on staging before using it for sales.

## Hostinger Business Web Hosting

For simulated OTP and payments on Business Web Hosting, follow [the single-subdomain walkthrough](HOSTINGER-SINGLE-SITE.md). It uses one custom Node.js app (`server.js`) serving Next.js and Express, one shared staff login at `/login`, a real MySQL database (`DB_DRIVER=mysql`), production HTTPS cookies and a finite maintenance cron job. One admin account accesses every staff module. Paid provider credentials are not needed for this prototype. This is separate from actual event sales.

The combined deployment needs one managed Node.js application with the explicit root `server.js` entry, the complete built frontend/backend files, MySQL access and the finite maintenance cron job. Check the actual account's process routing, memory limits, database access, HTTPS and logs. Static-only hosting cannot run the application. Do not run the existing two-process PM2 configuration in managed Web Hosting. No shared-hosting deployment has been attempted or claimed here.

## Hostinger VPS

Use one maintained Linux VPS initially. Install Node 24 LTS, MySQL 8, Nginx, a process manager such as PM2, and Certbot using the operating system/vendor’s current instructions. Put the project in a fixed directory owned by a non-root application user. Keep `.env` readable only by that user and excluded from Git.

1. Install dependencies with `npm ci`; provision/configure MySQL and run migrations and seeding as above.
2. Supply Razorpay and AskEva integration settings and test approved templates. Configure SMTP for fallback. Follow INTEGRATIONS.md.
3. Build with `npm run build`. This checks backend JavaScript syntax and builds Next.js. Frontend production uses `next start`; API production runs `backend/src/server.js` directly with Node.js. There is no backend compilation step or dependency on old `dist/` output. The PM2 example points to `src/server.js` from the backend working directory.
4. Set the domain in `deploy/nginx.conf`, install it in Nginx, validate with `nginx -t`, and reload. Configure HTTPS with Certbot, redirect HTTP to HTTPS, and confirm renewals. The supplied example is an initial HTTP configuration, not a certificate.
5. Start the two processes: `pm2 start deploy/ecosystem.config.cjs`. Set backend `HOST=127.0.0.1` in its environment so both listen only on loopback behind Nginx. The API otherwise defaults to `0.0.0.0` in production for managed hosting. Run `pm2 save` and configure PM2 startup using the command it prints for your operating system/user.
6. Verify `/api/health`, registration, live test-mode Checkout, signed webhooks, ticket recovery, cash approval and gate check-in. Check PM2/Nginx logs for failures without enabling sensitive request-body logging.
7. Use only **one API process** with the current process-local rate limiter and notification dispatcher. Multiple scanner devices are supported through that API; this does not require clustered Node processes. Before adding API instances, move rate limits and dispatcher ownership to coordinated durable infrastructure.

Cloudflare can front Nginx if desired. Use Full (strict) TLS with a valid origin certificate. Do not cache `/api`, `/admin`, `/scanner`, `/ticket`, payment or customer confirmation routes. Test Razorpay webhook reachability through any WAF challenge rules. Restore actual client IPs only from trusted Cloudflare ranges if you configure that; never trust arbitrary inbound forwarding headers.

## Backups and operation

- Back up MySQL daily, and more frequently during sales/entry. Use `mysqldump --defaults-extra-file=/SECURE/PATH/mysql-client.cnf --single-transaction santa_social`, or a managed backup facility. The credentials file must be private; do not put passwords in command arguments. Encrypt backups, retain an approved schedule, copy them off the VPS, and rehearse restoration.
- Back up secrets separately, especially `TICKET_SECRET`; a database backup alone cannot regenerate existing tickets without it. Do not commit backup files.
- Monitor process uptime, `/api/health`, pending captures, `PAYMENT_REVIEW` bookings, failed notification jobs, storage and MySQL connection exhaustion. API errors intentionally avoid logging customer bodies, OTPs or bearer tokens.
- Use `pm2 logs santa-api`, `pm2 logs santa-web`, and Nginx logs for diagnosis. Configure log rotation and retention. `pm2 restart santa-api --update-env` applies backend environment updates. `pm2 restart santa-web --update-env` restarts the frontend after a rebuild.
- For releases, back up, install the lockfile, apply reviewed additive migrations, build, restart the processes, and verify health. Do not rotate ticket/session secrets accidentally during deployment.
- The 15-second maintenance loop expires unpaid holds, retries notifications, attempts configured email fallback, and reconciles pending gateway payments. It resumes queued work after restart. Provider calls must have bounded timeouts in a custom AskEva adapter. Monitor the loop and externally reconcile gateway captures before event day.
- During database outages, requests fail without issuing admission tickets. The MySQL pool can create replacement connections; in-flight transaction retries are not automatic. Retry customer mutations with the original idempotency key, and confirm recovery in staging.

## Production checklist

- [x] Owner-supplied 9th Edition logo installed from `santa.png`; include `frontend/public/brand/`, `frontend/app/icon.png` and `backend/assets/` when deploying.
- [ ] Remaining 2026 event content and current media reviewed.
- [ ] MySQL migration, backups/restoration and reconnection tests completed.
- [ ] MySQL concurrency/load tests completed on the actual VPS; no throughput claim is based on SQLite demo tests.
- [ ] APP_MODE=live, NODE_ENV=production, unique secrets, exact HTTPS origin, strong individual staff credentials.
- [ ] Razorpay merchant capture settings, test/live separation, callback signatures, duplicate raw webhooks, browser-close recovery and refunds reviewed.
- [ ] Confirmed AskEva documentation, API access, approved authentication/utility templates, real OTP delivery, retry behavior and message delivery validated.
- [ ] SMTP sender/domain authentication configured and fallback delivery tested.
- [ ] Capacity, optional daily limits, group size, cash expiry and supervision policy approved.
- [ ] HTTPS, camera permissions and actual scanner phones tested at the venue with multiple devices.
- [ ] Failed payment, offline client, reservation expiry, duplicate scan, wrong date, lost ticket and payment review runbooks rehearsed.
- [ ] Customer data access/retention and staff audit access reviewed by the organiser.
- [ ] Event-day support, payment review/refund ownership, outage procedures and backup staff access assigned.

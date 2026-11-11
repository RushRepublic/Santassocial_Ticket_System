# Real Razorpay payments with simulated OTP

`APP_MODE=demo` keeps WhatsApp OTP and notifications simulated. The independent `PAYMENT_MODE=live` uses real Razorpay orders, verified capture, signed webhooks and reconciliation. No AskEva or SMTP credentials are required. Simulated OTP displays a code and does not verify ownership of the entered number.

## Razorpay setup

1. Select Live Mode and confirm `https://tickets.santassocial.com` is approved for this merchant account.
2. Open Account & Settings → API Keys. Use the matching Live Key ID (`rzp_live_...`) and Key Secret.
3. In payment capture settings, enable Automatic Capture. Tickets activate only after captured payment evidence.
4. Under Account & Settings → Webhooks, add `https://tickets.santassocial.com/api/webhooks/razorpay` for the `payment.captured` event.
5. Create a separate random webhook secret of at least 32 characters, add an alert email and enable the webhook. Enter the same secret in Hostinger. The webhook endpoint rejects events while payments remain simulated; verify successful delivery after activation.

Official instructions: [API keys](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/), [capture settings](https://razorpay.com/docs/payments/payments/capture-settings/), [webhooks](https://razorpay.com/docs/webhooks/setup-edit-payments/).

## Hostinger environment

Open Websites → tickets.santassocial.com → Environment variables. Enter credentials privately without surrounding quotes. Never commit or share secrets in chat.

| Variable | Value |
| --- | --- |
| `APP_MODE` | `demo` |
| `PAYMENT_MODE` | `live` |
| `ALLOW_HOSTED_DEMO` | `true` |
| `NODE_ENV` | `production` |
| `DB_DRIVER` | `mysql` |
| `FRONTEND_ORIGIN` | `https://tickets.santassocial.com` |
| `RAZORPAY_KEY_ID` | Your actual Live Key ID |
| `RAZORPAY_KEY_SECRET` | The matching Live Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Your separate webhook secret |

Keep existing MySQL access, admin credentials, SESSION_SECRET, TICKET_SECRET and OTP_SECRET. Do not change TICKET_SECRET: it signs existing QR codes. Keep AskEva/SMTP unconfigured. Keep the existing build command and `server.js` entry.

Live payment mode refuses startup without MySQL and complete Live Razorpay credentials, including the separate webhook secret. Add all values together before restarting. Save and redeploy/restart through Hostinger Deployments.

## Verify activation

Open `https://tickets.santassocial.com/api/health`. Relevant expected fields:

```json
{"ok":true,"mode":"demo","otpMode":"demo","paymentMode":"live","database":"mysql"}
```

Here `mode: demo` describes simulated OTP/messaging; `paymentMode: live` confirms real payments. OTP remains simulated; there must be no simulated payment dialog. Razorpay Checkout supplies the payment methods enabled for the merchant and customer's device.

Create a fresh booking after switching modes. Old pending `order_demo_` orders cannot be used in real checkout; start a new booking. Existing simulated online tickets remain demo and are rejected by live gate verification. Existing paid records are never automatically charged.

Complete a real booking at the displayed ticket price. Check the captured amount in Razorpay, successful webhook delivery, direct ticket display and failure/cancellation behavior. The gate scanner uses the actual event date in live payment mode; event tickets are not valid for admission on unrelated test dates.

With `MAINTENANCE_MODE=cron`, confirm the maintenance command is scheduled using the same environment: `node backend/src/run-maintenance.js` from the project root. It reconciles pending real orders. Callback verification and signed webhooks also update payment state.

Automated tests use synthetic credentials, a mocked gateway and a local test adapter. They cover simulated OTP, disabled fake settlement, signatures, amount/currency checks, pending capture, signed webhooks and simulated-ticket rejection. They do not verify real merchant credentials or bank/app transactions.

## Mobile payment return

Mobile Razorpay Checkout uses the signed return URL
`https://tickets.santassocial.com/api/payments/razorpay/return` (with the booking ID).
Keep the existing merchant website domain approved in Razorpay. No new credentials
or database migration are required. Desktop checkout retains its handler.

The return endpoint verifies the order/payment signature and fetches captured
payment evidence from Razorpay before redirecting to the ticket. It supplies the
existing ticket bearer in the URL fragment so a legitimate return can display the
ticket without relying on a cross-site POST cookie. Unsigned redirects never grant
ticket access. Pending or failed confirmation returns to retryable checkout.

Checkout also checks the authenticated booking's Razorpay order when restored,
when the browser regains focus/visibility, and every four seconds while visible
for up to two minutes. This recovers a missed browser callback without paying
again or waiting for a maintenance run. Only PAID/FREE status opens the ticket.
Webhook and background reconciliation remain enabled.

UPI apps and mobile operating systems control switching back to the browser.
The website cannot force every external app to close; when the browser resumes,
it recovers confirmed payment automatically. Verify the final bank/app handoff
on a physical Android and iPhone with the merchant's chosen payment methods.
Automated QA uses mocked provider evidence and never creates real charges.

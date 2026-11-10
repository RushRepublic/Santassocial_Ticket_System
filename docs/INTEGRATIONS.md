# Integration setup

## Configuration

Copy `.env.example` to `backend/.env`. Secrets are server-side only. APP_MODE defaults to `demo` for simulated OTP/messaging. PAYMENT_MODE independently controls payments and defaults to the APP_MODE setting. Use `APP_MODE=demo` with `PAYMENT_MODE=live` for real Razorpay and simulated OTP; follow [the Hostinger activation guide](RAZORPAY-LIVE.md). Live WhatsApp uses `WHATSAPP_MODE=live` independently of APP_MODE/SMTP; see [AskEVA activation](ASKEVA-SETUP.md). Hosted simulated OTP requires the existing explicit ALLOW_HOSTED_DEMO opt-in, MySQL and strong staff credentials. Use three independent random secrets of 32+ characters for sessions, tickets and OTP hashing; changing the ticket secret invalidates existing QR credentials, so preserve it and back it up securely.

## Razorpay

The live integration uses the official `razorpay` Node SDK for orders, fetching payments, and listing an order’s payments. Sources consulted:

- [Official Node SDK order operations](https://github.com/razorpay/razorpay-node/blob/master/documents/order.md)
- [Official Node SDK payment operations](https://github.com/razorpay/razorpay-node/blob/master/documents/payment.md)
- [Webhook signature validation and event deduplication](https://razorpay.com/docs/webhooks/validate-test/)

1. Obtain a Razorpay merchant account. Use test keys in staging and live keys only after activation. Configure automatic capture in the merchant dashboard; this application only activates **captured** payments, not mere authorisations.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a separate `RAZORPAY_WEBHOOK_SECRET` in the backend environment.
3. Configure an HTTPS webhook to `https://YOUR_DOMAIN/api/webhooks/razorpay` for `payment.captured`. Keep the webhook secret consistent with the server. Exercise dashboard test events and test Checkout before enabling sales.
4. Checkout sends only the public key and server-created order. Callback signatures are calculated over the stored order ID and payment ID. Payment amount, INR currency, order and captured status must match before activation.
5. Webhook verification uses the original raw request bytes and HMAC-SHA256 with constant-time comparison. `x-razorpay-event-id` is persisted for deduplication. Event persistence and settlement share a transaction.
6. The API process polls pending orders in batches as a fallback when the browser closes or webhook delivery is delayed. Capacity after a late capture is rechecked under lock. Review/refund cases retain gateway evidence and issue no QR.

Callbacks, webhooks and polling converge on the same settlement service. Gateway failures leave a recoverable reservation. Order creation uses a database claim to avoid concurrent duplicate orders. A process crash after creating a gateway order but before saving its ID can leave a `creating_…` claim; reconcile its receipt in the Razorpay dashboard before repairing the claim. Never clear such claims blindly or mark an online booking paid manually.

Refund creation and post-activation refund/revocation automation are not implemented. Disable unattended refunds and resolve them through a controlled operator workflow; paid-booking cancellation is deliberately refused in the UI/API. Validate that workflow before going live.

## AskEva WhatsApp

The built-in adapter in `backend/src/askeva.js` implements the owner-supplied
AskEVA PDF: POST `https://backend.askeva.io/v1/message/send-message`, token query
authentication, authentication body/copy-code parameters and seven-variable
utility ticket messages. See [the setup and acceptance-test guide](ASKEVA-SETUP.md).
Set `WHATSAPP_MODE=live`, `ASKEVA_API_KEY`, approved template names and language
privately in Hostinger. Keep APP_MODE=demo for simulated SMTP if desired;
PAYMENT_MODE independently controls Razorpay. An optional ASKEVA_ADAPTER_MODULE
retains compatibility with custom providers; leave it unset for the built-in adapter.
The provider contract is `sendOtp(mobile, otp)` and `sendNotification(message)`.
Provider errors, invalid JSON, missing message IDs and timeouts fail safely;
request URLs, OTPs, secrets and secure ticket links are never logged.

OTP is generated cryptographically, HMAC-hashed with the challenge ID and mobile, expires in five minutes, has five attempts, and is consumed once. Resends invalidate the older challenge and have a 60-second cooldown. IP rate limits provide an additional barrier. Live responses never include the OTP. A failed provider send cannot verify the mobile.

The registration UI sends and verifies OTPs inline beside/below the WhatsApp mobile field. It shows a verified tick only after the API establishes a matching customer session. Checkout rechecks that session; changing the mobile number invalidates the local verified indicator. The separate registration verification page has been removed, and `/verify-otp` redirects to the booking form. These UI changes use the same provider adapter and API endpoints; they do not enable live WhatsApp delivery without the approved AskEva setup. Development OTP simulation remains explicitly labelled inside the inline control.

Notifications are recorded as `QUEUED`, then `SENT`, `RETRY` or `FAILED` (or `DEMO_SENT` in demo). Retries use exponential delays with five attempts. Unique booking/type constraints avoid duplicate enqueueing. Remote delivery is at-least-once under a process failure; use a provider idempotency facility if available. Message failures never undo a paid booking. Historical DEMO_SENT notifications are not automatically resent. Identifiable simulated Razorpay jobs are superseded in live payment mode.

An outdated cash-pending message is marked `SUPERSEDED` when its booking is already approved, expired or cancelled, so it cannot incorrectly ask a paid guest to pay again.

## SMTP fallback

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` for a verified transactional sender. Port 465 uses TLS immediately; other ports require STARTTLS. Certificate validation remains enabled. Text-only notifications avoid HTML injection. After repeated WhatsApp delivery failure, a successful fallback records `EMAIL_SENT`; otherwise the original job continues its bounded retries. SMTP does not replace WhatsApp mobile OTP verification.

Source: [Nodemailer SMTP transport](https://nodemailer.com/smtp).

## Ticket generation and camera

The `qrcode` library generates one QR for the entire booking. PDF downloads exist on the API and in the client; shared bearer links use client-side PDF generation without exposing credentials in query strings. The PNG action saves the group QR. Native sharing falls back to copying the secure link.

`qr-scanner` uses the browser camera only after the staff member chooses Start camera scanner. Production requires HTTPS and browser camera permission. Camera failure has a manual secure token/link fallback. Test physical phones and venue connectivity; automated tests do not prove real-camera performance.

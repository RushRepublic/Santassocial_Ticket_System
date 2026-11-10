# AskEVA WhatsApp activation

This adapter follows the owner-supplied AskEVA PDF (pages 2-7, 28-34).
The PDF specifies `https://backend.askeva.io/v1/message/send-message` with
`token` query authentication. Some older Postman examples use a different host;
the implementation uses the PDF's primary endpoint. Do not copy credentials
from example collections. Confirm account-specific endpoint changes with AskEVA
if this endpoint rejects the newly generated account key.

## Templates already created

- `santa_social_otp`: Authentication, English `en`, expiry text 5 minutes.
  The backend generates a cryptographically random six-digit OTP and submits
  the same code as a body parameter and URL/copy-code button parameter, as
  documented in the PDF. AskEVA delivers the code; the website verifies it.
- `santa_social_ticket`: Utility, TEXT, English `en`, static header
  `Santa Social Ticket`. Seven ordered body variables: customer name, booking
  reference, full selected event date with weekday, adults, children under 5,
  payment status, full secure ticket link.

Both templates must be approved. The ticket template accommodates paid online,
paid cash, free tickets and unpaid cash reservations; unpaid cash stays clearly
marked due/approval required. Payment-review updates do not use this ticket
message or send a usable admission link; those updates remain retryable and
can use the existing SMTP fallback when separately configured.

## Hostinger, after this code is deployed

Keep all existing database credentials, staff credentials, secrets and Razorpay
settings. Set these server environment variables privately:

```dotenv
APP_MODE=demo
PAYMENT_MODE=live
WHATSAPP_MODE=live
ASKEVA_API_KEY=<your privately saved AskEVA API key>
ASKEVA_OTP_TEMPLATE=santa_social_otp
ASKEVA_TICKET_TEMPLATE=santa_social_ticket
ASKEVA_LANGUAGE=en
```

Leave `ASKEVA_ADAPTER_MODULE` unset/empty to use the built-in adapter. A nonempty
value is a legacy custom-provider override. Keep `ALLOW_HOSTED_DEMO=true` and
`DB_DRIVER=mysql` with the existing strong secrets. SMTP credentials are not
required for WhatsApp delivery. APP_MODE continues to govern SMTP simulation;
WHATSAPP_MODE independently governs OTP and WhatsApp booking notifications.
Never add API keys to NEXT_PUBLIC variables, source, GitHub or browser code.

Save and restart/redeploy the existing Hostinger app. `GET /api/health` should
return `paymentMode: "live"`, `otpMode: "live"`, `whatsappMode: "live"`,
`database: "mysql"`, and release `askeva-whatsapp-1`. The top-level `mode` remains
`demo` because APP_MODE remains demo; this does not simulate live payments or
WhatsApp when their independent modes are live.

## Notification maintenance

The existing outbox must run for ticket messages. If `MAINTENANCE_MODE=interval`,
the app processes it every 15 seconds. If using `MAINTENANCE_MODE=cron`, retain
the existing scheduled `node backend/src/run-maintenance.js` job with the SAME
server environment variables, including WHATSAPP_MODE and AskEVA credentials.
A successful API acceptance is recorded as SENT; this is not a delivery/read
receipt. Check AskEVA Reports for delivery failures and sufficient wallet balance.
Do not configure arbitrary inbound webhook URLs: delivery-report ingestion is
not part of this change. Existing retry limits and queued jobs remain intact.
DEMO_SENT historical notifications are not automatically resent.

## Acceptance test (owner's phone, no paid test transactions)

1. Open `/`, enter your WhatsApp number and click Verify. A fresh six-digit
   code should arrive. No simulated code should appear on the webpage or API.
2. Enter a wrong code once: verification must fail. Enter the received code:
   verification must succeed. Codes expire after five minutes, allow at most
   five verification attempts, cannot be reused, and have a 60-second resend
   cooldown. The matching customer session is still required for checkout.
3. Make a cash reservation with your own test details. Do not approve it or
   change existing customer bookings. Wait for maintenance and confirm the
   WhatsApp message shows cash due and its secure link opens the branded ticket
   on another browser without logging in. The same QR is retained; it cannot
   admit an unpaid customer without admin cash approval on the registered day.
4. Existing live online bookings notify only after server-confirmed PAID/FREE
   activation. Verify their flow with existing payment evidence or mocked tests;
   do not charge a real card just to test this deployment.
5. Check AskEVA Reports for accepted versus delivered messages. If delivery
   fails, verify approved template names/language, wallet balance and account
   permissions. Never paste tokens, OTPs or secure ticket links into public logs.

The application does not import account keys or trigger real WhatsApp sends
in automated tests. Production account delivery must be checked after the owner
activates WHATSAPP_MODE. No database migration or customer record rewrite is needed.

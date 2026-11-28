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
  `Santa Social Ticket`. Keep it approved for the pending cash fallback and
  existing free ticket notifications.
- `santa_social_ticket_confirmation_v2`: Utility, TEXT, English `en`.
  Used for confirmed paid online and cash bookings only. Both ticket templates
  take seven ordered body variables: customer name, booking
  reference, full selected event date with weekday, adults, children under 5,
  payment status with total, and full secure ticket link including the bearer
  fragment. The v2 link is a body variable, with no dynamic URL button parameter.

Keep these templates approved. Unpaid cash stays clearly marked
due. Payment-review updates do not use a ticket
message or send a usable admission link; those updates remain retryable and
can use the existing SMTP fallback when separately configured.

## Optional cash reservation template

Create a separate English (`en`) Utility TEXT template in AskEVA with the
following body and seven ordered variables. Use synthetic sample values for
approval, including a sample URL for variable 7.

```text
🎄 Santa’s Social – 9th Edition | Ticket Confirmation

Hello {{1}}!

Thank you for booking your tickets to Santa’s Social – 9th Edition! 🎅✨

Your booking is confirmed. We can’t wait to welcome you and your group for a magical celebration!

Your Booking Details

Booking Reference: {{2}}
Event Date: {{3}}
Event Time: 11:00 AM – 10:00 PM
Venue: Park Grounds, CODISSIA, Coimbatore
Adults: {{4}}
Children (Under 5): {{5}}
Payment status: {{6}}

🎟️ Your Group QR Ticket

View and download your QR ticket here:
{{7}}

A few things to remember:

* Your QR ticket is valid only for the registered event date.
* All guests included in the booking must enter together using the Group QR Ticket.

Get ready for a wonderful day filled with festive cheer, delightful experiences and Christmas magic!

See you at Santa’s Social! 🧑‍🎄🎄
```

After approval, set `ASKEVA_CASH_RESERVATION_TEMPLATE` to the exact approved
name in the server environment. The adapter supplies variable 6 as
`Cash due: ₹220.00. Please pay at the cash counter.` with the actual cash
amount. The booking still requires cash collection and approval before entry.
Leaving the setting empty retains the existing pending cash template.

## Hostinger, after this code is deployed

Keep all existing database credentials, staff credentials, secrets and Razorpay
settings. Set these server environment variables privately:

```dotenv
APP_MODE=demo
PAYMENT_MODE=live
WHATSAPP_MODE=live
ASKEVA_API_KEY=<your privately saved AskEVA API key>
ASKEVA_OTP_TEMPLATE=santa_social_otp
ASKEVA_TICKET_TEMPLATE=santa_social_ticket_confirmation_v2
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
`database: "mysql"`, and release `automatic-ticket-whatsapp-1`. The top-level `mode` remains
`demo` because APP_MODE remains demo; this does not simulate live payments or
WhatsApp when their independent modes are live.
On the VPS, deploy the updated code before setting the new template name and
restarting or reloading the application with the updated environment. The
previous release uses that setting for unpaid cash too. Keep any separate cron
worker on the same release and environment. An unset template setting retains
the legacy behaviour.

## Notification maintenance

Live WhatsApp now has its own in-app outbox worker. It starts automatically,
runs every 15 seconds, and wakes after successful API mutations such as
booking creation and captured payment verification/webhooks.
It does not depend on MAINTENANCE_MODE or an external cron job. Existing cron
maintenance may remain configured for reconciliation and retries. Keep its
environment consistent with the web app. Each job is atomically claimed with
a two-minute retry lease, preventing simultaneous sends by cron and the app.
A crash or lost provider acknowledgement can still cause a later at-least-once
retry; no provider idempotency capability is documented in the supplied API.
Notification failure never rolls back a payment or delays the ticket response.

The recipient is the verified customer mobile persisted on the booking. Paid
online notifications are enqueued at server-confirmed capture. Cash
reservations queue a message showing the amount due. With v2 configured,
cash collection queues one paid confirmation atomically with payment approval.
If cash is collected before the reservation message is processed, the paid
confirmation replaces that unsent message. Scan approval of an already-paid
booking does not send another confirmation. Existing Free Ticket notification
behaviour is retained. Previously approved cash bookings are not backfilled.
The QR and secure ticket route stay the same:
`https://tickets.santassocial.com/ticket/<id>#<bearer>`.
This opens the customer's receipt directly on another browser; the bare domain
would open registration instead. Never remove the bearer or use ID-only access.

A successful API acceptance is recorded as SENT. When the provider returns a
message ID, the server log associates it with the outbox job for tracing.
Check AskEVA Reports for delivery/read status and sufficient wallet balance.
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
   change existing customer bookings. Wait for automatic delivery and confirm the
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

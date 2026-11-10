# Express API

All routes are under `/api`, served directly by Express in the combined deployment (or proxied through Next.js during separate local development). JSON mutations require `Origin` equal to `FRONTEND_ORIGIN`. Cookies are HTTP-only, SameSite=Lax, restricted to `/api`, and Secure in production. Customer sessions use `santa_session` for 30 minutes; staff use `santa_staff_session` for eight hours. Customer verification does not replace staff access. Legacy staff cookies migrate without extending JWT expiry. All responses avoid caching. Request bodies are limited to 32 KB; webhooks allow 256 KB.

Errors return `{ "error": "Useful message" }`. 400 = validation, 401 = authentication, 403 = permission, 404 = missing resource, 409 = state conflict, 429 = rate limit, 503 = unconfigured provider. Booking amounts and approval amounts are integer **paise**.

| Method  | Endpoint                      | Access / behavior                                                                                        |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET     | `/health`                     | Public; verifies database connectivity and reports mode                                                  |
| GET     | `/events`                     | Public; event configuration, availability, demo indicator                                                |
| GET     | `/events/:id/availability`    | Public; current single event’s capacity                                                                  |
| POST    | `/otp/send`                   | Public, rate limited; `{mobile}`; returns `challengeId`, expiry; `demoCode` only in demo                 |
| POST    | `/otp/verify`                 | `{mobile, challengeId, otp}`; consumes code and issues customer session                                  |
| POST    | `/auth/login`                 | `{email,password}`; issues staff session                                                                 |
| POST    | `/auth/logout`                | `{scope:"staff"|"customer"|"all"}`; default all; clears only the selected session(s)                       |
| GET     | `/auth/me`                    | `?scope=staff` or `?scope=customer`; default auto prefers staff; returns only the selected identity         |
| POST    | `/bookings`                   | Verified mobile; `Idempotency-Key` header required                                                       |
| GET     | `/bookings/:id`               | Booking owner or admin/cashier                                                                           |
| POST    | `/payments/razorpay/order`    | Owner; `{bookingId}`; returns public checkout parameters                                                 |
| POST    | `/payments/razorpay/verify`   | Owner; `{bookingId,razorpay_order_id,razorpay_payment_id,razorpay_signature}`; fetches captured evidence |
| POST    | `/webhooks/razorpay`          | Raw signed Razorpay payload; no browser Origin requirement                                               |
| POST    | `/demo/payments/complete`     | Demo only; owner; `{bookingId}`; requires a demo order                                                   |
| POST    | `/tickets/retrieve`           | Verified mobile; all bookings for that session’s mobile                                                  |
| GET     | `/tickets/:id`                | Owner/admin/cashier or `Authorization: Bearer ss_…` ticket credential                                    |
| GET     | `/tickets/:id/download`       | Owner/admin/cashier or valid ticket bearer; branded PDF; `?format=png` returns the complete branded ticket image |
| GET     | `/admin/dashboard?date=all`   | Admin/cashier; dates also `2026-12-05` or `2026-12-06`                                                   |
| GET     | `/admin/bookings`             | Admin/cashier; `q`, `date`, `status`, `page`; 25 per page; `format=csv` exports matches                  |
| GET     | `/admin/bookings/:id`         | Admin/cashier; booking, payment, delivery, check-in records                                              |
| POST    | `/admin/bookings/:id/approve` | Admin/cashier; `{amountReceived}`; cash only                                                             |
| POST    | `/admin/bookings/:id/restore` | Admin/cashier; legacy expired cash only; no attendance cap                                                 |
| POST    | `/admin/bookings/:id/cancel`  | Admin; unpaid, not checked-in bookings only                                                              |
| POST    | `/admin/bookings/:id/notify`  | Admin/cashier; queues notification retry                                                                 |
| GET     | `/admin/payments`             | Admin/cashier; most recent 500 records                                                                   |
| GET     | `/admin/checkins`             | Admin/cashier: latest 100; scanner: own latest 100                                                       |
| GET/PUT | `/admin/settings`             | Admin only; inventory row locked on changes                                                              |
| POST    | `/scanner/verify`             | Admin/scanner; `{token}`; checks payment, date, previous entry                                           |
| POST    | `/scanner/checkin`            | Admin/scanner; `{token}` and `Idempotency-Key`; revalidates atomically                                   |

## Booking request

```json
{
  "name": "Guest Name",
  "email": "guest@example.com",
  "eventDate": "2026-12-05",
  "adults": 2,
  "kids": 1,
  "method": "RAZORPAY"
}
```

Use `CASH` for counter payment. Mobile comes from the verified server session; client-supplied mobile, totals, payment statuses or QR fields are ignored. A reused idempotency key must match the same mobile and booking payload.

## Event settings request

```json
{
  "capacity": null,
  "day5Capacity": null,
  "day6Capacity": null,
  "maxGroup": 20,
  "holdMinutes": null,
  "cashHoldMinutes": null,
  "allowKidsOnly": 0
}
```

Attendance and payment deadlines are unrestricted. Availability returns `unlimited: true`, with `capacity`, daily capacities, hold durations and `remaining` set to null. Legacy settings fields are accepted for compatibility and normalised to disabled values; they cannot impose limits. `allowKidsOnly` is disabled by default and requires an organiser-approved supervision policy.

## Payment states

`PENDING_PAYMENT` or `PENDING_CASH` → `PAID` after verified evidence/authorised cash receipt. Zero-price eligible bookings → `FREE`. Unpaid holds → `EXPIRED` or `CANCELLED`. Captured late payment without inventory → `PAYMENT_REVIEW`; this is never an admission ticket. Check-in is a separate timestamp and unique record; it does not make tickets disappear from retrieval.

For secure shared ticket links, the browser reads the URL fragment and supplies a bearer header for display and downloads. Server-rendered PDF and full-ticket PNG exports share the same red header, actual logo, Group Admission heading, brand font paths, booking details, status and original group QR. File sharing attaches this PNG where supported; otherwise it shares/copies the secure link to the same branded ticket page. Do not log bearer credentials. Retrieving by mobile/reference alone is not permitted.

Cash reservations now include `qrToken` immediately without a payment deadline. `/tickets/:id` and downloads permit these provisional cash tickets and label the amount due. Online-pending, expired and cancelled bookings do not expose a QR. Migration backfills QR hashes for existing cash reservations without changing their deterministic token or payment status.

`POST /scanner/verify` is lookup only: it returns booking/group details plus `amount` (paise), `method`, `status`, `mobile`, `email` and `paymentStatus` (`DUE` for pending cash, `PAID` for approved/free bookings). A successful lookup of unpaid cash does not authorize entry. `POST /scanner/checkin` retains `{token}` for paid entry and additionally accepts `{token, amountReceived}` for admin-only exact cash collection and entry in the same transaction. Check-in requires `Idempotency-Key`; scanner-only staff cannot collect cash. Expiry, date, duplicate-entry and ownership/role checks remain enforced. Admin/cashier `/admin/bookings/:id/approve` remains payment-only approval at a separate counter.

## Customer payment-method changes

`POST /api/bookings/:id/payment-method` accepts `{ "method": "CASH" }` or `{ "method": "RAZORPAY" }`, requires a matching verified customer and an Idempotency-Key. Switching an unpaid reservation atomically cancels the original and creates one replacement using server-stored guest/date/count/price details. Original payment records remain for reconciliation; a delayed capture on the cancelled online booking goes to PAYMENT_REVIEW and never grants admission. Paid/free/entered bookings cannot be replaced, in-flight order creation is rejected, and expired event dates remain blocked. The old cash QR is unusable after replacement. Retrying the same request key returns the same replacement.

Checkout payment choices remain selectable after returning from a ticket, failure or cancellation. Selecting a method only updates the local choice; replacement happens on confirmation. Choices stay temporarily disabled while a request or payment verification is running. Resuming the same method reuses the original booking/payment order.

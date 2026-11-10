# Current event dates: November 9-10, 2026

New registrations use Monday, November 9 and Tuesday, November 10, 2026. Weekdays and ticket dates are formatted dynamically. Previous schedule documents are historical records.

## Passed dates and scanner safety

As of November 10 IST, November 9 is past. Registration shows both dates but disables passed dates, using backend availability rather than the customer clock. The server rejects past-date booking creation and new payment order requests, including stale checkout drafts. Existing authorized/captured payment verification remains intact; no existing transaction is rewritten. Local isolated demo tests use controlled dates; production always uses the actual server instant converted to Asia/Kolkata. No production clock or environment change is needed.

Scanner date validation remains strict: matching ticket/current date on November 9 or 10 only, captured payment or admin cash collection, and atomic single entry. Invalid tickets show only the red centered Invalid Ticket heading and dynamic Registered Event Date. There is no approval button or extra explanation.

## Database inventory: read-only, production counts unavailable

The events table has no calendar-date columns; active event choices are supplied in code. No schema change or data migration is necessary for new registrations. Existing bookings, QR tokens, payment amounts/statuses and approval/check-in history remain unchanged. Authenticated production database/admin access is unavailable in this session, so affected counts cannot be reported reliably. Run privately:

```sql
SELECT eventDate, status, method, COUNT(*) AS bookingCount,
       SUM(people) AS guestCount, SUM(amount) AS amountPaise
FROM bookings
WHERE eventDate IN ('2026-11-05', '2026-11-06')
GROUP BY eventDate, status, method
ORDER BY eventDate, status, method;
```

## Proposed migration: not executed; explicit approval required

1. Back up the database and inventory exact booking IDs, original dates, check-ins and transaction evidence. Review cancelled, already-entered and payment-review records separately.
2. Obtain owner approval and customer agreement for exact IDs and dates. A possible mapping is November 5 to November 9 and November 6 to November 10. November 9 has passed; mapping to it will not allow admission on November 10. Do not apply this mapping automatically.
3. In a transaction, lock approved rows, verify original values, and change only eventDate/updatedAt. Keep customer information, pricing, payment records/statuses, QR nonce/hash and approval/check-in history. Audit original values and prepare rollback.
4. Verify totals and unchanged QR tokens on an isolated copy. Refresh ticket downloads and notify affected customers: already-downloaded images/PDFs retain the original printed dates. Roll back if any invariant fails.

## Existing deployment

Use main on RushRepublic/Santassocial_Ticket_System and its existing Hostinger GitHub auto-deployment at https://tickets.santassocial.com with root server.js. Preserve all environment values, live Razorpay settings, OTP mode, credentials and database. Verification must not create real payments or production customer records.

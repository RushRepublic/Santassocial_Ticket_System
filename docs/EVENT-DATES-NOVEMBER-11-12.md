# Current event dates: November 11-12, 2026

New registrations use Wednesday, November 11 and Thursday, November 12, 2026. Active registration, summaries, metadata, admin filters and backend booking/gate validation use these dates. Weekdays and issued ticket dates are formatted dynamically. Previous schedule documents are historical references.

## Registration and gate safety

Past-date registration and new payment-order restrictions remain intact. Availability is supplied by the backend; the browser does not decide the current date. Production always uses the backend server instant converted to Asia/Kolkata. Only tickets matching the current date on November 11 or 12 are eligible for approval, subject to payment, role and duplicate-entry checks. Outside those dates, approval is rejected. Invalid results retain only the centered red Invalid Ticket heading and dynamic Registered Event Date, with no approval button or additional explanation.

Ticket downloads and notifications use each booking's stored date. SMTP messages and AskEva payloads already read eventDate dynamically; they require no hardcoded template changes. Pricing and payment settings are unchanged.

## Production database inventory

The events table has no calendar-date configuration columns. No schema change, database reset or customer migration is needed for new registrations. Existing bookings, payment evidence, approval history and QR tokens remain unchanged.

Authenticated production database/admin access is unavailable in this session, so affected booking counts cannot be obtained reliably. Run this read-only query privately:

```sql
SELECT eventDate, status, method, COUNT(*) AS bookingCount,
       SUM(people) AS guestCount, SUM(amount) AS amountPaise
FROM bookings
WHERE eventDate IN ('2026-12-05', '2026-12-06')
GROUP BY eventDate, status, method
ORDER BY eventDate, status, method;
```

## Proposed migration: explicit approval required, not executed

1. Back up production and inventory exact affected booking IDs, dates, payment evidence and check-ins. Review cancelled, payment-review and already-entered bookings separately.
2. Obtain owner approval and customer agreement for exact IDs and mapping: December 5 to November 11; December 6 to November 12. Do not apply the mapping automatically or erase approval/entry history.
3. In a transaction, lock approved rows and verify original values. Change only eventDate/updatedAt for explicitly approved IDs; preserve customer data, prices, payment records/statuses, QR nonce/hash and approval/check-in history. Audit original values and prepare rollback.
4. Verify totals and original tokens on an isolated copy with controlled dates, including duplicate-entry behavior. Roll back if invariants fail. Notify affected customers and refresh downloads; previously saved files retain their original printed dates.

## Deployment and verification

Use existing main-branch GitHub auto-deployment for RushRepublic/Santassocial_Ticket_System at https://tickets.santassocial.com with root server.js. Preserve all environment variables, credentials, MySQL data and live Razorpay mode. The local demo default is November 11; the existing DEMO_EVENT_DATE setting is ignored in production. No production clock or infrastructure changes are needed. Test all four date combinations, non-event dates, direct API bypass attempts, invalid ticket reuse, duplicate prevention and historical preservation on isolated data. Never create real paid transactions for verification.

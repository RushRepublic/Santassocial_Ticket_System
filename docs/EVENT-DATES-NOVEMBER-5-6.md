# Current event dates: November 5-6, 2026

New registration choices are Thursday, November 5 and Friday, November 6, 2026. Ticket confirmations, downloads and notifications use the selected date stored on each booking. Active date choices, registration validation, admin filters, public metadata and gate validation have been updated. Prior schedule documents remain historical references.

## Past-date behavior

The existing registration form/API allow either configured event date and do not reject past event dates. This behavior is preserved, not weakened. November 5 is already past as of November 6: a customer can still select it and complete payment, but the ticket cannot be approved on November 6 or any different date. This schedule conflict is reported to the owner rather than silently adding or removing a purchase restriction.

Hosted scanning uses the backend server date converted to Asia/Kolkata. Only tickets matching the current day on November 5/6 are eligible for approval, subject to payment and duplicate-entry restrictions. Do not change the production clock, migrate dates, or override approval to make a past ticket usable. Invalid date screens keep only Invalid Ticket and the dynamic Registered Event Date, without an approval button.

## Database safety and affected booking inventory

The database events table has no calendar-date setting columns; active dates are supplied in code. No schema change, database reset, or customer/payment record migration is needed to change new registrations. Existing November 10/11 bookings retain their dates, amounts, statuses, approval history and QR tokens.

Affected production counts cannot be determined without authenticated admin/database access. Run this read-only query privately to identify them:

```sql
SELECT eventDate, status, method, COUNT(*) AS bookingCount,
       SUM(people) AS guestCount, SUM(amount) AS amountPaise
FROM bookings
WHERE eventDate IN ('2026-11-10', '2026-11-11')
GROUP BY eventDate, status, method
ORDER BY eventDate, status, method;
```

## Proposed customer migration: not executed, explicit approval required

1. Back up production and inventory exact affected booking IDs, original dates, check-ins and payment evidence. Review cancelled, already-entered and payment-review bookings separately.
2. Obtain owner authorization and customer agreement for exact IDs and a proposed mapping (November 10 to November 5; November 11 to November 6). Flag the first date as already past: changing a ticket to November 5 will not make it usable on November 6. Do not apply the mapping blindly.
3. Pause conflicting staff operations, lock approved rows and verify original values in a transaction. Change only eventDate/updatedAt for approved rows, retaining customer details, amounts, payment evidence/statuses, QR nonce/hash and approval/check-in history. Record original values and an audit trail for rollback.
4. Verify counts, totals and original QR tokens. Test the gate on an isolated copy with controlled dates. Roll back if any invariant fails. Never change the production server clock.
5. Notify customers and issue refreshed downloads. Previously saved PDF/images retain their original displayed date even though QR tokens remain the same.

## Existing deployment and verification

Use main on RushRepublic/Santassocial_Ticket_System and its existing Hostinger GitHub auto-deployment at https://tickets.santassocial.com, with root server.js. Preserve domain, environment values, database connections, live Razorpay mode, OTP mode, ticket price and production secrets.

The local demo default is DEMO_EVENT_DATE=2026-11-05; use November 6 for second-day tests. Production ignores the override. Tests use an isolated database and controlled dates for all four combinations, API bypass attempts, duplicates, unchanged invalid records and historical ticket preservation. No real paid transactions or production records are created by deployment verification.

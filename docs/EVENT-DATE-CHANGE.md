# Event dates: November 6-7, 2026

## Deployment scope

New registrations accept only November 6 (Friday) or November 7 (Saturday), 2026. Hosted gate validation compares the selected date with the backend server calendar date in Asia/Kolkata. Price, payment mode, credentials, schema and customer/payment records are unchanged.

The events table has no calendar-date configuration columns: its date choices are supplied by backend code. Legacy day5Capacity/day6Capacity columns are retained for compatibility and remain unused for attendance limits. No database date migration is run on startup or deployment.

Notifications and ticket exports format each booking's stored eventDate. Historical booking lists now also format that stored date, rather than assuming the current event month. Admin APIs continue to accept valid calendar dates as history filters; new-registration validation accepts only the two new dates.

## Existing customer tickets: migration plan (not executed)

Existing December 5/6 bookings are preserved, including their IDs, details, prices, payment evidence, statuses, entry history and QR tokens. They are not valid for November admission. Do not reinterpret a December ticket as a November ticket without the owner's authorization.

1. Using an authorized database connection, take a full backup and record booking counts, payment totals and check-in counts. Run this read-only inventory; do not share customer data or credentials publicly:

```sql
SELECT eventDate, status, method, COUNT(*) AS bookings,
       SUM(people) AS guests, SUM(amount) AS totalPaise
FROM bookings
GROUP BY eventDate, status, method
ORDER BY eventDate, status, method;
```

2. Confirm affected December 5 and December 6 booking IDs and customer consent for a proposed mapping to November 6 and November 7. Review cancelled, checked-in and payment-review records separately. Obtain explicit approval for the exact IDs and mapping before any write.
3. Pause conflicting staff operations during an approved change. In a transaction, lock the approved booking rows, confirm their original dates/statuses, and update only eventDate and updatedAt for those approved rows. Do not alter payments, prices, identities, statuses, ticketNonce, qrHash or check-in history. Store an audit trail with original values and a rollback plan.
4. Confirm row counts, payment totals and QR tokens remain unchanged. Verify the new-date scanner rules on an isolated copy, including duplicates. Roll back the transaction if any invariant fails.
5. Notify affected customers and reissue refreshed PDF/images. The QR token derives from booking ID/nonce and remains the same, but old downloaded files still show the old date. Never silently rely on those old files to communicate a changed booking.

No production database credentials or authenticated admin session were available to inspect private records during this code update. The preservation regression test uses an isolated historical record and confirms startup migration leaves both booking/payment data and its QR token unchanged. Inspect production counts privately before considering a customer-booking migration.

## Environment and deployment

The existing Hostinger GitHub integration deploys main from RushRepublic/Santassocial_Ticket_System to https://tickets.santassocial.com using the root server.js. No hosting resources, database, secrets, price or payment settings are replaced.

Local demo default: DEMO_EVENT_DATE=2026-11-06; use 2026-11-07 to test the second day. Production ignores this override, so an old value in Hostinger does not affect live validation. Do not change production credentials or the server clock.

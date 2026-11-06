# Current event schedule: November 10-11, 2026

New bookings accept Tuesday, November 10 and Wednesday, November 11, 2026. The hosted gate compares each ticket's stored eventDate to the backend's current Asia/Kolkata calendar date and allows admission only on one of these two dates. Past/future tickets show the existing centered red Invalid Ticket heading and dynamically formatted Registered Event Date, with no explanation or approval button. Other date, duplicate-scan and payment protections are unchanged.

## Database and historical bookings

The events table has no calendar-date configuration columns. Active dates are configured in application code; the legacy capacity column names remain unchanged. No schema change, reset or customer-record migration is required to publish the new schedule.

Existing November 6/7 and December bookings keep their original dates, QR tokens, payment evidence and statuses. They cannot be approved for admission on November 10/11 without an explicitly approved date migration. Historical admin lists and filters still display stored dates. Notifications and downloaded tickets use the stored booking date.

Private production records cannot be enumerated without authorized database access or an authenticated admin session. To identify affected bookings, run this read-only inventory privately:

```sql
SELECT eventDate, status, method, COUNT(*) AS bookingCount,
       SUM(people) AS guestCount, SUM(amount) AS amountPaise
FROM bookings
WHERE eventDate IN ('2026-11-06', '2026-11-07')
GROUP BY eventDate, status, method
ORDER BY eventDate, status, method;
```

A migration is necessary only if the owner wants existing November 6/7 bookings honored on the new schedule. No customer migration has been executed or authorized.

## Proposed migration plan: approval required before execution

1. Back up the production database and record affected booking IDs, dates, payment totals, statuses and check-ins. Review already-used, cancelled and payment-review bookings separately.
2. Obtain owner approval and customer agreement for exact IDs and the proposed mapping: November 6 to November 10, November 7 to November 11. Do not change unrelated December bookings.
3. Pause conflicting staff operations, lock the approved rows in a transaction and verify original values. Update only eventDate/updatedAt for approved IDs; retain all payment records, amounts, statuses, identities, ticketNonce, qrHash and check-in history. Record an audit trail and original values for rollback.
4. Verify row counts, payment totals and original QR tokens before committing. Test both new gate days and duplicate restrictions on an isolated database copy. Roll back if invariants fail.
5. Notify affected customers and provide refreshed downloads; their previously saved PDF/image still contains the old date even though the secure token is unchanged.

## Deployment and verification

Use the existing main-branch GitHub auto-deployment to Hostinger, root server.js and https://tickets.santassocial.com. Preserve production database connections, credentials, payment mode, price and environment values. The local demo default is now DEMO_EVENT_DATE=2026-11-10; November 11 is available for isolated second-day tests. Production ignores this override and never changes the host clock.

Tests cover all four new date combinations, non-event days, direct API rejection, unchanged invalid bookings, correct-date reuse, duplicate scans, IST midnight, and preservation/rejection of the old November bookings. Browser checks cover date choices/weekdays, ticket date, past/future error layouts with hidden approval on desktop/mobile, and valid paid/cash approval. Real payments and production record mutations are excluded.

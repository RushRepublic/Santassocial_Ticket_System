# Individual QR tickets

New bookings use one ticket per adult/child, with the existing booking and payment records unchanged. `ticket_batches` marks bookings created by this version. `individual_tickets` stores UUID, category, event date, random nonce, unique token hash, ordinal and approval timestamp/admin/idempotency key. The existing startup migration adds these two tables using `CREATE TABLE IF NOT EXISTS`; it does not convert customer records.

Online tickets are created inside captured-payment activation. Free bookings issue tickets on confirmation. Cash reservations issue tickets immediately under the existing reservation workflow; these cannot admit anyone until an admin collects the exact entire booking amount. First cash collection settles payment once, but only the scanned ticket is admitted. Remaining guests can arrive separately.

Admission tokens are domain-separated HMACs over random UUID/nonces. A booking bearer opens the receipt but cannot admit a new individual booking. Receipt APIs/downloads retain ownership/staff/bearer authorization. The existing WhatsApp outbox sends one secure receipt link per notification, never one message per individual ticket.

Approval locks the existing event row in the database transaction, validates server IST date/payment and updates only an unused ticket. The unique approval key supports retries; different concurrent keys for the same ticket have one winner. `checkins` remains a booking aggregate for compatibility, updated by one guest per approval. Individual history comes from the ticket rows; audit logs retain each approving admin. Booking `checkedInAt` is set only after the last ticket enters. Payment status remains independent.

The receipt carousel shows unused tickets first on opening, keeps approved tickets for reference, and refreshes status every 15 seconds/on focus. Native horizontal scrolling supports touch, trackpad and scroll snapping; arrows/keyboard support desktop. PDF downloads contain every ticket on its own page; saved/shared PNG contains the selected ticket with the original branding and QR.

## Existing booking safety and migration plan

Bookings without a batch remain legacy group bookings with their original QR, quantities, payment and entry history. They are not automatically expanded, so this release cannot mint additional unused tickets for previously admitted groups. Back up the production database before deployment. No production database credentials are available in the local workspace, so affected production counts have not been queried.

Run this read-only query in the existing production database to inventory legacy records:

```sql
SELECT b.eventDate, b.status,
       CASE WHEN b.checkedInAt IS NULL THEN 'NOT_ENTERED' ELSE 'ENTERED' END AS entryState,
       COUNT(*) AS bookings, SUM(b.people) AS tickets
FROM bookings b
WHERE NOT EXISTS (SELECT 1 FROM ticket_batches t WHERE t.bookingId = b.id)
GROUP BY b.eventDate, b.status, entryState;
```

Optional conversion requires a separately approved migration: snapshot booking/payment/check-in IDs and counts; distinguish unused from entered groups; reconcile ambiguous history with the owner; transactionally lock each booking, create exactly its purchased quantities and batch marker, disable its old admission credential, and retain the old entry audit. Never turn a previously entered group into unused individual tickets. Reissue receipt links/notify customers only after reviewing and approving that plan. This release executes none of those conversions.

## AskEVA template

The seven variables and single secure receipt link remain unchanged. The current approved external template says everyone must arrive together. Update that sentence through AskEVA/Meta approval to “Each guest has an individual QR ticket and may enter separately.” before customer communications for individual entry. Do not change the variable order or create five separate WhatsApp messages. This repository cannot edit an approved external template by changing API parameters.

## Verification

`backend/test/individual-tickets.test.js` covers issuance counts, capture-only online issuance, secure receipt access, partial entry, duplicate/concurrent approvals, both event dates and outside dates, history/counts, legacy compatibility, individual PNG QR decoding and multi-page PDF. Run the full check/test/build and local browser QA before deployment. Real MySQL concurrency verification requires a dedicated test database; never point automated tests at production.

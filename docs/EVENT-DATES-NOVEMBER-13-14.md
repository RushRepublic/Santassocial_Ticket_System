# Event dates: November 13-14, 2026

Active registration dates are Friday, 13 November 2026 and Saturday, 14 November 2026. Complete dates and weekdays use the existing date formatter. Production scanning uses the backend server calendar date in Asia/Kolkata; local demo overrides do not bypass production validation.

## Production data safety

No schema change or customer migration is required to configure future registrations. Existing bookings, individual tickets, QR identifiers, payments and approvals are retained. Previously issued November 11/12 tickets remain historical and cannot be admitted on the new dates.

Production database access is not available in this workspace, so affected counts and previous WhatsApp delivery cannot be confirmed. Run these read-only queries in the existing production database to audit the impact:

```sql
SELECT eventDate, status, COUNT(*) AS bookings, SUM(people) AS guests
FROM bookings WHERE eventDate IN ('2026-11-11','2026-11-12')
GROUP BY eventDate, status;

SELECT eventDate, COUNT(*) AS tickets,
       SUM(approvedAt IS NOT NULL) AS approved,
       SUM(approvedAt IS NULL) AS pending
FROM individual_tickets WHERE eventDate IN ('2026-11-11','2026-11-12')
GROUP BY eventDate;
```

## Migration plan requiring owner approval

1. Export a backup and audit bookings, individual tickets, legacy group tickets, payments, check-ins and notification history. Reconcile booking quantities and issued ticket counts.
2. Obtain an explicit booking-by-booking date mapping and a decision for already-approved tickets. Never reset entry or approval history or turn used tickets into unused tickets.
3. Test the mapping against a restored isolated database. Check the QR signature implementation before changing stored dates; keep booking IDs, nonces, receipt bearers and payment records unchanged.
4. Only after approval, apply narrowly scoped transactional updates to the selected bookings and their individual ticket dates. Check row counts and retain an audit/rollback export. Do not regenerate tickets.
5. Verify existing secure WhatsApp receipt links still load the same booking and updated approved ticket details. Previously downloaded PDFs/images retain their printed old dates; notify affected customers and provide updated downloads only after the migration is approved.

## Deployment

Use the existing main-branch GitHub import and Hostinger Node.js app (root server.js, npm run build, output directory .). No production secrets, environment values or database configuration changes are needed. DEMO_EVENT_DATE is only a local test default. Authenticated Hostinger access is required to trigger or inspect deployments if the existing automatic deployment does not run.

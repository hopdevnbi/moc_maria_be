# Customer daily check-in (100m / 5 coin) — release notes

## Behavior

- Signed-in users with no Mộc Maria staff/admin positions use the customer check-in at `/check-in` and in `/tai-khoan`.
- Customer rewards require an active branch with configured GPS, an accurate GPS reading (≤50m error), and a measured distance ≤100m. A rejected GPS check-in does not consume the day.
- Exactly one award per account/day and browser-installation identifier/day (Asia/Ho_Chi_Minh). PostgreSQL unique constraints enforce both; wallet credit and ledger insert are in the same transaction.
- The device key is a random UUID stored in the first-party browser's localStorage and only its SHA-256 hash is retained in the database. **This is not a hardware identity**: resetting browser data, a different browser, or another installation can bypass device-level limits. Account-level uniqueness remains enforced. Do not advertise guaranteed physical-device protection.
- Staff check-in remains 200m with the original out-of-range 0-coin behavior. Existing staff coin wallet and ledger tables are reused; customer rows are distinguished by `checkin_category='CUSTOMER'`. The original attendance tables retain RLS and revoked Data API grants.
- Customers can upload JPG/PNG/WebP avatars through the existing owner-scoped Bunny CDN/WebP pipeline regardless of VIP status.

## Deployment order

**Important:** TypeORM `migrationsRun=false`. Production schema changes are never applied automatically by pushing Git or updating the image. The release operator must check and run the single new migration. Do not point a local QA connection at production.

Migration: `CustomerDailyAttendance1793923200000`. It only adds two columns, a check constraint and a conditional unique index; it neither deletes existing rows nor resets coins.

1. Confirm Backend Quality, GHCR image publish and the currently running image. Back up the production database schema/metadata before the change.
2. Use the newly published Backend image in the `moc-maria` namespace. Run `npm run migration:show:prod` only if the installed CLI provides it; otherwise use `node ./node_modules/typeorm/cli.js migration:show -d dist/database/data-source.js` inside the new API pod and confirm the expected migration is the only pending one.
3. Apply `node ./node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js` with the configured `DATABASE_MIGRATION_URL` if present. **Do not run if unrelated migrations are pending**; escalate to the release owner. If the runtime DB role cannot perform DDL, run with the approved migration connection instead of elevating the application role.
4. Check `SELECT name FROM migrations WHERE name='CustomerDailyAttendance1793923200000'` and verify `checkin_category`, `customer_device_hash` and `uq_customer_checkin_device_date` exist.
5. Ensure the new Backend rollout is healthy, then allow the new FE deployment. Authenticate a test customer with valid GPS, verify exactly 5 coins once, reject a second customer account using the same browser and reject out-of-range GPS without a row. Verify standard customer avatar upload and staff 200m rules.

If migration fails, do not repeatedly retry blind. Restore the prior image via Kubernetes rollout undo and investigate the DB state. A partial completed migration may require manual reconciliation of the TypeORM migrations table; do not run the destructive `down` migration on a production database with awarded coins.

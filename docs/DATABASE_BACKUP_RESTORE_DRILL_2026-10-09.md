# Application database backup/restore drill — 2026-10-09

Before the contact/consent migration, public-schema custom-format pg_dump backup was created using postgres:17-alpine in a temporary moc-maria pod. Connection used PGSSLMODE=verify-full and the mounted official Supabase root CA. No database password is embedded in manifests, reports or command text.

The backup is kept outside Git under the owner's private Windows directory, whose inherited access was removed and owner-only full access applied. No dump content was printed. Size: 109030 bytes; SHA-256 aabb83ea83d3311a9572f4b52506b0dd1e438af867ef3dff54ef0ca5424fdf39.

Restore verified with scripts/verify-backup-restore.cjs <absolute-private-dump-path>. The script validates PGDMP header, creates a new disposable postgres pod/database/Secret with a random password, restores only into that named QA database, verifies migrations/roles/permissions/table counts, then deletes only its QA pod and Secret. No production URI is accepted by this script. Result: PASS; migrations=9, roles=7, permissions=8, tables=24.

Scope: Mộc Maria application public schema. Supabase platform-managed schemas and ownership/ACL configuration are excluded and must be handled by the provider's separate backup policy. This manual drill does not satisfy automated backup/retention and monitoring tasks P08-T14/T36.

New migration rollback/reapply tested on disposable QA PostgreSQL before production. Production rollback priority: restore prior API image and keep additive tables; do not drop consent/evidence data after release. Reverting migration destroys these new tables and is appropriate only before live writes or after a separately reviewed recovery plan. A full production restore must be scheduled/reviewed and never target a running database without backup and explicit recovery scope.

## Before C2 migration12
Private public-schema backup73690 bytes, SHA25654a88d739a61e2b8d560f833e63155815c0f85ff533aa8fdb3db8b7fe85023fe. Fresh disposable restore PASS11 migrations/30 tables/7 roles/8 permissions before apply11→12; pod and Secret removed. Manual rehearsal only; automated schedule/retention remains open.

## Before D1 migration13
Private public-schema backup89146 bytes, SHA256b6a0d56b885c340e32c727675dc6f1f436fbde6323f5f729ddfffe77e2e0a781. Fresh disposable restore PASS12 migrations/34 tables/7 roles/8 permissions before apply12→13. Manual drill only; automated retention remains open. Source rollback keeps attendance/history tables and data.

## Before D2 migration14
Private schema13 backup106514 bytes SHA25698777e56f627857e7a99f0ddaa7d851d1e1934fd4db2fc20018d35176ab21947. Fresh disposable restore PASS13 migrations/39 tables/7 roles/8 permissions before13→14. Initial migration guard stopped before writes due optional migration name; read-only13 verified, corrected class-name fallback job v2 succeeded. Automated retention remains open; rollback keeps assessment/issuance tables and history.

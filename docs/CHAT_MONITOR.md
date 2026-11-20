# Super Admin chat monitor — 2026-11-20

The Mộc Maria KTV consultation service already persists both directions in PostgreSQL; no change to shared Chat/Queue, participants, Zalo, notification outboxes, existing read receipts, password workflows or message contents.

- GET admin/chat-monitor and admin/chat-monitor/threads/:id: guarded by current authenticated session, SUPER_ADMIN and existing admin.portal/customers.manage permissions. No-store responses, 60-message cursor pages, descending sequence, text and existing image attachment metadata. Password-protected threads show activity metadata only; never message body or image. Explicit existing support flow remains the sole way to send as support.
- No new group or message copying, no broadcasts to customers. Read-only monitor accesses audited per actor per 15-minute interval, without logging bodies, names or passwords.
- PrivateChatMonitor1795078800000 enables RLS and revokes direct client privileges on chat, audit and auth/role/session/token tables. Production preflight confirmed backend owns all 11 tables, no forced RLS or dependent views, and no direct frontend table client. This is required to prevent a client from bypassing the role gate through existing database grants. Keep security migration even on application rollback.
- FE /quan-tri/giam-sat-chat: Super Admin-only navigation and component authorization, 4s polling while mounted, local current-page search, paginated history, clear speaker and timestamps, existing support link. No persisted client cache or copies. Participant chat notices explicitly disclose Super Admin support/quality review and password exception. Six locales for new UI.
- Local Backend quality: 398/398; PostgreSQL 16 integration 36 migrations and 11 private tables verified including both speakers, history, password masking, forbidden roles and audit. FE focused 58/58, types/lint passed. Backup archive and checksum verified at preparation; full restore not tested. Release gates require CI, migration and production verification; no production test message.

## Backend production release
Commit f5e65ebb09436e05b4d20baf5c100603e48fd3ff. Quality 44661152928 and container build 44661153008 succeeded.
Backup public-pre-chat-monitor-20261120.dump: 998530 bytes, sha256 779b0d412b674960de887eb0cceede708ae04c90b946a2d6b125c4d7d9acfc13, PostgreSQL 17 archive TOC verified, full restore not exercised.
Job moc-maria-chat-monitor-20261120 completed, 35 -> 36 migrations, all 11 tables verified RLS and direct anon/authenticated grants revoked, backend access retained and client TLS verified.
New immutable image sha256:889eaf25f3bba99de4fbda02edf6f377535109da0bbd0ceec1fe225768770ea1; pod moc-maria-api-97d956f85-cxzcz Ready 1/1, 0 restarts.
Health live/ready, services, providers and provider-display HTTP 200. Anonymous access to both monitor endpoints and existing private threads endpoint HTTP 401. No actual customer message was read for QA and no production fixture created.
Previous app image sha256:e4369f7c6ef25c1c3a4b712d3056381fbf5d4de05a8eff9ad3afc32c2ce21533 is application rollback target; retain security migration.
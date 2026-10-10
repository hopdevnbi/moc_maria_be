# KTV safety — web release plan

Implement now: voluntary, appointment-inquiry-associated home-visit safety sessions; explicit consent; private SUPER_ADMIN monitoring; check-in/out; pause/resume/stop; SOS and audited acknowledgement/resolution; stale location and overdue check-in alerts; mobile and desktop UI.

This is a safety session, not a confirmed booking. A KTV must have already contacted the customer and agreed the visit separately. No eligibility, booking acceptance, quotation or payment rules change.

Security: authenticated endpoints, provider ownership, SUPER_ADMIN-only monitor, no customer access. Store only the latest GPS point, AES-256-GCM encrypted using a dedicated VPS Secret. No GPS in URLs, logs, browser persistence or audit metadata. Admin location reads are audited at most once per minute per admin/session to limit log volume.

Session cap: 8 hours, one active session per KTV. Online updates target 10 seconds; admin polls every 5 seconds. More than 60 seconds since the GPS fix means stale, regardless of polling/heartbeat. Show accuracy and last-fix time. Device GPS can be spoofed; this is supporting information, not proof of physical presence.

Stopping/finishing removes the live point immediately. SOS keeps its own encrypted last-known snapshot for up to 24 hours; no location trail. Maintenance runs every minute and on reads/writes: expire sessions, remove points older than 24 hours, delete encrypted visit context 24 hours after end, remove resolved/no-SOS sessions after 7 days. Unresolved SOS retains only incident metadata after that window. Database backups are separately managed and may have longer retention; operators must govern backup access/retention too.

Web limitation: sharing requires a visible page. Switching apps, closing the page, denying permission, loss of network or locking the phone can stop updates. UI explicitly reports this. SOS works without GPS but requires network; successful API response means recorded, not that an operator has responded. Only an operator acknowledgement changes that status. No claim of 24/7 emergency response; operators must keep the dashboard open and arrange an on-duty response process. No external SMS/email is sent.

Map: locally bundled Leaflet; optional OpenStreetMap tiles, loaded only after admin chooses to open the map. No external account/billing. Consent discloses approximate map viewport shared with the tile provider; KTV names, addresses and coordinates remain local overlays. Respect visible attribution, normal browser caching and no bulk/offline prefetch. Map failure does not hide textual coordinates/timestamps/SOS.

Later: native Android/iOS foreground/background location permissions and battery testing, designated safety-operator role, configurable hotline and explicit external escalation integration. Do not promise reliable background tracking from a PWA.

Validation: unit tests for encryption/staleness/retention; isolated PostgreSQL API tests for cross-user/customer/admin restrictions, concurrent start, stale fixes, pause/stop/expiry, SOS lifecycle and retention; frontend GPS lifecycle tests and responsive role-based browser QA with synthetic fixtures only. Full repo quality and CI; deploy backend Secret/image before frontend, verify private endpoints and production pages, commit/push all scoped work and record release evidence.

## Verified production release

KTV SAFETY AND CLEAN PUBLIC URL RELEASE — 2026-10-10
CODE: FE 56fe71d279f2b3ed68a532e1405a67e69db77194; BE 8bbc2c20809acbd0ccc470f992b1a939abe23304
TEST: Merged PR CI: FE 80 tests and full quality/build PASS; BE 37 unit tests and full quality/audit PASS; 8 isolated PostgreSQL safety integrations PASS. QA KTV loaded session does not start GPS; admin stale/overdue/SOS, acknowledge then resolve PASS. Responsive 320/390/1440 no overflow. Production old profile and booking URLs become named aliases and retain Linh Anh; booking/sign-in links contain no demo. Live/ready 200, private safety endpoints 401. Production deployment success.
COMMIT: https://github.com/hopdevnbi/moc_maria_fe/pull/24; https://github.com/hopdevnbi/moc_maria_be/pull/14
DEPLOY: Vercel production 6978653776; ghcr.io/hopdevnbi/moc_maria_be@sha256:fba61122bf79d31da44e10f1447fd86f4575359214832ec7efb006b926116782
BUSINESS_DATA: No production safety sessions, GPS points, SOS alerts, bookings, approvals or public reviews created. Dedicated production encryption key stored in Kubernetes Secret only. Safety feature requires no new schema migration.
LIMITATIONS: Web GPS needs visible foreground page; native background tracking is future work. SOS needs network and an on-duty operator, no automatic calls/SMS. Real device GPS was not enabled during QA. OSM tiles unreachable from QA machine network; fallback coordinates/stale status verified, map background availability not verified. Existing internal seed/database IDs preserved.

# Customer registration and private KTV consultation

The owner requested a usable customer account and a complete journey from choosing one of the ten seeded KTV profiles and a service to private chat. The prior profiles had real THERAPIST identities but APPLIED provider applications, so the public service-eligibility directory excluded them and Chat remained disabled.

## Code

- Backend PR #4, source `d65b2a7486c89505b20283a7267819170422e217`, adds a public, no-store `/api/v1/ktv-chat/providers` consultation directory. Existing approved providers retain their public eligibility checks. The ten seed identities require an explicit `chatEnabled` registry flag, matching application/user IDs, active staff/user records and a THERAPIST role. Rejected or suspended applications are excluded.
- Private conversations bind customer, application and KTV user IDs. Membership checks, idempotent sending, pagination, read markers and reciprocal timed/permanent blocks remain enforced. Revocation disables sending while retaining private history.
- `scripts/enable-seeded-ktv-chat.cjs` changes only the existing ten-account registry and records an audit event. It does not approve applications, issue certificates or change booking/service policies.
- Frontend PR #6, source `b9e11b81e56187accece7c6c0d6c33b768d50edc`, activates KTV/service chat links using real account bindings. Login and registration preserve the chosen KTV/service through safe internal return paths. The composer provides service selection, optional prepared questions, emoji insertion and Enter/Shift+Enter behavior with IME protection.
- Account navigation now distinguishes customers from KTV, including customer discovery/messages and KTV inbox/planning/profile/training. The mobile layout uses a single pane, back navigation and viewport-aware chat sizing.

## Test and release evidence

TEST: 25 backend unit tests; all 71 integration tests across nine suites and all 17 migrations pass in disposable PostgreSQL. The private remote test runner uses a 60-second per-test timeout for SSH latency. A first run had one older 30-second timeout; shared-database directory assertions were then scoped to their own fixtures. Frontend full quality/build and all 27 tests pass. PR/main CI pass; the frontend font/Turbopack CI failure cleared on rerun without changing fonts or bypassing checks.

COMMIT: BE PR #4 source `d65b2a7486c89505b20283a7267819170422e217`; FE PR #6 core `b9e11b81e56187accece7c6c0d6c33b768d50edc`; FE PR #7 final UI `dc99e8e2f2eeb53b64b219612c80c8c9bd950252`. Backend fixture validation corrections are committed as `b864ad5` / `ca836d9` and included in the validation follow-up.

DEPLOY: backend image `sha256:9183dd6df3eca3f3f1e0e1e1c6d1ba575e227575ea59daab1ae4be831ddb5f68`, rollout ready. Public chat directory HTTP200 with ten identities mapped to the private onboarding registry; anonymous private threads HTTP401; liveness/readiness HTTP200. Frontend Production `6972380799` succeeded and `mocmaria.com` was verified in browser.

LIVE FLOW: a customer created through the normal registration form returned to Linh Anh and Massage cổ vai gáy. Emoji question sent in customer UI; actual KTV login received it and sent a UI reply. The API verifies two distinct conversations, nonparticipant KTV HTTP404, temporary/permanent blocking in both directions, reopening and unchanged history after denied writes. Customer permanent block/unblock and KTV one-hour block/unblock were also exercised in UI. All test blocks were opened again. No additional provider approval was issued.

RESPONSIVE: 320px/390px chat and account pages have no horizontal overflow. The service name remains readable; a long draft expands up to120px; at a reduced500px viewport the input bottom remains within the viewport. Mobile back/list/ten-KTV picker and separate Mai Anh empty history were verified. Desktop1440 layout checked. Screenshots are private local artifacts; customer credentials TXT is exported to the owner’s photo folder outside Git.

## Business data

The owner explicitly authorized activating consultation for ten previously created seed identities and creating a customer through ordinary registration. Five KTV schedules remain configured and five unset. Photos remain owner-selected local activity photos. No new public reviews, provider approvals, certificates or customer reservations are created by this release.

Customer and KTV passwords are stored only in private local manifests and owner TXT handoff files, outside Git. No mailbox is provisioned by creating an account. The customer role is checked against the normal registration response; staff/admin permissions are not granted.

## Release order and rollback

Deploy the additive backend route first, then enable the verified registry, then deploy frontend. This release requires no new database migration (schema remains at migration 17).

The previous API image is `sha256:14a551f94e5a677097776eaa01729c963ebfdad97d303189a50f28334c27e833`. A private pre-activation registry snapshot exists for flag rollback. Preserve all conversations/messages/blocks and the registered customer; do not down-migrate or delete history during application rollback. Turning off consultation flags retains history and disables new messages for those unapproved seed accounts.

The separate E2a booking ownership and overall project checklist remain in progress. Chat consultation availability does not certify service or booking eligibility.

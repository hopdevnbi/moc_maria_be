# Zalo notifications for KTV Nguyệt and Tiến Mạnh

## Thanh Thanh — 2026-11-10

The owner authorized an additional dedicated bot for the persisted Thanh Thanh provider `4d0f6e3e-fd0e-4c84-841c-1be521de1086`. Read-only production verification found one matching active user with THERAPIST role; application status APPLIED is preserved. No new provider, role grant or approval is created.

Bot slug `thanh-thanh` uses `ZALO_THANH_THANH_BOT_TOKEN`, `ZALO_THANH_THANH_PROVIDER_ID`, `ZALO_THANH_THANH_CHAT_IDS` and `ZALO_THANH_THANH_WEBHOOK_SECRET`, referencing the dedicated `moc-maria-zalo-thanh-thanh` Secret. Webhook: `/api/v1/zalo/ktv/thanh-thanh/webhook`. Apply `deploy/thanh-thanh-zalo-env-patch.json` as a strategic merge patch so existing container environment, resources and rollout strategy remain intact.

The existing exact-provider checks apply at enqueue and worker claim. Only customer/admin-created bookings selecting Thanh Thanh and inbound customer chat in her thread can reach this bot. Another provider's event, an unbound provider, a KTV reply, a group pairing or a mismatched webhook secret cannot enroll or notify her. Three administrator channels and existing KTV channels retain their existing scope. Customer contact redaction and protected conversation handling remain unchanged.

Private pairing uses an actual “Kết nối Mộc Maria” event from the intended recipient. Bot ID, token and group-invite URL are not a private recipient ID. Keep delivery disabled by an empty recipient binding until the intended private account is verified. Never create production booking/chat fixtures or unsolicited test deliveries. Pending/outbox keys remain within varchar(100), including this longer bot slug.

Pairing accepts different letter casing, repeated whitespace and canonically equivalent Vietnamese accents. The owner screenshot showed the legitimate command “Kết nối mộc maria”, which the earlier case-sensitive comparison silently ignored. Misspellings such as “meria”, unrelated text, groups, mismatched sender IDs and cross-bot signatures remain rejected. The operator captured a real private Zalo event from the owner-confirmed account Thanh; no further user resend is required for binding.

Validation includes new own-provider/cross-provider units, signed private webhook/group rejection, and a real isolated PostgreSQL HTTP case covering Thanh Thanh booking → owned thread → inbound message → KTV reply. Production acceptance verifies getMe, webhook response, provider/recipient binding, API readiness and existing channel preservation without synthetic business events. Exact release evidence is recorded in the scoped release JSON after rollout.

Owner scope on 2026-11-04: both recipients are KTV, not Super Admin. Persisted provider records are Nguyệt Nguyễn (1ddd7a59-3150-4ced-aa5b-052a51f367f9) and Bác sĩ Tiến Mạnh (44174274-e46e-418d-a08b-e26ceede49b7). Read-only production verification found active users with THERAPIST only, application status APPLIED. This integration grants no roles or operational approvals.

The previous staff worker broadcast every event to all configured staff bots. It also used a 101-character Tiến Mạnh outbox key for a varchar(100) column, and linked to an admin-only page. All three defects are covered by the new tests.

Each staff bot now requires token, approved private recipient and exact PROVIDER_ID binding. Only bookings assigned to that provider and inbound customer chat for that provider enqueue its notification. KTV replies, missing identity and another provider's events never fan out to staff. Existing primary/Hoàn/Linh Đan administrator channels keep receiving every booking/chat event through their existing recipient lists and outboxes.

Customer-created and Admin-created inquiries both enqueue inside the business transaction. Rollback and idempotent customer retries do not create additional deliveries. SHA-256 delivery identity uses a 56-hex digest so every staff key fits the database column. The worker also checks provider identity while claiming rows; legacy unscoped staff rows are excluded, never replayed blindly.

No customer phone/email is included in new Zalo payloads, including admin payloads. Contact-like strings inside names, service labels and message excerpts are masked. All four sender implementations sanitize again immediately before HTTP so older pending messages are also protected. Protected conversations omit bodies. No change to email content or customer chat history.

KTV message links:

- Incoming chat: /tin-nhan?thread=<thread UUID>, selected after member authentication.
- Booking: /tin-nhan?inquiry=<64-hex persisted inquiry ID>. After login the client POSTs /api/v1/ktv-chat/inquiries/:id/thread. The server verifies the persisted provider user, application, active customer/provider and THERAPIST role. An admin or unrelated KTV gets 404. Only then is an existing one-to-one thread reused or created; no message is sent automatically. Existing block/privacy rules remain in KtvChatService. Login retains the original inquiry/thread locator.

Dedicated Kubernetes Secrets, namespace moc-maria:

- moc-maria-zalo-nguyet
- moc-maria-zalo-tien-manh
  Each contains token, provider-id, chat-ids, webhook-secret. Values never belong in Git/logs. Deployment env references are ZALO_NGUYET_* and ZALO_TIEN_MANH_* (BOT_TOKEN, PROVIDER_ID, CHAT_IDS, WEBHOOK_SECRET). Existing admin Secret values and recipient registries are preserved.

Webhook paths are POST /api/v1/zalo/ktv/nguyet/webhook and /api/v1/zalo/ktv/tien-manh/webhook. Signed events containing the exact phrase “Kết nối Mộc Maria” save a pending candidate only. Only private chats whose sender ID equals chat ID qualify; groups cannot enroll. Operator verifies the intended KTV before copying a chat ID into its dedicated Secret and restarting the API. Arbitrary senders are never automatically subscribed. Tokens/invite URLs/bot IDs are not recipient IDs.

Official API methods were verified against the Zalo Bot documentation (POST getMe, getUpdates, setWebhook/getWebhookInfo). Polling timeout error408 means no message was available. Webhook is used in production after deployment. No real customer test bookings/messages or synthetic notification sends are created during acceptance. QA uses disposable PostgreSQL and fake delivery transports only.

Validation: full BE units and FE tests/build plus eight isolated PostgreSQL HTTP cases; final counts, source/image/deploy IDs and recipient readiness are recorded in deploy/ktv-zalo-release.json. Backend runner: node test/ktv-zalo-scope-runner.cjs (QA_LOCAL_PORT can select an unused local SSH forwarding port). Frontend tests include guest login preservation, owned inquiry entry and failure retry.

## Private pairing key recovery, 2026-11-04

The Tiến Mạnh pending-pairing prefix plus a full SHA-256 digest was 102 characters, exceeding app_metadata.key varchar(100). This is separate from the earlier outbox identity defect. staffPendingKey now limits its digest to the remaining column width. Existing Nguyệt and Tùng keys remain unchanged. A real PostgreSQL HTTP regression posts repeated private pairing events for every bot and verifies one persisted candidate per bot with keys at most 100 characters.

Source c867824 passed all 296 unit tests, eight isolated PostgreSQL HTTP cases, typecheck/build and GitHub Quality. Its immutable image is deployed with unchanged API environment, resources and RollingUpdate strategy. The live compiled Tiến Mạnh key length is 100. No database migration or synthetic production pairing event was used.

The owner confirmed Việt Nhật as Nguyệt's intended private recipient; that binding is active and two actual business notifications were recorded as sent. After the fix was deployed, the unique private candidate named “Bs Mạnh” arrived through Tiến Mạnh's correct bot and was bound to his dedicated Secret. Only its chat-ids field changed; token, provider binding and webhook secret were preserved. The API restarted to load the binding. Earlier failed messages were not recoverable through a bounded getUpdates attempt; both webhooks remain enabled. Current readiness and CI/image identifiers are in the release JSON. No synthetic notification was sent to either KTV.

No new database migration. Public RAM cache/flags, existing bank QR, chat Web Push, Redis queue and other tenants remain intact. Runtime rollout must use a scoped container image/env patch and retain the current RollingUpdate strategy. Release source must be an ancestor of main; record exact digest, CI and live versions. Rollback restores the previous image and dedicated env bindings, preserving all other environment values.

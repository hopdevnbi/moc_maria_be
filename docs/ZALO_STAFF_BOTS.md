# Zalo notifications for KTV Nguyệt and Tiến Mạnh

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

Validation: full BE units and FE tests/build plus seven new isolated PostgreSQL HTTP cases; final counts, source/image/deploy IDs and recipient readiness are recorded in deploy/ktv-zalo-release.json. Backend runner: node test/ktv-zalo-scope-runner.cjs (QA_LOCAL_PORT can select an unused local SSH forwarding port). Frontend tests include guest login preservation, owned inquiry entry and failure retry.

No new database migration. Public RAM cache/flags, existing bank QR, chat Web Push, Redis queue and other tenants remain intact. Runtime rollout must use a scoped container image/env patch and retain the current RollingUpdate strategy. Release source must be an ancestor of main; record exact digest, CI and live versions. Rollback restores the previous image and dedicated env bindings, preserving all other environment values.

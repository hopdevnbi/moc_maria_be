# Zalo admin alerts

Customer messages and appointment inquiries enqueue a notification in the same database transaction as the event. Existing email alerts are preserved. Chat replies from KTV, rejected requests, blocked sends and idempotent repeats do not produce a new notification. Delivery runs in the API background worker every two seconds, without external HTTP in the chat request path.

Set server-only `ZALO_BOT_TOKEN` and comma-separated `ZALO_ADMIN_CHAT_IDS` from a private Kubernetes Secret. Never put either in frontend variables, Git, logs or Plan files. Bootstrap the intended recipient using their exact connection message through `getUpdates`; do not select unrelated users or groups. Check `getWebhookInfo` first and preserve an existing webhook. Polling is used only during setup, not for ongoing delivery.

Notifications contain customer/KTV display names, optional service name and event reference, but no chat body, address, password, phone, email or location. The link is the normal account page; it grants no access to private customer/KTV history. Membership and per-chat password gates remain in place.

Each event and recipient has a deterministic SHA-256 outbox key in existing `app_metadata`; no new migration is required. Atomic database row claiming with `SKIP LOCKED` and a 60-second lease prevents concurrent API replicas sending the same event. Both HTTP success and Zalo `ok:true` are required. Timeouts and API errors are retried with exponential backoff, capped at one hour; after 12 unsuccessful attempts the row is marked `failed` and a generic operator warning is logged. No error URL or response body is logged because URLs contain the token.

Delivery is at least once: a process crash after Zalo accepts a message but before the database acknowledgement can result in a duplicate. The event reference lets the recipient identify repeats. Do not claim exactly-once external delivery.

Operator checks (without extracting chat contents or secrets):

```sql
SELECT value->>'status' AS status, count(*)
FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%' GROUP BY 1;
```

After fixing a configuration or transport problem, retry only an explicitly selected failed key:

```sql
UPDATE app_metadata SET value=(value-'lease') ||
  jsonb_build_object('status','pending','attempts',0,'nextAt',clock_timestamp()),
  updated_at=clock_timestamp()
WHERE key=$1 AND key LIKE 'mocmaria.zalo.outbox.%' AND value->>'status'='failed';
```

Successful records may be purged after 30 days by an operator; retain failed/pending records until resolved. Avoid enabling a token in automated fixtures: all tests use isolated fake credentials and stub external delivery.

Official API references:
- https://bot.zapps.me/docs/apis/sendMessage/
- https://bot.zapps.me/docs/apis/getUpdates/
- https://bot.zapps.me/docs/apis/getWebhookInfo/

Release evidence will distinguish CODE / TEST / COMMIT / DEPLOY / live recipient verification. Bot creation alone is not a working website notification integration.

Validation 2026-10-10: 46 unit tests, 27 isolated chat/inquiry integration cases and 3 PostgreSQL outbox cases passed. Format/lint/typecheck/build passed. Bot getMe verified BASIC; no new connection event received yet, so live recipient delivery remains pending.

Server release: main37e734853e9c78652f2af79fd3b99630561be9bf / image sha256:4811bdda3f581beff6493c2942499abe15716d920768707c0ec3841aa317938a. PR17 merged; main quality/container CI passed. Dedicated secret moc-maria-zalo-admin installed without replacing existing email or safety secrets. Rollout ready1; initial ingress transition503 recovered on follow-up: health live/ready200 and chat/inquiry/admin-email private401. Recipient remains unset: outbound notifications are disabled pending a fresh connection message. No production message/inquiry fixture or new migration.

# Mộc Maria - Three additional staff Zalo bots

## Scope

Existing super-admin bots: Hop, Hoan, Linh Dan. Their tokens, recipients,
outbox, webhook, workers and formatting remain unchanged.

New bots: Dr Tien Manh (slug tien-manh), Son Tung Thao Y (slug tung),
Nguyet Nguyen (slug nguyet).

All six bots receive the same inquiry and individual chat events. Staff bots
exclude customerPhone and customerEmail from inquiry notifications. If the
customer's display name or customer-authored chat includes an email address
or Vietnamese telephone number, staff notifications redact it as [email ẩn]
or [SĐT ẩn]. KTV contact information, service, sender role, event IDs and
other permitted content remain unchanged. Password-protected chat body
remains concealed for all six bots.

New bots have independently leased, idempotent outboxes in app_metadata and
retry up to 12 times, following the existing Hoan/Linh Dan design. No
database migration, Chat Socket, Frontend or Queue modification is required.

## Production Kubernetes Secret keys

Place values in existing moc-maria-api-secrets (namespace moc-maria).
Never commit tokens or recipient chat IDs.

Dr Tien Manh:
- ZALO_TIEN_MANH_BOT_TOKEN
- ZALO_TIEN_MANH_CHAT_IDS (comma-separated, initially empty)
- ZALO_TIEN_MANH_WEBHOOK_SECRET

KTV Tung:
- ZALO_TUNG_BOT_TOKEN
- ZALO_TUNG_CHAT_IDS
- ZALO_TUNG_WEBHOOK_SECRET

KTV Nguyet:
- ZALO_NGUYET_BOT_TOKEN
- ZALO_NGUYET_CHAT_IDS
- ZALO_NGUYET_WEBHOOK_SECRET

The webhook URLs are:
- https://api.mocmaria.com/api/v1/zalo/ktv/tien-manh/webhook
- https://api.mocmaria.com/api/v1/zalo/ktv/tung/webhook
- https://api.mocmaria.com/api/v1/zalo/ktv/nguyet/webhook

Configure each bot via the Zalo Bot setWebhook API with its own URL and
secret_token. Never log token-bearing API URLs.

## Recipient enrollment (not automatic)

1. Invite each bot into its intended Zalo group or open its private chat.
2. Send the exact phrase: Kết nối Mộc Maria
3. Webhook verifies the header X-Bot-Api-Secret-Token and saves the chat ID
   only as a pending candidate in app_metadata, under
   mocmaria.zalo.staff.<slug>.pending.
4. An operator validates the chat ID and adds it to that bot's CHAT_IDS
   Kubernetes Secret value. Restart backend after updating the secret.
5. Test one booking and one chat using test accounts. Confirm the distinct
   six outboxes, privacy-preserving staff payloads, and delivery status.

The bot's token, public invite URL and bot ID are NOT recipient chat IDs.
Until a CHAT_IDS value is approved and configured, the bot cannot receive
automated notifications.

## Production safety

- Outboxes for old admin bots can contain customer contact details: avoid
  dumping app_metadata.value in production logs.
- Keep each webhook secret distinct; a webhook only stores pending IDs and
  must never auto-subscribe an unverified group.
- Tokens supplied in conversation should be rotated after integration.
- Do not bypass the backend quality/security gate merely to activate bots.

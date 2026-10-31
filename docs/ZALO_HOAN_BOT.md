# Moc Maria Hoan third Zalo booking bot

This channel is independent from the original and Linh Dan bots; their tokens, webhook registrations, Kubernetes secrets, recipient lists and outbox prefixes remain unchanged.

- Token: `ZALO_HOAN_BOT_TOKEN`
- Recipients: `ZALO_HOAN_CHAT_IDS` (empty until verified)
- Webhook auth: `ZALO_HOAN_WEBHOOK_SECRET`
- Secret: `moc-maria-zalo-hoan` (keys `token`, `chat-ids`, `webhook-secret`)
- Webhook: `POST /api/v1/zalo/hoan/webhook`
- Outbox: `mocmaria.zalo.hoan.outbox.*`
- Pending candidates: `mocmaria.zalo.hoan.pending.*`

The webhook accepts authenticated private/group message events containing the exact pairing phrase and stores a pending candidate; it does not automatically authorize an arbitrary sender. Verify intended recipients before entering chat IDs into this bot's secret. Never reuse recipients from the earlier bots without verification. Bookings enqueue into an independent outbox; chats and gifts remain on the existing channels. Deploy with strategic merge patches, never JSON merge patch that replaces the environment variables. Verify getMe, health and webhook registration. Keep credentials out of Git and logs.

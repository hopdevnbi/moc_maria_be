# Secondary Zalo bot: Moc Maria Linh Dan

The original Zalo bot is not modified. It retains its existing `ZALO_BOT_TOKEN`,
`ZALO_ADMIN_CHAT_IDS`, webhook, recipient registry and
`mocmaria.zalo.outbox.*` deliveries.

## Booking notification path

When a customer creates a new appointment inquiry in
`ExperienceService.createInquiry`, the existing `ZaloAlertsService.enqueue`
persists the original notification. The separate
`ZaloLinhDanAlertsService.enqueue` also persists a secondary delivery in the
same database transaction, under `mocmaria.zalo.linh-dan.outbox.*`.
Notifications about customer/KTV chat, gifts and admin-created bookings are
**not** sent by this secondary bot.

Each secondary message is deduplicated by inquiry ID and recipient. Its worker
retries with the same 12-attempt policy and row-lease handling as the original
bot. Delivery is at least once, not exactly once.

## Configuration

Create a **new** secret named `moc-maria-zalo-linh-dan` in the `moc-maria`
namespace with keys `token` and `chat-ids`. Do not edit or replace
`moc-maria-zalo-admin`. Use the dedicated environment variables:

- `ZALO_LINH_DAN_BOT_TOKEN`: the secondary bot's HTTP API token.
- `ZALO_LINH_DAN_CHAT_IDS`: comma-separated recipient chat IDs **for this bot**.

The new bot cannot send to a group or private chat merely because it was
created or an invite link exists. The intended recipient must interact with the
new bot, or invite it into the destination group and send a message. Find that
chat's ID using the new bot's `getUpdates` API (check webhook configuration
first; do not disrupt an existing webhook). Confirm the sender/group identity
before adding its ID. Never reuse the original bot's chat IDs without verifying
the new bot has access. Do not log token-bearing URLs or incoming message bodies.

Reference: https://docs.zaloplatforms.com/docs/BOT/create_bot

The optional `deploy/k8s/zalo-bot-env.json` manifest contains references to
both existing and new secrets. When applying it, use a **strategic merge**
patch so existing environment entries are preserved. Do not use JSON merge
patch, which could replace the entire deployment environment.

If either new variable is missing, the secondary bot remains disabled without
affecting the original. Do not enable it without confirmed recipient IDs.

## Release checklist

1. Validate the new token via `getMe`, without printing it.
2. Retrieve and verify the intended destination chat ID.
3. Run format, lint, typecheck, unit tests and build.
4. Create the isolated secret, deploy the verified backend image and configure
   the two new environment references. Do not change legacy secret or webhook.
5. Trigger a **synthetic secondary outbox message** only after recipient
   confirmation, and confirm sent status. Do not create a fake customer inquiry.
6. Check that the original bot remains configured, healthy and able to send.

Never commit actual credentials, chat IDs or production message contents.

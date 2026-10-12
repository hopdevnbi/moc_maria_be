# Chat performance and scheduled admin reports — 2026-10-12

## Audit

The actual customer–KTV chat runs in Mộc Maria BE/PostgreSQL, with one unique customer/provider thread. Production initially had 9 threads and 27 messages. It does not use the separately prepared MongoDB/Acutis Chat deployment. Preserving this storage avoids moving existing customer history.

The prior implementation includes participant permissions, paginated history, stable message retry IDs, reciprocal blocking, customer per-thread passwords, optimistic outgoing bubbles and notification sound. Incoming history was fetched every five seconds, including already loaded older pages. Inbox polling was every eight seconds.

The previous AI shipped the Zalo outbox in BE image `sha256:4811bdda3f581beff6493c2942499abe15716d920768707c0ec3841aa317938a`. Bot getMe succeeds, but `ZALO_ADMIN_CHAT_IDS` was empty and no notifications were queued. It notified individual customer messages; no daily/hourly thread report existed. The existing admin email recipient was enabled, but runtime `QUEUE_SERVICE_URL` and `QUEUE_API_KEY` were absent. Shared Acutis Queue reports SMTP and workers ready.

## CODE

- Authenticated `GET /ktv-chat/threads/:id/updates?after=<message UUID>` holds a request for up to 20 seconds. A committed send wakes local waiters immediately. Four-second database checks handle other API replicas; idle transactions and row locks are never held while waiting. Membership, cursor ownership and chat unlock proofs remain enforced. Disconnects clean up waiters.
- FE downloads initial/older history once, then merges only new rows. It cancels requests on switching/locking/leaving, retries connection failures and pauses new held requests while hidden. Outgoing bubbles retain their retry identity and do not advance the receive cursor past unseen peer messages. Memoized rows and shared date formatters reduce work while typing; loading older messages preserves scroll position. Inbox refresh remains every eight seconds and is invalidated on active incoming messages.
- `GET/POST /admin/chat-digest` exposes persistent schedule and channel settings to the same administrative permission used for notification recipients. Defaults: daily 09:00 Vietnam time; interval mode supports 1–168 hours.
- One report per changed thread per period/recipient. The report contains names, counts of new customer/provider messages, latest activity and thread reference; no message body. Quiet threads are skipped. Chat no longer creates an alert for each message. Appointment inquiry notifications retain their existing behavior.
- PostgreSQL clock, transaction advisory lock, per-thread sequence watermarks and atomic outbox creation keep schedules durable and prevent concurrent collectors duplicating reports. The first report covers the preceding configured period; known threads catch up on unread report ranges after downtime. Missing all delivery channels does not consume the watermark.
- Zalo uses its existing durable delivery worker with leases/retries. Email has a durable outbox, stable BullMQ job IDs and Queue delivery acknowledgement: accepted jobs are `queued`, completed SMTP jobs `sent`, exhausted Queue failures `failed`. Status is visible in admin settings. Transport failures never slow a chat send or undo persisted messages.
- Acknowledged deliveries have 30-day retention; pending/failed deliveries stay for diagnosis. External Zalo delivery remains at least once because its API has no transaction with PostgreSQL.

## TEST

BE: 49 unit tests and all 99 integration tests across 12 suites passed. The disposable PostgreSQL run covers held-request wakeup after commit, new-message cursor ownership, cancellation, privacy compatibility, schedule cutoffs, concurrent collectors, quiet threads, disabled/missing channels, retry identity and Queue acknowledgement. FE: all 82 tests across 22 files, typecheck/lint and production build passed; changed files have no lint errors. Existing appointment-test lint warnings remain. No production customer messages are created for testing.

## DEPLOY

Deploy the additive backend before the frontend. No schema migration or data movement is required. Dedicated `moc-maria-queue-access` contains the existing Queue API key; application `QUEUE_SERVICE_URL` points to `http://acutis-education-queue.giangxa.svc.cluster.local`. Shared Giang Xa service resources are not modified.

Zalo recipient setup can be completed later: the owner opens Bot Mộc Maria and sends exactly `Kết nối Mộc Maria`. Read that intended connection event via getUpdates, preserve any existing webhook, save its recipient ID in the existing private Zalo Secret, restart BE and verify a single setup notification. An old screenshot proves the Bot exists but does not supply a retained connection event.

## BUSINESS_DATA / rollback

No customer, KTV, booking, review, password or chat fixture is added to production. Existing message storage and settings remain. Roll back application images/frontend if needed; retain real message data, digest watermarks and pending deliveries. For a notification-only incident disable the schedule in admin rather than deleting history.

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

## Production release evidence

CODE / COMMIT: BE `396bd847fd1b6134b069563d072479ac4448bad2` (implementation `85658bc`); FE `07daed7f3f50f5b1f135679976f417ca6b93c751`. Both released to main by an ancestry-checked fast-forward through the already authorized Git identity. GitHub CLI used another account and could not create a pull request; no PR was created.

TEST: BE quality CI `38204145119` and image publish `38204145125` succeeded. FE quality CI `38204414044` succeeded. Local validation: 49 BE unit tests, 99 disposable PostgreSQL integration tests and 82 FE tests; typecheck, changed-file lint and builds passed. The complete integration rerun fixed two issues found during QA: collector timing now uses PostgreSQL's clock, and claimed email rows use a SELECT-returning CTE compatible with TypeORM.

DEPLOY: BE image `ghcr.io/hopdevnbi/moc_maria_be@sha256:f0a8f9e3bb958391a5f9ec19c76e19efb304a50b84fec86a031264f37ab41b78`, Ready 1/1, zero restarts. Changed Recreate to RollingUpdate with maxSurge=1/maxUnavailable=0. Queue URL and dedicated Secret reference added without replacing existing secrets. HTTPS ready 200; new private digest/incremental endpoints anonymous 401. Shared Acutis Chat and Queue remain Ready 1/1.

FE production deployment `7006570380` succeeded. `https://mocmaria.com/quan-tri/thong-bao` returns 200 and its live JavaScript bundle contains `/admin/chat-digest`. UI interactions were covered by component tests; a new authenticated live browser walkthrough was not completed because native Chrome capture reported minimized windows and `failed to activate captured window`.

DELIVERY: Email setup job `moc-maria.chat-digest.setup.20261012` was accepted with HTTP 202 and finished `completed`, attemptsMade=1, addressed to the existing enabled admin recipient. This confirms the email provider accepted transmission, not mailbox inbox placement. The actual scheduled first report has not run yet.

SCHEDULE: enabled, daily 09:00 Vietnam time; nextAt `2026-10-13T02:00:00.000Z` (13 October 09:00 Vietnam). Email ready=true; Zalo ready=false; pending=0/failed=0 at verification. The owner explicitly deferred the fresh Bot connection message while coding proceeded. Zalo end-to-end delivery remains pending that recipient step.

BUSINESS_DATA: Production still has the original 9 threads/27 messages; no chat, provider, booking or password fixtures were added. Rollback image is `sha256:4811bdda3f581beff6493c2942499abe15716d920768707c0ec3841aa317938a`; retain message/history/watermark data. The shared Plan's booking phase/ledger remains separately owned; this scoped release is recorded in its own coordination claim and this document.

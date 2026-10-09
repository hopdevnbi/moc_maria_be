# Private customer–KTV chat — 2026-10-09

Customers choose a real, publicly eligible KTV directly in `/tin-nhan` or open the same conversation from a provider link. Each customer/KTV application pair has one private thread; concurrent opens reuse it. KTVs see only their customer conversations. Group membership, arbitrary sender IDs and administrator bypasses are not accepted.

The former frontend called `/api/v1/ktv-chat/threads`, but the deployed backend had no corresponding module. This release adds that API and a mobile layout with separate list/conversation screens, back navigation, a composer that follows the visual viewport, technician search, unread counts, per-thread drafts, retry and chronological history in pages of 50.

## Architecture and audit

Acutis Chat `5c414f0` uses Socket.IO 4.8, MongoDB rooms, Acutis JWT identities and class/parish authorization through its Core API. It has no MOC_MARIA tenant contract in the audited source. Acutis Queue was fetched and its master branch fast-forwarded. Neither service is changed for this release. Chat history and membership are stored in the existing dedicated Mộc Maria PostgreSQL database and protected by its existing access-token/session guard. No new infrastructure, shared Mongo rooms or queue publishing is required.

This release uses polling (messages every 5 seconds, conversations every 8 seconds). It does not claim WebSocket delivery, typing, online presence, end-to-end encryption, attachments, push notifications or a report/block workflow. Booking/quote state is never changed by messages.

## API and privacy

- `GET /ktv-chat/threads`: participant-scoped names, last text and unread count, private/no-store.
- `POST /ktv-chat/threads`: `{providerApplicationId}`; customer permission, current public provider gates, no self-chat, unique pair.
- `GET /ktv-chat/threads/:id/messages?before=<message UUID>`: latest 50 or older page, chronological; cursor must belong to this thread.
- `POST /ktv-chat/threads/:id/messages`: `{body, clientMessageId?}`; trim, 1–2000 characters; stable UUID retries deduplicate transactionally. Existing clients without a UUID remain supported. 30 new messages per sender/thread/minute. Suspended providers and inactive participants cannot send.
- `POST /ktv-chat/threads/:id/read`: `{lastMessageId}`, 204. Only a message in the thread can advance the actor's monotonic read marker.

All read/send/read-marker requests verify membership on the server; unrelated users receive 404. Existing history remains readable by participants after provider suspension. Text is rendered as text, with no HTML injection or unnecessary contact/address fields in responses. Only approved real providers from the public directory appear in the picker; demo cards do not accept messages.

## Verification

CODE: FE and BE implementation complete for direct text chat.
TEST: BE 25 existing unit tests + 55 isolated PostgreSQL integration tests, including 12 new chat cases. Migration 16 rollback/reapply PASS. FE 6 new interaction tests cover login return URL, picker/demo exclusion, draft isolation, delayed response races, send retries and mobile back. FE typecheck/lint/build PASS. Desktop and 390/320px browser QA uses local-only fixtures; no production business fixtures.
COMMIT: see Git history on `codex/ktv-private-chat` and release update below.
DEPLOY: pending until the release update below records the actual image and frontend deployment.
BUSINESS_DATA: no production seed or changes to provider approval/catalog; a real eligible provider is required to start a chat.

## Release

Deploy backend migration before switching frontend. Additive migration `PrivateKtvChat1791659000000` adds only `ktv_chat_threads`, `ktv_chat_messages` and indexes. Before production migration, back up the application schema and check its existing migration prefix. On application rollback retain the new tables/history; never run `down` after real messages are written. Do not touch Giang Xá resources or booking modules.

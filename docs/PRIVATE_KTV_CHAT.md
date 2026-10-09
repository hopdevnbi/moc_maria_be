# Private customer–KTV chat — 2026-10-09

Customers choose a real, publicly eligible KTV directly in `/tin-nhan` or open the same conversation from a provider link. Each customer/KTV application pair has one private thread; concurrent opens reuse it. KTVs see only their customer conversations. Group membership, arbitrary sender IDs and administrator bypasses are not accepted.

The former frontend called `/api/v1/ktv-chat/threads`, but the deployed backend had no corresponding module. This release adds that API and a mobile layout with separate list/conversation screens, back navigation, a composer that follows the visual viewport, technician search, unread counts, per-thread drafts, retry and chronological history in pages of 50.

## Architecture and audit

Acutis Chat `5c414f0` uses Socket.IO 4.8, MongoDB rooms, Acutis JWT identities and class/parish authorization through its Core API. It has no MOC_MARIA tenant contract in the audited source. Acutis Queue was fetched and its master branch fast-forwarded. Neither service is changed for this release. Chat history and membership are stored in the existing dedicated Mộc Maria PostgreSQL database and protected by its existing access-token/session guard. No new infrastructure, shared Mongo rooms or queue publishing is required.

This release uses polling (messages every 5 seconds, conversations every 8 seconds). It does not claim WebSocket delivery, typing, online presence, end-to-end encryption, attachments, push notifications or a report workflow (blocking is added in F2 below). Booking/quote state is never changed by messages.

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
DEPLOY: RELEASED; evidence below.
BUSINESS_DATA: no production seed or changes to provider approval/catalog; a real eligible provider is required to start a chat.

## Release

Deploy backend migration before switching frontend. Additive migration `PrivateKtvChat1791659000000` adds only `ktv_chat_threads`, `ktv_chat_messages` and indexes. Before production migration, back up the application schema and check its existing migration prefix. On application rollback retain the new tables/history; never run `down` after real messages are written. Do not touch Giang Xá resources or booking modules.

Production release verified: BE `8d7dc7b6e92934681dcd9ff90d5d575923cf2b40`, image `sha256:35295f4b7fb0213b9cd76cc6da9039f7910459d5ffa42e5977b0d2c30f1656c1`, ready replica 1; migration job `moc-maria-private-ktv-chat-20261009` applied 15→16 with exact schema-prefix checks. FE `df53c27f05e9ba1ea257a6916bf27f31e50e264b`, GitHub production deployment `6959386754` successful, `https://mocmaria.com/tin-nhan` browser alias verified. Both PR/main quality CI and backend image workflow PASS. Production health 200, unauthenticated chat 401 (previous missing route fixed), public eligible provider count 0. Authenticated full conversation flow verified only in isolated/local QA, not with a real production KTV.

Pre-migration private schema backup: 148927 bytes; SHA256 `cc4eeab82988896caf4f7123bb1d8dbd42d1beca6963110ad8d533a792da6daf`. Disposable restore PASS: 15 migrations/49 tables/7 roles/8 permissions. QA infrastructure removed. Previous image `sha256:dc3cb89ee11a0b536c4dfedc535efb078ddc57ed4244bbfeac3a9ed694ef343b` is the source rollback target; retain message tables after writes. Temporary workstation QA SSH access is removed after release.

## Reciprocal blocks and verified reviews — F2

CODE: Both thread participants may POST `/ktv-chat/threads/:id/block` with TEMPORARY/durationMinutes (1–525600) or PERMANENT, and POST `/unblock` for their own block. Either active block prevents new messages in both directions; history remains private/readable. Expiry is checked against the database clock on every send/list, with no scheduled-job dependency. Blocks and sends lock the same thread; reopening cannot bypass the unique pair. Notes remain private. Unblocking cannot revoke the peer's block. Existing clients remain compatible with additive thread fields.

Ratings: public GET `/provider-reviews/public/ratings` and `/providers/:id/reviews?page=1`; authenticated GET `/provider-reviews/me/eligible?providerApplicationId=…`, POST `/provider-reviews`, PATCH `/provider-reviews/:id`. One 1–5 star review and nonblank comment per completed appointment/assigned KTV. Ownership, completed status, elapsed service time and no self-review are checked on the server. Concurrent retries deduplicate. Customers can edit within 7 days with expectedVersion; every create/edit/moderation is recorded. A chat block does not remove or prevent verified feedback. Public responses omit customer identity, appointment identifiers and location. Independent staff moderation requires staff.manage, reason and version, and excludes the author/KTV themselves. Hidden reviews are excluded from averages. No fabricated defaults for unrated or demo profiles.

Frontend: mobile block duration/custom days/permanent selector and reopen dialog; blocked composer/history notice; real ratings on KTV cards and profile, paginated comments, completed-service review form with star radios. Review entry is in the real provider profile; existing E2 booking ownership is untouched. No booking completion endpoint is introduced.

TEST: BE 25 unit + 65 disposable PostgreSQL integration tests PASS; latest migration rollback/reapply PASS. FE 21 tests, full lint/typecheck/build PASS; local browser block/reopen and feedback flow verified at 390px, 320px layout verified without horizontal overflow. No production fixtures. Backup before migration: 157634 bytes, sha256 c06baebade2135928ebf1de3af690730dac8deb7bf1f411f33e963eb6d87bcf5; isolated restore evidence follows.

COMMIT/DEPLOY: RELEASED; source and deployment evidence below. Additive migration `ChatBlocksReviews1791662000000` must precede frontend rollout. On application rollback retain blocks/reviews/history; never down-migrate after real writes. BUSINESS_DATA: no provider approvals, booking completion or public sample reviews added. Production currently has no eligible real KTV; submitting verified feedback additionally depends on the separately owned E2 booking completion flow.

F2 production release: BE `c213cc1b62fa3e021e0a35b1d5e101dea6b5d5cd`, image `sha256:14a551f94e5a677097776eaa01729c963ebfdad97d303189a50f28334c27e833`, ready1; job `moc-maria-chat-blocks-reviews-20261009` applied16→17 with exact migration-prefix checks. FE `5f12ecb952c3c093167124b3329213b32f459b7f`, production deployment `6960250016` success; `https://mocmaria.com/tin-nhan` alias verified in browser. Both PR/main quality CI and image publish PASS. API health200, chat/block/create-review/eligible routes anonymous401, public ratings200 with0 eligible providers. Authenticated writes verified only in disposable/local QA. Backup restore PASS:16 migrations/51 tables/7 roles/8 permissions. Temporary QA resources removed; key revoked at final cleanup. Previous backend image `sha256:35295f4b7fb0213b9cd76cc6da9039f7910459d5ffa42e5977b0d2c30f1656c1` is the application rollback target; retain reviews/blocks/history.

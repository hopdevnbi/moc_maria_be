# Mộc Maria — KTV 1:1 chat integration handoff

Branch: `codex/ktv-chat` (based on BE `main`, kept in separate worktree).
Frontend live: `moc_maria_fe` `main`, commit `83e7e39`.

## Implementation

- NestJS module `src/modules/ktv-chat`: authenticated customer/provider direct messaging, backed by dedicated Postgres tables.
- Customer can open or reuse a chat only with a currently publicly approved/eligible KTV (same eligibility gate as `GET /providers/:id`).
- Only the customer and corresponding provider account can read/send on that thread. Messages are never publicly cached.
- Validation: max 2000 chars, non-empty, server-sent sender identity only, limit 15 messages/minute/sender with transaction-scoped advisory lock, indexes for per-sender and per-thread reads.
- UI `/tin-nhan?provider=<providerApplicationId>` polls GET messages every 8s. Chat is not yet Socket.IO; real-time can follow after functional release.

## REST routes (Bearer auth; Cache-Control: private, no-store)

- `GET /api/v1/ktv-chat/threads` — list actor's threads (limit 100).
- `POST /api/v1/ktv-chat/threads` — body `{ "providerApplicationId": "UUID" }` — customer only, safe to replay.
- `GET /api/v1/ktv-chat/threads/:id/messages` — most recent 80, ascending order.
- `POST /api/v1/ktv-chat/threads/:id/messages` — body `{ "body": "..." }` — both authorized parties.

## Release coordination

BE E2a/booking agent owns database migrations and currently works in `codex/production-integration`. Do not overwrite its worktree and do not apply this migration without checking the existing release ledger. Integrate this branch after booking schema conflicts are reconciled. This code does not need any Acutis Education Chat service changes.

Before backend publication:
1. Review chat branch diff and E2a conflicts; merge into BE master via review.
2. Run `npm run migration:run` against correct DB using controlled production migration workflow.
3. Deploy BE image and verify authenticated open/send/receive access; verify unrelated users get 404.
4. Verify KTV suspension prevents new messages and revoked KTV doesn't reappear.
5. Verify FE route `/tin-nhan` responds correctly, no caching in network tab.
6. Confirm production services/providers/branches have real **approved** records; no fixture KTV may be displayed.

## Checks on branch

- TypeScript typecheck passed.
- Changed-files ESLint/Prettier passed (entire Windows Git worktree has CRLF formatting false positives on untouched legacy files; Linux CI format expected normal LF).
- Jest full suite: 7 suites, 31 tests passed, including 6 KTV chat permission/rate-limit cases.
- Database migration not run; actual PostgreSQL integration test pending.

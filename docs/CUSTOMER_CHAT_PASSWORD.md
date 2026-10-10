# Customer per-chat password

Customers can protect each private KTV conversation independently. Provider access is unchanged. The list always masks the protected customer's message preview, even while unlocked. Authentication and existing membership checks are still required; KTV/nonmember accounts cannot set, change, remove or recover another customer's chat password.

## API

All routes are authenticated and `private, no-store`, under `/ktv-chat/threads/:id/privacy`:
- POST `/password`: password6–128 characters; changing an existing password also requires currentPassword. Changes revoke previous grants and issue a fresh proof for this session.
- POST `/unlock`: password; returns a fresh unlock_token and unlock_expires_at.
- POST `/lock`: revokes this session's proof immediately.
- POST `/remove`: password, verified against this chat's hash; history remains intact.
- POST `/recover`: password, verified against the owning customer's active account password; removes the chat lock without deleting history.

Protected customer history GET, outgoing POST (including idempotent retry) and read-marker POST require `X-Chat-Unlock`. Proofs are random256-bit values bound to thread plus live authenticated session, expire after15 minutes, and are compared through SHA-256/timingSafeEqual. Bearer authentication alone cannot read a protected chat while a grant exists. Provider requests still work normally; server blocking/suspension checks continue to apply.

## Storage and concurrency

Use the existing private app_metadata namespace `mocmaria.chat.privacy.<thread UUID>`. Store an Argon2id password hash (19 MiB/time2/parallelism1), failed-guess counters/cooldown and bounded active session grants containing only proof hashes/expiry. No plaintext password/proof is persisted or included in thread listings/audits. Audit metadata contains only threadId/action. Existing HTTP logging serializes method/requestId/path and omits headers/body. No migration or identity/provider/booking module changes are needed.

All privacy operations and history/send/read access serialize on the dedicated chat thread row. Five invalid proofs of the password trigger a five-minute per-thread cooldown. Wrong-password counters commit before returning an error, so rollback cannot bypass rate limits. Recovery shares the same protection. Account/session revocation remains enforced by the existing access guard.

## Client behavior

Proof stays in a component ref; never localStorage/sessionStorage/query cache. Locking, leaving the conversation, leaving the page or expiry conceals history and discards draft/outbox/cache/proof. Reload needs the password again. A server CHAT_LOCKED response also clears visible/cache content immediately. Password dialogs support confirmation, current-password checks, recovery, masked inputs, keyboard focus and mobile layouts. KTV views do not show customer password controls.

The feature gates customer access to server history; stored message text and provider access retain existing behavior. It does not introduce end-to-end message encryption.

## Verification / rollout

CODE complete. FE full quality:39 tests, lint/typecheck/format and production build PASS. BE full quality:25 unit tests, lint/typecheck/format and build PASS using temporary normalization of Windows checkout line endings (unchanged files restored). The disposable PostgreSQL suite tests owner membership, masked previews/API gates, proof/session/thread isolation, expiry, persistent rate limits, change/removal/recovery and retained history; final run pending. Existing REST chat has no lock records until a customer opts in. Deploy the additive backend first, then frontend; no production passwords will be set by the agent. Production UI smoke and final source/image evidence follow.

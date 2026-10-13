# Mộc Maria branded transactional email — 2026-10-13

## Scope and sender

All existing Mộc Maria email producers now call `mocMariaEmailJob`:

- `AdminAlertsService.bookingRequested`: administrative booking request notification.
- `ChatDigestService.drainEmail`: administrative per-thread scheduled digest.

Every job carries `from: no-reply@mocmaria.com`, HTML, a plain-text alternative, purpose and correlation ID. The shared Queue accepts a bare email address for `from`; a formatted display name would violate its current contract. Resend domain `mocmaria.com` is verified with DKIM TXT plus the two exact sending CNAME records supplied by Resend. Sending is enabled; receiving is not configured. This sender is for outgoing notifications, not an inbox.

The shared Queue's existing Resend key is restricted to `giangxa.com`: the live sender check returned `550 This API key is not authorized to send emails from mocmaria.com`. The owner explicitly approved a new `Moc Maria Production` key with Sending access limited to `mocmaria.com`.

Mộc Maria therefore runs a separate instance of the unchanged published Queue image (`bb2b24c`, digest `1fd3b5d63346729da03cf32d8ea52f670359c069f0711e8d212c599a2afb1f05`). Its Redis, API credential and SMTP credential are isolated in namespace `moc-maria`; the API points to `http://moc-maria-email-queue.moc-maria.svc.cluster.local`. Neither Giang Xá Queue source/deployment nor its SMTP credentials/default sender are changed. `giangxa.com` retains its existing verified domain and sender configuration. No database migration is required.

The complete integration suite exposed an existing cross-host clock issue twice: Zalo initial outbox timestamps used application time while due-row selection used database time. Initial timestamps now use `clock_timestamp()` in the insert, matching the collector's clock. No recipient, message text, schedule, backoff policy or shared service changes are involved.

## Templates

`src/shared/email/moc-maria-email.ts` owns the sage/ivory/gold layout, official logo on `mocmaria.com`, visible brand text (also readable if images are blocked), Vietnamese dates in `Asia/Ho_Chi_Minh`, and existing administrative links. Layout uses presentation tables, inline styles and a mobile media query. User-controlled names/notes are escaped. Price formatting uses integers without floating-point precision loss.

Booking email lists actual customer contact details, KTV, service, branch, requested time, anticipated price, notes and appointment reference. Its action opens the existing `/quan-tri` page; the project currently has no `/quan-tri/lich-hen` route.

Chat email includes participant names, new-message counts, last activity, thread reference and `/quan-tri/thong-bao`. It includes no message bodies. New report outbox entries persist the rendered HTML; pending entries from previous releases receive a branded fallback around their existing text. Stable job IDs, recipient selection, schedules, watermarks, leases, delivery acknowledgements and Zalo text remain unchanged. Jobs already accepted by Queue before deployment retain their original payload; completed mail cannot be changed retrospectively.

Audit boundary: registration/verification/welcome/forgot-password email producers are absent. `AuthService.forgotPassword` persists a token but does not send email in production. This release updates all existing email flows; it does not add authentication flows or claim those unfinished functions are operational.

## Validation and preview

Run backend unit tests/typecheck/build, lint/format, and `scripts/isolated-integration-test.cjs` against its disposable database before release. Git on this Windows host checks out CRLF; formatting/lint can use `endOfLine: auto` locally without modifying unrelated files. GitHub Linux quality runs the unchanged full quality command.

After build, generate local previews without sending mail:

```text
node scripts/preview-email-templates.cjs <absolute output directory>
```

The generated booking, chat digest and existing-report previews contain local QA content only. Browser visual checks cover desktop and 390px mobile, logo loading, readable details/actions and absence of horizontal overflow. Verify live delivery only to the owner's explicitly selected recipient, using clearly identified template-check subjects; never create production bookings/messages to test email.

## Release and rollback

Commit/push validated source to `main`, wait for Backend Quality and Publish Backend Container, then resolve that exact main image to an immutable digest and update only `moc-maria/moc-maria-api`. Application source `3a6171d5c31a00f64c65bf15ae3809b6e8ad91db` passed 57 unit and 100 isolated PostgreSQL tests, GitHub Quality `38360974346` and image build `38360974671`; its image digest is `a84a956d9c2ebc52ce5855f632143d9d6a01816dc45d3ed6d75fbf5f6f62e69d`.

Provision Secret `moc-maria-email-secrets` privately with `SMTP_PASS` (new scoped key), random `QUEUE_API_KEY`, random `REDIS_PASSWORD`, and `REDIS_URL` pointing to its dedicated Redis service with URL-encoded password. Do not commit or print values. Apply `deploy/k8s/moc-email-queue.json` after server dry-run. It includes an internal Queue service and password-protected Redis with AOF, no eviction, retained 1Gi volume, and bounded memory. The static hostPath volume is for the current single-node VPS; migrating nodes requires copying `/var/lib/moc-maria/email-redis` and preserving the Secret. AOF durability is not a substitute for an off-host backup.

Wait for Redis/Queue readiness before merging only the Queue URL/Secret environment fields into the live API Deployment. Do not blindly reapply the older generic API manifest over unrelated operator-managed fields. Failed Mộc Maria email jobs in the former shared broker must be identified by dedicated sender/job prefix and replayed only into the new broker with the original job ID; keep completed/other-tenant jobs unchanged.

Record source/image and health checks after rollout. Preserve outbox entries, watermarks, Redis volume and settings on rollback. Do not switch the new sender back to Giang Xá's restricted SMTP key. No FE deployment or Giang Xá deployment is required.

# Mộc Maria — voluntary KTV tips / lời cảm ơn

## UX and business semantics

The public `/chuyen-vien/:slug` profile includes a voluntary appreciation button.
Customers select a preset tip amount or enter VND (10,000–10,000,000), view the
KTV's own account and uploaded QR if available, and transfer **directly to the KTV**.
The QR is the static image supplied by the KTV; it may not automatically fill the
selected amount. If neither QR nor account exists, customers are directed to
chat with the KTV instead. Payment details are never invented.

After choosing to view transfer instructions, one record with status `INTENT`
is inserted into existing `app_metadata`, keyed
`mocmaria.ktv.tip.intent.v1.<clientRequestId>`. If the customer explicitly
clicks “Tôi đã chuyển khoản”, the record becomes `SELF_REPORTED`.
**Neither state proves that bank funds arrived.** Analytics must not treat
intents or self-reported amounts as verified revenue. `verifiedVnd: null`
is deliberate; a verified transfer workflow is a separate future feature.

The KTV may upload a QR and edit their bank, account holder and account number
directly on their own public page. `SUPER_ADMIN` can edit any KTV. The backend
enforces ownership, active account and role, regardless of what the UI displays.
Bank information and QR are public by design and the editor tells staff this.
The setting uses `app_metadata` versioning, per-key transactional advisory
locking, and an audit-log entry without recording the account number in logs.
No schema migration is needed and existing appointment/booking logic is untouched.

## Endpoints (under `/api/v1`)

| Method | Path | Access / result |
|---|---|---|
| GET | `/provider-tips/:id/config` | Public only for visible KTV; `version, bankName, bankAccount, accountHolder, qrUrl, updatedAt` |
| GET | `/provider-tips/:id/config/editor` | KTV owner or `SUPER_ADMIN` |
| PATCH | `/provider-tips/:id/config` | Same; body `expectedVersion, bankName, bankAccount, accountHolder, qrUrl` |
| POST | `/provider-tips/:id/qr` | Same; multipart `file` JPG/PNG/WebP max 5MB |
| POST | `/provider-tips/:id/intents` | Public; `amountVnd`, UUID `clientRequestId`; returns ID, one-time private token and `INTENT` |
| POST | `/provider-tips/:id/intents/:tipId/declare` | Public; JSON `{token}`; sets `SELF_REPORTED` (unverified) |
| POST | `/provider-tips/:id/intents/:tipId/keepsake` | Optional; multipart `file, token, consentVersion=PRIVATE_TIP_KEEPSAKE_V1` max 5MB; only after self-report |
| GET | `/provider-tips/:id/intents/:tipId/keepsake` | KTV owner or `SUPER_ADMIN` only; decrypts privately stored PNG |
| GET | `/provider-tips/:id/report` | KTV owner or `SUPER_ADMIN`; counts, self-reported VND and `verifiedVnd:null` |

## Privacy / infrastructure

- Uploaded bank QR becomes a public, optimized PNG on existing Bunny CDN:
  `moc-maria/provider-tips/qr/<providerId>/<randomUUID>.png`.
- Optional transfer keepsake images are converted to PNG (with EXIF removed),
  encrypted server-side with AES-256-GCM and uploaded as `.bin` under
  `moc-maria/provider-tips/private-keepsakes/<providerId>/<tipId>.bin`.
  Their URLs are **never exposed** by public APIs. Only an authorized KTV/
  SUPER_ADMIN can fetch a decrypted image through the authenticated API.
  Encrypted Bunny bytes cannot be viewed as a photograph even if an object
  link is obtained.
- Encryption key is HMAC-derived from `TIP_KEEPSAKE_SECRET`, or from the
  existing production `JWT_ACCESS_SECRET` as a compatibility fallback.
  **Keep the key stable** or migrate/re-encrypt stored images before rotating
  the source secret. Do not log or commit either secret.
- A KTV editing a bank QR can unpublish it; the already-uploaded binary may
  remain for manual CDN cleanup later. Tips do not integrate with a payment
  gateway or represent bank-verified transactions.
- Existing API ingress `8m` body limit is sufficient (each image max 5MB),
  so no Kubernetes ingress changes are necessary.
- Request throttling guards limit anonymous intent, self-report and keepsake
  uploads; the UUID client request key prevents inserting the same intent twice.

## Release and manual checks

Backend unit tests, lint/typecheck/build first, then push `main` and wait for
GHCR digest. Roll out only namespace `moc-maria` deployment `moc-maria-api`,
validate live/ready and public/unauthorized paths, then push FE `main` to
Vercel. Check at 390px/375px/320px on Chrome/Safari, cover no bank/QR,
account-only, QR-only, both, custom amount, copy, owner/guest/admin controls
and optional receipt skip/upload. No real bank transfers or actual customer
receipts should be created during release smoke tests.

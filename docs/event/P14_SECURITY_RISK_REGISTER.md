# P14 Security risk register — 2026-10-15

This document records the verification status, not a declaration that deployment is secure. **Status: conditional / not yet production-certified.** The release gate requires no unresolved Critical/High findings and tests against the deployed configuration.

| Threat | Severity | Current control / evidence | Remaining verification |
| --- | --- | --- | --- |
| Replay / double open / overclaim | Critical | P07 transaction, idempotency and quota; P14 OPEN rate limit; unit tests | Run PostgreSQL concurrency and interrupted-response recovery tests against deployed API |
| Stock/budget race | Critical | P07 transactional inventory and budget lock design | Verify 50–100 simultaneous requests, multi-pod, stock exhaustion and rollback with real PostgreSQL |
| Broken object-level authorization / tier spoofing | High | JWT guard and server-side tier/ownership decisions; existing gift service tests | Negative end-to-end tests across two distinct customers, VIP tiers, branches and cashier roles |
| Double redemption / fake QR / brute-force | High | Server validation of hashed QR, redeem state and VERIFY/REDEEM action limit; P14 global cashier buckets | Two-cashier concurrent redemption, token-guessing and branch permission tests against database |
| CSRF, CORS and cross-subdomain cookies | High | Bearer-protected event routes and documented intended host design | Verify real Vercel/Cloudflare allowed origins, cookie flags, OPTIONS, redirects and CSRF policy on staging |
| XSS, SQL injection | High | Parameterized SQL in P14 limiter; DTO validation at controller boundary | Audit all campaign/prize user-rendered content, uploads and raw queries; dynamic negative tests |
| Admin status/prize manipulation | High | Super-admin gates, audit/versioning design | Negative test all lifecycle endpoints, including archived, concurrent edits and authorization by role |
| Token or PII exposure in logs, URLs and caches | High | QR POST body, private no-store responses and hashed token storage design | Inspect proxy/application/access logging, analytics, exception traces and cache headers in staging |
| Voucher stacking / duplicate checkout claims | High if automatic checkout is enabled | Checkout integration deliberately deferred unless validated | Keep automatic voucher redemption disabled until checkout atomicity/stacking/refund tests pass |
| Automated bot / multi-account attempts | Medium to High (environment dependent) | DB-backed per-JWT action limits; no intrusive fingerprinting | Configure/test trusted-proxy IP/WAF controls; exercise multi-account load and 429 observability |
| Denial of service via limiter buckets | Medium | P14 UUID v4 scope validation, bounded action names and branch-global counter | Test expiry/cleanup and DB index performance under realistic pressure |

## Verification log

- `npm test -- --runInBand gift-abuse`: **PASS**, 2 suites / 9 tests (2026-10-15).
- `npm run build`: **PASS** (2026-10-15).
- Full gift regression, cross-account security E2E, real database concurrency, multi-pod checks, production/proxy checks: **not yet verified in this report**.

## Release decision

Do **not** mark P14 accepted or turn on a public campaign until the High/Critical verification items above are closed with concrete test evidence. Avoid logging raw QR tokens, passwords, customer identifiers or JWTs in test reports. Scope future fixes to gift-event features and do not change booking, chat, reviews or VIP semantics.

# Public content cache — code ready, production held

Owner instruction on 2026-11-04: finish cache code and tests, wait for the existing Web Push migration. Do not run production migrations, deploy, or enable flags under this handoff. Booking core is unchanged.

## Behavior

`PublicCacheModule` adds an opt-in HTTP interceptor and `GET /api/v1/public-content/revision`. `PUBLIC_CONTENT_CACHE_ENABLED=true` enables the interceptor; absent/false leaves existing reads live. Before migration the revision endpoint returns 503 and readers bypass cache. No startup dependency on Redis or the new schema.

Anonymous GETs on the explicit allowlist can use process RAM: services, categories, branches, provider display/presentation, service detail and public showcase. Budget: 32 MiB serialized values, 2,000 entries, 512 KiB per entry, LRU eviction, singleflight and jittered 300 second TTL. Concurrent loader count is bounded; HTTP/Nest admission and the existing DB pool still bound upstream work. Response objects are cloned. Errors and oversized values are not retained. `/ktv-chat/providers` has at most five seconds of backend cache because eligibility can change with time. `/providers`, booking availability, tip/bank/QR, authenticated, cookie-bearing and query-bearing requests bypass this cache.

Every selected request checks the database revision, including hits. A miss checks again after loading and retries if a commit occurred during the load. Headers `X-Public-Cache`, `X-Public-Revision` and `X-Public-Cache-Bytes` expose state without response data. Selected responses are HTTP `no-store`; this is an application RAM cache, not an instruction to cache HTML/API responses at a CDN.

## Transactional invalidation

Migration `1793775435753-PublicContentCache` creates private schema `moc_cache`. The singleton contains an epoch UUID. `public_changes` stores one marker per public-writing transaction, using `pg_current_xact_id()`. Revision is SHA-256(epoch + committed marker count), truncated to 24 hex characters. There is no global counter UPDATE lock. Counting committed rows detects transactions that commit late; taking MAX of transaction/sequence IDs would miss those. Business rollback rolls back its marker. Multiple writes in one transaction insert one marker.

Triggers cover the source tables listed in the migration, public metadata key prefixes and provider user activation/name changes. Password-only and unrelated customer/metadata changes do not invalidate public reads. Booking/appointments/chat/session tables are excluded. Existing business records and queries are unchanged. Old RAM entries become unreachable immediately at the next authoritative check and are physically cleared on observed revision changes. No webhook, dispatcher, Redis or asynchronous outbox is required for this correctness gate.

The private schema has no PUBLIC grants and uses invoker functions. Before production, verify the API writer and migration owner roles can read/write it and all intended public source mutations use the existing authorized database roles. Do not grant anonymous access. Monitor ledger row count; do not delete markers or compact without changing epoch atomically and rechecking concurrency semantics.

## Frontend contract

The matching FE branch uses the same opt-in flag. Each RSC render reads the authoritative revision and successful public DTOs are cached with that revision in the Next `use cache` key. Next RAM defaults and `cacheLife({stale:5,revalidate:300,expire:3600})` provide lifecycle/eviction. Cache fills require the matching backend revision header. A missing/disabled gate or failed fill falls back to live reads; errors are not cached as empty success. Dynamic provider availability stays live.

The same-origin revision route uses the cheap gate when enabled, retaining the legacy full-catalog hash as rollback fallback. Its 24-hex contract remains compatible. A single browser watcher per tab verifies socket hints at the origin, polls visible tabs about every five seconds when enabled, refreshes on revision changes and on the first enabled check to close the SSR/subscription race. Legacy fallback stays at 90 seconds. Hidden tabs skip reads and recheck on visibility. First content already rendered can remain visible until a successful check; offline/gate failure cannot promise immediate browser invalidation. Existing Router RAM/prefetch is reused. SW navigation/API and QR policies remain network-only/no-store; push handlers are unchanged.

## Validation and limits

- Backend unit suite: 295 tests passed, including ten new cache/race/budget/interceptor tests. Recheck scoped tests with `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/shared/public-cache/public-memory-cache.spec.ts src/shared/public-cache/public-cache.interceptor.spec.ts`.
- Isolated real PostgreSQL + two Nest apps: `node test/public-content-cache-runner.cjs`. The runner creates/deletes its own temporary PostgreSQL pod and Secret in the existing namespace; generated credentials stay out of logs/Git. It runs source migrations only in this disposable DB, including Web Push, before the cache tests. This does not apply Web Push to production.
- E2E covers SQL CRUD, real service insert/hide/delete, cross-instance invalidation, rollback, late commit, transaction deduplication, private write exclusion, provider deactivation, public revision contract, private schema access and cache migration down/up preserving source rows.
- Frontend: 360 tests passed, real Next dev compiler/RAM integration passed; production build and typecheck passed. Local runner verifies actual cross-request hits, revision change, live availability, 503 recovery and backend flag-off. These are correctness checks, not production speed measurements.
- Windows checkout has inherited CRLF while Prettier expects LF. Standard backend lint reports these across unchanged files. Changed files pass standard lint; full source lint is also checked with only `endOfLine:auto` overridden. Do not mass-format unrelated modules.

No production post-cache benchmark, physical mobile/PWA acceptance, or multi-replica rollout has been performed. The available production baseline is stored outside Git in the supplied prompt folder. Never equate an edge shell HIT with complete page-data readiness.

## Resuming release after owner authorization

1. Re-read the shared coordination files, fetch both origins, inspect new main commits and claim the one release owner. Keep the cache branches isolated until validated integration into main.
2. Read the **live migration ledger** and compare its exact ordered prefix with source. Production was missing `KtvChatWebPush1793700000000` at audit. Wait for its authorized owner to apply it; never backdate/skip that migration or run all pending production migrations silently.
3. Review/test against the new main state. Take the existing private backup and verify the restore path. Confirm database runtime roles and source tables. Apply only the authorized pending cache migration through the normal migration ledger after the Web Push prerequisite is resolved.
4. Build/deploy BE from main with cache flag false, record exact image digest and health. The checked-in `deploy/k8s/api.yaml` was stale at audit: do not wholesale apply it over live environment, secrets, image or rolling strategy. Preserve live settings and patch only reviewed fields.
5. Enable BE flag, verify MISS→HIT/revision/no-store, memory, errors and heavy endpoint latency. Then deploy matching FE from main with server flag true. Check actual HTML/RSC/data, visible-tab CRUD refresh, navigation, tip QR and SW push behavior. Never create fake production providers/customers/tips/bookings for tests; use authorized real content edits or isolated fixtures.
6. Compare ten or more cold/warm/revisit samples and representative concurrent reads. DB roundtrip was about 67 ms; revised internal warm p95 target is ≤150 ms plus ≥50% reduction on heavy API paths. Browser revisit ≤150 ms/LCP p75 ≤2.5 s are unverified acceptance targets, not guarantees.
7. Redis is deferred with evidence: one API replica, bounded RAM, sufficient memory and a database gate already providing cross-instance correctness. If needed, provision a **separate** cache deployment (128 MiB maxmemory/256 MiB pod limit, rebuildable ephemeral storage), never share/flush/reconfigure `moc-maria-email-redis` or other tenants. Remeasure hit rate, DB revision cost and capacity before changing this decision.

Rollback: switch FE and BE flags false first; restore previous source/images through main/release procedure. Keep additive cache schema and ledger in production. `down` is tested only in disposable QA; do not drop live schema/history as a routine rollback. After a database point-in-time restore, rotate the cache epoch before re-enabling caches, so restored marker counts cannot reuse keys from the later database timeline.

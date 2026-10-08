# Mộc Maria Project Progress - Backend

## Current
- Phase 01 Foundation: DONE
- Phase 02 Auth / RBAC / Customer / Staff Identity: DONE (e2e 3/3 PASS; migration applied)
- Phase 03: IN PROGRESS - P03-T01 branch entity and migration authored, not yet applied
- Phase 03 branch API added: GET /api/v1/branches (active only), and protected GET/POST/PATCH /api/v1/admin/branches. Quality PASS; branch integration e2e and new migration application pending.
- Product plan extended 2026-10-08: KTV self-application, in-house courses and assessment,
  admin eligibility, at-home booking, public prices, customer address and direct KTV chat
  are now mandatory MVP requirements. See docs/KTV_MARKETPLACE_REQUIREMENTS.md.
- KTV Quality & Trust requirements added to Phases 03-08: verified customer reviews,
  premium KTV public cards, monitoring, risk pauses, fair moderation, reinstatement and appeals.
  See docs/KTV_QUALITY_TRUST_REQUIREMENTS.md. PLANNED, not implemented.
- Next step: validate branch migration on an isolated DB, then branch CRUD and public read APIs
- Phase 01 implementation commit: 8a87b44

## Phase 01 completed
- [x] Acutis backend/frontend/chat/queue fresh audit
- [x] Independent repository bootstrap
- [x] NestJS 11 strict TypeScript foundation
- [x] Config/Joi/Pino/Swagger/global validation
- [x] Global exception filter and request correlation ID
- [x] PostgreSQL + TypeORM + snake_case naming strategy
- [x] Database session timezone UTC
- [x] Supabase Session Pooler runtime/migration connection validated
- [x] Migration show/run/revert/run smoke test
- [x] Health live/readiness endpoints validated against Supabase
- [x] Dockerfile authored
- [x] GitHub quality workflow
- [x] APP_ID / CHAT_TENANT / QUEUE_SOURCE = MOC_MARIA
- [x] Secret scan of trackable files clean
- [x] Production dependency audit: 0 vulnerabilities

## Phase 01 validation
- Install: PASS
- Format: PASS
- Lint: PASS
- Typecheck: PASS
- Unit tests: PASS
- Build: PASS
- PostgreSQL migration up/down: PASS
- PostgreSQL timezone: UTC
- Health live: HTTP 200
- Health ready + DB: HTTP 200
- Production dependency audit: PASS, 0 vulnerabilities
- Docker image execution: not run because Docker CLI is not installed on this workstation; Dockerfile is committed and image build remains part of production infrastructure verification.

## Database note
The Supabase Direct hostname uses IPv6 and was not reachable from this local network.
Local runtime and migration validation therefore use the Supabase Session Pooler on port 5432.
Certificate chain verification is disabled only in the local .env for the current workstation;
production TLS/CA settings must be reviewed again in Phase 08.
- P03-T01 branch migration applied to configured Supabase PostgreSQL (2026-10-08). P03-T02 weekly business-hours migration applied, public GET /branches/:id/hours and permission-guarded PUT /admin/branches/:id/hours added. Quality PASS; endpoint integration tests pending.
- P03-T03 exceptional branch hours: public GET /branches/:id/exceptions and protected PUT /admin/branches/:id/exceptions. PostgreSQL schema migration applied; backend quality PASS. Branch integration e2e remains pending.
- P03-T04 and P03-T05: branch rooms/equipment resource foundation and publishable service categories delivered with admin CRUD and public read API. Supabase migration ResourceCategoryFoundation1791530800000 applied. Unit tests 7/7 PASS. Integration e2e and detailed branch exception API tests pending.
- P03-T06..T08: services, priced duration/buffer variants, branch-specific service mapping and optional override, admin create and public read endpoints. Supabase migration ServiceCatalogPricing1791534400000 applied. Quality/unit 7/7 pass. Integrations, editing flows and published price interpretation still need E2E before task DONE.
- Added KTV applicant self-registration, admin review, internal-certificate issue/revoke and approved-only public listing foundation; migration ProviderOnboarding1791538000000 APPLIED on configured Supabase. Quality 7/7 PASS. Training attendance/assessment, skills eligibility, rating, home booking/chat not implemented; do NOT activate production bookings until validated.
- KTV academy foundation: training courses, enrollment, assessment, 80 percent minimum attendance, internal certification gated by actual COMPLETED passing enrollment. Migration ProviderTraining1791541600000 applied. Quality PASS and 17/17 unit tests. Full training UI/attendance evidence/legal credential checks still pending. VPS namespace moc-maria exists but no deployment; secret provisioning was blocked, ingress DNS not yet verified.

## Production execution audit — 2026-10-08
- Completed source/plan/infrastructure audit: see PRODUCTION_AUDIT_2026-10-08.md. Phases 03–08 remain open.
- API DNS points to dedicated VPS; Let's Encrypt certificate READY. Frontend DNS unchanged.
- Dedicated namespace Secret and public CA mounted; immutable GHCR image pull verified.
- Read-only Kubernetes database preflight passes authorized TLS 1.3 with all nine migrations already applied. No migration/reset or production seed required.
- Initial rollout exposed guard dependency resolution failure in new modules. AuthModule now re-exports IdentityModule; complete-application startup integration and CORS/CSRF checks added. Updated image and rollout verification pending.
- Supabase data is currently empty; no fake services, providers or prices will be published.
- Validation: backend quality PASS (17 unit tests), full application integration PASS 11/11 including CORS and cookie-origin rejection. No data mutations in these integration checks.
- Backend source/image commit: 6ced49be33c82d8cabd11ca5e7394a2553160266. CI quality and image publication PASS.
- Rollout HEALTHY with digest sha256:71bd6f943e7859313ec1aa849b8c80c27d4794bec2d5dff886eb81029e419c7f. HTTPS health ready/live HTTP 200.
- Production auth smoke PASS: secure HttpOnly cookie, customer-only register, me, RBAC denial, bad password, refresh rotation/replay rejection, logout token invalidation and subsequent login/logout. Random strong-password account cleaned up.
- CORS apex credentialed preflight verified; GiangXa.com still HTTP 200. FE production API environment configuration and browser validation continue.

## Catalog / provider integration release preparation — 2026-10-08
- Public service detail with published-category/service checks, active duration/price variants and active branch mappings; service and variant edit/list API added without changing existing list response.
- Owned training reads expose only applicant data and omit assessor/issuer identifiers. Admin training read added with staff-management permission.
- Application state transitions, approval-to-staff identity, assessment, certificate issue and revoke audited. Eligibility mutations use a provider-application transaction lock; approval does not automatically publish the profile.
- Public provider reads batch queries and immediately exclude suspended/revoked/expired/inactive users. Skills, territory, schedules, quality/legal gates still must be added before booking activation.
- Admin hours/exceptions and branch mappings can be read for inactive branches without exposing them publicly.
- Private response caching disabled; request logging excludes authorization/cookies/body/query.
- Validation: 17 unit tests + 20 integration tests PASS; full BE build PASS. Integration fixtures ran only in ephemeral PostgreSQL over SSH; nine migrations applied in QA and pod/Secret cleaned up. Production database was not seeded/reset/modified by fixture tests.
- Frontend authentication tested in live browser including session restoration/reload and logout. Temporary browser QA identity removed.
- No new production schema migration in this group. Immutable image publication/rollout and FE catalog/admin deployment pending.

Catalog/provider release ffc89b39ddaa2b37b70c337160c90778227d0ffd deployed successfully.
- GHCR publication and CI quality PASS; image digest sha256:4ec1e00d8521e01f52980cfe3a3fa85602f6482da817939bfb42a49d9d1e17b9 pulled anonymously on VPS and deployed only in moc-maria.
- Kubernetes rollout ready=1, live/ready HTTPS 200; providers no-store, private training/admin requests require authentication and use private/no-store; missing published service 404. GiangXa HTTPS still 200.
- FE companion 99612d5 deployed via Vercel dpl_743MiiREwFh3gvt6U8RmTdN7eM1d and aliased https://mocmaria.com. Public page reads actual empty production catalog/providers.
- Rollback API: reapply previous digest sha256:71bd6f943e7859313ec1aa849b8c80c27d4794bec2d5dff886eb81029e419c7f. Schema unchanged, no database rollback needed. FE rollback: prior READY deployment dpl_6QkFFnd7uF6EwLHGALEfTxs1k5nR.
- Broader marketplace scope remains unfinished; isolated private admin browser QA continues next.

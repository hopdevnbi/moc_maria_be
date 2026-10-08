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

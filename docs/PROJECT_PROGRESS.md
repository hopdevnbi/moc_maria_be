# Mộc Maria Project Progress - Backend

## Current
- Phase: 01 Foundation
- Status: IN_PROGRESS
- Current blocker: Supabase Direct Connection hostname is not reachable from this local network; Session Pooler URI is still needed for DB migration smoke validation.

## P01 backend
- [x] P01-T01 Acutis base audit
- [x] P01-T02 Repository created/cloned
- [x] P01-T03 NestJS foundation
- [x] P01-T04 PostgreSQL/TypeORM configuration and initial migration authored
- [x] P01-T06 Tracking files
- [x] P01-T07 Repo hygiene
- [x] P01-T08 Dockerfile and health endpoints
- [x] P01-T09 APP_ID / CHAT_TENANT / QUEUE_SOURCE constants
- [ ] PostgreSQL migration run/revert smoke test
- [ ] P01 final validation/commit

## Validation so far
- Typecheck: PASS
- Unit tests: PASS (3)
- Build: PASS
- Lint: PASS
- PostgreSQL connection: BLOCKED on local network using Supabase Direct host
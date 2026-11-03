# KTV refusal API recovery — 2026-11-03

The production frontend submits `{ status: "DECLINED", reason }` to the participant inquiry endpoint. The deployed API was still source `3382680`, whose DTO rejected `reason` with HTTP 400 and `message: ["property reason should not exist"]`. The frontend presents array validation errors as a generic failure. Backend main `c7addc82c3830d66d505c1fa6f043cec42e4af06` already adds the optional validated DTO field, requires a trimmed 10–500 character refusal reason, permits assigned KTV refusal from PENDING/CONTACTED, persists the reason and records the audit event.

Recovery deploys that existing main image, without changing the API contract, configuration, Secrets or database schema. The previous and candidate immutable images are recorded in `deploy/ktv-refusal-recovery-release.json`.

## Validation

- Actual production login using the owner-supplied KTV account succeeds. No credentials or tokens are included in this report.
- Production diagnosis uses an all-zero nonexistent inquiry ID, so the request cannot change customer data. Before recovery it returns the DTO whitelist 400.
- The production refusal dialog populates preset reasons, disables confirmation for a four-character reason and enables confirmation for a valid preset. Confirmation is not submitted against a real customer request.
- New `test/inquiry-refusal.e2e-spec.ts` exercises the configured Nest application and disposable PostgreSQL: reason validation, authentication and ownership, PENDING/CONTACTED refusal, customer/KTV reads, audit persistence, duplicate refusal and terminal/official-record protections.
- Four related integration suites pass: 21 tests covering refusal, customer experience, provider workspace and booking lifecycle. All migrations ran only in a disposable database. Its pod, Secret and SSH tunnel were removed.
- Existing GitHub run 41575322544 passes `npm run quality` for source c7addc8. Its separate dependency audit fails on inherited advisories (four high/four moderate); this recovery does not change dependencies. Container publication run 41575322553 succeeds.

## Production boundary

The screenshot inquiry was already CANCELLED when inspected. Another active inquiry changed to COMPLETED independently during the read-only browser session. Neither was changed by this recovery. No real inquiry cancellation, refusal, completion, message send or fabricated business record was submitted. Final live contract and health results are recorded with release evidence.

## Verified rollout

The API runs the c7addc8 immutable image with one ready replica. Live/ready both return 200. The identical nonexistent-ID refusal probe now returns 404 “Không tìm thấy yêu cầu.” instead of the whitelist 400, proving the deployed DTO accepts reason and reaches the service ownership lookup. Environment and Secret references were compared before/after and are unchanged. Local full quality passes: formatting, ESLint, TypeScript, 240 unit tests and build. Only this report, isolated HTTP regression and release image evidence are added by the recovery branch.

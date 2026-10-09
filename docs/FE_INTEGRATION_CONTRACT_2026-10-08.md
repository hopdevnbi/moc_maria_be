# Mộc Maria - API integration contract for the parallel Frontend worker

Backend repository: `hopdevnbi/moc_maria_be`.
API prefix: `/api/v1`. Use the Backend OpenAPI contract when adding new screens.
**The frontend is being edited by another worker; do not overwrite uncommitted FE work.**

## Public catalog (already coded)
- `GET /service-categories`: published categories only.
- `GET /services`: published services and active variants. The response is a list of
  `{service, variants}`. Each variant contains `durationMinutes`, `priceVnd` as
  a decimal string (PostgreSQL bigint), `bufferBeforeMinutes`, `bufferAfterMinutes`.
- `GET /branches/:branchId/services`: active branch mappings for published services;
  includes `priceOverrideVnd`, nullable decimal string. This override is schema-level
  groundwork; final per-variant pricing semantics are **not yet production-ready**.
- `GET /branches`: active branches.
- `GET /branches/:branchId/hours`: recurring weekly business hours.
- `GET /branches/:branchId/exceptions`: dated closures/exception hours.

## KTV application and directory (already coded)
- `GET /providers`: array of published eligible KTV
  `{id,publicName,introduction,serviceArea,avatarUrl}`.
  Eligible means APPROVED, staff profile public+active, and an unrevoked,
  nonexpired internal training certificate. The API intentionally excludes
  reviews/rating until they are verified by completed bookings.
- `POST /provider-applications`: bearer token; body
  `{publicName, introduction?, serviceArea?}`; creates APPLIED only.
- `GET /provider-applications/me`: bearer token; applicant's status.
- `GET /admin/provider-applications`: staff-management permission.
- `PATCH /admin/provider-applications/:id/review`: authorized review
  `{status,note?}`.
- `POST /admin/provider-applications/:id/certificates`: authorized issue after
  a completed passing internal course; `{courseCode, title, certificateNumber, expiresAt?}`.
- `PATCH /admin/provider-applications/:id/certificates/:certificateId/revoke`.
- `GET/POST /admin/provider-training/courses`.
- `POST /admin/provider-training/enrollments`:
  `{providerApplicationId,courseId}`.
- `PATCH /admin/provider-training/enrollments/:id/assessment`:
  `{attendancePercent,assessmentPassed}`. Pass requires 80%+ attendance.

## Cache and confidentiality
- Public catalog: `Cache-Control: public, max-age=60, s-maxage=300,
  stale-while-revalidate=300`.
- Public provider directory: `Cache-Control: public, max-age=10,
  s-maxage=20, stale-while-revalidate=30` to limit stale visibility following
  provider suspension.
- Never use shared caching for auth/session, applications, certificates,
  private addresses, messages, quotes, or appointments.
- Next.js can layer revalidation by URL/tag when the Backend mutation flow is ready.
  Avoid indefinite local/session cache for provider eligibility.

## NOT ready / do not fake in the FE
- Public booking or therapist shift availability, chat, verified reviews/ratings,
  legal practice credentials, payment, distance/travel fee.
- Bunny media/upload service for Mộc Maria: **not yet provisioned**.
  Never reuse `giangxa-media` as Mộc Maria's production asset store.
- API ingress/TLS for `api.mocmaria.com`: **not yet deployed**.
  `mocmaria.com` Vercel frontend being live does not imply Backend is live.

If API data is empty, show a refined empty/loading state rather than fictional staff,
ratings, service prices or testimonials.

## Contract additions — verified 2026-10-08
- HTTPS API is live at https://api.mocmaria.com/api/v1; auth browser smoke PASS.
- GET /services/:slug returns {service,variants,branches:[{branch,priceOverrideVnd}]} for published services/categories only.
- PATCH /admin/services/:id; GET/POST /admin/services/:id/variants; PATCH /admin/services/:id/variants/:variantId.
- GET /provider-applications/me/training returns own enrollments/courses and certificates with server-calculated isValid. Assessor/issuer ids excluded.
- GET /admin/provider-applications/:id/training requires staff.manage.
- GET /admin/branches/:id/hours, /exceptions and /services includes inactive branch configuration for authorized admin operations.
- Provider public cache is now no-store to avoid stale eligibility. Private APIs are private/no-store.
- Application review follows APPLIED→REVIEWING→TRAINING→ASSESSMENT→APPROVED with rejection, remediation and suspension transitions; invalid jumps fail. Approval creates THERAPIST identity/profile with isPublic=false; it does not imply bookable eligibility.
- Catalog/provider lifecycle integration suite now exercises PostgreSQL constraints and HTTP RBAC in an isolated ephemeral QA database.

## Stage B — provider contact/consent (2026-10-09)

- Additive migration ProviderConsentContact1791628000000; legacy applications receive no assumed consent or verification.
- Existing POST application body stays compatible. Optional applicationConsentVersion=provider-consent-v1 records application-review consent atomically with the application.
- PATCH /provider-applications/me updates owned non-approved application name/introduction/area only; rejects state/identity forgery. APPROVED profile edits require review.
- GET /provider-applications/me/eligibility: private,no-store; current contact verification and two consent scopes; no contact hashes/evidence/actor identifiers. bookable=false until skills/schedule/service gates are implemented.
- POST /provider-applications/me/consent: {scope:APPLICATION_REVIEW|PUBLIC_PROFILE,version:provider-consent-v1,granted:boolean}. Versioned audit. Withdrawal excludes public profile immediately.
- GET /admin/provider-applications/:id/eligibility needs staff.manage; administration sees evidence references and verifier ID.
- POST /admin/provider-applications/:id/contact-verifications needs roles.manage; {channel:EMAIL|PHONE,contactValue,evidenceReference,confirmedByContact:true}. Existing active account contact must match. References allow only letters/numbers/dash/underscore. No self-verification.
- PATCH /admin/provider-applications/:id/contact-verifications/:verificationId/revoke needs roles.manage, checks application ownership, no self-action.
- This is MANUAL_CONTACT_CONFIRMATION with actual admin evidence. It is not OTP or automatic email delivery. User contact updates permanently revoke old verification; changing back does not restore it.
- Application review now requires a non-blank decision note. Approval requires profile completion, application consent and verified current contact, in addition to existing real training/certificate checks. Public listing additionally requires opt-in PUBLIC_PROFILE consent.
- Admin/applicant interface must not imply approval/contact confirmation is legal credential verification or booking readiness. Full skill/legal/quality/service/territory gates still pending.

## Stage C1 — skills and schedules (release pending)
- GET /provider-applications/me/planning and /admin/provider-applications/:id/planning: private/no-store, provider-owned read; branch/service names, skills with live certificateValid, assignments/weekly/dated schedules. No reviewer IDs in own data.
- POST admin :id/skills needs roles.manage; applicant-owned valid certificate, serviceId, certificateId, isActive, reason. No self assignment. Legal/service training policy gates remain separate.
- POST :id/branch-assignments and /weekly-shifts and /dated-schedules require staff.manage. Reason required. Provider application lock serializes all schedule writes.
- Weekly shifts: branchId, weekday0=Sunday..6, startsAtMinute, endsAtMinute. Intersections forbidden across branches; adjacent allowed. No overnight shift: split into calendar days.
- Dated: date YYYY-MM-DD, kind OVERRIDE with branchId or TIME_OFF without branch; intervals0..1440. Overrides replace all weekly shifts for that provider/date; time off subtracts across all branches.
- PATCH :id/weekly-shifts/:recordId/disable or dated-schedules/:recordId/disable soft-disables with reason and ownership check.
- GET :id/planning/windows?branchId&date intersects branch hours/exception hours, assignment, provider shifts and time-off in Asia/Ho_Chi_Minh. Private planning only, never bookable slots.
- bookable remains false until full service/legal/territory/quality and booking gates implemented. No fake production schedules or skill data.

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

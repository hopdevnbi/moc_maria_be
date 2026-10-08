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

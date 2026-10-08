# KTV marketplace / home service - Core MVP (2026-10-08)

This is a tracked product requirement summary. The full task breakdown lives in
`C:\Users\User\Desktop\Mộc maria\Plan` (Master Plan, Phases 03-08, decisions D-013..D-016).

## Provider / KTV lifecycle

1. Applicant registers independently (not automatic THERAPIST authorization).
2. Mộc Maria reviews application, identity/contact, service area and permitted credentials.
3. Applicant attends in-house courses and practical assessments.
4. Mộc Maria issues, renews or revokes **internal training certificates**, records all audits.
5. Admin approves provider eligibility per service. Only approved, active and properly
   qualified KTV with matching skill/territory/schedule can appear in public listings.
6. Internal certificates must never be misrepresented as governmental practice licences.
   Regulated healthcare or treatment services require separate legal qualification checks.

## Customer journey

1. Browse published massage packages with duration, base price, permitted surcharges
   and service areas; choose KTV or search available KTV by address/slot.
2. Submit a service-at-home address privately; calculate service-area and travel feasibility.
3. Chat directly with an eligible KTV about expectations, availability and pricing.
4. Create booking request; KTV accepts or declines; timeout/reassignment is supported.
5. Backend sends a versioned quote with full total; customer explicitly accepts
   before final confirmation. Chat content cannot silently update a booked price/time.
6. Receive reminders, service updates and an opportunity to review/report an incident.

## Non-negotiable acceptance

- Untrained, rejected, expired or suspended KTV cannot appear as bookable.
- Provider skills and service areas are enforced on the server, not only in the UI.
- Public pricing, travel fees and every quote revision are clear and auditable.
- Customer address and provider credentials have restricted access and retention.
- Cross-tenant chat isolation with the Acutis Education chat service remains mandatory.
- Concurrent requests for a KTV slot cannot create double bookings.
- Server controls states, quote acceptance, cancellation and refund policies.
- No production claim of a legal practice licence based solely on Mộc Maria training.

## Implementation ownership

- P03-T26..35: onboarding, courses, assessments, eligibility, geography, public pricing.
- P04-T15..22: at-home booking, addresses, accept/decline, quotes, concurrency.
- P05-T15..20: public KTV onboarding/listing, package pricing, customer booking UX.
- P06-T21..26: prebooking customer-KTV chat, provider actions, privacy.
- P07-T21..26: training/approval admin, moderation, pricing and incident operations.
- P08-T54..59: production acceptance, notifications, safeguards and failure tests.

Status: SPECIFIED / NOT YET IMPLEMENTED (work remains in Phase 03).

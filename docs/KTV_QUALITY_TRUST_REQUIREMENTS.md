# KTV Quality & Trust - mandatory MVP scope

This document mirrors additions to the local master plan dated 2026-10-08.
Implementation status: **PLANNED**, not yet implemented.

## Verified customer feedback
- Customer may rate a KTV 1-5 stars and comment only after a genuinely completed booking.
- One verified review per booking-provider combination; edits and moderation are auditable.
- Optional reports and evidence follow privacy, consent, retention and limited-access rules.
- Reviews can receive KTV responses, but no harassment, retaliation or pressure to change ratings.
- Rating shown publicly includes verified review count and avoids inventing a score for new KTV.

## KTV public discovery experience
- Photo/avatar with consent and safe fallback, display name, concise authentic introduction,
  expertise, services and published prices, service area, availability, internally trained badge
  and correctly described credentials, star summary, verified review count.
- Search/filter by supported services, location, time and verified feedback.
- Never imply Mộc Maria internal training is a statutory practice licence.

## Monitoring and enforcement
- Aggregate actual verified rating trends, provider-attributable cancellations, no-shows,
  repeated verified incidents and severe safety complaints with sample-size safeguards.
- States: ACTIVE -> WATCHLIST -> PAUSED -> SUSPENDED -> REMOVED with audited transitions.
- Objective risk rules may temporarily pause new bookings, especially serious safety reports,
  pending prompt human review. Low ratings alone must not trigger permanent removal.
- Authorized staff decide long-term sanctions and reinstatements, provide reasons, evidence,
  expiry/remediation requirements and a meaningful provider appeal path.
- Eligibility is enforced server-side for both provider discovery and booking acceptance.
- Protect against fake/duplicate reviews, retaliatory reports and excessive data access.

## Phase allocation
- Phase 03: P03-T36..39 quality data/public profile and eligibility.
- Phase 04: P04-T23..25 verified booking provenance and enforced states.
- Phase 05: P05-T21..25 premium KTV cards, detail and verified reviews.
- Phase 06: P06-T27..29 customer review submission/provider appeals.
- Phase 07: P07-T27..33 moderation, rules, remediation, audit, scorecards.
- Phase 08: P08-T60..64 notification, privacy and production acceptance.

No changes to live data, VPS or Kubernetes are implied by this specification.

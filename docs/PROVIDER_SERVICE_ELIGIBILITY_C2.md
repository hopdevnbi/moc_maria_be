# Service eligibility — Stage C2

CODE/QA scope; deployment recorded separately in current status.

## Public gate
Application APPROVED, active user/staff profile, current independent verified contact and both consent scopes are required. Reviewed public title/slug/experience and quality ACTIVE are required. A service must have published service/category, active variant and branch mapping, active assigned branch, skill referencing the applicant's valid certificate for the exact policy course, completed passing enrollment with attendance >=80%, reviewed active policy not expired, and active applicant grant. A recurring shift or future date override must exist at that branch.

SPECIALIST always requires a current private verification reference/expiry. Other providers require it when the scoped service policy requires a specialist licence. These references record an authorized owner's actual review; the system makes no legal determination and does not grant a state practice licence. No default policies, legacy opt-in or production fixtures.

Only safe public fields are returned: name, introduction, public area, reviewed title/experience, provider kind, internal training badge and eligible services/branch/mode/territory/travel fees. Private contact, reviewer IDs, legal/credential references and personal documents are excluded. Avatar is null until separate media consent/pipeline. Public responses no-store. bookable=false until Phase04. This capability gate is not a concrete free slot.

AT_HOME grants may include travel fee, travel buffer and optional radius from verified branch coordinates; missing coordinates cannot activate a radius grant. ON_SITE rejects travel fields. Concrete destination/radius/slot validation and immutable price snapshots are Phase04 and remain incomplete.

## Private routes
All require authentication; all GET responses private,no-store.
- GET /provider-applications/me/service-readiness: owned safe readiness; no credential references.
- GET /admin/provider-applications/:id/service-readiness: staff.manage.
- GET /admin/provider-applications/:id/service-configuration: roles.manage, private review/profile/grant edit values including credential references.
- GET /admin/service-provider-policies: staff.manage.
- POST /admin/service-provider-policies: roles.manage, exact service/branch/mode/jurisdiction upsert, required course/legal review reference/expiry/explicit confirmation/reason. Scope changes create another policy; disable obsolete scope explicitly.
- POST /admin/provider-applications/:id/public-profile: roles.manage; reviewed title/slug/optional years, explicit accuracy confirmation/reason. Publishing requires prior approval/contact/application+public consent.
- POST .../:id/operating-review: roles.manage, kind WELLNESS/SPECIALIST and quality ACTIVE/WATCHLIST/PAUSED/SUSPENDED, reason.
- POST .../:id/service-grants: roles.manage; policy, private verification reference/expiry if required, travel conditions, explicit reviewed confirmation/reason.
Application writes serialized by provider lock and prohibit self-review, even SUPER_ADMIN. Policy/profile/quality/grant changes audited. Expired policies/credentials can still be deactivated. Expiry automatically excludes public eligibility; no cron is necessary for this gate. WATCHLIST fails closed in this first implementation.

## Schema and rollback
ProviderServiceEligibility1791635200000 adds four tables without inferring historic eligibility. Source rollback may retain tables; do not revert/drop after live writes. Backup and migration order guards required before production apply. Manual restore rehearsal does not close automated backup/retention tasks.

## Remaining
Detailed training modules/session attendance/evaluation history/renewal (D), verified-booking ratings/quality aggregates, booking acceptance/quote/slot/radius validation (E), tenant chat, media consent and pipeline remain open. Public profile slug stored; existing UUID routes retained for compatibility, SEO slug routing belongs to Phase05.

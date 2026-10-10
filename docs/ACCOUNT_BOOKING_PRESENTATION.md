# Accounts, moderated provider descriptions and Hanoi appointment requests

## Behavior

The public account UI gains visible session logout, profile/password shortcuts and customer profile updates using the existing APIs. KTV descriptions use a separate revision workflow: KTV submits 30–2,000 characters; only SUPER_ADMIN may approve or reject the exact revision ID. The previous approved description remains public while a new revision is pending or rejected. Approval affects presentation only and does not grant operating eligibility or certificates.

The public booking entry offers service/provider selection, a fixed Hanoi region, branch or customer address and desired date/time. Customers send an appointment inquiry to a directory-listed KTV offering that service. Both participants see the request in their account. KTV may mark it CONTACTED or DECLINED; customers may cancel. CONTACTED means an exchange is underway, not a confirmed reservation. Existing verified branch availability/request/quote transactions are retained separately; there is no change to their eligibility, schedule locks or prices.

## API and persistence

Additive endpoints: public GET /provider-presentation; authenticated GET/POST /provider-presentation/me; SUPER_ADMIN GET /admin/provider-presentation and PATCH /admin/provider-presentation/:id; participant GET/POST /appointment-inquiries and PATCH /appointment-inquiries/:id.

Use existing app_metadata with namespaces mocmaria.presentation.* and mocmaria.inquiry.*. No migration. Advisory transaction locks serialize revisions and customer inquiry creation. Exact revision IDs reject stale approvals. Customer-scoped UUID idempotency keys produce deterministic inquiry IDs; conflicting replay bodies are rejected. Limit twenty pending and twenty new requests per hour per customer. Require a future date within sixty days, complete address and a live directory/provider-service pair. Respect reciprocal permanent/timed chat blocks. Only customer/provider participants read an inquiry address; public presentation returns approved description and provider ID only. Audit records contain IDs/decisions, not addresses or description bodies.

## Validation

Local backend full quality passed: format, ESLint, TypeScript, 27 existing unit tests and build. Seven new PostgreSQL integration cases passed with all 17 migrations in an isolated disposable database: authentication/roles, private pending revisions, exact-version approval, retained published content, forged service/address/date rejection, concurrent idempotency and participant isolation, lifecycle ownership and reciprocal block expiration. No production inquiry or description approval is created by verification.

Frontend quality: 55 tests and format/lint/typecheck/build passed. Four request interaction tests cover search, validated selection, retry identity, real receiver mapping, Hanoi time conversion and short-lived sign-in draft restoration. Browser and production release evidence is recorded after release.

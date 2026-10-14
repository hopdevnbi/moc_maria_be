# Technician completion

POST /provider/appointment-inquiries/:id/complete records a technician-reported performed service for their own contacted request without an official appointment. Requires servicePerformedConfirmed=true, reason 10–500 characters and proposed time in the past. Pending, cancelled, archived and foreign requests are rejected. Repeated requests are idempotent. Advisory and row locks serialize with existing customer reply and fulfillment actions. Exactly one audit event is written. Customer cancellation is rejected after reported completion. No appointment, reservation, qualification or review eligibility is created.

Official appointments retain the existing versioned inquiry-fulfillment lifecycle. UPDATE RETURNING is wrapped in a CTE SELECT to read TypeORM PostgreSQL results consistently.

Validation: full quality and production build PASS; 25 suites / 112 unit tests PASS. Disposable PostgreSQL HTTP tests: 3 workspace cases plus 8 customer-experience cases PASS, covering concurrent requests, persistence, roles, ownership and official lifecycle version updates. No schema migration or business-data write required.

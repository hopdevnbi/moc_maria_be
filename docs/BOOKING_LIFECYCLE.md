# Booking lifecycle and editable notes

Scope transferred explicitly by the owner on 2026-10-15. Public/admin inquiries remain persisted in app_metadata; a linked appointment, when present, is authoritative.

## Behavior

- Operational states: PENDING, CONTACTED, CONFIRMED, IN_SERVICE, COMPLETED, DECLINED, CANCELLED. Archive is independent.
- Admin list/detail/counts recognize existing KTV completion stamps and use the same state precedence. The real linked appointment status takes precedence over metadata. REQUESTED/ACCEPTED/CUSTOMER_CONFIRMED/CHECKED_IN map to the corresponding operational state; EXPIRED/NO_SHOW group under cancellation while original appointment history is retained.
- Super Admin can correct any state, including completed/cancelled/declined and archived inquiries. Ordinary Admin retains its pending-intake permission. Customer/other KTV access remains restricted.
- Completion needs explicit servicePerformedConfirmed=true. Editable proposed notes never substitute for that confirmation.
- Updates use the existing per-inquiry advisory lock, metadata row lock, optional expectedStatus/expectedUpdatedAt and appointment version. Linked changes atomically update appointment status/version/history and inquiry metadata. Reactivation checks overlapping assigned-provider bookings under provider locks.
- Reopening clears the current legacy completion stamp, retaining its old timestamp and reason in audit history. Archive and original history are preserved.
- Unlinked inquiries do not fabricate appointments, prices, payment records or verified review entitlement. Operational completion alone does not create a verified booking. Existing appointment-based reviews retain their eligibility policy.
- Assigned KTV may start an admin-confirmed legacy inquiry at most 30 minutes early, then report completion once its requested time has arrived. Official appointment transitions retain their existing sequence, timing and version checks.
- Reopening preserves original appointment time and expiry. Correct expired appointment scheduling separately before using it as a new reservation.

## API and deployment

PATCH /api/v1/admin/appointment-inquiries/:id accepts all seven statuses for Super Admin, reason 10-500 characters, optional expectedStatus/expectedUpdatedAt/expectedAppointmentVersion, and explicit completion confirmation. POST /api/v1/provider/appointment-inquiries/:id/start accepts an editable reason. Existing request contracts remain compatible. Deploy backend before frontend. No schema migration or production fixture is required.

Migration discovery now includes only numeric migration filenames so the event migration's colocated .spec.ts is not loaded as a migration during isolated QA. A pre-existing UTF-8 BOM in ProviderReviewModerationDefault was removed to satisfy formatting; SQL is unchanged.

## Validation

- Disposable PostgreSQL: test/booking-status.e2e-spec.ts, provider-workspace.e2e-spec.ts and customer-experience.e2e-spec.ts: 17/17 tests, 3/3 suites PASS. Includes privilege checks, explicit completion, legacy stamps/counts/history, all-state correction, stale/concurrent writers, linked appointment/version/history rollback on collision, archive preservation and assigned KTV transitions.
- Full backend quality checks and main CI are recorded in the release tracker.
- No production booking/customer mutations, migration execution, email or Zalo test dispatch.

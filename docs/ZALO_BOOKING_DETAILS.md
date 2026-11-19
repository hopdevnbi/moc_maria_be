# Booking Zalo notification content

Existing customer and administrator-created booking requests supply the assigned provider and customer contact fields, requested time, location mode and booking address. Only structured inquiry details are added at delivery. Missing or invalid contact values are omitted; the appointment time is displayed in Asia/Ho_Chi_Minh. Chat, protected conversations, digest, gift and direct-message sanitization remain unchanged.

All configured administrator channels still receive booking alerts. Staff channels remain scoped to the assigned provider, existing opt-out switches, deterministic outbox keys, leases and retries. No tokens or IDs are changed. No shared Queue or Chat change. The booking snapshot is removed from the outbox on successful delivery; failed deliveries retain it for the existing retry policy.

Deployment prerequisite: apply and verify the scoped AppMetadataPrivate migration before deploying the new image. No business-data edits. The application continues accessing metadata using its privileged backend connection; direct public client table grants are restricted. Keep that security boundary even if application code is rolled back.

Validation: 393 backend unit tests passed before adding the security migration, isolated backing database booking HTTP tests passed 14 cases, including customer/admin requests and recipient scope. New migration and production-style grant verification passed with 35 migrations; post-migration E2E and CI must pass before rollout. Mocked transport verifies all four intended recipients receive the full details and snapshots are removed upon successful delivery. No production booking fixture or external test message.
## Production release - 2026-11-19

- Application source: 6c581ac1fc1d8e5a1c5a10a6a9a4720e1a5005b0.
- Backend Quality 44497508452 and Publish Backend Container 44497508020 succeeded. Isolated booking HTTP E2E: 15/15 after security migration.
- Pre-release public-schema backup: 995162 bytes, SHA256 d0560c44450375b6ec8a8708d768d162872af7e2f82918b248c532514b1d04be. Archive TOC and checksum verified; full restore not exercised.
- Migration job succeeded: 34 to 35 migrations, AppMetadataPrivate1795075200000, verified TLS, RLS enabled, anon/authenticated table access revoked. Backend metadata read verified.
- Deployment moc-maria-api rolled out image sha256:e4369f7c6ef25c1c3a4b712d3056381fbf5d4de05a8eff9ad3afc32c2ce21533. Pod moc-maria-api-554df885fb-knvrr ready, zero restarts at verification.
- Production GET /api/v1/health/live, /api/v1/health/ready, /api/v1/services, /api/v1/providers, /api/v1/provider-display returned HTTP 200.
- Previous application image sha256:ec1dd62169e1215bf9ba0e58a47a607f995ed66eb689935e7b4f738c3a9fd5ce remains the application rollback target; do not undo the private metadata security boundary.
- No real booking fixture, external test notification or historic resend. Actual Zalo receipt awaits a new genuine booking.

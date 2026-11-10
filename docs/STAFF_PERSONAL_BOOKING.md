# Personal booking for staff

The owner explicitly permits KTV and administrators to request services for themselves from another KTV. Previously both the frontend and API required `customer.portal`, disabling the button for staff-only accounts.

`canUsePersonalBooking` grants this narrow capability to active THERAPIST, DOCTOR_CONSULTANT, SUPER_ADMIN, ADMIN, BRANCH_MANAGER and RECEPTIONIST accounts, alongside existing customers with `customer.portal`. It is used only by appointment inquiry creation and customer-side chat opening. No database role assignments or general customer portal permissions are added; legacy booking APIs keep their existing authorization.

The authenticated actor remains the buyer. Caller-supplied customer identities are rejected. Existing self-booking/self-chat checks, participant-only access, cancellation ownership, rate limits, idempotency, transactions and privacy controls remain in force. The frontend exposes sent requests at `/lich-hen` and keeps incoming KTV work in the KTV workspace.

Zalo delivery uses the receiving provider identity, independent of the buyer's staff role. A request or inbound buyer message for Thanh Thanh goes to her dedicated bot and existing administrator channels. The buyer's own KTV bot and unrelated KTV bots do not receive it. Provider replies keep their existing routing.

Validation: 373 unit tests across 68 suites; format, lint, typecheck and build. The isolated PostgreSQL HTTP suite additionally covers staff/admin accounts without `customer.portal`, own identity, correct outboxes, chat creation, participant isolation, cancellation ownership, self-booking/self-chat rejection and identity injection. Fixture accounts/catalog data are confined to a disposable database; no synthetic production booking, chat or notification is sent.

Release uses the immutable main-built image with an image-only strategic deployment patch. Preserve all 47 runtime environment entries, including Thanh Thanh's token/provider/recipient/webhook Secret references, resources and RollingUpdate strategy. Do not apply the whole legacy manifest to the live deployment. Final release identifiers and checks are recorded in `deploy/staff-personal-booking-release.json`.

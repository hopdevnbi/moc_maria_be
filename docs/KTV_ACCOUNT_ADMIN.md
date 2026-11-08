# Super Admin KTV account maintenance

The management page `/quan-tri/ktv` contains an **Sửa** action for each
technician. Super Admin also sees **Tài khoản & bảo mật** in that panel and in
`/quan-tri/ktv/:applicationId`.

The application has no independent `username` column. Email and phone number
are login identifiers; `displayName` is the internal account label, separate
from the public KTV name and profile.

## Authenticated API

- `GET /api/v1/admin/provider-display/ktv/:applicationId/account`: read the
  KTV account without exposing the password hash.
- `PATCH /api/v1/admin/provider-display/ktv/:applicationId/account`: update
  any combination of `email`, `phone`, `displayName`, `password`,
  `mustChangePassword` (only with a new password).
- Only an authenticated `SUPER_ADMIN` with `staff.manage` can read or write.
  The target must remain a `THERAPIST` and cannot have a `SUPER_ADMIN` role.
- Email is normalized, validated and checked against other accounts. Phone
  numbers use existing Vietnamese normalization and collision checks.
- New passwords use the same Argon2id password-hashing policy as authentication.
  Passwords are never sent back to the client or stored in the audit metadata.
- Updates are atomic. On email, phone or password changes, all refresh sessions
  for that KTV are revoked; the access-token guard checks session revocation on
  every authenticated request. Display-name-only changes preserve sessions.
- The original `provider_applications.id` and `users.id` do not change,
  preserving existing schedules, chat threads, media, roles and history.

## Deployment and smoke checks

Deploy Backend before Frontend, and verify `/api/v1/health/ready`.
As Super Admin, open a KTV's **Sửa** panel to verify the account fields load,
then save a harmless display-name change and confirm the audit event. Do not
change real staff credentials for smoke testing.

Verify a regular Admin cannot read the account route (403), the Super Admin
cannot edit another Super Admin identity, and an invalid or duplicate email is
rejected without updating the account.

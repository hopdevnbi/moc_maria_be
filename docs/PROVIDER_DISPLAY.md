# Public provider display controls

GET `/provider-display` returns the display policy without private user data.
GET `/admin/provider-display`, PUT `/admin/provider-display/order` and PATCH
`/admin/provider-display/:id` require authenticated ADMIN/SUPER_ADMIN accounts
with `staff.manage`. Writes validate `expectedVersion`, acquire a transaction
advisory lock and persist the new policy with its audit log atomically.

The policy lives in `app_metadata` at `mocmaria.provider.display.v1`; no migration
is required. Missing configuration preserves existing catalog ordering. Only
public-display fields and visibility are changed. It never approves training,
changes booking eligibility, disables an identity or deletes business history.

Visibility states are VISIBLE, HIDDEN and ARCHIVED. Public hidden/archived entries
expose only their ID and `visible:false` so rendering cannot fall back to an old
published card. Public chat discovery applies this policy; existing conversations
retain their identities/history. Restoring an archive to HIDDEN is intentional.

QA includes actual isolated SQL transactions for persistent order, concurrent
version conflicts, exact provider membership, display info/audit, archive/restore
and retained chat history. Production acceptance uses read-only checks.

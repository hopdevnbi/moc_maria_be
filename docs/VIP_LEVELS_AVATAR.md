# VIP levels and avatar access

The existing `mocmaria.customer.vip.<userId>` record accepts optional `level`1–99.
Admin writes preserve the current level when omitted, default a historical VIP to1,
and clear the level when revoking membership. Level changes share the existing audit
transaction. Customer and admin responses expose the effective active level.

`POST /customers/me/avatar` now requires active VIP membership before uploading.
`updateCustomerAvatar` checks again under a transaction share lock on the user and
VIP metadata, serializing against admin VIP updates. Ordinary, expired and revoked
members cannot upload or persist a new avatar. Staff avatar behavior is unchanged.

The existing storage pipeline and generated URLs remain intact. Only Mộc Maria
storage env/Secret is provisioned. No migrations, shared Giang Xá changes or actual
customer profile writes are needed for this release.

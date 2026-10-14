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

Verification: merged-main local quality99 tests, TypeScript/lint/format/build PASS.
All4 new VIP/avatar SQL integration cases pass. The broader combined suite has6
existing fixture failures in review policy/publication and provider-display audit
counting; those runtime modules are preserved. CDN transport was tested with a
generated QA image: upload succeeded, public HEAD200/image-webp, QA object removed.

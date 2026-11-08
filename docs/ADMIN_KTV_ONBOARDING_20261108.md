# Super Admin — create new KTV and manage public media

## Scope

- `POST /api/v1/admin/provider-display/ktv` is restricted to active authenticated `SUPER_ADMIN` with `staff.manage` permission.
- Payload: `publicName`, optional `title`, `introduction`, `serviceArea`, and `serviceIds` (selected from the existing care menu).
- Response returns `providerId`, `userId`, public `alias`, generated internal `username`, **one-time** `temporaryPassword`, and `mustChangePassword=true`. Do not log or persist the temporary password outside the password hash in `users`.
- The transaction creates a unique `THERAPIST` identity, active staff profile, `APPLIED` provider application, and app_metadata entries for the seed-backed chat/display directory. The existing registry/catalog entries are preserved.
- The new KTV is not automatically certified, qualified for real booking, or assigned weekly shifts. The chat consultation entry is enabled. `provider-display` visibility can still be controlled by Admin.
- `GET /api/v1/admin/provider-display/ktv/capabilities` lets the web UI disable the creation control until the API rollout is live.
- Reuse `POST /api/v1/provider-showcase/:id/media` and `PATCH /api/v1/provider-showcase/:id` for media on Bunny CDN. The existing service verifies public-media consent, MIME, size, ownership, version and whitelist.
- `PATCH /api/v1/admin/provider-display/:id/avatar` accepts `{ mediaId }` only from an image **already saved in the same profile showcase**, then sets the account avatar and adds an audit record. Super Admin only.

## Operator release sequence

1. Wait for GitHub quality and GHCR image checks on the Backend main commit.
2. In the Mộc Maria Kubernetes cluster, deploy the reviewed image by its verified digest or corresponding `sha-<full commit>` tag to deployment `moc-maria-api`. Do not use the unrelated Motivate EKS context on the Windows workstation.
3. Check `/api/v1/health/ready`, create-ktv capability endpoint while authenticated, and check new KTV creation as SUPER_ADMIN, plus failures with regular ADMIN.
4. Deploy the paired Frontend main commit via Vercel Git integration. Ensure the admin create button becomes enabled and the previous 7 KTV receivers remain unchanged.
5. Super Admin creates Thanh Thanh using the existing details; because the public slug `ktv-thanh-thanh` is reserved for the owner-supplied introduction, it will map to the existing profile without duplicating its public card. Upload photo/video to the new provider ID via Admin and save before choosing an avatar.
6. Verify an 8-person public directory, correct services, no invented certification, new account login/change-password, and safe private chat ownership. Booking remains subject to business eligibility.

## Important boundaries

- No schema migration required. Existing `users`, `user_roles`, `staff_profiles`, `provider_applications` and `app_metadata` are used.
- Images and video should only be published with the rights of all people shown; the Admin UI requires an explicit consent checkbox.
- Do **not** overwrite the existing KTV account registry, reassign legacy aliases, or reset a password if an identity already exists. Creating a new user is not a replacement for an existing one.
- Do not claim a K8s rollout succeeded without observing rollout status and a matching live API build.

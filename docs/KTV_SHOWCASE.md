# KTV public showcase — Mộc Maria

The `/chuyen-vien/:slug` and `/chuyen-vien/:id` pages show the existing official KTV identity, services, rating, and booking/chat links, optionally enriched with an editable presentation.

## Editing and public privacy

- `GET /api/v1/provider-showcase/:applicationId` is public only for a provider shown by `ProviderDisplayService.publicDisplay`. Missing presentation returns a version-zero empty object.
- `GET /api/v1/provider-showcase/:applicationId/editor`, `PATCH /api/v1/provider-showcase/:applicationId` and `POST /api/v1/provider-showcase/:applicationId/media` require an access token. A `THERAPIST` or `DOCTOR_CONSULTANT` may edit only their own application. `SUPER_ADMIN` may edit any KTV application. The backend enforces both conditions independent of frontend controls.
- Presentation is versioned using `expectedVersion` and backed by existing PostgreSQL `app_metadata` (`mocmaria.ktv.showcase.v1.<applicationId>`). Changes and uploads have audit-log entries. No migration is necessary.
- Headline, long biography, 14 reference-hour ranges, a note, eight WebP pictures and one MP4 are customizable. Actual service eligibility, pricing, appointments, availability, ratings, and display visibility remain governed by their existing modules and **are never written by this endpoint**.
- Hours are strictly reference hours. No booking slot is created or confirmed by them.

## Bunny media

- Image upload: JPG, PNG or WebP up to 8 MB; Sharp validates dimensions and produces a compressed WebP up to 1600 px. Video: MP4 up to 40 MB. MP4 H.264/AAC is recommended for iOS Safari; the server does not transcode video.
- The API requires explicit `PUBLIC_PROFILE_MEDIA_V1` consent and stores a fresh random UUID under `moc-maria/provider-showcase/<applicationId>/` on Bunny Storage. Only assets with the exact expected CDN prefix/UUID and suffix can be added to presentation.
- Reuse existing production Secret `moc-maria-avatar-storage` (without duplicating credentials): `BUNNY_STORAGE_ZONE` -> `zone`, `BUNNY_STORAGE_REGION` -> `region`, `BUNNY_CDN_BASE_URL` -> `cdn`, `BUNNY_STORAGE_ACCESS_KEY` -> `access-key`. These mappings are already present on the API deployment as of 2026-11-04.
- The normal API ingress currently has an 8 MB request-body limit. Apply `deploy/k8s/provider-showcase-media-ingress.yaml` to allow 42 MB **only on `/api/v1/provider-showcase`**; ordinary routes keep their existing request-body limit.
- Uploading a file does not immediately publish it; the editor must save the profile. Removing media from the gallery unpublishes its link but deliberately does not erase the CDN object (retention/cleanup can be added separately).

## Release & verification

1. Run backend `npm run typecheck`, targeted ESLint, and Jest; run FE lint/typecheck/full tests/production build.
2. Push the backend `main` so GitHub Actions publishes `ghcr.io/hopdevnbi/moc_maria_be:sha-<commit>`.
3. Apply the dedicated media ingress to namespace `moc-maria`, deploy the reviewed image to `moc-maria-api`, wait for readiness, and verify an empty public presentation and authorization enforcement.
4. Push FE `main` to trigger its linked Vercel production project. Check `/chuyen-vien/nguyen-hoan` on Android/Chrome and iOS/Safari. As a logged-in KTV or SUPER_ADMIN, test a harmless text edit and an authorized test image/video, then clean up test entries.

The FE empty-gallery state is intentional: portrait, biography fallback, working-hours explanation and official services render without requiring any showcase media or reference schedule.

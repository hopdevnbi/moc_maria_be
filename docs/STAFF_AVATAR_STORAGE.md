# Staff Avatar CDN Configuration

POST /api/v1/staff/me/avatar is protected by staff.portal, transforms validated images to 384x384 WebP and saves them under moc-maria/staff-avatars/{userId}/{randomUUID}.webp.
GET /api/v1/staff/me returns avatarUploadEnabled based on available storage configuration. If missing, upload returns HTTP 503 and the frontend hides the action.

Use authorized Kubernetes Secret references for:
BUNNY_STORAGE_ZONE=giangxa-media
BUNNY_STORAGE_ACCESS_KEY or BUNNY_STORAGE_API_KEY
BUNNY_CDN_BASE_URL or BUNNY_STORAGE_CDN_URL=https://giangxa-media-cdn.b-cdn.net
BUNNY_STORAGE_REGION=sg (optional)

Automated movement of keys between applications was blocked by a safety mechanism; it was not completed. A qualified operator must configure the authorized Secret manually. Never paste secrets in Git, logs, or Chat.

No migration is necessary: the URL is stored in staff_profiles.avatar_url.

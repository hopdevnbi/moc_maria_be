# Bunny CDN setup for Mộc Maria

The Admin avatar endpoint already converts JPG/PNG/WebP uploads to 384x384 WebP and stores the resulting URL in staff_profiles.avatar_url. The API requires a dedicated Bunny Storage write key in the moc-maria namespace. Other service credentials must not be read or copied.

## Authorized operator steps

1. Copy scripts/configure-bunny-media.py to the VPS using your normal secure transfer workflow.
2. Start an interactive SSH session, then run:

    KUBECONFIG=/etc/kubernetes/admin.conf python3 configure-bunny-media.py --status
    KUBECONFIG=/etc/kubernetes/admin.conf python3 configure-bunny-media.py

3. Verify the target is moc-maria/moc-maria-api. Type CONFIGURE, then enter the dedicated authorized Bunny Storage write key at the hidden prompt. No key is included in shell arguments, Git or logs.
4. The script creates or updates Kubernetes Secret moc-maria-bunny-media, configures secretKeyRef environment variables, restarts the deployment and checks readiness without changing the image digest.
5. Log in as Admin at https://mocmaria.com/quan-tri/ho-so. Confirm the avatar upload control is available and test an authorized image. Check that the CDN URL loads, persisted avatar appears in the topbar, and API ready health is healthy.

Defaults: zone giangxa-media; CDN https://giangxa-media-cdn.b-cdn.net; region sg. Use flags --zone, --cdn and --region only if these values are different for the authorized Mộc Maria zone.

The script is not a key recovery method. It requires the operator to supply their own authorized Storage write key. Previously attempted automated transfer from an unrelated service was blocked and not performed.

## Images

Store optimized WebP variants on Bunny Storage. For service covers use small and large derivatives, responsive srcset/sizes and lazy loading. For avatar photos use the current 384px WebP and unique immutable object paths. Configure the Bunny Pull Zone caching policy so immutable URLs can be cached aggressively; never cache authenticated API responses publicly. Do not expose employee photos without the proper consent.

## Videos

Use a separately authorized Bunny Stream library for future video uploads and adaptive HLS playback. Include a poster image, controlled upload permissions, transcoding, appropriate stream caching and signed playback for private media. The existing avatar endpoint intentionally rejects videos; no video-upload UI or Bunny Stream integration is implemented by this setup script.

## Verification and rollback

Verify deployment image unchanged and pod READY, staff/me.avatarUploadEnabled is true, a test image uploads successfully, and the returned CDN URL serves WebP. If the write key fails, correct the dedicated Secret; do not loosen authentication or move credentials into frontend code. To disable uploads remove the Bunny Secret env references from the deployment and restart it, retaining other env vars. This script does not delete or overwrite existing avatar data.

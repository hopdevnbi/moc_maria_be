# Dashboard backend - production rollout gate (2026-10-17)

## What is ready

- Full backend CI passed for latest dashboard sources at `3ecda4c`; 188 unit tests PASS.
- GHCR immutable image contains the dashboard controller/service/module:
  `ghcr.io/hopdevnbi/moc_maria_be@sha256:c3d6bd2f36d15032d0ae7824e0ce36f713ea30b9249dfc3b684adaaf01f44a9e`
- Image build: [GitHub Actions 38986079801](https://github.com/hopdevnbi/moc_maria_be/actions/runs/38986079801) source `cecb09f`; commits after this image are only tests, docs, manifest / non-runtime formatting.
- API endpoints:
  - `GET /api/v1/admin/dashboard/overview?period=month&date=2026-10-17`
  - `GET /api/v1/admin/dashboard/providers/:id?period=month&date=2026-10-17`

## Current deployment state

The operator reported browser fetch `404` at `api.mocmaria.com`. Backend GitHub Actions **only publishes images**; it does not change Kubernetes deployments. Chat On Steroids tunnel to company computer is currently disconnected. Therefore this release is **prepared, not confirmed deployed**.

## Safe image-only rollout (run only through authenticated VPS terminal)

Important: production can contain environment changes (e.g. `GIFT_EVENTS_ENABLED=true`) that differ from the checked-in template. **Do not apply `deploy/k8s/api.yaml` wholesale**; only change the image on the existing deployment, preserving every environment variable, Kubernetes Secret and volume.

```bash
set -euo pipefail
K="kubectl --kubeconfig=/etc/kubernetes/admin.conf -n moc-maria"
OLD_IMAGE="$($K get deploy moc-maria-api -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].image}')"
printf 'Current image: %s\n' "$OLD_IMAGE"
$K set image deployment/moc-maria-api \
  api=ghcr.io/hopdevnbi/moc_maria_be@sha256:c3d6bd2f36d15032d0ae7824e0ce36f713ea30b9249dfc3b684adaaf01f44a9e
if ! $K rollout status deployment/moc-maria-api --timeout=180s; then
  $K rollout undo deployment/moc-maria-api
  $K rollout status deployment/moc-maria-api --timeout=180s
  exit 1
fi
$K get deploy moc-maria-api -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].image}'
printf '\n'
```

After rollout, verify:
```bash
curl --fail --max-time 15 https://api.mocmaria.com/api/v1/health/live
curl --fail --max-time 15 https://api.mocmaria.com/api/v1/health/ready
curl -sS -o /dev/null -w 'dashboard_without_token: %{http_code}\n' \
  'https://api.mocmaria.com/api/v1/admin/dashboard/overview?period=month&date=2026-10-17'
```

The dashboard endpoint without a bearer token must return 401 (or 403 if a preceding access policy denies the user), **not 404**. Then verify a genuine Super Admin's authenticated dashboard loads real data in browser and check API pod logs for SQL errors (without logging access tokens).

Dashboard code does not add migrations. Do not run database migrations solely for this release. If the previous image was working but the new API errors, revert only the API deployment with `kubectl rollout undo deployment/moc-maria-api` and investigate; do not change Mộc Maria, Giang Xá, Queue or Chat secrets.

## Do not mistake packaging for deployment

A GitHub `main` commit, successful backend unit tests, and GHCR digest **do not prove the production pod is running that image**. Record the deployed digest and the observed dashboard response after SSH access is available.

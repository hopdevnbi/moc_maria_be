# Mộc Maria - isolated Kubernetes staging manifests

These manifests are **not automatically deployed**. The image reference is an intentional placeholder.
Do not apply until the image exists, GHCR pull access is established and the secret is installed.

Deployment uses namespace `moc-maria`, without touching `giangxa` resources.
An ingress and ArgoCD Application are intentionally withheld until a dedicated DNS host,
TLS certificate and GitOps repository path are agreed and tested. Never reuse api.giangxa.com.

Required Kubernetes Secret `moc-maria-api-secrets` must be provisioned out-of-band
with `DATABASE_URL`, `JWT_ACCESS_SECRET`, `CORS_ORIGINS`,
`AUTH_COOKIE_SECURE=true` and any production-specific settings. Never commit actual values.

Before release: verify container registry access, resolve image to immutable digest,
validate DB TLS verification, run reviewed migrations as a one-off job, confirm DNS/TLS,
review resource pressure and backup/rollback procedure, then apply with explicit
`--kubeconfig=/etc/kubernetes/admin.conf`. Deployments do not run migrations automatically.

Rollback: `kubectl -n moc-maria rollout undo deployment/moc-maria-api`;
schema rollbacks require independent review, not an automatic downgrade.

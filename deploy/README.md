# Mộc Maria - isolated Kubernetes staging manifests

These manifests are manually deployed, with immutable image digests. Run backend quality and
the complete-application integration test before publishing each image. Verify GHCR pull,
the dedicated Secret, database TLS and valid HTTPS before applying the API Deployment.

Deployment uses namespace `moc-maria`, without touching `giangxa` resources.
The separate ingress hosts `api.mocmaria.com` using `letsencrypt-prod`; never reuse
api.giangxa.com. Cloudflare API A record uses DNS only, so HTTPS terminates at the verified
origin. Frontend apex/www records remain unchanged. Never use Cloudflare Flexible.
Automatic ArgoCD/GitOps is not configured.

Required Kubernetes Secret `moc-maria-api-secrets` must be provisioned out-of-band
with `DATABASE_URL`, strong `JWT_ACCESS_SECRET`, and an empty `AUTH_COOKIE_DOMAIN`
(host-only cookie). Transfer Secret input directly via encrypted SSH stdin; never use
command arguments or print credentials. Preserve JWT on subsequent releases.
The manifest sets exact apex/www CORS, secure cookies, disabled public Swagger and strict
PostgreSQL SSL. Never commit actual Secret values.

Create ConfigMap `moc-maria-database-ca` from the **public**
`certificates/supabase-ca.crt`, key `supabase.crt`. Download source is Supabase Database
Settings, documented at https://supabase.com/docs/guides/platform/ssl-enforcement.
`NODE_EXTRA_CA_CERTS` trusts that CA without disabling verification. Pod-scoped
`ndots: 1` avoids Alpine DNS search failures; CoreDNS and other namespaces are unchanged.
Run `k8s/database-preflight.yaml` (use a new Job name on repeat runs) and require
authorized TLS and reviewed migration status. All nine foundation migrations were applied
at the audit. Application startup does not apply migrations.

Before release: verify container registry access, resolve image to immutable digest,
validate DB TLS verification, run reviewed migrations as a one-off job, confirm DNS/TLS,
review resource pressure and backup/rollback procedure, then apply with explicit
`--kubeconfig=/etc/kubernetes/admin.conf`. Deployments do not run migrations automatically.

API probes cover `/api/v1/health/live` and `/api/v1/health/ready`. Deployment requests
100m CPU/192Mi RAM, limits 500m/512Mi, UID/GID 1000, dropped capabilities. Recreate
strategy fits the small VPS but entails a brief release outage. Inspect bounded, redacted logs.
Verify live/ready, public catalog, unauthenticated admin denial, CORS, rejected untrusted
cookie mutations and register/login/refresh/logout. Never log tokens/cookies/passwords.
Temporary smoke-test accounts must be removed by recorded IDs without publishing fixtures.

Only after API verification configure Vercel public API URL
`https://api.mocmaria.com/api/v1`, rebuild/deploy and verify browser requests.

Record the previous API digest and Vercel deployment ID before each release.
Rollback: `kubectl --kubeconfig=/etc/kubernetes/admin.conf -n moc-maria rollout undo deployment/moc-maria-api`;
then wait for rollout and verify health. Alternatively reapply the previous digest.
For a first release without a healthy previous revision, scale only this API to zero while
repairing it. Preserve Secret, DNS/TLS and all other namespaces. Revert Vercel to the prior
healthy deployment if FE integration fails. Take a dedicated DB backup before future
migrations; schema rollbacks require independent review, never an automatic downgrade.

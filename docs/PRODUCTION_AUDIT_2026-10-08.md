# Production and product audit — 2026-10-08

Scope: the user's production execution request, Phases 03–08 and the existing FE integration contract. Status describes verified behavior, not just source presence. The existing homepage design and Vietnamese fonts are retained while API integration is added.

| Module | Backend | Frontend | Database | Test | Production |
|---|---|---|---|---|---|
| Auth, JWT, refresh sessions, RBAC | DONE | DONE | DONE | DONE | DONE |
| Branches, hours, exceptions, resources | PARTIAL | PARTIAL | DONE | DONE | PARTIAL |
| Service categories, variants, branch pricing | PARTIAL | PARTIAL | DONE | DONE | PARTIAL |
| KTV applications and approval | PARTIAL | PARTIAL | DONE | DONE | PARTIAL |
| Training, assessment, internal certificates | PARTIAL | PARTIAL | DONE | DONE | PARTIAL |
| Public KTV directory | PARTIAL | PARTIAL | DONE | DONE | PARTIAL |
| Skills, schedules, service areas, eligibility | MISSING | MISSING | MISSING | MISSING | MISSING |
| Booking, availability, quotes, concurrency | MISSING | MISSING | MISSING | MISSING | MISSING |
| Direct tenant-isolated chat and reports | MISSING | MISSING | MISSING | MISSING | MISSING |
| Verified reviews, quality moderation, appeals | MISSING | MISSING | MISSING | MISSING | MISSING |
| Admin portal and audit evidence | PARTIAL | MISSING | PARTIAL | PARTIAL | MISSING |
| Independent media storage and uploads | MISSING | MISSING | MISSING | MISSING | MISSING |
| Dynamic catalog SEO and performance QA | PARTIAL | PARTIAL | PARTIAL | MISSING | MISSING |
| API domain, Kubernetes, HTTPS | DONE | IN PROGRESS | DONE | DONE | DONE |

## Verified infrastructure

- FE main at audit: `d27c1c0`; BE main: `3035816037f3a662d0ae5739660c0848256b1276`. Both checkouts clean. Dedicated backend branch `codex/production-integration`.
- SSH key access to the specified VPS works. Available RAM ~3.3 GiB, disk ~32 GiB. Existing ArgoCD, cert-manager and ingress-nginx healthy. Namespace `moc-maria` was empty; no changes to `giangxa`.
- Latest GHCR image build and quality CI succeeded. Anonymous containerd pull of the immutable image succeeds. Manifest pins its digest.
- Official Supabase root CA permits an authorized TLS 1.3 connection from this workstation. SQL `pg_stat_ssl` reflects the pooler's downstream connection, so client TLS was additionally checked on the actual Node TLS socket.
- All nine source migrations are present in the configured Supabase migration table. Counts of users, branches, services and provider applications are zero. No fabricated catalog or provider data will be published.
- Frontend apex and www DNS records already point to Vercel and must remain unchanged. The separate API A record and cert-manager ingress are verified and healthy.

## Remaining critical work

Public directory eligibility currently covers approval, public profile and certificate only. Skills, quality state, territory and schedule gates must be implemented before enabling booking. Service edit/detail and applicant-owned training/certificate reads are now implemented and integration tested. Catalog, branches/resources/hours, applications and training admin screens are implemented; the full booking/chat/reviews/media admin scope remains open. Existing unit tests do not prove booking, pricing or production integration.

Phases 03–08 remain open. Production infrastructure is prioritized explicitly by the user; it does not imply that Phase 03 or Phase 08 is complete.

Production infrastructure milestone: API healthy on verified HTTPS, dedicated database TLS, production auth smoke and fixture cleanup all PASS. Image/source SHA and release evidence are recorded in PROJECT_PROGRESS.md. Product phases remain incomplete.

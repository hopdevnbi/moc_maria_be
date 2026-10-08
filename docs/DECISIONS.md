# Technical Decisions

## TD-001 - Independent application ownership
Mộc Maria owns its own backend, frontend and PostgreSQL database. Acutis business modules and DB
are not runtime dependencies.

## TD-002 - PostgreSQL
Use PostgreSQL/TypeORM for booking concurrency and future multi-branch requirements.

## TD-003 - Shared services are contract dependencies
Chat and Queue are reused only through explicit service contracts. Chat needs tenant-aware changes
before Mộc Maria integration; Queue needs a source/versioned job contract before production events.

## TD-004 - Application identity
Use MOC_MARIA consistently as APP_ID, CHAT_TENANT and QUEUE_SOURCE.

## TD-005 - Deployment deferred
Local coding and validation come first. Vercel/VPS/domain production work is Phase 08.

## TD-006 - KTV marketplace is essential MVP scope
Independent KTV applications, Mộc Maria training, practical assessment, in-house
certification, eligibility approval, transparent home-service pricing and direct
prebooking chat are core requirements, not optional future enhancements.
Internal certification is not a legal practice licence; regulated services require
additional verification. See `docs/KTV_MARKETPLACE_REQUIREMENTS.md`.

# Phase 2 acceptance

## Implemented

- Hono API and PostgreSQL event store.
- Workspace-scoped hashed bearer key authentication and explicit key provisioning.
- Batch ingestion, duplicate retries, and conflict detection with PostgreSQL transaction lock.
- Rate-aware cost engine integration and persisted cost status.
- TypeScript SDK over HTTP; remote non-HTTPS endpoints rejected.
- API and SDK tests with injected memory store.

## Still required before public deployment

- Live PostgreSQL migration and transaction/concurrency integration tests.
- Rate limiting, HTTPS reverse proxy, key rotation, audit logging and operational safeguards.
- Strict money/timestamp validation at DB boundary; provider pricing provenance.
- PostgreSQL least-privilege runtime role and backup plan.
- Dependencies and security scanning review.
- No public GitHub release until explicit final approval after all gates.

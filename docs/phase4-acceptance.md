# Phase 4 — security and database verification

## Verified

- Both migration scripts execute on an embedded PostgreSQL engine (PGlite).
- SQL analytics query returns scoped customer values with no cross-workspace leakage in the test fixture.
- Unique event constraint and key revocation columns behave as expected in embedded PostgreSQL.
- Per-process rate limiter test covers limits and window resets.
- Authenticated ingestion and analytics endpoints share a workspace rate-limit bucket.
- Key issuance prints a revocation UUID; explicit revoke CLI sets `revoked_at`.
- Typecheck and automated tests pass. Dependency audit and basic secret scan should be rerun before release.

## Unverified release blockers

- The `node-postgres` connection pool and transactions against a standalone PostgreSQL server.
- Concurrent retry behavior on independent database connections and processes.
- API key rotation against a running database with live clients.
- Strong isolation via PostgreSQL RLS or an independently verified least-privilege DB role.
- External-facing gateway rate limits, TLS, logging, backups, monitoring and a complete threat review.
- Live OpenAI provider integration, dashboard browser smoke test and large-data pagination.

PGlite is a real PostgreSQL engine compiled to WASM, but its concurrency model differs from a standalone PostgreSQL server. A passing embedded SQL test is not equivalent to passing production network/concurrency tests.

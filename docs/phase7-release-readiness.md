# Phase 7 — release gate preparation

## Completed

- Added `npm run test:postgres`: opt-in standalone PostgreSQL concurrency test with an exact `agentmargin_ci` database-name guard and empty public-schema check.
- The test covers 20 concurrent same-ID inserts, conflicting payload rejection and workspace isolation.
- Extended TypeScript typecheck coverage to apps, packages, and scripts. Corrected one previously untyped test fixture.
- Added core and API protection against estimated event costs larger than PostgreSQL BIGINT supports.
- Verified all runnable tests and dependency auditing on current source.

## Environment blocker

- A PostgreSQL 18.4 standalone binary was acquired into a temporary directory. Starting its cluster requires a non-root operating-system user. The current sandbox disallows switching process UID/group; it cannot run the standalone database without expanding operating-system permissions. The temporary binary files were removed after this check.
- No production, personal, or external database was accessed.

## Still blocked

1. Run `npm run test:postgres` against a dedicated disposable PostgreSQL server; validate concurrency independently from PGlite.
2. Perform real browser visual/accessibility smoke tests, beyond passing DOM tests.
3. Verify gateway/TLS, abuse protection, backup/restore, monitoring and key management for deployment.
4. Repeat secret, dependency, license, and build checks before explicit publication approval.

## Decision

**NO-GO** for GitHub publication and public service deployment under the owner's instruction to complete security checks first.

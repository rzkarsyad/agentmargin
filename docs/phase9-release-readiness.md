# Phase 9 — self-hosted MVP release candidate audit

## Implemented since v0.8

- Deterministic advisory-lock acquisition order for event batches.
- Standalone PostgreSQL test extended to competing reverse-order batches.
- Authenticated, transactional revenue ingestion with idempotency (migration 003).
- End-to-end revenue ingestion tests through the PostgreSQL-compatible socket.
- Prepared CI with a disposable PostgreSQL 16 service.

## Verified locally

- TypeScript typecheck and locally executable tests.
- Embedded PostgreSQL migrations and tenant-filtered analytics.
- Network adapter via PGlite socket, revenue retry/conflict behavior.

## Unverified release gates

- The GitHub Actions workflow has not run on GitHub.
- Standalone PostgreSQL server concurrency test has not run in this environment.
- Real-browser smoke/accessibility testing, final license and secret scanning.

## Decision

**HOLD** until pending gates are actually verified.

# Phase 1 acceptance and release gates

## Included

1. Deterministic cost calculation, historical model pricing, cached token classes.
2. Provider-reported cost prioritization.
3. Revenue/AI contribution per customer and period.
4. Cost completeness indicators and safe handling of zero revenue.
5. PostgreSQL schema with tenant-scoped keys and event uniqueness.
6. Unit tests and basic developer docs.

## Deferred

- Authenticated ingestion API, network boundaries and persistence integration.
- OpenAI adapter and automatically captured provider costs.
- Live dashboard, Stripe sync, forecasting and alerts.
- Migrations runner, RLS, operational backups and deployments.

## Verification before public release

- `npm run check` passes.
- PostgreSQL migration tested against clean local PostgreSQL.
- No secrets or private files in source or git history.
- Dependency audit and SAST performed; any findings reviewed.
- API authentication, tenant isolation and idempotency integration tests pass once API exists.
- README claims match implemented capabilities.

Phase 1 passing unit tests is **not** sufficient authority to publish a public production-ready app.

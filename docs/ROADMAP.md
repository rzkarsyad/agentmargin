# AgentMargin — Roadmap and release gates

**Vision:** give builders trustworthy, attributable customer-level AI inference and revenue economics—not just a total token bill.

**Latest tagged release:** [v0.3.0-alpha](https://github.com/rzkarsyad/agentmargin/releases/tag/v0.3.0-alpha).
**Current main branch:** contains later experimental source commits (v0.4–v0.6 foundations) that are **not** tagged as npm/production/stable releases.

## Delivered and released

| Version | What shipped | Evidence |
| --- | --- | --- |
| v0.1 alpha | Exact cost engine, tenant-scoped ingestion, idempotent usage/revenue records, baseline PostgreSQL tests | [Release](https://github.com/rzkarsyad/agentmargin/releases/tag/v0.1.0-alpha) |
| v0.2 alpha | One-command local demo, OpenAI usage helpers, unknown-cost diagnostics, live local E2E | [Release](https://github.com/rzkarsyad/agentmargin/releases/tag/v0.2.0-alpha) |
| v0.3 alpha | Workspace pricing with effective dates/immutable history, React+Arc compact dark dashboard, local integration testing | [Release](https://github.com/rzkarsyad/agentmargin/releases/tag/v0.3.0-alpha) |

## Implementation and verification status

### v0.4 — developer adoption foundation (PR #5 merged)

- [x] Build compiled SDK ESM + TypeScript declarations and verify npm tarball contents.
- [x] Build a runnable Next.js App Router demo that can send synthetic usage/revenue; optional server-side OpenAI request.
- [x] Document security and onboarding, verify Next.js production build and dependency audit in CI.
- [x] Build **opt-in**, operator-reviewed LiteLLM community pricing import with exact units, provenance digest and source note.
- [x] Add a **weekly, read-only provider pricing candidate scan** and review artifact; not automatic price application or invoice reconciliation.
- [x] **First public SDK release:** `@makinohq/agentmargin@0.4.0-alpha.1` published to npm under the `alpha` tag; npm GitHub Actions Trusted Publisher configured by the owner. [Gate #8](https://github.com/rzkarsyad/agentmargin/issues/8).
- [x] **OIDC publication:** `0.4.0-alpha.2` published successfully by [Actions run 39898669098](https://github.com/rzkarsyad/agentmargin/actions/runs/39898669098). Registry artifact/provenance inspection and clean external consumer checks remain separate evidence.
- [ ] Validate installation/integration with **three independent developers**; [feedback issue #1](https://github.com/rzkarsyad/agentmargin/issues/1).

**Important:** catalog import is not an unattended official provider feed. An operator must review and explicitly apply the rates. Official invoice reconciliation is not shipped.

### v0.5 — analytics accuracy foundation (PR #6 merged)

- [x] Server-computed, whole-workspace exact financial totals with clear unknown-cost semantics.
- [x] Tenant-scoped customer **keyset pagination**, 1–100 results per page, with a consistent snapshot within each API call.
- [x] Update dashboard to use whole-workspace KPIs instead of summing a truncated table.
- [x] Test more than 125 customer records, cursor boundaries and cross-workspace totals in PostgreSQL.
- [ ] Audit live provider invoice variances/tiered usage and verify real business accounting semantics.
- [ ] Decide pricing-catalog update approval policy before allowing unattended provider imports.

### v0.6 — integrations foundation (PR #7 merged)

- [x] Post-call Anthropic Messages adapter; safely rejects unsupported cache-creation billing tiers.
- [x] Signed Stripe USD `invoice.paid` conversion to idempotent AgentMargin revenue records (local test receiver), with signature/timestamp and boundary tests.
- [ ] **Live Stripe sandbox, refund/credit/currency reconciliation**, durable retries and multi-account mapping. [Gate #9](https://github.com/rzkarsyad/agentmargin/issues/9).
- [ ] Expand provider coverage based on real integrations requested, not speculative adapters.

## Next: v0.7–v0.9 — production hardening (NOT DONE)

The following work is **mandatory before** any production internet deployment. Track detailed evidence and acceptance checks in [Security & reliability gate #10](https://github.com/rzkarsyad/agentmargin/issues/10).

- **v0.7:** independent tenant threat model; PostgreSQL least-privilege role/RLS assessment; authenticated gateway, TLS, unauthenticated and distributed abuse controls. A [preliminary tenant threat model](TENANT_THREAT_MODEL.md), [runtime role grant template](DB_RUNTIME_ROLE.md), [workspace key roles and expiry](KEY_PERMISSIONS.md), and disposable CI permission tests exist; **independent review**, managed key rotation, deployment-specific application remain unverified. [Credential-backed RLS](DB_RUNTIME_ROLE.md) is implemented as a review candidate, with direct PostgreSQL 16 SQL tests; independent review remains open.
- **v0.8:** monitored, encrypted backups and **restore drills**; privacy lifecycle, export/deletion policy, structured redacted logging, alerts, incident handling. A [synthetic PostgreSQL 16 backup/restore CI drill](BACKUP_RESTORE.md) and [opt-in redacted request telemetry](OBSERVABILITY.md) are implemented; real scheduled backups, encryption/retention, restore timing, alerting, and operational monitoring remain **unverified**.
- **v0.9:** pricing/provider bill reconciliation, refunds and revenue adjustments, data migrations with rollback tests, resilience/load and recovery scenarios.

## Status matrix (implemented ≠ externally verified ≠ production-ready)

| Stage | Implemented and automated evidence | Externally verified | Production-ready |
| --- | --- | --- | --- |
| v0.4 | ESM/declarations, package contents, Next.js starter, onboarding | OIDC publication run succeeded; three independent developers and registry consumer/provenance checks remain open | No |
| v0.5 | Exact workspace totals, pagination, effective pricing, unknown-cost diagnostics | Real provider invoice/tier validation and pricing approval policy open | No |
| v0.6 | OpenAI/Anthropic helpers, signed USD invoice conversion and duplicate tests | Stripe sandbox, credits/refunds, multi-account/currency evidence open | No |
| v0.7 | Credential-backed tenant RLS migration, SQL denial, key expiry/revocation, pool reuse and migration recovery tests | Independent security review and deployment-specific least privilege/TLS/abuse validation open | No |
| v0.8 | Encrypted backup hook/restore CI drill, privacy-safe classified telemetry, readiness, private Prometheus metrics, graceful shutdown, DB operation time bounds | Scheduled encrypted external backups, measured RPO/RTO, alerts and incident drills open | No |
| v0.9 | Ingestion concurrency/idempotency and atomic isolation migration failure/retry tests | Provider/revenue reconciliation, adjustments and failure/load evidence open | No |
| v1.0 | Release gates tracked below | No independent release approval | No |

## v1.0 — stable release (NOT DONE)

Only tag v1.0 when all of these **external and technical** gates have independent evidence:
1. Real developers have installed and exercised the core integration loop without maintainer help.
2. Public SDK registry artifact is verified, released with provenance, and API contracts/version compatibility documented.
3. Tenant security, authentication, data governance and platform abuse controls independently reviewed.
4. Backup restore, migration recovery, telemetry, privacy/export/delete and incident response procedures proven by drills.
5. Provider-billed costs and received/reconciled revenue match documented accounting rules.

**Not now:** hosted SaaS promises, AI-based margin predictions, role-based enterprise dashboards, unsupported provider tiers, or production claims from synthetic CI data alone.

## Getting involved

Try the [local demo](DEMO.md), review [pricing import](PRICING_IMPORT.md), [analytics API](ANALYTICS_PAGINATION.md) and [integrations](INTEGRATIONS.md). Report what broke in [issue #1](https://github.com/rzkarsyad/agentmargin/issues/1). Real developer friction determines priority.

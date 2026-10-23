# AgentMargin — Roadmap and release gates

**Vision:** give builders trustworthy, attributable customer-level AI inference and revenue economics—not just a total token bill.

**Latest tagged release:** [v0.3.0-alpha](https://github.com/rzkarsyad/agentmargin/releases/tag/v0.3.0-alpha).
**Current source status:** SDK `0.4.0-alpha.2` is a published prerelease. The v0.7–v0.9 continuation below is a stack of unmerged review candidates; no stable or production release is claimed.

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
- [x] **OIDC publication:** `0.4.0-alpha.2` published successfully by [Actions run 39898669098](https://github.com/rzkarsyad/agentmargin/actions/runs/39898669098). Clean registry artifact consumption and integrity/provenance metadata inspection passed; [Cryptographic verification passed in CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39908019043). See [consumer evidence](V04_DEV_ADOPTION.md).
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
| v0.4 | ESM/declarations, package contents, Next.js starter, onboarding | OIDC publication run succeeded; clean registry ESM/TypeScript consumer passed; registry signatures and one SDK provenance attestation verified in CI; three independent developers remain open | No |
| v0.5 | Exact workspace totals, pagination, effective pricing, unknown-cost diagnostics | Real provider invoice/tier validation and pricing approval policy open | No |
| v0.6 | OpenAI/Anthropic helpers, signed USD invoice conversion and duplicate tests | Stripe sandbox, credits/refunds, multi-account/currency evidence open | No |
| v0.7 | Credential-backed tenant RLS migration, SQL denial, key expiry/revocation, pool reuse and migration recovery tests | Independent security review and deployment-specific least privilege/TLS/abuse validation open | No |
| v0.8 | Encrypted backup hook/restore CI drill, privacy-safe classified telemetry, readiness, private Prometheus metrics, graceful shutdown, DB operation time bounds | Scheduled encrypted external backups, measured RPO/RTO, alerts and incident drills open | No |
| v0.9 | Offline traceable cost/revenue reconciliation, signed credits/refunds in reports, exact tolerances/cached-token diagnostics, durable report replay, normalized Stripe inbox/atomic replay candidate, ingestion concurrency/rollback/connection-recovery smoke and atomic migration failure/retry tests | Real billing imports, deployed webhook/account validation, persisted adjustment ingestion, provider/accountant review and production-scale load evidence open | No |
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

## Engineering continuation evidence (2026-10-23)

These are **stacked, unmerged review candidates**, in dependency order. No production deployment, database change, npm publication or stable tag was performed. PRs #22 and #23 were confirmed merged, and `main` was fetched at `bea396246af6495081f6bc596501c6af28750ff5` before implementation. The existing dashboard design is preserved.

| PR | Implementation commit | Change and evidence |
| --- | --- | --- |
| [#24](https://github.com/rzkarsyad/agentmargin/pull/24) | `f172040` | Credential-backed tenant RLS, migration 007, protected key table, scoped transactions and SQL denial/upgrade tests; [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39906262771) |
| [#25](https://github.com/rzkarsyad/agentmargin/pull/25) | `80647c8` | Readiness, metrics, draining lifecycle, encrypted backup hooks and recovery/alert runbooks; [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39906820150) |
| [#26](https://github.com/rzkarsyad/agentmargin/pull/26) | `5f32075` | Traceable offline reconciliation, durable reports, rollback/connection recovery and bounded concurrency; [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39907388283) |
| [#27](https://github.com/rzkarsyad/agentmargin/pull/27) | `e2d93cf` | Registry consumer/provenance check and SDK integration edge fixes; local checks passed; [registry signatures/provenance and Next.js CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39908019043); [full CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39908018981) must be checked on the final commit |

Local verification on the combined source passed `npm run check` (57 passed, one pre-existing TODO), SDK package checks, root and starter dependency audits (zero vulnerabilities), Next.js production build, PostgreSQL 16 security/upgrade/recovery/concurrency tests, encrypted backup restore/failure drill, real server SIGTERM lifecycle, source scan and diff checks. The earlier PR CI runs additionally passed desktop/mobile Chromium and the full synthetic Docker/API/SDK/browser demo. These are synthetic engineering results, not independent security or production validation.

Only schema migration **007** was added. It is additive and does not rewrite financial rows. Pause traffic, apply after 006 as trusted owner, reapply runtime grants, and deploy the matching API together. Old restricted API binaries are incompatible with the new authentication grants. SDK method signatures stay compatible; stricter invalid-input validation and Stripe payment-time replay considerations are documented in [integrations](INTEGRATIONS.md). No unpublished source fix is claimed to exist in the alpha.2 registry artifact.

## Remaining release gates and required evidence

| Gate | What still clears it |
| --- | --- |
| Independent tenant/security review | A reviewer other than the implementer reproduces direct SELECT/INSERT, forged context and pooling tests, audits definer ownership/effective grants/extensions, and signs off the deployment's threat boundaries |
| Runtime deployment and abuse controls | Verified TLS/trusted ingress, separately provisioned non-owner credentials, shared gateway/atomic distributed quota infrastructure, multi-process failure/load tests and secret rotation evidence |
| Recovery and monitoring | Actual encryption/storage hooks and independent key recovery; scheduled external backups and retention; delivered alerts; timed, production-scale isolated restores with agreed RPO/RTO and incident ownership |
| Financial integrations | Authentic official billing imports and source attribution; provider invoice/cached-tier comparisons; Stripe sandbox payments/refunds/credits and out-of-order replay; explicit accounting/FX/multi-account policies and reviewed variance reports |
| Remaining financial engineering | A separate durable normalized Stripe delivery candidate is implemented and tested synthetically; deployed/sandbox validation and persistent signed revenue adjustments remain **unfinished**; offline reports alone do not clear this gate |
| Data governance | Approved export/deletion/retention policy, backup expiry and privacy erasure procedure, with synthetic implementation tests and independent operator/privacy approval |
| Developer adoption | Three real independent developers complete installation/integration and record feedback; automated clean npm consumption does not count as three developers |
| Release integrity | Registry cryptographic verification passed (two registry signatures, one SDK attestation); current CI and independent review on final commits plus explicit authorization are still required for later npm publication or a stable tag |

## Reproducing locally with disposable infrastructure

Requires Node 24 (minimum 22.18), npm and Docker. The checkout command uses the top review branch; do not merge security changes before review.

```bash
git clone https://github.com/rzkarsyad/agentmargin.git
cd agentmargin
git fetch origin main test/registry-consumer-and-integration-edges
git switch --track origin/test/registry-consumer-and-integration-edges
npm ci
npm run check
npm audit --audit-level=low
node scripts/sdk-registry-consumer-smoke.mjs
# Requires access to npm's cryptographic verification/trust-data endpoints:
node scripts/sdk-registry-consumer-smoke.mjs --verify-signatures

docker run --rm -d --name agentmargin-local-ci \
  -e POSTGRES_DB=agentmargin_ci -e POSTGRES_USER=agentmargin_ci \
  -e POSTGRES_PASSWORD=ci-only-disposable -p 127.0.0.1:55432:5432 postgres:16
docker exec agentmargin-local-ci pg_isready -U agentmargin_ci -d agentmargin_ci
export AGENTMARGIN_STANDALONE_DATABASE_URL='postgresql://agentmargin_ci:ci-only-disposable@127.0.0.1:55432/agentmargin_ci'
# Must start empty; this applies migrations 001–008 and populates fictional data.
npm run test:postgres
node --experimental-strip-types scripts/server-lifecycle-test.ts
node --experimental-strip-types scripts/reconcile.ts \
  examples/reconciliation/synthetic-costs.json /tmp/agentmargin-private-reports

npm --prefix examples/nextjs-starter install --no-audit --no-fund
npm --prefix examples/nextjs-starter run build
npm --prefix examples/nextjs-starter audit --audit-level=high
python3 scripts/check-release-files.py
docker stop agentmargin-local-ci
```

For an already-cloned clean checkout, use `git fetch origin` then switch to the review branch; preserve any uncommitted work. Wait for `pg_isready` success before running the suite. To repeat PostgreSQL tests, create a new disposable container/database; the suite intentionally refuses a nonempty database. The CI-only rotation/restore/backup scripts additionally enforce their GitHub/synthetic guard and port 5432; use the existing CI workflow for those complete drills. Browser scripts require Python Playwright 1.56.0 and Chromium, as provisioned in CI. Optional provider calls are excluded from these commands.

For a manually administered disposable database, the exact ordered schema and runtime-grant commands are in [database isolation](DB_RUNTIME_ROLE.md). Backup hook setup, retention and isolated recovery commands are in [backup/restore](BACKUP_RESTORE.md); monitoring and response examples are in [observability](OBSERVABILITY.md).


## Preliminary integration-readiness review — 2026-10-23

**No merge is authorized.** The implementer's review is preliminary and does not replace an independent security review. The stack is still **#24 → #25 → #26 → #27**, with no recorded independent review approvals at the start of this audit. All four original heads had passing GitHub CI. Fixes are committed on their owning branches and propagated by merge commits; no branch history is rewritten.

| Finding | Owning PR / action | Residual risk |
| --- | --- | --- |
| Runtime grants relied on manual detection of elevated roles, ownership, memberships and effective CREATE/mutation privileges | #24: transactional guard rejects unsupported authority; real PostgreSQL tests exercise rejection | Extensions/other definer functions and deployment credentials still require independent review |
| Migration 007 could wait indefinitely on active writers | #24: bounded lock/statement waits, contention rollback/retry test | Operator staging timing and explicit migration approval remain required |
| Readiness could report 200 with schema 006 or disabled RLS | #25: migration-contract checks; pre-007 and disabled-RLS tests | Readiness is not certification of arbitrary policies/grants |
| String allocation IDs were normalized before shape validation | #26: reject malformed JSON and excess allocations before copying; reject negative estimated inference costs | Authentic provider evidence and accounting review remain external gates |
| Possible surviving column grant | Tested and **not reproduced** on PostgreSQL 16; REVOKE ALL removed the tested grant | Do not describe a rejected hypothesis as a proven vulnerability |
| In-flight revocation under hostile repeatable-read snapshots | Explicitly documented in #24 security design | **Open review gate:** a continuously active hostile transaction is not hard-bounded by statement/idle timeouts; session containment or stronger identity isolation may be required |

SQL reads/writes remain parameterized; SECURITY DEFINER functions use pg_catalog and fully qualified tables. Adversarial tests cover shadow key tables, forged credentials, function replacement, RLS disabling, cross-tenant writes/reads and pool reuse. No tested cross-tenant bypass was found for a correctly provisioned runtime password alone. This is bounded automated evidence, not independent assurance or approval.

After security migration/residual findings receive **explicit approval**, merge #24 first, then retarget #25 to main and rerun checks; repeat for #26 and #27. Keep parent branches until dependents are retargeted. The exact staging rollout is in [database isolation](DB_RUNTIME_ROLE.md): pause/drain traffic, apply 007 after 006, validate runtime grants, deploy matching API, verify schema readiness and synthetic tenant operations, then resume only under the approved plan. Never broaden grants to make an older API work.

### Next engineering backlog

1. **Durable Stripe delivery:** persist only verified/normalized invoice evidence before acknowledgment; transactionally replay into revenue with row claims, exact-payload deduplication, bounded retries, dead-letter visibility and synthetic crash/concurrency tests. Real Stripe sandbox/account routing and delivery monitoring remain external gates.
2. **Persisted financial adjustments:** append-only signed credits/refunds/adjustments linked to original payment/provider evidence; define effective dates, correction/reversal policy and multi-account/currency rules before including them in dashboard revenue. Preserve old positive-only records and require clean/upgrade/RLS/replay tests.
3. **Reconciliation accuracy:** authentic provider billing importers, allocation completeness, credit attribution, cached tier coverage, explicit FX provenance and batch-versus-line tolerance policy. Keep unknown and unmatched data incomplete; do not silently replace estimates.
4. **Release operations:** independent security review; deployed shared abuse controls; actual storage/key recovery/retention; timed restore and alert drills; privacy export/deletion policy; three independent developer trials. Synthetic CI does not clear these gates.


A separate `feat/durable-revenue-deliveries` candidate now implements backlog item 1's local foundation: migration 008, tenant-scoped committed enqueue, atomic idempotent replay, eight-attempt backoff/dead letters, aggregate backlog reporting and signed synthetic receiver E2E. It follows #27 and does not change the required #24 → #25 → #26 → #27 order or authorize a merge. Review its schema/state-update grants separately. Persisted financial adjustments, real Stripe sandbox/account mapping, official billing imports and all independent/operational release gates remain open.


| Reviewed candidate | Current reviewed head | Latest audit CI evidence |
| --- | --- | --- |
| #24 | `403f066` | [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39910305923) |
| #25 | `a2e645f` | [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39910535006) |
| #26 | `260219e` | [CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39910770329) |
| #27 | `609dc94` | [Full CI passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39910883628), [starter/registry verification passed](https://github.com/rzkarsyad/agentmargin/actions/runs/39910883631) |
| [#28](https://github.com/rzkarsyad/agentmargin/pull/28) | Separate durable-delivery candidate | Local checks passed (58 tests plus one pre-existing TODO, PostgreSQL 16, signed local receiver, migration/role/retry/race tests); [current PR checks](https://github.com/rzkarsyad/agentmargin/pull/28/checks) must pass on its final reviewed head |

Passing CI is technical evidence only. No reviewer approval has been inferred from CI or this preliminary audit; all candidates remain blocked from merge until the requested security/critical-finding review and explicit approval.

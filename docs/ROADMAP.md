# AgentMargin release dashboard

Authoritative status as of 2026-10-23. **Engineering complete, integrated, externally
verified, released and production-ready are separate claims.** This candidate is
not yet integrated or released. No production action, tag or npm publication occurred.

Latest platform tag: `v0.3.0-alpha`. Published npm SDK:
[`@makinohq/agentmargin@0.4.0-alpha.2`](https://www.npmjs.com/package/@makinohq/agentmargin/v/0.4.0-alpha.2),
[OIDC publication](https://github.com/rzkarsyad/agentmargin/actions/runs/39898669098).
Prepared versions: platform `v0.9.0-alpha.1`, SDK `0.5.0-alpha.1` (additive SDK
methods; platform and SDK milestones deliberately differ). Neither is published.

## Milestone matrix

| Milestone | Implementation | Integration | Test evidence | External verification | Security | Release gate / exact next action |
| --- | --- | --- | --- | --- | --- | --- |
| v0.4 developer adoption | Complete foundation | Existing SDK/starter on main; source additions PR only | Published ESM/TypeScript consumer, signatures/provenance and Next.js CI [39953502998](https://github.com/rzkarsyad/agentmargin/actions/runs/39953502998) | Alpha.2 OIDC/registry verified; independent users pending | Release integrity review open for candidate | Foundation passed; three real developer trials remain a **v1.0 adoption gate**, not a sole blocker for v0.9 engineering |
| v0.5 analytics/pricing | Complete for supported USD/token contract | Baseline on main; net adjustments PR only | Whole-workspace/pagination/effective pricing/unknown costs; [#32 CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39941973060) | Official provider bills and accountant review pending | Candidate review open | Blocked: supply authentic exports, approved allocations/prices and accounting policy |
| v0.6 integrations | Partial validation | Original adapters on main; durable/current-schema fixes PR only | SDK/signature/schema fixtures; [#35 original CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39959864754) | Moland **test-mode unpaid $15 invoice / $0 paid verified**; paid/refund/credit/signed CLI path pending | Account/routing review open | Blocked: supported CLI test credentials/listener or equivalent tooling for unavailable payment/credit APIs |
| v0.7 security | Implemented candidate boundary; residual powers remain | PR only | PostgreSQL 16 007–014 attacks, RLS, scopes, pooling; [013 CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39965876033) | **No independent security approval** | Catalog error oracle fixed in 013; cursor/in-flight and inbox authority open | Blocked: independently review/accept boundary and migrations, approve protected PRs |
| v0.8 reliability/privacy | Partial deployment validation | PR only | Encrypted/full restores, key rotation, readiness, lifecycle and bounded concurrency CI; disposable privacy/restart follow-up in release candidate | External storage/key recovery, delivered alerts, scale/RPO/RTO and privacy approval pending | Operations review open | Blocked: deployment-specific storage, ingress/shared quotas, scheduled drills and operator sign-off |
| v0.9 financial engineering | Supported ledger/replay/net reports implemented; genuine QA incomplete | PR only | Exact $128−$117.25=$10.75 synthetic fixture across ledger/API/reconciliation/browser; immutable recovery tests | Authentic Stripe paid/refund/credit, official provider billing and policy approval pending | Independent SQL/accounting approval open | Blocked: clear external evidence and merge gates, validate final main commit, authorize alpha publication |

**Production-ready: No for every candidate stage.** Unsupported FX, mixed/prepayment
credits, cache-creation billing tiers, positive reinstatements and full dispute
lifecycles are explicit unsupported/incomplete cases, not completed features.
The [accounting policy](ACCOUNTING_POLICY.md) states the supported financial basis.

## Integration matrix and exact order

All PRs were rechecked open/unmerged with no review approvals. Main remains
`bea396246af6495081f6bc596501c6af28750ff5`. Latest known checks for the original stack:

| PR | Head | Depends on | Latest verified CI |
| --- | --- | --- | --- |
| #24 | `403f066` | main | [39910305923](https://github.com/rzkarsyad/agentmargin/actions/runs/39910305923) passed |
| #25 | `a2e645f` | #24 | [39910535006](https://github.com/rzkarsyad/agentmargin/actions/runs/39910535006) passed |
| #26 | `260219e` | #25 | [39910770329](https://github.com/rzkarsyad/agentmargin/actions/runs/39910770329) passed |
| #27 | `609dc94` | #26 | [39910883628](https://github.com/rzkarsyad/agentmargin/actions/runs/39910883628) passed |
| #28 | `162baa6` | #27 | [39912463047](https://github.com/rzkarsyad/agentmargin/actions/runs/39912463047) passed |
| #29 | `e690cba` | #28 | [39938145062](https://github.com/rzkarsyad/agentmargin/actions/runs/39938145062) passed |
| #30 | `9852d15` | #29 | [39938962610](https://github.com/rzkarsyad/agentmargin/actions/runs/39938962610) passed |
| #31 | `45395eb` | #30 | [39940014653](https://github.com/rzkarsyad/agentmargin/actions/runs/39940014653) passed |
| #32 | `e80792d` | #31 | [39941973060](https://github.com/rzkarsyad/agentmargin/actions/runs/39941973060) passed |
| #33 | `ec81227` | main, independent | [39953503015](https://github.com/rzkarsyad/agentmargin/actions/runs/39953503015) CI, [39953503022](https://github.com/rzkarsyad/agentmargin/actions/runs/39953503022) CodeQL/stack compatibility passed |
| #34 | `eff636a` | #32 | [Earlier full checkpoint](https://github.com/rzkarsyad/agentmargin/actions/runs/39969459723) passed; [current checks](https://github.com/rzkarsyad/agentmargin/pull/34/checks) cover restore ACL and redaction follow-ups |
| #35 | `3852f84` | #34 | [Earlier full checkpoint](https://github.com/rzkarsyad/agentmargin/actions/runs/39969544723) and [starter](https://github.com/rzkarsyad/agentmargin/actions/runs/39969544383) passed; [current checks](https://github.com/rzkarsyad/agentmargin/pull/35/checks) cover propagated ACL/redaction |
| #36 release preparation | release branch | #35 | [Complete rehearsal checkpoint](https://github.com/rzkarsyad/agentmargin/actions/runs/39969944175) passed (73 pass + existing TODO); [unfiltered CodeQL checkpoint](https://github.com/rzkarsyad/agentmargin/actions/runs/39970382041) has 103 rules / 1 retained hash finding. Current [final-head checks](https://github.com/rzkarsyad/agentmargin/pull/36/checks) must pass after each update |

**Preferred approved merge order:** #33 first, then **#24 → #25 → #26 → #27 →
#28 → #29 → #30 → #31 → #32 → #34 → #35 → #36**. #33 is independent and its
changes are merged once in an isolated rehearsal, not duplicated into stack PRs.
Retain parent branches. After each approved parent merge, retarget its immediate
child to main, merge updated main into the child without rewriting reviewed history,
resolve/review any conflicts, rerun final-head checks and obtain the required review.
Do not batch-merge the chain or deploy intermediate security migrations.

[Protect main](https://github.com/rzkarsyad/agentmargin/rules/25719548) is **active**:
PR, one approval, stale-review dismissal, resolved conversations, up-to-date `test`
from GitHub Actions, no force push/deletion, no bypass actors. Earlier notes that
protection was disabled are superseded. No settings were weakened. Passing CI is
not approval. No independent reviewer or publication authorization is recorded.

## Security findings and review package

- **Confirmed catalog-shadow error oracle:** implicit pg_temp-first lookup let
  forged temporary pg_roles/pg_class bypass BEFORE-trigger ownership guards and
  distinguish a hidden payment by validation errors. RLS still prevented the final
  cross-tenant INSERT. Additive 013 explicitly qualifies catalog references and
  sets pg_catalog,pg_temp paths. PostgreSQL 16 reproduces the baseline error and
  requires the same session to receive 42501 after remediation. 012 is unchanged.
- **Revocation:** 009 rejects REPEATABLE READ/SERIALIZABLE authentication. Existing
  READ COMMITTED cursor/in-flight statements retain their admitted snapshot.
  Statement/idle timeouts do not set an absolute transaction lifetime. Separately
  authorized role NOLOGIN/session termination is a shared-role incident action.
- **Runtime+ingest compromise:** bulk financial SELECT is denied, but own-tenant
  inbox payload/state, pricing/source metadata and narrow digest/allowance oracles
  remain. Independent reviewers must accept this or require separate enqueue/worker
  identities and reviewed procedures. A tenant GUC is never claimed as a boundary.
- **CodeQL:** #33 removes the two regex patterns with unchanged fallback bytes/CSP
  and structural React children. Full unfiltered reference analysis ran 103 rules:
  base 3 findings, patch 1 (SHA-256 fixture paths). Generated bearer keys have 256
  random bits; human-password KDF advice does not apply to those paths. No hashing,
  key compatibility, RLS or revocation semantics changed. No suppression/dismissal.
  Main #1/#2 await approved integration/rescan; #3 needs authorized false-positive
  triage. Full-stack scanning also found seven filesystem race checks; bounded
  descriptor reads and canonical private directories removed all seven. The
  remaining full-stack result includes operator bearer-key environment paths,
  documented with the fixture paths in PREAUTH_SECURITY.md. Stored alerts/Dependabot endpoints are unavailable to the connector;
  current authoritative alert state is **not verified**.

Reviewer package: [threat model and checklist](TENANT_THREAT_MODEL.md),
[role/grant/deployment model](DB_RUNTIME_ROLE.md), [CodeQL paths](PREAUTH_SECURITY.md),
`db/007…013`, `db/runtime_privileges.psql`, and guarded PostgreSQL tests.
Automated implementer evidence does not replace independent human review.

Migration 014 additionally prevents direct runtime failed/delivered-state resets:
normal workers may only advance pending attempts and preserve retry cycles/backoff;
reviewed admin recovery is the required reset path. Ingest and admin bearer keys
cannot bypass it through direct runtime SQL. Original 012/013 files are unchanged.
The trusted owner and pending-state worker completion authority remain separate
review boundaries; no independent approval is inferred.

## Financial QA evidence and remaining cases

| Scenario | Expected | Observed evidence | Status |
| --- | --- | --- | --- |
| Genuine Moland unpaid invoice | $15 due, $0 paid | Newly created run `agentmargin-qa-v09-20261023-001`; account/false mode checked before every write; exact invoice readback open/1500/0 | Provider observation verified; signed pipeline not verified |
| Genuine $29/$99 paid, $6.25/$99 refunds, $12 credit | $128 gross, $117.25 reductions, $10.75 net | Connector lacks payment-method attach, invoice pay and credit-note create; no CLI test credential/listener available | **Not run**, no invented figures |
| Synthetic supported lifecycle | Same exact amounts | Signed synthetic input, PostgreSQL ledger/API/reconciliation and desktop/mobile assertions | Automated evidence only |
| Duplicate/out-of-order/crash/scope loss | One economic effect or atomic rollback | PostgreSQL concurrency/backoff/savepoint/credential-change tests | Automated evidence only |
| EUR/mixed credits/reinstatement/cache-creation tier | Explicit unsupported/FX/incomplete | Parser/reconciliation regressions | External accounting/tier evidence pending |

The connected account was confirmed test-only; only new labeled customer, product,
price, item and unpaid invoice were created. No existing customer reads, unrelated
modifications, deletes, paid-out-of-band simulation or live operations. Private API
evidence is kept outside Git. Real event API-version/signature evidence remains
unavailable. Sanitized invoice alias:
`sha256:bec9af311407eabdc0e1bfe4ad983b83a68e75abc3a1c59befd1aea153698825`;
private evidence bundle digest:
`70011557a5137cda2e70b4bb043c3908c61e3e2e3261aa6cac2f318af4735193`.
The tool schema is `2026-09-30.preview`; it does not reveal the actual event API
version, so no event-version verification is claimed. [Harness and secure setup](INTEGRATIONS.md) describe the exact CLI path.

Official OpenAI/Anthropic exports and trusted pricing provenance are not supplied.
The existing reconciliation input interface accepts explicit provider/account,
period, source references, allocations, signed credits and tolerances; unknown FX,
unsupported tiers and unmatched evidence keep complete variance unknown. Run
`scripts/reconcile.ts` on reviewed normalized inputs. A generic JSON interface is
not claimed to validate an authentic provider invoice. Do not auto-apply unverified
prices or convert currency without evidence.

## Disposable verification commands

Node 24 (minimum 22.18), npm, Docker and Python Playwright/Chromium for browser tests:

```sh
git clone https://github.com/rzkarsyad/agentmargin.git
cd agentmargin
git fetch origin main release/v0.9.0-alpha.1 fix/codeql-alert-audit
git switch --track origin/release/v0.9.0-alpha.1
npm ci
npm run check
npm audit --audit-level=low
node scripts/sdk-registry-consumer-smoke.mjs --verify-signatures
npm --prefix examples/nextjs-starter install --no-audit --no-fund
npm --prefix examples/nextjs-starter run build
npm --prefix examples/nextjs-starter audit --audit-level=high

docker run --rm -d --name agentmargin-v09-ci \
  -e POSTGRES_DB=agentmargin_ci -e POSTGRES_USER=agentmargin_ci \
  -e POSTGRES_PASSWORD=ci-only-disposable -p 127.0.0.1:55432:5432 postgres:16
# Wait for success before continuing:
docker exec agentmargin-v09-ci pg_isready -U agentmargin_ci -d agentmargin_ci
export AGENTMARGIN_STANDALONE_DATABASE_URL='postgresql://agentmargin_ci:ci-only-disposable@127.0.0.1:55432/agentmargin_ci'
npm run test:postgres
node --experimental-strip-types scripts/stripe-delivery-local-test.ts
node --experimental-strip-types scripts/server-lifecycle-test.ts
node --experimental-strip-types scripts/reconcile.ts examples/reconciliation/synthetic-costs.json /tmp/agentmargin-private-reports
python3 scripts/check-release-files.py
docker stop agentmargin-v09-ci
```

The PostgreSQL suite requires an **empty** loopback database literally named
agentmargin_ci. It tests clean installation, pre-007 and successive upgrades,
013 failure/retry and the catalog oracle before/after; never run it on live data.
Use a new container to repeat. Full GitHub CI additionally runs guarded restart,
rotation/restore/backup and Docker/browser scenarios. Local CI-only scripts require
their documented service identity/guards; do not spoof them on non-CI databases.

For a separate empty disposable development DB, provision its trusted owner and
non-owner LOGIN NOINHERIT runtime, then apply every migration in numeric order:

```sh
for migration in db/[0-9][0-9][0-9]_*.sql; do
  psql "$AGENTMARGIN_DEV_ADMIN_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
psql "$AGENTMARGIN_DEV_ADMIN_URL" -X -v ON_ERROR_STOP=1 \
  -v runtime_role=agentmargin_dev_runtime -f db/runtime_privileges.psql
```

Existing schemas: apply only unapplied migrations; never replay 001 or edit stored
checksums. Drain API/receivers/workers, verify isolated restore, apply 007–014 as
trusted migrator, reapply final grants and deploy matching API/worker/receiver.
Old RR analytics, broader grants and old schema/API pairs are incompatible. Readiness
fails closed before 014. Preserve original payments and review legacy account-source
mappings against evidence; no automatic guessed backfill. On failure: rollback,
investigate/retry or restore a new isolated DB; no destructive down-migration.

## Release package and external gates

At the completed rehearsal checkpoint, 73 tests passed plus one pre-existing TODO;
PostgreSQL 16 catalog/RLS/recovery/privacy/financial regressions passed. The synthetic
DB restart recovered in 434 ms; full dump/restore took 1 second on the small fixture.
These are sample drill observations, not RPO/RTO guarantees or representative load.
Root/starter audits reported zero vulnerabilities; actual shared gateway/storage/
alert delivery remain external gates.

The all-language checkpoint [39971847379](https://github.com/rzkarsyad/agentmargin/actions/runs/39971847379)
ran JavaScript 103 queries (one retained hash finding), Python 50 (zero), and Actions
23 (zero), all unfiltered. Final source changes require their own checks. Restore
follow-ups quarantine default PUBLIC definer grants recreated by `--no-acl` and
probe restored RLS, guard settings and financial/source-account integrity; reapply
runtime privileges before any restored application access.

The read-only `v09-validation.yml` rehearses #33 plus the whole stack, runs full CI,
registry/starter and unfiltered CodeQL, then prepares source/SDK tarballs, exact
commit/tree, migration SHA-256 hashes, npm integrity and a clean external consumer.
It publishes no release. See [draft notes](releases/v0.9.0-alpha.1.md),
[accounting policy](ACCOUNTING_POLICY.md), [privacy lifecycle](PRIVACY_LIFECYCLE.md),
[backup/recovery](BACKUP_RESTORE.md) and [observability](OBSERVABILITY.md).

Remaining release actions, in order:

1. Independent security review/acceptance of 007–014, residual authority and CodeQL
   triage; founder/accountant approval of recorded-revenue/credit/cross-period policy.
2. Supply sandbox-scoped CLI/API access for real signed paid/refund/credit delivery;
   execute the harness and corroborate reports with authentic provider exports.
3. Approve and integrate the protected PR sequence. Re-run all checks and default
   CodeQL on **final main**, resolve critical regressions, regenerate artifacts from
   that exact commit; rehearsal commit evidence alone is insufficient.
4. Explicitly authorize the platform alpha tag, SDK alpha tag and publication.
   Verify npm-publish environment review/Trusted Publisher config. The workflow now
   requires main ancestry and passing final-commit Actions test. Use OIDC only.
5. Perform authorized publication and verify exact GitHub/npm URLs, version,
   integrity/provenance and clean consumer. No publication has occurred here.

Deployment-specific TLS/shared abuse controls, scheduled encrypted external backups,
separate key recovery, delivered alerts, scale/RPO/RTO and approved financial-data
retention/erasure remain production gates. Three independent developers remain a
v1.0 adoption gate. No production certification or v1.0 completion is implied.

# AgentMargin release dashboard

Authoritative status as of 2026-10-24 (Asia/Jakarta). **Engineering complete, integrated, externally
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
| v0.5 analytics/pricing | Supported contract plus private CSV validation and actual SDK/API/PG replay implemented | Baseline on main; billing follow-up stacked after #36 | Exact event rounding, effective prices, unknown costs, duplicates, pagination and tenant boundaries; synthetic replay in CI | **Conditional PASS: authentic OpenAI 25/13/0 export, 9 micros estimated = 9 billed, zero variance**; organization-level only | Candidate review open | INCONCLUSIVE: historical price authority, project/key billing allocation, original response identity, wider tier/cache/product coverage and financial policy sign-off |
| v0.6 integrations | Supported USD platform-account flow implemented and sandbox-validated | Original adapters on main; durable/current-schema fixes PR only | SDK/signature/current+legacy nullable allocation regressions; restricted PostgreSQL signed-delivery tests | **PASS: operator-verified Moland signed recovery**, eight receipts / seven accepted / EUR rejected; [aggregate evidence](INTEGRATIONS.md#genuine-sandbox-qa-harness-and-recovery) | Independent account/routing and CodeQL review open | Signed sandbox acceptance passed; account-bound integration review and approved protected integration remain. FX/mixed/multi-account extensions are not claimed |
| v0.7 security | Implemented candidate boundary; residual powers remain | PR only | PostgreSQL 16 007–014 attacks, RLS, scopes, pooling; [013 CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39965876033) | **No independent security approval** | Catalog error oracle fixed in 013; cursor/in-flight and inbox authority open | Blocked: independently review/accept boundary and migrations, approve protected PRs |
| v0.8 reliability/privacy | Partial deployment validation | PR only | Encrypted/full restores, key rotation, readiness, lifecycle and bounded concurrency CI; disposable privacy/restart follow-up in release candidate | External storage/key recovery, delivered alerts, scale/RPO/RTO and privacy approval pending | Operations review open | Blocked: deployment-specific storage, ingress/shared quotas, scheduled drills and operator sign-off |
| v0.9 financial engineering | Supported ledger/replay/net reports implemented; genuine signed Stripe QA passed | PR only | Exact ledger/API/reconciliation/browser fixture, nullable allocation rejection and immutable recovery tests | **PASS: operator-verified $128 gross − $105.25 refunds − $12 credits = $10.75 net; $0 variance**. Independent official billing and policy approval pending | Independent SQL/accounting approval open | Blocked: independent billing/policy evidence, security/review and integration gates; validate final main/artifacts and authorize alpha publication |

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
| #35 | latest nullable-allocation candidate | #34 | [Recovery checkpoint CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39993391943) and [starter](https://github.com/rzkarsyad/agentmargin/actions/runs/39993391993) passed; [current checks](https://github.com/rzkarsyad/agentmargin/pull/35/checks) must cover the nullable-field follow-up |
| #36 release preparation | release branch | #35 | [Recovery rehearsal checkpoint](https://github.com/rzkarsyad/agentmargin/actions/runs/39993427654) passed (78 pass + existing TODO; unfiltered JS 103 / 3 retained findings, Python 50 / 0, Actions 23 / 0). [Final-head checks](https://github.com/rzkarsyad/agentmargin/pull/36/checks) must pass after the nullable-field/evidence update |

**Preferred approved merge order:** #33 first, then **#24 → #25 → #26 → #27 →
#28 → #29 → #30 → #31 → #32 → #34 → #35 → #36 → OpenAI billing follow-up**. #33 is independent and its
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
  current authoritative alert state is **not verified**. The latest recovery rehearsal also retains harness HTTP-route and private verified-receipt candidates; their bounded/authenticated data-flow assessments are in INTEGRATIONS.md and still require independent review. No exclusions or dismissals are used.

Reviewer package: [threat model and checklist](TENANT_THREAT_MODEL.md),
[role/grant/deployment model](DB_RUNTIME_ROLE.md), [CodeQL paths](PREAUTH_SECURITY.md),
`db/007…014`, `db/runtime_privileges.psql`, and guarded PostgreSQL tests.
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
| Genuine signed Moland recovery (operator Mac run, reported 2026-10-24 Asia/Jakarta) | Eight signed events; seven accepted financial events; one EUR rejection | All eight receipts signature-verified, full pagination, existing fixtures replayed without new transactions | **PASS, operator-verified external sandbox evidence** |
| Genuine USD financial totals | Gross $128.00; refunds $105.25; credits $12.00; net $10.75; variance $0.00 | Exact expected/actual results reported by operator; final `kind: stripe_sandbox_qa`, `status: pass`, `actualMicros: 10750000`, `varianceMicros: 0` | **PASS for the supported USD/platform-account acceptance scope** |
| Nullable Stripe allocation | `out_of_band_amount: null` means no out-of-band allocation | Explicit null only becomes zero; required money/mixed allocations remain strict; current/legacy and restricted-PG regression | Implemented; [current CI](https://github.com/rzkarsyad/agentmargin/pull/35/checks) verifies the committed follow-up |
| Duplicate/out-of-order/crash/scope loss | One economic effect or atomic rollback | PostgreSQL concurrency/backoff/savepoint/credential-change tests and signed synthetic harness | Automated evidence; no new claim of an externally observed crash |
| EUR/mixed credits/reinstatement/cache-creation tier | Explicit unsupported/FX/incomplete | Genuine EUR rejection verified; other unsupported cases covered by parser/reconciliation regressions | Rejection is expected; no FX or unsupported feature implementation claimed |

The successful Mac run supersedes the earlier connector-only unpaid-invoice and
webhook-delivery failure checkpoints. The operator retains private receipts and
financial evidence. This repository records the supplied aggregate attestation,
not raw events, object/customer identifiers, secrets or private evidence paths.
The implementing agent did not independently inspect those files or repeat the
external run. No additional Stripe transactions were created for this follow-up.
See the [integration evidence and recovery contract](INTEGRATIONS.md#genuine-sandbox-qa-harness-and-recovery).
Genuine sandbox success is distinct from independent provider billing, accounting
approval, security approval, deployment validation and publication authorization.

Authentic OpenAI Usage/Cost exports are now locally inspected with a conditional
9-micro production-engine/SDK/API/PostgreSQL match and zero variance. The charge is
organization-level; historical rate authority, project/key allocation and original
response identity remain inconclusive. [OpenAI evidence](OPENAI_INTEGRATION.md#private-openai-billing-validation-v05)
records current official pricing observations and private reproducibility commands.
Anthropic and broader OpenAI tier/cache/product/adjustment evidence remain missing.
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
2. Corroborate the now-passing genuine signed Moland recovery with independently
   obtained provider billing exports and approved allocations/recognition policies.
   The operator verified all eight signed events, seven financial acceptances and
   expected EUR rejection, with $10.75 net and zero variance. Do not create another
   transaction run merely to record this result; private evidence stays private.
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


Stripe QA recovery follow-up (#35 propagated to #36): run-scoped discovery fully
paginates events; API retrieval never counts as delivery. Recovery forbids
financial writes and uses CLI v1.55.1 `events resend` without an endpoint flag,
requesting fresh signed HTTP delivery to the login-authenticated loopback listener.
Both key and login account are checked; listener/resend exclude STRIPE_API_KEY.
Private verified receipts persist before ACK; allowlisted diagnostics distinguish
forwarding, signatures, fixture matching, normalization and API failures. Exact
invoice currency and the official Refund resource's missing livemode field are
handled explicitly. The operator has now passed the genuine signed Mac recovery
with the exact $128 − $105.25 − $12 = $10.75 flow and zero variance. A separate
fictional-CLI/restricted-PG16 regression uses the observed nullable optional field
and continues to verify rejected/missing forwarding and financial consistency.
Only explicit null for out_of_band_amount is normalized; signed inputs and all
other allocation checks are preserved.
Independent security/accounting review, approved integration, provider exports
and explicit release authorization remain required.

## Remaining v0.5–v0.9 alpha acceptance blockers

A source/SDK alpha can document a restricted supported contract; it cannot turn
missing required evidence into a pass. The matrix above still distinguishes tested
implementation, operator external evidence, approved integration and production
readiness. No criterion is weakened by the successful Stripe run.

| Stage | Passed within supported alpha scope | Evidence/action still needed for all-green status |
| --- | --- | --- |
| v0.5 | Exact USD/event rounding, pagination/effective pricing/unknown reporting; authentic OpenAI 25/13/0 -> 9 micros persisted/analytics = 9 org-billed, variance 0 | Historical rate authority, project/key billing allocation, original response identity, cached/tier/product/other-provider coverage and founder/accountant policy sign-off; no automatic unverified price import |
| v0.6 | Genuine signed single-platform USD invoice/refund/pure balance-credit recovery; explicit EUR rejection; adapter regressions | Independent account/routing/schema review and protected integration. Multi-account/FX/mixed/reinstatement support requires separate evidence if included; it remains explicitly unsupported in this alpha |
| v0.7 | Credential-backed RLS and 007–014 adversarial/upgrade tests | Independent security approval of migrations, ownership/grants, cursor/in-flight revocation and runtime+ingest/inbox authority; CodeQL triage and required PR approvals |
| v0.8 | Disposable encrypted/full restores, restart/pool recovery, metrics/readiness/shutdown, privacy and failure drills | Operator-owned external storage/key recovery, scheduled retention/restore and delivered alert evidence, agreed measured RPO/RTO/load, incident/privacy approval. Deployed TLS/shared quotas remain deployment gates; a source-only alpha must explicitly retain them |
| v0.9 | Append-only ledger/replay/reconciliation plus genuine $10.75 net / zero-variance Stripe acceptance | Independent provider/Stripe billing corroboration and accounting approval; inherited security/operations gates; approved stack integration, final-main CI/CodeQL/artifact verification and explicit alpha tag/publication authorization |

Unsupported features are not marked implemented, and production remains unapproved.
Three independent developer trials remain the separate v1.0 adoption gate.

## v0.5 acceptance evidence — 2026-10-24 Asia/Jakarta

The existing production cost engine already rounded correctly; no calculation,
authentication, SDK API, schema, RLS, migration or UI changes were needed. The
billing follow-up branches from `release/v0.9.0-alpha.1` after #36; no inherited PR
is rewritten or merged. Stripe's genuine QA is unchanged and was not repeated.

| Acceptance gate | Current result | Evidence / remaining action |
| --- | --- | --- |
| Original export ingestion and precision | PASS | Authentic files read-only; 31 buckets / 30 blank each, exact decimal quantities/money, SHA-256/row/byte references in private local report |
| Exact model / current official standard text rates | PASS, current observation | Official model/pricing pages observed 2026-10-23 UTC; $0.10 input / $0.50 output / $0.01 cached per million; no community-rate substitution |
| Historical rate effective date / account modifiers | INCONCLUSIVE | Obtain dated official notice/provider attestation for the sample instant and account/region; QA window is explicitly conditional |
| Actual production event rounding | PASS, conditional rates | 25 input × 0.1 + 13 output × 0.5 = 2.5 + 6.5 = 9 micros; one round, not separate 10-micro rounding |
| SDK / HTTP / restricted PostgreSQL / analytics | PASS, local aggregate replay | Cost 9, immutable price UUID, duplicate replay, late unknown retention, customer pagination/workspace totals, auth and tenant checks; no original response ID is invented |
| Official export amount consistency | PASS, organization only | Actual 9 estimated vs exact 9 USD-micro charge; variance 0; does not establish project or API-key allocation |
| Project/key billing allocation | INCONCLUSIVE | Export populated billing dimensions or obtain official allocation evidence; amount agreement alone is insufficient |
| Original response-to-event identity | INCONCLUSIVE | Original ID/time not supplied; optional separately authorized future capture/SDK replay cannot retroactively identify it |
| Effective/unknown/cache/tier/batch/duplicates/history regressions | PASS, automated | Exact decimals, cache rate/missing cache, effective boundaries, community disagreement, unsupported dimensions, missing lines, duplicate rows, UTC/scoped variance; no guessed tiers/FX |
| Genuine cached/other supported provider coverage | INCONCLUSIVE | Collect authentic scoped usage/billing evidence for the intended alpha support matrix, including cached reads and other providers; explicitly unsupported tiers remain rejected |
| Full billing products/adjustments/period coverage | INCONCLUSIVE | Review provider export completeness, account/regional/product charges and signed credit/discount allocation; blank rows are not proof no activity was missed |
| Founder/accountant financial policy approval | INCONCLUSIVE | Dated approval of event half-up rounding, recorded-USD cost attribution, prepaid balances, adjustments, coverage and tolerances |
| Reviewed integration / final release / production | Pending; production NO | Required independent security/accounting review, protected stack approvals, final-main CI/CodeQL/artifacts and separate release authorization |

**v0.5 is not fully green.** No external evidence or human approval is manufactured.
The [operator README](OPENAI_INTEGRATION.md#macos-read-only-audit-no-provider-key-or-spending)
provides exact safe macOS commands and a separately guarded future paid experiment.
The CSV tool's overall status deliberately stays INCONCLUSIVE for external gates;
it is an audit aid, not an automated accounting certification.

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
| v0.5 analytics/pricing | Supported contract plus private CSV validation and actual SDK/API/PG replay implemented | Baseline on main; billing follow-up stacked after #36 | Exact event rounding, effective prices, unknown costs, duplicates, pagination and tenant boundaries; synthetic replay in CI | **Operator PASS: second genuine 10/5/0 request, identity preserved, local cost 4 micros; org delta 3.5**. Reported total 13 vs 12.5, +0.5 event-rounding variance; org allocation unproven | Candidate review open | INCONCLUSIVE: historical price authority, project/key billing allocation, wider tier/cache/product coverage, rounding materiality and financial policy sign-off |
| v0.6 integrations | Supported USD platform-account flow implemented and sandbox-validated | Original adapters on main; durable/current-schema fixes PR only | SDK/signature/current+legacy nullable allocation regressions; restricted PostgreSQL signed-delivery tests | **PASS: operator-verified Moland signed recovery**, eight receipts / seven accepted / EUR rejected; [aggregate evidence](INTEGRATIONS.md#genuine-sandbox-qa-harness-and-recovery) | Independent account/routing and CodeQL review open | Signed sandbox acceptance passed; account-bound integration review and approved protected integration remain. FX/mixed/multi-account extensions are not claimed |
| v0.7 security | Implemented candidate boundary; residual powers remain | PR only | PostgreSQL 16 007–014 attacks, RLS, scopes, pooling; [013 CI](https://github.com/rzkarsyad/agentmargin/actions/runs/39965876033) | **No independent security approval** | Catalog error oracle fixed in 013; cursor/in-flight and inbox authority open | Blocked: independently review/accept boundary and migrations, approve protected PRs |
| v0.8 reliability/privacy | Tested source and Mac local rehearsal; deployment validation pending | PR only | Encrypted/full restores, key rotation, readiness, lifecycle and bounded concurrency CI; disposable privacy/restart tests | **PASS, founder/operator-attested Mac synthetic recovery: default and orbstack**. External storage/key custody, delivered alerts, scale/RPO/RTO and privacy approval pending | Operations review open; no independent security approval | BLOCKED: deployment-specific storage, ingress/shared quotas, scheduled drills and operator sign-off |
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
| #37 OpenAI billing evidence | `feat/openai-billing-evidence` | #36 | [Current source/combined/CodeQL checks](https://github.com/rzkarsyad/agentmargin/pull/37/checks); authentic private export replay passed locally, overall external gates INCONCLUSIVE |

**Preferred approved merge order:** #33 first, then **#24 → #25 → #26 → #27 →
#28 → #29 → #30 → #31 → #32 → #34 → #35 → #36 → #37**. #33 is independent and its
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
organization-level; historical rate authority and project/key allocation remain inconclusive. The founder
subsequently verified second-response identity and local cost 4, versus org billing
delta 3.5; reported aggregate 13 vs 12.5 has +0.5 event-rounding variance. New
before/after files and receipt remain founder-held, not independently inspected. [OpenAI evidence](OPENAI_INTEGRATION.md#private-openai-billing-validation-v05)
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
| v0.5 | Exact USD/event rounding, pagination/effective pricing/unknown reporting; first authentic 25/13/0 -> 9/9 micros; operator second 10/5/0 -> 4 ledger vs 3.5 org delta, aggregate 13/12.5 with +0.5 rounding variance | Historical rate authority, project/key billing allocation, cached/tier/product/other-provider coverage, rounding materiality and founder/accountant policy sign-off; no automatic unverified price import |
| v0.6 | Genuine signed single-platform USD invoice/refund/pure balance-credit recovery; explicit EUR rejection; adapter regressions | Independent account/routing/schema review and protected integration. Multi-account/FX/mixed/reinstatement support requires separate evidence if included; it remains explicitly unsupported in this alpha |
| v0.7 | Credential-backed RLS and 007–014 adversarial/upgrade tests | Independent security approval of migrations, ownership/grants, cursor/in-flight revocation and runtime+ingest/inbox authority; CodeQL triage and required PR approvals |
| v0.8 | Disposable encrypted/full restores, restart/pool recovery, metrics/readiness/shutdown, privacy and failure drills | Operator-owned external storage/key recovery, scheduled retention/restore and delivered alert evidence, agreed measured RPO/RTO/load, incident/privacy approval. Deployed TLS/shared quotas remain deployment gates; a source-only alpha must explicitly retain them |
| v0.9 | Append-only ledger/replay/reconciliation plus genuine $10.75 net / zero-variance Stripe acceptance | Independent provider/Stripe billing corroboration and accounting approval; inherited security/operations gates; approved stack integration, final-main CI/CodeQL/artifact verification and explicit alpha tag/publication authorization |

Unsupported features are not marked implemented, and production remains unapproved.
Three independent developer trials remain the separate v1.0 adoption gate.

## v0.5 acceptance evidence — 2026-10-24 Asia/Jakarta

The existing production cost engine already rounded correctly; no calculation,
authentication, SDK API, schema, RLS, migration or UI changes were needed. The
[#37 billing follow-up](https://github.com/rzkarsyad/agentmargin/pull/37) branches from `release/v0.9.0-alpha.1` after #36; no inherited PR
is rewritten or merged. Stripe's genuine QA is unchanged and was not repeated.

| Acceptance gate | Current result | Evidence / remaining action |
| --- | --- | --- |
| Original export ingestion and precision | PASS | Authentic files read-only; 31 buckets / 30 blank each, exact decimal quantities/money, SHA-256/row/byte references in private local report |
| Exact model / current official standard text rates | PASS, current observation | Official model/pricing pages observed 2026-10-23 UTC; $0.10 input / $0.50 output / $0.01 cached per million; no community-rate substitution |
| Historical rate effective date / account modifiers | INCONCLUSIVE | Obtain dated official notice/provider attestation for the sample instant and account/region; QA window is explicitly conditional |
| Actual production event rounding | PASS, conditional rates | First 2.5 + 6.5 = 9; second 1 + 2.5 = 3.5 rounds to 4. Actual restricted-PG synthetic two-event replay stores/aggregates 13; ledger policy unchanged |
| SDK / HTTP / restricted PostgreSQL / analytics | PASS, local aggregate replay | Cost 9, immutable price UUID, duplicate replay, late unknown retention, customer pagination/workspace totals, auth and tenant checks; no original response ID is invented |
| Official export amount consistency | Conditional precision PASS; ledger acceptance INCONCLUSIVE | First 9/9; operator after 12.5 exact token estimate/provider vs 13 reported ledger, +0.5 rounding difference. Never auto-accept that difference or infer project/key allocation |
| Project/key billing allocation | INCONCLUSIVE | Export populated billing dimensions or obtain official allocation evidence; amount agreement alone is insufficient |
| Original response-to-event identity | PASS, operator-verified second request | Genuine second response retained its real identity through local SDK/API/PG/analytics. Private receipt not inspected by agent; first response remains unidentified. No further paid call is requested |
| Fractional precision / daily aggregate / snapshot delta | Implemented; synthetic tests PASS | Decimal provider costs stay exact; multi-request bucket has no event ID/rounded ledger total. Optional private receipt checks one net increment; real before/after hashes are retained only when founder runs locally |
| Rounding drift/materiality | Risk demonstrated; approval pending | Half ties add +$0.50 per million identical 3.5-micro events; other workloads drift down. Bounds are not automatic tolerances; higher-precision sidecar is proposed, not a ledger migration |
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


The founder-reported second-request acceptance does not close strict billing
allocation or coverage. The [fractional-variance report and safe snapshot command](OPENAI_INTEGRATION.md#second-genuine-request-and-fractional-micro-variance)
separate first files actually inspected by the agent, the new operator attestation,
and new synthetic regression evidence. The two-request export is never treated
as one real request; exact 12.5 and unknown rounded ledger remain distinct.
No paid API request, accounting-policy change or historical ledger rewrite is
authorized by this follow-up. Remaining v0.5 blockers are dated official pricing/
account modifiers, project/key bill allocation and complete cohort/product/cache/
provider evidence, financial rounding/materiality/policy approval, plus protected
integration and inherited independent security/release gates.


## v0.7/v0.8 gate closure follow-up

[#38 security follow-up](https://github.com/rzkarsyad/agentmargin/pull/38) branches from #37; the backup/recovery follow-up branches from #38. Preserve the entire parent order and
include #33 once in the isolated combined-source rehearsal. No merge is authorized.
The [updated risk register/reviewer packet](TENANT_THREAT_MODEL.md)
records exact immutable 007–014 checksums and decisions still requiring a reviewer.

| Gate | Implemented / tested | External verification | Overall result |
| --- | --- | --- | --- |
| Expected security-schema readiness | PG16 reproduced false ready with audit RLS disabled; fix/tests cover both audit tables, nine disabled financial/audit triggers and extra permissive policies | No deployment verification | Local PASS; independent approval BLOCKED |
| Tenant/role/auth/ledger/migration regressions | PG16 001–014 clean/upgrade/rollback, shadow guard, key expiry/revocation, pool reuse, scopes, concurrency, financial/privacy suite PASS | No independent reproduction | Automated PASS; security gate BLOCKED |
| Cursor/in-flight revocation | New PG16 tests demonstrate retained WITH HOLD results and admitted statements; next SELECT denies revoked proof. Existing separate-owner session containment tested | No operator incident drill or accepted boundary | Residual INCONCLUSIVE; approval BLOCKED |
| Shared runtime/ingest/inbox/recovery authority | Negative cross-tenant and direct failed-reset tests PASS; own-tenant worker/oracle/initial-inbox authority remains | No independent capability review | INCONCLUSIVE; required architectural decision BLOCKED |
| CodeQL original/candidate triage | No suppression or dismissal; complete final combined scan required on follow-up | Authoritative alert state and independent triage unavailable | INCONCLUSIVE |
| v0.8 operator controls | Authenticated/full synthetic restore, local key recovery, restart/privacy controls tested; Mac rehearsal now PASS by founder/operator attestation | Mac local execution attested; external storage/key custody, delivered alerts, scale, RPO/RTO and privacy approvals absent | Local Mac gate PASS; deployed operational gate BLOCKED |

There is no accounting, key hashing, SDK, UI or migration contract change in the
security follow-up. Existing genuine financial acceptance evidence stays scoped
as recorded above. All candidate production-ready statuses remain NO.


## v0.8 reliability/privacy evidence matrix — recovery follow-up

| Gate | Implemented | Tested / result | Externally verified | Production-ready / required evidence |
| --- | --- | --- | --- | --- |
| Mac operator recovery rehearsal | Guarded synthetic-only PG16 wrapper | Founder/operator-attested PASS: default 13s total / 1s restore / 1s authenticated recovery; orbstack 9s / 1s / 2s | Local Mac execution attested; raw logs not independently inspected and tested SHA not supplied | Local acceptance PASS; no independent cloud, network or security approval |
| Local backup retention boundary | Explicit UTC cutoff; old -mtime rounding corrected | Baseline FAIL: a 7-day/5-minute-old file survived; new boundary/unrelated-file regression PASS | No external retention evidence | BLOCKED: approved schedule/holds and actual version/replica/object expiry |
| Backup integrity / key recovery | Archive hash/size/start metadata, authenticated synthetic CMS envelope and distinct local key-recovery fixture | PASS: missing/wrong/recovered key, truncation/content tampering, full fingerprints and restore | Founder-attested Mac local recovery PASS; same UID is not separate credential administration | BLOCKED: real independent key recovery and durable external download/authentication |
| Local backup/hook path containment | Canonical paths, trusted owner/ancestor modes; reject shared writable paths | PASS: writable parent/hook fixtures denied before dump/lock; root-sticky /tmp fixture supported | No deployed secret/filesystem audit | BLOCKED: operator storage/secret custody review; same-UID/root compromise excluded |
| Failure / retry / overlap | Existing lock/cleanup; expanded dump/encrypt/upload/prune failure and successful retry drills | PASS: old success marker preserved, no plaintext/lock after ordinary failures, held lock respected | No scheduler/hook outage evidence | BLOCKED: deadlines, crash residue handling, external inventory reconciliation and alert receipt |
| Restored tenant/financial permissions | Fresh restricted LOGIN plus final grants on both restored targets | PASS: missing/revoked/expired key, auth-table denial, tenant SELECT/INSERT, transaction reset and immutable grants | Founder-attested Mac restricted LOGIN/RLS/tenant/immutability PASS; no deployment-like role/secret recovery | BLOCKED: deployed operator and independent review; no owner-session SET ROLE substitute |
| Readiness / restart / shutdown / concurrency | #38 schema drift checks; existing pool/restart/lifecycle/rollback/load tests | PASS locally and #38 combined CI | No production-scale or deployed recovery measurement | BLOCKED: agreed RPO/RTO and load/ingress topology; synthetic elapsed times are not guarantees |
| Backup monitoring / alerts | Read-only private freshness CLI; allowlisted error/metrics logs and operator procedure | PASS: age boundary, legacy/new markers, future clock, malformed/unsafe private file and output redaction | No actual notification receipt | BLOCKED: approved destination firing/ack/escalation/resolution and collector-loss drill |
| Privacy lifecycle | Existing bounded fictional export/teardown, immutable ledger and protected evidence; per-category decision matrix | Synthetic PASS; real retention/erasure approval INCONCLUSIVE | Founder-attested Mac disposable privacy lifecycle PASS; no real-data privacy/legal review | BLOCKED: category owners/durations/holds, backup resurrection manifest, copies and independent approval |
| Distributed rate limiting / TLS | Process-local limiter is explicitly local; shared gateway/atomic quota design documented | Multiple deployed instances and partition behavior NOT tested | None | BLOCKED: infrastructure selection and fail-closed quota/edge verification |

Local Linux recovery observations: full restore/probes 2 seconds; authenticated
backup/key/failure/restore probes 2 seconds; final wrapper 17 seconds on tiny
fictional data. These are measurements, not RPO/RTO commitments. The founder has
now attested Mac PASS on default (13s total, 1s restore, 1s authenticated recovery)
and orbstack (9s, 1s, 2s). Both report externalStorageVerified=false and
productionRtoMeasured=false. External object/key custody, real alert delivery,
scale and policy acceptance remain unverified. No private financial evidence is
committed and no new Stripe/OpenAI request was performed. The [macOS/Docker operator commands](BACKUP_RESTORE.md#safe-macos--docker-desktop--orbstack-rehearsal)
and [privacy decision matrix](PRIVACY_LIFECYCLE.md#v08-privacy-evidence-matrix-and-decisions)
are the handoff, with no authorization for production actions.

The founder-reported `DOCKER_INSECURE_NO_IPTABLES_RAW` warning on both Mac runs is
an environment observation, not a confirmed vulnerability or proof of deployed
network isolation. Context names may refer to one local daemon; no independent
infrastructure, external key custody, real alert delivery, production RPO/RTO,
privacy or security approval is inferred. See the [Mac acceptance report](BACKUP_RESTORE.md#founderoperator-attested-mac-acceptance--reported-2026-10-24)
for provenance, timings and limitations. The implementing agent did not inspect
raw logs or repeat completed provider billing QA. Overall v0.8 remains BLOCKED on
the external evidence listed in the matrix.

Verified parent evidence for #38 `91a46ac73caf358ed0bc9cdab2b956d213b11af3`:
[source CI](https://github.com/rzkarsyad/agentmargin/actions/runs/40040048988) and
[full combined rehearsal](https://github.com/rzkarsyad/agentmargin/actions/runs/40040049019)
PASS. Downloaded unfiltered SARIF matches combined tree
`fcbb57a68bb79ffc8ba25f4f981c277ec1c87198`: JS/TS 103 rules / 3 inherited
candidates, Python 50 / 0, Actions 23 / 0. No suppression, exclusion or dismissal.
The two original regex findings are absent in the combined tree; main alert closure
still needs approved integration/rescan and authorized independent triage.
Final child CI/CodeQL evidence must match its own source head/tree and is recorded
on its PR after completion; parent evidence is not substituted for those checks.

Remaining founder/operator/reviewer actions, in order:

1. Independent reviewer reproduces the pinned PG16/migration/CodeQL packet and
   explicitly decides cursor/in-flight, shared runtime/ingest/worker/inbox and
   provider-authenticity boundaries. No independent security approval exists.
2. Mac synthetic rehearsal is now PASS by founder/operator attestation. Next supply
   separately authorized nonproduction external storage/independent key-recovery,
   retention, notification, incident, load and measured recovery evidence with
   accountable owners; retain run logs/source identity privately when available.
3. Privacy/financial owners approve category retention/legal holds, erasure/restore
   manifests, operational objectives and existing accounting/precision/materiality
   policy. Genuine sandbox success is not independent provider billing validation.
4. Required protected reviews and explicit integration authorization; only then
   integrate #33 independently and #24 → #25 → #26 → #27 → #28 → #29 → #30 → #31
   → #32 → #34 → #35 → #36 → #37 → #38 → backup/recovery follow-up. Drain writers
   for a separately approved migration rollout, apply only unapplied 001–014 in
   order, verify checksums, reapply final grants and matching binaries, test in an
   isolated deployment and review cutover. No production action is authorized now.
5. Repeat final-main CI/CodeQL/package/provenance validation and obtain explicit
   alpha release/tag/npm authorization. Repository transfer to makinohq/agentmargin
   is a future approved destination, not an action authorized by this work.

v0.4–v0.9 implementation/financial evidence above is preserved. v0.7/v0.8 technical
coverage improves; independent approval, deployed operations and production-ready
remain BLOCKED. v0.9.0-alpha.1 is still an unreleased candidate.

### External AI assessment follow-up

The founder supplied Claude's assessment of fdc3c7d. It is an AI source review,
not independent human security approval. See the AM-01–AM-18 disposition register
in [TENANT_THREAT_MODEL.md](TENANT_THREAT_MODEL.md#external-ai-assessment-remediation-2026-10-24).
AM-01 is reproduced on disposable PostgreSQL and corrected additively in 015;
remaining findings and deployment approvals are open. Ruleset 25719548 Protect
main is active; the assessment's contrary legacy-protection inference is corrected.
All security/operational/release gates remain subject to their documented review.

AM-02–AM-06 source containment is implemented in the runtime follow-up (016, final grants, effective log/TLS checks, auth admission and installed-contract drift detection). Local full SDK/web/types/tests, real PG16 regression and synthetic server-log verification PASS. Deployment TLS/extension inventory and independent approval remain BLOCKED. See DB_RUNTIME_ROLE.md for breaking configuration prerequisites; no approved accounting or key digest changes.

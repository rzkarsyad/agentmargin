# OpenAI usage tracking and private billing validation

AgentMargin provides **post-call**, server-side usage tracking helpers. It does *not* auto-instrument OpenAI calls, capture prompts, or include an OpenAI pricing catalog.

```ts
import { AgentMarginClient } from '@makinohq/agentmargin';

const meter = new AgentMarginClient({
  endpoint: 'http://127.0.0.1:8787',
  apiKey: process.env.AGENTMARGIN_API_KEY!, // server only
});

// response = completed result from an existing OpenAI Responses API call
await meter.trackOpenAIResponse(response, trustedCustomerId);
// completion = completed result from the Chat Completions API
await meter.trackOpenAIChatCompletion(completion, trustedCustomerId);
```

The published `@makinohq/agentmargin@0.4.0-alpha.2` has compiled ESM and TypeScript declarations. The stack prepares `0.5.0-alpha.1` without publishing it; use the local workspace build for candidate changes. Token counts are submitted as usage metadata; the AgentMargin server estimates USD microdollar costs only when a trusted matching model price version exists. **No output content or prompts are included in ingestion**.

The service requires authenticated local API access, and customer attribution must come from **your application's authenticated server-side identity**, never untrusted browser input. If provider usage or pricing is missing, no complete margin should be asserted. Tracking failures require durable retries/reconciliation before production use.

See [Next.js integration recipe](../examples/nextjs-openai/README.md) and [synthetic local example](../examples/track-synthetic-openai.ts).

## Private OpenAI billing validation (v0.5)

The CSV workflow reads original Usage/Cost exports without changing them or making
provider requests. It runs the existing production `calculateEventCost` engine;
`--postgres` also runs the SDK, HTTP API, restricted runtime, immutable price/cost
persistence and paginated workspace analytics against a disposable PostgreSQL 16
database. It creates synthetic local workspaces, never customer invoice records.
Only a single-request CSV row can be replayed with an explicitly local QA ID and
UTC bucket-start time. Multi-request rows have **no event identity** and cannot be
ingested by this harness; their exact token estimate is a separate diagnostic.
Neither case reconstructs an original response ID or request timestamp.

### Observed sample and official pricing evidence

On **2026-10-24 Asia/Jakarta (2026-10-23 UTC)**, both supplied authentic exports
were read and hashed locally: 31 daily buckets each, 30 blank, one active usage
row. Quantities are one `gpt-6-luna` request, 25 input / 13 output / zero cached
tokens, `default` service tier and non-batch. The UTC interval is
`[2026-10-23T00:00:00Z,2026-10-24T00:00:00Z)`.

The [official model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [official pricing table](https://developers.openai.com/api/docs/pricing),
observed on that date, list standard text input **$0.10**, output **$0.50** and
cached input **$0.01 per million tokens**. These are current observations, not
independently dated historical price-change evidence. The example config's
UTC effective window is an **operator-supplied QA hypothesis**, not an approved
customer rate. Current pages do not establish the rate for every earlier instant
in that bucket or account-specific modifiers. Keep a dated official rate notice
or provider confirmation for historical acceptance; never infer it from a match.

The production calculation is `(25 × 100000 + 13 × 500000) / 1000000 = 9` USD
micros, rounded once per event. The components are 2.5 and 6.5 micros; rounding
them independently would incorrectly produce 10. The actual restricted-PG/API
replay stored **9 micros**, linked its generated workspace price version, and
reported **9 micros** across workspace and customer pagination. Duplicates did
not add cost; usage recorded before pricing remained unknown on replay. The
Cost CSV's exact USD amount is **9 micros**, giving **0 micros variance**.

**This is organization-level corroboration.** Its charge row has no project/key
attribution, and no original response ID was supplied. Regional/account modifiers,
other billed products, complete account coverage, historical rates and accounting
approval remain unproven for this first sample. The second request below has an
operator-verified private identity. These limitations keep overall v0.5 **INCONCLUSIVE**,
even when individual calculation/export/replay checks are PASS. The implementing
agent made no paid request, and no private exports, identifiers or full reports are in Git.
The private report retains exact source SHA-256/byte/row references, pricing
configuration digest, rate provenance, quantities, variance and local price IDs.

### macOS: read-only audit, no provider key or spending

Use Node 24, npm, and a separate worktree to preserve any current changes. Do not
paste financial exports into issues or PRs. Substitute your private export paths:

```bash
git fetch origin
git worktree add ../agentmargin-openai-review origin/feat/openai-billing-evidence
cd ../agentmargin-openai-review
npm ci
umask 077
OPENAI_QA_PRIVATE="$HOME/agentmargin-private/openai-2026-10-24"
mkdir -p "$OPENAI_QA_PRIVATE"
AGENTMARGIN_OPENAI_BILLING_QA=local-only npm run qa:openai:billing -- \
  "$HOME/Downloads/completions_usage_2026-09-23_2026-10-23.csv" \
  "$HOME/Downloads/cost_2026-09-23_2026-10-23.csv" \
  examples/openai-billing-rates.example.json "$OPENAI_QA_PRIVATE"
```

Exit **0 = PASS, 1 = FAIL, 3 = INCONCLUSIVE**. For these exports **3 is expected**:
amount agreement does not fill the missing attribution, historical or approval
evidence. Do not mask exit 1. Read the generated `openai-billing-*.json` locally;
stdout prints check statuses only. Reports must live outside the checkout in a
0700 directory with trusted ancestors and 0600 files. Symlinked/nonregular inputs
and overlarge/invalid CSVs fail; raw CSV cells are never printed or executed.

### macOS: disposable PostgreSQL / SDK / API / analytics replay

Requires Docker Desktop. Choose an unused name/port; the command deliberately
fails if that container name already exists. It must be a **new empty database**,
never a forwarded/live database. The password below is a disposable fixture only.

```bash
docker run --detach --name agentmargin-openai-qa-20261024 \
  --publish 127.0.0.1:15433:5432 \
  --env POSTGRES_DB=agentmargin_ci --env POSTGRES_USER=agentmargin_ci \
  --env POSTGRES_PASSWORD=ci-only-disposable postgres:16
docker exec agentmargin-openai-qa-20261024 pg_isready -U agentmargin_ci -d agentmargin_ci
# Repeat pg_isready until ready, then:
export AGENTMARGIN_STANDALONE_DATABASE_URL='postgresql://agentmargin_ci:ci-only-disposable@127.0.0.1:15433/agentmargin_ci'
npm run check
npm run test:postgres
npm run test:openai:postgres
npm run test:openai:postgres -- \
  "$HOME/Downloads/completions_usage_2026-09-23_2026-10-23.csv" \
  "$HOME/Downloads/cost_2026-09-23_2026-10-23.csv" \
  examples/openai-billing-rates.example.json "$OPENAI_QA_PRIVATE"
```

`test:postgres` requires empty `agentmargin_ci`, applies migrations **001–014**
and verifies upgrade/rollback/RLS/ownership/revocation/security regressions.
`test:openai:postgres` then provisions a random NOINHERIT runtime role, applies
`db/runtime_privileges.psql`, uses it through the actual local HTTP API, and
removes only that fresh role/grants afterward. Local fixture rows remain immutable
for inspection. Re-running the replay creates another isolated synthetic workspace;
it never resubmits a provider request or reprices previous workspaces. At most 100
single-request rows are replayed per invocation; partition larger reviewed exports
explicitly. The fixture-only invocation is in both CI and the combined rehearsal.
The private CSV invocation still exits 3 for the documented external gaps.

After retaining private reports, remove **only this disposable container**:

```bash
docker stop agentmargin-openai-qa-20261024
docker rm agentmargin-openai-qa-20261024
unset AGENTMARGIN_STANDALONE_DATABASE_URL
```

### Interpretation and supported scope

- Exact decimal/exponent parsing uses integers; `25.0` is valid, `25.1` tokens is
  invalid, and submicrodollar billing differences remain visible. Missing amounts
  and blank daily buckets never become zero. CSV limits are 10 MB, 100 columns,
  100,000 rows and 10,000 characters/cell.
- Match exact UTC periods and populated project/key scopes. Cross-day differences
  cannot cancel in a grand total. Duplicate active rows fail, overlapping billing
  scopes require review, and additional billing products/credits need allocation.
- Only config entries explicitly marked `official_current` are candidates for
  conditional QA calculation. This flag is an operator assertion, not a signature
  or independent source verification. Community/unverified rates remain provenance
  only; neither this command nor CI imports them into customer pricing.
- Cache reads require a configured rate and consistent token counts. Missing
  modality details, aggregate multi-request buckets or missing rates stay unknown;
  per-request rounding cannot be reconstructed from multi-request totals. A
  supported uniform-price bucket can have an exact unrounded token estimate;
  its rounded ledger total and event identity still remain unknown.
- Nondefault/missing tiers, batch, cache writes, audio/image usage, long-context
  modifiers, non-USD/unknown FX and unfamiliar pricing dimensions fail or remain
  explicitly inconclusive. No guessed rates or FX. This validator does not extend
  the SDK's basic three-token price contract to those dimensions.
- The tool always leaves historical effective-date authority, original-response
  identity, full provider coverage and human financial policy approval as external
  gates. It is evidence for review, not a switch that certifies all v0.5 accounting.

### Separate capture command: explicit paid opt-in, existing metadata recovery

**No new paid request is needed or authorized for this follow-up.** The founder
completed the second experiment described below; the implementing agent did not
make or repeat it. No spending is authorized by either CSV command.
`scripts/openai-live-qa.ts` prepares a single small text-only Responses request.
It requires an existing `OPENAI_API_KEY`, a separately reviewed current-day QA rate
window and an explicit `one-paid-request` opt-in. No prompts, response text or keys
are saved. It captures only the real response ID/model/time/status/tier/usage.

Use a **fresh private run directory** and a private copy of the rates config;
review current official rates and adjust its QA window to the intended request
instant without claiming historical authority. `--check` does no network I/O:

```bash
# OPENAI_API_KEY is supplied securely in the environment, never pasted into Git.
node --experimental-strip-types scripts/openai-live-qa.ts --check \
  "$HOME/agentmargin-private/reviewed-current-rates.json" \
  "$HOME/agentmargin-private/openai-one-request"
```

Reference only for a future, separately authorized experiment; skip this request
command for the current acceptance work:

```bash
AGENTMARGIN_OPENAI_LIVE_QA=one-paid-request \
  node --experimental-strip-types scripts/openai-live-qa.ts --request \
  "$HOME/agentmargin-private/reviewed-current-rates.json" \
  "$HOME/agentmargin-private/openai-one-request"
```

The fixed prompt, no tools, 16 output-token cap and `reasoning.effort=none` target
far below $1 at the reviewed standard rates. This is a spend target, **not a hard
provider/account dollar cap**; dashboard limits are imperfect. No automatic
retry, model fallback, or redirect is allowed. An exclusive attempt marker is
written **before** network I/O. On timeout/crash/HTTP error, retain the directory
and inspect provider usage manually; do not delete the marker or create another
run to evade the guard. A request may have been charged even without a receipt.

Once metadata exists, use the already migrated disposable database above to track
and verify it **without another provider request**:

```bash
node --experimental-strip-types scripts/openai-live-qa.ts --track \
  "$HOME/agentmargin-private/reviewed-current-rates.json" \
  "$HOME/agentmargin-private/openai-one-request"
```

This invokes `trackOpenAIResponse` with the captured real identity and a synthetic
customer, verifies persisted cost/price reference and analytics, and saves private
results. Unsupported metadata or missing price history is rejected before tracking.
Only mock requests are tested automatically. Genuine second-request execution
and local identity-preserving tracking have passed on the founder’s Mac, as an
operator report; raw response/exports remain private and were not inspected by
the implementing agent.
Compare that run's UTC period and real usage with later official exports, retaining
any missing project/key attribution. This future test cannot retroactively identify
the founder's original 25/13 request.


### Second genuine request and fractional-micro variance

Founder-reported private acceptance on **2026-10-24 Asia/Jakarta**, for UTC day
2026-10-23: a completed `gpt-6-luna` response used **10 input / 5 output / zero
cached tokens**. The original identity was preserved and the local SDK/API/PG/
analytics pipeline passed with **4 recorded USD micros**. This is genuine
operator-verified execution, not an independent inspection of the private receipt
by the implementing agent. The first response's original identity remains absent.

| Official snapshot, operator-reported | Requests | Input | Output | Org USD cost |
| --- | --- | --- | --- | --- |
| Before | 1 | 25 | 13 | $0.000009 = 9 micros |
| After | 2 | 35 | 18 | $0.0000125 = 12.5 micros |
| Net snapshot change | 1 | 10 | 5 | $0.0000035 = 3.5 micros |

At the conditional standard rates, the second event's exact rational estimate
is `10 × 0.1 + 5 × 0.5 = 3.5` micros. Existing half-up event recording produces
**4**, so `ledger − provider = 4 − 3.5 = +0.5 micro` ($0.0000005). The founder
reports aggregate AgentMargin cost **13**, versus provider **12.5**, also **+0.5**.
The difference is 4% of that small provider total; the second event alone differs
by approximately 14.29%. An absolute tiny amount is not proof relative error is
immaterial. This is consistent with event quantization, not automatically a cost
calculation defect or an approved reconciliation tolerance.

The original first exports were previously inspected locally. The new before/
after files and second response metadata are founder-held; their numbers above
are recorded as an operator attestation. No source hash or response ID is
invented for files not supplied to the agent. Synthetic regressions reproduce
the numbers and actual restricted-PG storage/analytics, without representing
the fixtures as another genuine provider run. Org cost still lacks project/key
attribution. Asynchronous billing updates, retrospective corrections, unrelated
activity and account/region modifiers prevent causal allocation from a net
counter change alone.

#### Report precision and interpretation

Schema 2 CSV reports separate these exact decimal-string amounts:

- `calculatedMicros`: sum of production event-rounded estimates, only when every
  row represents one supported request. Otherwise null.
- `unroundedEstimatedMicros`: conditional linear token/rate diagnostic. A daily
  bucket is not rounded or ingested as a request. A uniform price must cover the
  entire UTC bucket; uncertain long-context/tier/cache dimensions stay unknown.
- `billedMicros`: exact provider USD charge; fractional micros are retained.
- `varianceMicros`: ledger minus provider; null when event-rounded costs cannot
  be reconstructed. `eventRoundingErrorMicros` is ledger minus unrounded estimate.
- `unroundedEstimateVarianceMicros`: unrounded estimate minus provider. Thus
  **ledger variance = event rounding error + unrounded pricing/billing residual**.

For the after daily row alone: unrounded estimate **12.5**, billed **12.5**, but
rounded ledger sum **null**. The same 35/18 aggregate can result from two events
whose rounded costs sum to 12 or 13. The known 25/13 and 10/5 event partition
sums to **13**; a CSV bucket does not establish that partition or those identities.
A nonzero explained rounding variance remains visible and **INCONCLUSIVE** for
financial acceptance. Unexplained exact-price/billing differences still fail.
The numerical rounding bound is diagnostic, never an automatic tolerance.

The existing ledger, SDK money fields and generic `reconcile.ts` still require
integer USD micros. Do not round a 3.5-micro provider line to 4 merely to feed that
interface. Use this precision-aware CSV report and retain the original decimals;
a broader precision interface needs separately reviewed compatibility/policy work.

#### Safe macOS before/after comparison — zero provider calls or ledger writes

Use the existing review worktree with a clean working tree, fetch the PR update,
and retain original files in separate private before/after directories. No new
OpenAI key, paid request or running database is needed. Prepare a **new private**
rate config containing only the reviewed rates: the checked-in example's
`expected` asserts the original one-request sample and cannot apply to both
snapshots. The snapshot command rejects that assertion instead of ignoring it.

```bash
git fetch origin
git merge --ff-only origin/feat/openai-billing-evidence
npm ci
umask 077
OPENAI_QA_PRIVATE="$HOME/agentmargin-private/openai-rounding"
mkdir -p "$OPENAI_QA_PRIVATE"
node --input-type=module - "$OPENAI_QA_PRIVATE/snapshot-rates.json" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const {rates}=JSON.parse(readFileSync('examples/openai-billing-rates.example.json','utf8'));
writeFileSync(process.argv[2],JSON.stringify({rates},null,2)+'\n',{mode:0o600,flag:'wx'});
JS
AGENTMARGIN_OPENAI_BILLING_QA=local-only npm run qa:openai:snapshots -- \
  "$OPENAI_QA_PRIVATE/before/usage.csv" "$OPENAI_QA_PRIVATE/before/cost.csv" \
  "$OPENAI_QA_PRIVATE/after/usage.csv" "$OPENAI_QA_PRIVATE/after/cost.csv" \
  "$OPENAI_QA_PRIVATE/snapshot-rates.json" "$OPENAI_QA_PRIVATE/reports" \
  --receipt "$HOME/agentmargin-private/openai-one-request/response-metadata.json"
```

Substitute actual private paths. The receipt must be the existing schema-1
`state=tracked` file produced by `openai-live-qa.ts --track`; it must retain its
real ID/time and report successful identity-preserving storage. The script checks
its model/time/tokens and reported stored cost against the delta and production
calculator, without uploading or echoing metadata. This is local corroboration,
not independent verification of the database or provider. Original receipt bytes
and all four source hashes are referenced privately; originals remain unchanged.
No actual response ID appears in the report or stdout.

Omit `--receipt ...` if the file is unavailable. Then the report gives only
unrounded net arithmetic and keeps rounded cost/identity unknown. The optional
conditional two-event sum means first single-request QA estimate plus a matching
receipt, not an independently read complete ledger cohort. Only one active
usage/cost bucket per snapshot is supported; mixed scopes, changed dimensions,
known org mismatch, negative/corrected counters, missing costs and unsupported
billing dimensions cannot become an accepted match. Missing org identity remains
explicitly inconclusive. Before/after ordering/finality and strict billing
attribution always remain pending.

Expected exit **3 (INCONCLUSIVE)** preserves those gates. Exit **1** means invalid
inputs or an unexplained/conflicting comparison; investigate instead of masking
it. Re-running this read-only command creates another private 0600 report with
identical financial results and no duplicate ingestion. Existing private reports
are not overwritten. A new paid call is neither requested nor needed.

#### Rounding drift at scale and next precision work

For exact nonnegative event cost `x`, rounding error is
`e = floor(x + 0.5) − x`, so **−0.5 < e ≤ +0.5 micros**. Across N requests,
**−N/2 < total error ≤ N/2 micros**. The distribution matters:

| Hypothetical workload | Drift | Interpretation |
| --- | --- | --- |
| Repeat the 3.5-micro second event 1,000,000 times | +500,000 micros = +$0.50 | 14.2857% relative overstatement; same partition/rates assumed |
| Repeat it 1,000,000,000 times | +500,000,000 micros = +$500 | Linear accumulation; not a measured production workload |
| Uniform fractional residues in tenths, as a mathematical model | Mean +0.05 micro/event; +$50 per billion | Half-up ties introduce positive drift under this assumption |
| All events at 0.4 micro | −0.4 micro/event | Downward rounding can be substantial; cancellation is not guaranteed |

These deterministic tests demonstrate possible systematic bias, not the actual
future usage distribution or an invented provider bill. The two genuine samples
do not estimate production bias. Materiality needs founder/accountant-approved
absolute and relative period thresholds, measured representative workloads and
coverage/attribution evidence. Do not auto-accept every difference below N/2:
that bound could hide missing usage or pricing errors.

The implemented improvement is a **read-only precision/variance sidecar report**.
Recommended separately reviewed work is to retain each event's exact integer
cost numerator and denominator with immutable price/source/policy version, then
compare event-rounded ledger totals and unrounded period estimates with official
provider amounts separately. An additive precision column/report interface would
need migration, backfill provenance, compatibility and policy review. Do not
rewrite historical costs, add silent corrections or switch to half-even/bucket
rounding without approval. Historical price authority, project/key allocation,
provider/cache/product coverage and financial policy approval remain open.

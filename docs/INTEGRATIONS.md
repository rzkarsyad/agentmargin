# Provider and billing integrations — v0.6 candidate

**Developer adapters; not proof of a production billing integration or reconciliation.** Live Stripe/OpenAI/Anthropic accounts have not been connected or audited by AgentMargin CI.

## Anthropic Messages usage

```ts
import {AgentMarginClient} from '@makinohq/agentmargin';
const margin=new AgentMarginClient({endpoint:'http://127.0.0.1:8787',apiKey:process.env.AGENTMARGIN_API_KEY!});
const message=await anthropic.messages.create(/* your authenticated server-side call */);
await margin.trackAnthropicMessage(message,trustedCustomerId,new Date().toISOString());
```

The adapter maps `input_tokens` + `cache_read_input_tokens` as total input, while `cache_read_input_tokens` remains a cached subset. It **rejects messages with nonzero `cache_creation_input_tokens`**, because writing caches uses a different billable tier not yet represented in AgentMargin's pricing schema. Missing model prices are unknown.

Provider result IDs give deterministic idempotency; never send generated text or customer personal data. A trusted server session must supply the customer ID.

## Stripe paid invoice -> revenue (local example)

1. Start the disposable AgentMargin demo and get its workspace API key.
2. Build SDK and run `node --experimental-strip-types examples/stripe-webhook-local.ts` with server-only `STRIPE_WEBHOOK_SECRET` and `AGENTMARGIN_API_KEY` environment variables.
3. Use Stripe CLI's local `stripe listen --forward-to http://127.0.0.1:8788/stripe/webhook`. Copy the **CLI-issued** signing secret into the server shell. Test only in Stripe sandbox.
4. The receiver verifies Stripe's raw-payload HMAC SHA-256 signature and 5-minute timestamp tolerance. It only maps `invoice.paid` for **USD** invoices with stable Stripe invoice and customer IDs. `amount_paid` cents become USD microdollars. It calls authenticated AgentMargin `trackRevenue`.
5. Stable invoice IDs make duplicate deliveries idempotent. Source now prefers invoice `status_transitions.paid_at` over event creation time so separate events for the same payment retain a stable timestamp; legacy payloads without that field retain event-time fallback. These source changes are not yet npm-published. A failure writing revenue returns 503 for retry; nonmatching signatures are rejected.

Use the optional `STRIPE_ACCOUNT_ID` to require a specific connected account. For a real multi-account deployment, **require** account-to-workspace mapping, approval and reconciliation independently; do not use the single demo key across accounts. The local receiver deliberately binds to `127.0.0.1` and has no public TLS ingress.

### Known limitations (release blockers)

- No charge refunds, credit notes, multicurrency conversion, subscription proration audit or dispute/adjustment reconciliation.
- No payout/tax/processor fee accounting; `AI contribution` remains revenue minus recorded inference costs.
- Stripe event API shape may change; verify schemas/fixtures against a real Stripe sandbox before integration.
- Webhook verification alone is not operational assurance: need durable queue, rate limiting, account ownership, replay policies, database least privilege and backup/restore.
- Provider pricing is unverified against invoices (see [pricing importer](PRICING_IMPORT.md)).
- Do not deploy this webhook receiver or the alpha AgentMargin API to the public internet.

For production Stripe integration, a formal event contract and reconciliation process are required before supporting refunds, subscription revenue attribution or cross-currency.

## Offline financial reconciliation foundation (v0.9 candidate)

`packages/core/src/reconciliation.ts` compares explicit recorded exports with external billing exports. It makes no provider requests and never mutates financial records or applies pricing. Run the fictional fixture with:

```bash
node --experimental-strip-types scripts/reconcile.ts \
  examples/reconciliation/synthetic-costs.json /tmp/agentmargin-private-reports
```

The input contract includes workspace/provider/account, currency, half-open period, immutable export/source references, recorded amounts (reported/estimated/unknown), effective-pricing references, optional inclusive-input/cached/output counts, and external invoice lines with explicit record-ID attribution. For revenue use `scope.kind="revenue"`; include payments and signed refund/credit/adjustment evidence from an audited source. A credit must be nonpositive; adjustments can have either sign. This **does not add negative records to the existing positive-only revenue API**. Persistent refund/adjustment ledger ingestion and a durable Stripe webhook inbox remain unfinished work.

The engine deduplicates identical IDs, rejects conflicting duplicates and overlapping allocations, and sorts evidence so out-of-order delivery produces the same report. Amounts use exact integer micros. Tolerance is the maximum of an absolute amount and the ceiling of absolute billed amount × basis points / 10,000. Each line reports external amount, known recorded amount, signed variance (external minus recorded), tolerance, missing/unknown IDs and token variances. Estimated rows require pricing provenance. Cached counts remain a subset of inclusive input tokens; mismatches cannot be hidden by matching dollar totals.

Unknown amounts never become zero or a verified margin. Missing billing evidence, unmatched rows, credits without explicit attribution, missing token evidence and any line variance keep `complete=false`; an empty report cannot be complete. Separate unallocated credits do not silently reduce an individual usage line. No fuzzy matching, allocation guesses, automatic price replacement, FX conversion, tax/fee recognition or revenue-recognition policy is applied. Different currencies are rejected; use separate currency/account/period reports or supply an explicitly reviewed conversion export with rate/date/source evidence. AgentMargin's current HTTP ledger is USD, so its direct exports must be reconciled as USD.

Reports contain a deep snapshot of every normalized input, source references, per-line outcomes and a canonical SHA-256 digest. The CLI writes private mode-600 files under a mode-700 directory, fsyncs complete bytes and publishes by an exclusive atomic link. Identical replay verifies the stored bytes; altered existing evidence is never overwritten. A crash can leave an unpublished private `.report-*` temporary file for operator cleanup. SHA-256 is an integrity/reference identifier, **not** a signature or proof that a provider supplied an input. Reports contain sensitive account/financial data: apply the backup/privacy policy and never send them to request logs or public CI artifacts.

Synthetic tests cover exact large amounts, tolerance edges, missing usage, unknown cached pricing, cached-token mismatches, credits/refunds, duplicate and out-of-order evidence, currency boundaries and durable report replay. Real provider statement import/export authenticity, actual Stripe sandbox refunds/credit notes, FX/accounting policy and independent accountant/provider validation remain external release gates. The adapter is an auditable foundation, not a claim of completed live reconciliation.

## Retry and delivery contract

The SDK performs one request per call and propagates cancellation/network errors; it does not automatically retry uncertain writes or provider calls. For recoverable AgentMargin failures, persist the normalized event/record in your durable queue and replay the same ID, occurredAt and payload with bounded backoff and jitter. Treat HTTP 409 as an integrity conflict requiring investigation, 400/401/403 as configuration/input failures, and 429/503 as recoverable according to your queue policy. Never re-run a paid provider inference call merely because usage tracking failed. The local Stripe receiver returns 503 when persistence fails so Stripe can retry; it has no independent durable inbox and remains a development example.

Preliminary integration review hardened the original JSON boundary: billing `recordIds` must be an actual array (strings are rejected before iterable copying), and the total allocation budget is checked before deep copying. Estimated inference costs cannot be negative; signed provider credits remain separate reported adjustment evidence. These checks prevent malformed evidence from acquiring a complete reconciliation result. Independent billing/accounting review remains required.


## Durable normalized Stripe delivery (separate v0.9 review candidate)

Migration **008** adds a PostgreSQL inbox for normalized, verified USD invoice payments. The trusted local receiver verifies the literal Stripe body before calling the new source SDK method `enqueueRevenueDelivery({providerEventId,providerAccount,record})`. `POST /v1/revenue/deliveries` derives the workspace from its bearer key, requires ingest/admin capability, validates/canonicalizes the positive revenue record and acknowledges only after database commit. It is an authenticated ingestion interface, **not a public Stripe-signature verifier**. A trusted integrator with an ingest key could already submit revenue directly; source authenticity remains that integrator's responsibility.

The receiver's durable mode is opt-in with `AGENTMARGIN_DURABLE_REVENUE=true`. Connected events require an explicit `STRIPE_ACCOUNT_ID` mapping to that receiver's single workspace. Platform events use the fixed `platform` account reference. A persistence outage returns 503 so Stripe can retry; the same event ID and exact normalized payload deduplicate even if acknowledgment was lost. Raw webhook JSON/signatures and signing secrets are not stored in the inbox. Only event/account references, normalized revenue fields, digest and delivery state are persisted.

Run a scoped worker with a separately provisioned **runtime** database URL and a workspace ingest key in the process environment:

```bash
node --experimental-strip-types scripts/revenue-replay-worker.ts
```

`AGENTMARGIN_REPLAY_LIMIT` is 1–100, default 25, for a bounded one-shot pass; schedule it externally. Each job claims one due row with `FOR UPDATE SKIP LOCKED`, writes through the same idempotent revenue routine as direct ingestion, and commits ledger insertion and delivered state together. A crash rolls back both and releases the claim; no processing lease remains stuck. If authorization changes and the final state UPDATE is filtered by RLS, the worker requires exactly one updated row and rolls the entire transaction back. A real PostgreSQL regression injects that permission change between ledger insertion and completion. Concurrent distinct event IDs for the same invoice produce one financial row, with later jobs recorded as duplicate success.

Recoverable errors persist an error class and exponential backoff (2^attempt seconds, capped at 300), with at most eight persisted attempts. Payload conflicts and invalid records fail immediately. Failed rows remain available for authorized inspection; they are never silently deleted or rewritten. The worker prints only aggregate counts/backlog age, never keys, IDs, payloads or SQL errors; it exits nonzero while failed backlog exists. Alert on failed count > 0, growing/old pending backlog, missing worker runs and repeated database failures. An unavailable database cannot persist an attempt: the row remains pending and the bounded worker exits with failure. Operators must monitor that failure rather than treating absence of state changes as success.

Dead-letter remediation requires an operator-reviewed source/accounting decision: inspect the original record and source evidence in authorized tooling, preserve the failure, and submit a separately attributed correction only under the approved adjustment policy. Do not overwrite an existing invoice or generate random IDs to bypass a conflict. Existing payments created with event-time fallback can conflict with newly normalized paid_at; preserve the historical payload or review an explicit adjustment.

The runtime may read/insert its tenant inbox rows and update only state/attempt/scheduling/error columns; it cannot update payload, delete rows or cross tenants. The privileged owner remains trusted. A DB-password-plus-ingest-key attacker can tamper with its tenant processing status (and already has tenant financial-ingestion authority); this is not independent provider authenticity. Privacy deletion/export and backup-retention procedures must include this new sensitive table.

Deployment is separate from #24–#27: after their explicit approvals and merge, review migration 008, pause/drain writers, apply it after 007, reapply the updated grants and deploy the matching API/worker before enabling durable receiver mode. The new readiness contract requires the inbox RLS policies. Migration 008 is additive; existing revenue amounts and positive-only API semantics are preserved. This source API/SDK addition is **not npm-published**. It does not implement refund/credit-note/dispute ingestion, FX conversion, immutable signed adjustment records or live Stripe sandbox validation.

Automated evidence uses fictional signed webhooks and disposable PostgreSQL 16: full receiver→API→inbox→worker flow, outage acknowledgment, duplicate/conflicting deliveries, separate/out-of-order invoice events, concurrent consumers, rolled-back claims, retry exhaustion/backoff, partial-write rollback, tenant/write-scope denial and migration failure/upgrade. No Stripe financial API is called.

### Persisted payment reductions (migration 010 candidate)

`POST /v1/revenue/adjustments` / SDK `trackAdjustments(records)` appends positive USD reductions of an existing payment. Required fields: `originalPaymentId`, `customerId`, `kind` (`refund`, `credit`, `payment_reversal`), positive integer-string `amountMicros`, `currency: 'USD'`, timezone-qualified `occurredAt`, `provider`, `providerAccount`, stable `sourceObjectId`, and immutable `evidenceRef`. Evidence references identify the original export row or provider object; they are asserted integration evidence, not independent billing verification. Never send prompts, complete webhook bodies or credentials.

Identity is derived from provider/account/economic object, **not delivery event ID**. Repeated identical evidence is a duplicate; changed amounts, attribution, dates, kind or evidence under that identity conflict. Distinct partial refunds use distinct refund IDs. Do not encode a mutable aggregate refunded-to-date value as a new refund: it double-counts incremental refunds. For Stripe, a refund and a credit note referring to that refund must resolve to the same refund economic object, not two reductions. Delivery receipts can retain multiple verified event IDs separately.

Migration 010 labels existing positive revenue USD (the existing contract), adds the append-only ledger, and blocks UPDATE/DELETE/TRUNCATE on both payments and adjustments. It never rewrites payment amounts. A private fixed-search-path trigger locks the original payment and checks tenant/customer/currency/effective-date attribution and cumulative reductions <= original payment. Concurrent partial adjustments cannot overdraw a payment. Runtime RLS requires ingest/admin for insertion and read/admin for full rows; the exact-ID digest helper permits safe replay. Trigger authorization precedes privileged lookup to avoid cross-tenant error probes. Owner/migrator compromise still bypasses this boundary by changing schema.

Apply 010 after 009 during a drain, reapply runtime grants and deploy matching API. Adjustment batches are atomic. Missing originals return 409: retain the normalized evidence and retry after payment ingestion; do not create placeholder payments. Wrong currency, over-adjustment and conflicting provenance need operator investigation. Standalone credits without a paid original, positive corrections, reinstating reversed payments, non-USD/FX conversion, dispute lifecycle accounting and policy-driven revenue recognition remain unsupported. No automatic corrective overwrite/delete exists. Financial reporting must explicitly include the adjustment ledger before being used as net revenue; older positive-only analytics represents gross until the reporting follow-up is applied.

### Durable Stripe refunds and balance credits (migration 011 candidate)

The local receiver's `AGENTMARGIN_DURABLE_REVENUE=true` mode now calls SDK `stripeEventToFinancialDelivery` and commits either payment or adjustment delivery before returning success. HMAC verification checks the literal raw bytes, timestamp tolerance and expected account **before** financial normalization. This is a loopback example, not a deployed webhook service. The authenticated API accepts trusted normalized evidence; it is not a public unsigned Stripe receiver. Synthetic tests establish local behavior only, not compatibility with a real account's pinned Stripe API version.

Supported normalization: `refund.created` / `refund.updated` with `status=succeeded`, and an explicitly allocated, issued, pure post-payment customer balance credit in `credit_note.created`. Refund IDs identify incremental amounts, and object creation time remains stable across delivery event IDs. Pending/failed/canceled refunds do not reduce revenue. Refund-backed credit notes are ignored in favor of the succeeded refund object to prevent double counting. Mixed/pre-payment/out-of-band/new allocation shapes, FX and positive credit-void/dispute reinstatement flows require reconciliation; the example returns 503 for unresolved supported financial routing/unsupported accounting, rather than claiming it recorded them.

Refund objects lack a reliable invoice link. Supply an account-scoped, trusted mapping via SDK `refundLinks` or the example's private `AGENTMARGIN_STRIPE_REFUND_LINKS_FILE` JSON, keyed by refund ID with `{originalPaymentId,customerId}`. Populate it from independently retrieved invoice/charge/payment evidence, **never arbitrary webhook metadata**. Connected accounts require `STRIPE_ACCOUNT_ID`. No Stripe network requests or automatic fuzzy matching occur.

Migration 011 adds an immutable payment-source link and adjustment inbox. New invoice workers commit revenue, account source and completion together; a later event cannot change a payment's account. A legacy payment without account evidence is not auto-adopted on duplicate delivery: replay fails for operator review. Existing delivered inbox rows are not guessed into source links. Operators must validate and import missing mappings against original evidence; do not bypass this check by changing history. Stripe adjustments require a matching account source at the database boundary. Legacy generic/import adjustments remain asserted evidence pending accounting review.

`enqueueAdjustmentDelivery` / `POST /v1/revenue/adjustments/deliveries` persists canonical USD evidence. `scripts/revenue-replay-worker.ts` processes up to the configured 1–100 payment jobs **and** up to that many adjustment jobs per pass, with transactional `FOR UPDATE SKIP LOCKED`, atomic ledger/completion, and eight attempts with capped exponential backoff. Missing payment/account evidence remains `unmatched_payment`; conflicts and invalid amounts fail visibly without modifying payments. Aggregate failed/unmatched counts need monitoring. Crash or authorization loss rolls back the entire attempt. No process-local queue or distributed retry guarantee is claimed.

After eight attempts, evidence remains in failed inbox rows. Reconcile the missing source or conflicting payload, then explicitly requeue the **same immutable receipt** under reviewed operator tooling by resetting only state/attempts/error_class/available_at/delivered_at. Retain the prior attempt evidence in operator incident records; automated requeue/a durable attempt history UI is not implemented. Never alter payloads or invent a replacement payment. Repeated webhook delivery alone does not reset exhausted retries. Restore drills fingerprint both new tables. Apply 011 after 010, reapply grants, and deploy matching API/worker/receiver during a coordinated drain. All independent security, real Stripe sandbox/API-version/account mapping and accounting gates remain open.

### Ledger-backed financial reports

The reporting candidate exports one coherent, bounded PostgreSQL snapshot, preserving original-payment references (including originals outside the report period), normalized adjustment provenance and pricing references. Run only with a restricted database role and workspace read/admin key. The output contains sensitive financial/customer data, uses file mode 600, refuses conflicting overwrites and prints only a digest/status:

```sh
env DATABASE_URL="$AGENTMARGIN_DEV_RUNTIME_URL" AGENTMARGIN_API_KEY="$AGENTMARGIN_DEV_READ_KEY" \
  node --experimental-strip-types scripts/export-financial-ledger.ts \
  2026-10-01T00:00:00Z 2026-11-01T00:00:00Z /tmp/private-ledger.json
```

Reports fail rather than silently truncate above 10,000 entries per evidence set; use narrower periods or a separately reviewed partitioned export. Financial sums use BigInt/integer strings, including totals above an individual BIGINT. `gross - refunds - credits - reversals = net`, and `net - known inference cost = known contribution`. Full contribution stays null when costs or delivery coverage are unknown. The snapshot hash identifies the exact inputs, not independent proof of provider billing.

To reconcile a Stripe account, pass `{ledger: exportedReport.inputs, billing: {...}}` to existing `scripts/reconcile.ts input.json private-report-directory`. `billing` includes the existing scope, export reference, exact tolerances and billed lines; allocations use `payment:<stored payment id>` / `adjustment:<stored adjustment id>`. Persisted reductions become negative recorded entries. The immutable report contains both the ledger snapshot and reconciler inputs/digests. Other known accounts are excluded; legacy payments without account attribution remain unresolved. Do not infer missing allocation/FX/provider data.

`unresolvedEvidence` explicitly retains `{id, sourceRef, reason}` with `reason` one of `unknown_fx`, `unsupported_billing_tier`, `unmatched_transaction`, and optional original `currency`, integer-string `amountMicros`, `billingTier`. Such original-currency amounts are **not converted or included in USD sums**. Any unresolved item prevents a complete report/total variance claim; known sums remain available. Importers must enumerate unsupported or missing evidence, not discard it to make reconciliation pass. Adapter rejection alone cannot prove complete provider billing coverage. Official invoice/account/API-version and accountant review remain external release gates.


## Reviewed dead-letter recovery (source candidate, migration 012)

Each committed enqueue, state/attempt transition and requeue gets an append-only
`delivery_history` row in the same transaction. Migration 012 records existing
rows as **checkpoints**; it cannot recover prior attempt history. Rolled-back
attempts/crashes have no committed transition; the worker's fixed error signal
and external process monitoring cover these failures. History proves authenticated
SQL transitions, not an independent Stripe receipt. A compromised ingest key plus
DB password still has the documented inbox-state authority.

Review the original receipt, account mapping, failure classification, payment and
remaining allowance before recovery. Only `database_retry`/`unmatched_payment`
failed jobs qualify; permanent conflicts/invalid records require investigated new
evidence, not a payload edit. An admin bearer key is required. Each recovery has
an immutable request UUID, unchanged payload digest, review reference and key UUID.
Replaying that request returns its receipt without resetting a subsequent attempt.
There are at most three reviewed requeues, each with eight attempts. The function
locks jobs, preserves original payloads and lets normal ledger idempotency decide
whether replay inserts anything. Workers cannot change `retry_cycle` or write the
audit tables directly. External approval is an operator process; a string reference
alone does not prove a human approved it.

For a disposable loopback `/agentmargin_ci`, put this shape in a private mode-0600
file, using actual fixture identifiers and the original digest:

```json
{"workspaceId":"<fixture-uuid>","kind":"adjustment","providerEventId":"evt_fixture","payloadDigest":"<64-hex>","reviewRef":"incident:QA-001","requestId":"<new-uuid>"}
```

```sh
AGENTMARGIN_RECOVERY_ENV=disposable node --experimental-strip-types scripts/requeue-delivery.ts /private/review.json
```

Set `DATABASE_URL` to the restricted runtime and `AGENTMARGIN_API_KEY` to the
fixture admin key through the shell's secret tooling. Never pass them as CLI
arguments or log SQL bound parameters. The tool intentionally refuses remote or
non-CI databases. It does not schedule a worker or clear the release approval gate.


## Current Stripe credit-note schema and platform routing

The original synthetic credit fixture used `credit_amount`, `refund_amount` and
`refund`. The official [Stripe OpenAPI snapshot](https://github.com/stripe/openapi/blob/90539938d9aad57955213f39ffbb23312ddbb6c8/openapi/spec3.json)
(`2026-09-30.endive`) instead returns `refunds: [{refund, amount_refunded}]`.
`credit_amount` is a **create-request parameter**, not a credit-note object field.
Source now accepts pure post-payment balance credits only when amount equals
post-payment amount, pre-payment/out-of-band amounts are zero, refunds is empty,
and an explicit customer-balance transaction exists. Wholly refund-backed notes
are ignored in favor of succeeded refund events; mixed, duplicate-refund,
expanded/unknown allocation and contradictory old/new shapes fail explicitly.
Legacy fixture shapes remain compatible but are not claimed as live API evidence.

For a dedicated **platform-account** signing secret, set
`STRIPE_PLATFORM_ACCOUNT_ID` (events omit `event.account`). For a connected-account
endpoint use `STRIPE_ACCOUNT_ID` (the signed event must match). Choose exactly one.
Never derive a workspace/account from untrusted webhook metadata. The additive SDK
`platformAccount` option binds this trusted routing configuration; a platform
endpoint rejects connected-account envelopes. The legacy no-option SDK converter
still uses `platform` for compatibility; new durable receivers require explicit
routing. Stripe may return `out_of_band_amount: null` for an unused optional allocation.
Only explicit null in that field is normalized to zero, in both current and legacy
shapes; the signed object is not mutated. Missing values, strings, positive or
negative out-of-band amounts, null required monetary values, partial refund/balance
mixtures and contradictory allocation shapes remain rejected. A wholly refund-backed
note still returns no adjustment so succeeded refund events count the reduction once.
Signature verification still precedes normalization and durable acceptance.

## Genuine sandbox QA harness and recovery

`scripts/stripe-sandbox-qa.ts` requires a test-only API key, explicitly selected
Moland sandbox account, and an existing loopback `agentmargin_ci` migrated through
014 with the tested restricted runtime grants. It never uses live mode, public
tunnels, fabricated signatures or account-wide cleanup. Keep private financial
receipts outside the checkout in an operator-owned mode-0700 directory.

Configure through secret tooling (never commit or paste secrets):
`STRIPE_API_KEY` (test prefix only), `STRIPE_SANDBOX_ACCOUNT_ID`,
`AGENTMARGIN_STANDALONE_DATABASE_URL`, `AGENTMARGIN_SANDBOX_RUNTIME_URL`, and
`AGENTMARGIN_SANDBOX_EVIDENCE`. The owner URL must use user/database
`agentmargin_ci` at `127.0.0.1`; the runtime URL must target that same disposable
DB with a different, least-privilege role. Existing data/workspaces are retained.

**Resume existing fixtures on macOS without creating financial objects:**

```sh
# Preserve your current work by using a separate checkout. Do not reset or clean it.
git fetch origin release/v0.9.0-alpha.1:refs/remotes/origin/release/v0.9.0-alpha.1
git worktree add --detach ../agentmargin-qa-resume origin/release/v0.9.0-alpha.1
cd ../agentmargin-qa-resume
npm ci
stripe version                         # validated CLI protocol: v1.55.1
env -u STRIPE_API_KEY stripe whoami --format json
# The CLI login must select Moland, matching the restricted key's exact account.
# Keep your existing DB/key/account settings; use the ORIGINAL evidence directory
# containing qa-run.json. Do not create a new run ID or edit that file.
export AGENTMARGIN_SANDBOX_EVIDENCE="$HOME/<existing-private-QA-directory>"
AGENTMARGIN_STRIPE_SANDBOX_QA=test-only AGENTMARGIN_SANDBOX_MODE=recover \
  node --experimental-strip-types scripts/stripe-sandbox-qa.ts
```

The harness independently checks BOTH the restricted-key account and the CLI
login account before opening the listener. It removes `STRIPE_API_KEY` from the
listener and resend subprocess environments only, preserving CLI login/profile,
proxy and CA configuration. API reads continue to use the restricted test key.
No need to export a signing secret: the running listener supplies it privately.
Do not use `stripe config --list`, debug logging, `--live`, or `--skip-verify`.

`recover` is the default. It requires the original `qa-run.json`, verifies its
account/age, fully paginates the four expected event types from that run's creation
time, and keeps only exact `agentmargin-qa-<run>` metadata matches. It reads the
existing three paid invoices, refunds and credit, verifies exact InvoicePayment
payment-intent links and shared customer, and confirms the unpaid $15 invoice.
Ambiguous, incomplete, changed, unrelated or older-than-30-day fixtures fail
closed. Discovery is API evidence, **never signed delivery**. Stripe Refund
resources have no `livemode` field in the pinned official schema; their false-mode
signed events, selected test-key context and exact payment links establish mode.

After mapping, recovery executes `stripe events resend EVENT_ID` **without**
`--webhook-endpoint`, using the same CLI login as the listener. In
[CLI v1.55.1](https://github.com/stripe/stripe-cli/blob/4501fc5a6e58dacab6a60a089e93317cc7b84861/pkg/cmd/resource/events_resend.go),
that command requests `for_stripecli=true`, routing existing events to the active
local listener. It does not create invoices, payments, refunds or credits. The
transport forbids all financial POSTs in recovery; the only remote write is this
run-scoped delivery retry, with an account check before each request. It can also
reach other active CLI listeners on the same sandbox: stop unrelated listeners
first. Retry is bounded to two resend requests per missing event. CLI command
success alone never satisfies the delivery check. A missing/denied/expired resend
fails the run and preserves diagnostics; it never falls back to re-signing an API
object, widening signature age or creating replacement transactions.

The localhost receiver verifies literal bytes, one timestamp within five minutes,
v1 HMAC and false platform mode before matching run metadata. Run-scoped verified
receipts are written privately and fsynced **before** enqueue/HTTP acknowledgment;
no signing secret is persisted. Signature-invalid/unrelated requests are counted
but their payloads are discarded. Normalized payment/adjustment acceptance uses
the real API and restricted PostgreSQL role. Every recovery attempt uses a fresh
local workspace to prove delivery/processing from the same existing Stripe
objects; it does not alter earlier workspaces. Saved raw receipts are audit
inputs, not a way to bypass signature expiry. Recovery always requests fresh
signed delivery. API calls are asynchronous so fixture creation cannot block the
receiver's event loop.

Stdout/stderr contain allowlisted JSON only: stage, listener start/ready/exit,
exit code/signal, expected/verified-received/accepted unique event counts by type,
HTTP response counts, AgentMargin HTTP status counts, and fixed rejection
categories. No keys, secrets, raw CLI/error text, event/object/customer IDs or
payloads appear there. Interpret failures as follows:

| Diagnostic | Meaning / next action |
| --- | --- |
| `account-check`, `listener-start` | Login/account mismatch, CLI setup, early exit or secret timeout; fix local login without the restricted-key override |
| `missingAtListener` | Neither an observed CLI event nor a verified HTTP receipt; inspect CLI connection/subscription/resend permission |
| `seenWithoutHttp` | CLI saw event, receiver has no verified receipt; inspect forwarding/HTTP status and signature counters |
| `signature_missing`, `signature_invalid`, `signature_expired` (400) | Receiver reached, signature rejected; do not disable verification |
| `account_mode`, `fixture_mismatch` (400/422) | Wrong account envelope/test flag or run metadata; investigate routing |
| `fixture_mapping_pending` (503) | Genuine receipt raced the local mapping; resend after discovery/mapping |
| `normalization` (422) | Unsupported/malformed financial snapshot; inspect private API-version/raw evidence |
| `normalized_delivery` (503) | AgentMargin rejected or timed out; inspect aggregate upstream HTTP statuses and local DB/runtime setup |
| `evidence_write` (503) | Private receipt could not be persisted; repair permissions/storage before replay |
| `unsupported_fx` (422) | Expected EUR rejection, retained as unresolved FX; never included in USD sums |

`received` counts only authenticated, run-matched receipts; signature rejects are
shown separately. Counts are unique event IDs, with duplicate HTTP attempts counted
separately. CLI log parsing is supplementary: missing log lines do not override a
verified HTTP receipt. Default delivery wait is 30 seconds per round; optional
`AGENTMARGIN_SANDBOX_DELIVERY_TIMEOUT_MS` is bounded to 1000–120000. It cannot make a
missing/rejected receipt successful. Private session discovery/failure files and
raw receipts survive failures; successful report files retain API versions,
provider evidence, exact ledger/reconciliation, delivery history and hashes.
Do not upload these financial files publicly.

For a genuinely new fixture run only, use a **new private directory** and explicit
`AGENTMARGIN_SANDBOX_MODE=create`. It refuses any existing run file, checks the
selected account before every financial write, uses deterministic operation keys,
sets invoice currency explicitly (including EUR), and labels newly created
objects. An interrupted create run is recovered without automatic financial
mutation; missing fixtures remain a blocker. Never reuse Stripe's expiring
idempotency namespace to recreate an old run.

**Genuine signed sandbox acceptance: PASS — operator-verified on macOS,
reported 2026-10-24 (Asia/Jakarta).** The existing Moland test fixtures were
recovered without creating additional transactions. Complete event pagination and
all eight genuine signed receipts were verified: three `invoice.paid`, two
`refund.created`, two `refund.updated`, and one `credit_note.created`. Seven
financial deliveries were accepted; the EUR invoice was correctly rejected as
unsupported FX. Ledger/API/reconciliation produced:

| Measure | Expected | Actual |
| --- | --- | --- |
| Gross USD revenue | $128.00 | $128.00 |
| Refunds | $105.25 | $105.25 |
| Credits | $12.00 | $12.00 |
| Net revenue | $10.75 | $10.75 |
| Reconciliation variance | $0.00 | $0.00 |

The operator reported final output `kind: stripe_sandbox_qa`, `status: pass`,
`actualMicros: 10750000`, `varianceMicros: 0`. The final compatibility issue was an
unused `out_of_band_amount: null` in the genuine credit-note shape; the narrow
normalization above resolves it. Regression fixtures use fictional identifiers and
test signatures, with null/zero equivalence, strict rejection and real restricted
PostgreSQL coverage. They are separate from this operator's genuine Stripe run.
Private receipts, object IDs, customer details and credentials remain with the
operator; no private financial files are committed or published. This implementing
agent has not independently inspected those files or repeated the external run.

This clears the supported USD platform-account **genuine signed sandbox** acceptance
check. EUR remains unsupported; unknown pricing keeps complete contribution null.
It does not clear authentic independent provider billing-export corroboration,
accountant policy approval, independent SQL/security/CodeQL review, multi-account
or unsupported allocation/FX coverage, deployment-specific backup/monitoring/load
validation, protected integration, or explicit release/publication authorization.
No additional Stripe transactions are needed to record or regression-test this
result. Any future recovery must use the existing private run directory as above.

Static-analysis review of this harness is preliminary. Two intentional receiver
patterns can produce CodeQL candidates: `js/user-controlled-bypass` identifies
HTTP path selection, which only selects a route and cannot bypass the subsequent
HMAC/mode/run checks; `js/http-to-file-access` identifies the receipt signature
header written into the private audit JSON after those checks. The latter is
intentional evidence capture, with a 3000-character signature bound, 256 KB body
bound, 200-receipt attempt bound, generated filenames, JSON encoding, exclusive
no-follow writes and trusted private ancestors; files are never evaluated or
served. Invalid/unsigned/unrelated payloads are not persisted. Tests verify both
rejection and unchanged financial totals. No rule/query/path exclusion or alert
dismissal is used. An independent reviewer must assess these data flows along
with the existing high-entropy bearer-digest classification. The fictional CLI
now generates its payloads from source constants and limits HTTP destinations to
loopback, rather than sending arbitrary JSON read from a configuration file.

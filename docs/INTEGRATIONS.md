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

# Provider and billing integrations — v0.6 candidate

**Developer adapters; not proof of a production billing integration or reconciliation.** Live Stripe/OpenAI/Anthropic accounts have not been connected or audited by AgentMargin CI.

## Anthropic Messages usage

```ts
import {AgentMarginClient} from '@agentmargin/sdk';
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
5. Stable invoice IDs make duplicate deliveries idempotent. A failure writing revenue returns 503 for retry; nonmatching signatures are rejected.

Use the optional `STRIPE_ACCOUNT_ID` to require a specific connected account. For a real multi-account deployment, **require** account-to-workspace mapping, approval and reconciliation independently; do not use the single demo key across accounts. The local receiver deliberately binds to `127.0.0.1` and has no public TLS ingress.

### Known limitations (release blockers)

- No charge refunds, credit notes, multicurrency conversion, subscription proration audit or dispute/adjustment reconciliation.
- No payout/tax/processor fee accounting; `AI contribution` remains revenue minus recorded inference costs.
- Stripe event API shape may change; verify schemas/fixtures against a real Stripe sandbox before integration.
- Webhook verification alone is not operational assurance: need durable queue, rate limiting, account ownership, replay policies, database least privilege and backup/restore.
- Provider pricing is unverified against invoices (see [pricing importer](PRICING_IMPORT.md)).
- Do not deploy this webhook receiver or the alpha AgentMargin API to the public internet.

For production Stripe integration, a formal event contract and reconciliation process are required before supporting refunds, subscription revenue attribution or cross-currency.

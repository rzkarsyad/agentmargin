# AgentMargin

**Know your margin. Not just your tokens.**

An open-source, self-hosted developer tool for attributing AI inference costs to customers and calculating contribution margins. This repository is currently **experimental open-source preview (not production-ready)**. It includes a core engine, PostgreSQL API, TypeScript SDK, OpenAI usage adapters, and local analytics dashboard. It does not yet offer automatic instrumentation or a production-hardened deployment.

## What works today

- Pure TypeScript cost engine with provider-reported costs taking precedence over token-derived estimates.
- Historical pricing windows by model; separate input, output, and cached-input rates.
- Exact USD microdollar arithmetic using `bigint`, with half-up rounding per event.
- Customer/workspace/period-scoped revenue and cost aggregation.
- Honest `unknown` cost state, null margin when coverage is incomplete, and null margin for zero revenue.
- Duplicate usage event ID detection in the in-memory core; unique constraints in PostgreSQL.
- PostgreSQL schema for workspaces, customers, events, prices and revenue.
- Local HTTP API (`POST /v1/events`) protected by workspace-scoped bearer keys stored as SHA-256 digests.
- Authenticated `POST /v1/revenue` endpoint and SDK helper for customer revenue, with transactional idempotency.
- At-most-100 event batch ingestion, HTTP payload limit, and atomic database idempotency (identical retries succeed; conflicting payloads return 409).
- TypeScript SDK for explicitly sending usage events; direct provider auto-capture is not yet implemented.
- OpenAI Responses and Chat Completions usage-to-event helpers (manual calls after provider responses complete).
- Workspace-scoped `/v1/analytics` JSON endpoint and browser dashboard at `/dashboard` (local-only preview).
- Per-process rate limit (default 120 authenticated requests per workspace per minute) and a key-revocation CLI.
- Embedded PostgreSQL (PGlite) migration and tenant-scoped aggregation tests.
- End-to-end test traversing SDK → authenticated API → `node-postgres` connection → PGlite socket → persisted data → analytics, including key revocation.
- Functional DOM smoke test for dashboard calculations, incomplete results, truncation warnings, and safe text rendering.

## Requirements

- Node.js 22.18+ (24 recommended)
- npm
- PostgreSQL 15+ for the optional schema (not required to run core tests)

```sh
npm install
npm run check
```

### Minimal example

```ts
import { calculateCustomerMargin, formatUsdMicros } from './packages/core/src/index.ts';

const summary = calculateCustomerMargin({
  workspaceId: 'my-workspace', customerId: 'cust-1',
  periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z',
  prices: [{ id:'price-v1',model:'example-model', effectiveFrom:'2026-01-01T00:00:00Z',
    inputMicrosPerMillion:1_000_000n,outputMicrosPerMillion:4_000_000n }],
  events: [{ id:'event-1',workspaceId:'my-workspace',customerId:'cust-1',
    occurredAt:'2026-10-10T12:00:00Z',model:'example-model',inputTokens:5000,outputTokens:2000 }],
  revenues: [{ id:'invoice-1',workspaceId:'my-workspace',customerId:'cust-1',
    occurredAt:'2026-10-01T00:00:00Z',amountMicros:29_000_000n }],
});
console.log(formatUsdMicros(summary.knownAiCostMicros)); // 0.013000
```

Run a TypeScript script on Node 24 with `node --experimental-strip-types example.ts`.

## Database

Create a dedicated PostgreSQL database/user with least privileges, then apply all migrations in order:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_initial.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_ingestion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/003_revenue_ingestion.sql
```

Insert a workspace UUID (`INSERT INTO workspaces(id,name) VALUES('...','Local development');`), then create a scoped API key:

```sh
DATABASE_URL='postgresql://...' node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID
DATABASE_URL='postgresql://...' npm run start -w @agentmargin/api
```

The API listens on **127.0.0.1:8787**, not a public interface. Treat the generated key as a secret. The API derives workspace identity only from the authenticated key; clients cannot choose a workspace ID. Database row-level security is not configured, so direct database access must remain restricted.

To rotate an API key, generate a new one, update clients, and revoke the old key using the printed key UUID:

```sh
DATABASE_URL='postgresql://...' node --experimental-strip-types apps/api/src/revoke-key.ts OLD_KEY_UUID
```

The rate limiter is local to one API process and does **not** replace an edge/gateway limiter for invalid-key attempts or distributed deployments.

```ts
import { AgentMarginClient } from './packages/sdk/src/index.ts';
const client = new AgentMarginClient({endpoint:'http://localhost:8787',apiKey:process.env.AGENTMARGIN_API_KEY!});
await client.track([{id:'unique-req-1',customerId:'customer-123',model:'example-model',
  occurredAt:new Date().toISOString(),inputTokens:1000,outputTokens:300}]);
await client.trackRevenue([{id:'invoice-1',customerId:'customer-123',
  occurredAt:new Date().toISOString(),amountMicros:'29000000'}]); // $29.00
```

If the model has no stored matching price version, the event is accepted as `unknown` cost. Provide a trusted price version or a provider-reported cost to calculate it. Do not embed API keys in browser/client-side bundles.

### OpenAI usage adapter

```ts
import { fromOpenAIResponse } from './packages/sdk/src/openai.ts';
// `response` is the completed output of your existing OpenAI Responses API call.
const event = fromOpenAIResponse(response, 'customer-123');
await client.track([event]);
```

Or use `fromOpenAIChatCompletion(completion, customerId)` for Chat Completions. Usage fields follow the official [Responses](https://platform.openai.com/docs/api-reference/responses/object) and [Chat Completions](https://platform.openai.com/docs/api-reference/chat/object) formats. Missing usage throws an error, preventing zero-cost assumptions. Do not send prompts, outputs, or OpenAI API credentials to AgentMargin. This is a **post-call helper**, not automatic instrumentation.

### Local analytics

Open `http://127.0.0.1:8787/dashboard` on the same machine after starting the API. Paste your workspace-scoped AgentMargin key into the page (it is not persisted in browser storage). Select a date range and load. The page shows customers, revenue, known AI costs, contribution and cost coverage. A customer with unknown event costs has no final contribution or margin. The dashboard currently supports a maximum 366-day range and at most 2,000 customers per query; if truncated, it explicitly labels the displayed numbers as partial. Larger workspaces need pagination and server-computed aggregate endpoints before production. Security response headers restrict script execution and disable caching.

## Semantics and limitations

- All monetary values are integer **USD microdollars** (1 USD = 1,000,000 micros). Conversion and pricing input validation at an API boundary remains future work.
- Rates are also USD micros **per one million tokens**. `cachedInputTokens` is part of `inputTokens`, not additional usage.
- A provider-reported cost of `0n` is legitimate and overrides estimates.
- Missing model rates or missing cached-input rate produces `unknown`, not zero.
- Contribution = revenue − **tracked AI inference cost**. This is **not net profit** and does not include hosting, support, gateway fees, or taxes.
- Margin basis points = `(contribution / revenue) * 10000`, rounded half-up. Divide by 100 for percent. A null value means no valid complete margin can be asserted.
- Period boundaries are `[start, end)` in UTC; revenue records can be input via the SDK/API, but are not automatically imported from Stripe.
- No provider price catalog is bundled; do not assume demo/example rates represent live provider pricing.
- For precise auditable pricing, preserve pricing versions and event-side calculated results. Historical changes to pricing tables must not silently alter settled records in a future ingestion service.
- The ingestion service serializes writes by workspace/event ID and uses PostgreSQL uniqueness for idempotency. It rejects conflicting retries instead of silently modifying financial data.

## Security status

See [SECURITY.md](SECURITY.md). Standalone PostgreSQL usage/revenue idempotency, concurrency, reversed batch order and tenant isolation tests passed locally on OrbStack and in [GitHub Actions CI run #1](https://github.com/rzkarsyad/agentmargin/actions/runs/39653058627) for commit `022808f`. This is a source-release validation, not a production security certification. TLS proxy, abuse protection, observability, deployment checks, and an independent security review remain production blockers. **Do not deploy as a public service.**

### Standalone PostgreSQL release test

An opt-in test is available for a **dedicated empty database named exactly `agentmargin_ci`**. It creates only test tables/data there, refuses to run against another database name or an already populated public schema, and runs 20 simultaneous same-ID ingestion attempts through independent PostgreSQL connections.

```sh
AGENTMARGIN_STANDALONE_DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/agentmargin_ci' npm run test:postgres
```

Use a disposable local PostgreSQL server (version 15+), never a production or shared database. The command does not drop the test database afterwards. The expanded PostgreSQL tests passed locally on OrbStack and in GitHub Actions CI run #1 for commit `022808f`.

### CI release gate

The `.github/workflows/ci.yml` workflow is prepared to run unit/integration tests, TypeScript checks, standalone PostgreSQL concurrency tests against a disposable PostgreSQL 16 service, heuristic source secret scanning, `npm audit`, and mocked-analytics Chromium browser smoke tests. **GitHub Actions CI run #1 passed** on commit `022808f`, including the PostgreSQL service, mocked-analytics Chromium smoke tests, source secret scan and dependency audit. Later commits must pass CI independently. See `docs/phase13-security-and-ci-audit.md` for the security review and release gates.

## License

MIT. See [LICENSE](LICENSE).

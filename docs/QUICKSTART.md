# Local Quickstart (experimental)

AgentMargin currently works best as a **localhost-only** tool. This guide separates the no-database calculation demo from optional PostgreSQL-backed API usage.

## 1. Run the cost engine without a database

Requires Node.js 22.18+ (24 recommended):

```bash
git clone https://github.com/rzkarsyad/agentmargin.git
cd agentmargin
npm ci
node --experimental-strip-types examples/calculate-margin.ts
npm run check
```

This uses fictional USD token rates and a simulated customer. It does not contact OpenAI.

## 2. Start a disposable development PostgreSQL (optional)

With OrbStack or Docker installed:

```bash
docker run -d --name agentmargin-local \
  -e POSTGRES_USER=agentmargin \
  -e POSTGRES_PASSWORD=local-dev-only \
  -e POSTGRES_DB=agentmargin \
  -p 127.0.0.1:55432:5432 postgres:16
```

The password is **only a local throwaway example**, not suitable for a network-facing deployment. If you already have a container by that name, stop and inspect it instead of overwriting data.

Set the connection in your current shell:

```bash
export DATABASE_URL='postgresql://agentmargin:local-dev-only@127.0.0.1:55432/agentmargin'
```

Apply migrations in order. You need a working `psql` client (install PostgreSQL command-line tools if not available):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_initial.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_ingestion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/003_revenue_ingestion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/004_workspace_pricing.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/005_api_key_roles.sql
```

## 3. Create a workspace and local API key

On macOS or Linux with `uuidgen` installed:

```bash
export WORKSPACE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
psql "$DATABASE_URL" -c "INSERT INTO workspaces(id,name) VALUES ('$WORKSPACE_ID','Local demo');"
node --experimental-strip-types apps/api/src/create-key.ts "$WORKSPACE_ID"
```

Copy the generated **AgentMargin** API key into your password manager. It is displayed only once. Do not confuse it with your OpenAI provider key and do not commit it.

## 4. Start the local API and dashboard

```bash
npm run build:web
npm run start -w @agentmargin/api
```

Open `http://127.0.0.1:8787/dashboard` in a browser on the same Mac. Paste the AgentMargin key to view local analytics. It is not saved in browser storage.

To submit usage and revenue, use the [SDK source](../packages/sdk/src/index.ts). For example, from server-side TypeScript:

```ts
import { AgentMarginClient } from './packages/sdk/src/index.ts';

const client = new AgentMarginClient({
  endpoint: 'http://127.0.0.1:8787',
  apiKey: process.env.AGENTMARGIN_API_KEY!,
});

await client.track([{
  id: 'demo-usage-1', customerId: 'demo-customer', model: 'example-model',
  occurredAt: new Date().toISOString(), inputTokens: 1000, outputTokens: 200,
}]);

await client.trackRevenue([{
  id: 'demo-invoice-1', customerId: 'demo-customer',
  occurredAt: new Date().toISOString(), amountMicros: '29000000',
}]);
```

**Important:** the usage event's cost will be marked `unknown` unless you supply a provider-reported cost or configure a trusted matching workspace price through the [Model pricing API/UI](PRICING.md). This is intentional; missing pricing is not free usage. The SDK is not published to npm yet, and its server-side code must not ship with keys in browser bundles.

To try the OpenAI post-call helper, see [packages/sdk/src/openai.ts](../packages/sdk/src/openai.ts). It does **not** instrument requests automatically.

## 5. Shut down your local demo

Stop the API using Ctrl+C. If the example container above was created for this purpose and you no longer need its data:

```bash
docker rm -f agentmargin-local
```

This **deletes the container's database data** when using default ephemeral container storage. Do not run against an existing container unless you intend to remove it.

## Verification and scope

```bash
npm run check
```

For real PostgreSQL concurrency verification in a separate, empty `agentmargin_ci` database, see [docs/orbstack-release-verification.md](orbstack-release-verification.md).

AgentMargin has no TLS gateway, database RLS, distributed limiter, backup/restore procedure or production readiness guarantee. **Do not expose this localhost preview to the public internet or send real customer records.** See [SECURITY.md](../SECURITY.md).

# @agentmargin/sdk

Lightweight, server-side TypeScript SDK for sending AI inference usage and attributed revenue to an AgentMargin instance. No OpenAI SDK dependency; the OpenAI post-call helpers accept structural responses.

**Experimental prerelease:** API is subject to change. Publishing to npm is a separate release step; do not assume the package exists on npm just because it appears in this repository.

## Build locally

```bash
npm ci
npm run build -w @agentmargin/sdk
node scripts/sdk-package-smoke.mjs
```

The published package exposes **compiled ESM JavaScript and .d.ts typings**, not runtime TypeScript source. It requires Node.js 22.18+ and has no runtime dependencies. Run from a trusted server; do not bundle workspace keys into browser code.

```ts
import { AgentMarginClient } from '@agentmargin/sdk';

const margin = new AgentMarginClient({
  endpoint: process.env.AGENTMARGIN_ENDPOINT ?? 'http://127.0.0.1:8787',
  apiKey: process.env.AGENTMARGIN_API_KEY!,
});

// Response is a completed OpenAI Responses API result, obtained independently.
await margin.trackOpenAIResponse(response, trustedCustomerId);

await margin.trackRevenue([{
  id: 'invoice-123', customerId: trustedCustomerId,
  occurredAt: new Date().toISOString(), amountMicros: '29000000',
}]);
```

An idempotent stable event ID is required for direct `track`. Reported provider cost (if any) takes precedence over a stored price. Missing usage/cost is **unknown**, not free. Usage payloads contain token/model metadata only; never submit prompts or completion text.

[Local quickstart](../../docs/QUICKSTART.md) · [OpenAI tracking semantics](../../docs/OPENAI_INTEGRATION.md) · [Security limitations](../../SECURITY.md).

## npm publication gate

A maintainer with rights to the `@agentmargin` npm organization must configure a trusted publisher for the repository's `publish-sdk.yml` workflow. GitHub repository ownership alone does **not** grant npm scope ownership. The workflow is manually dispatched and checks the exact package version and tag first. Never publish an untested prerelease with the `latest` dist-tag.

# @makinohq/agentmargin

Lightweight, server-side TypeScript SDK for sending AI inference usage and attributed revenue to an AgentMargin instance. No OpenAI SDK dependency; the OpenAI post-call helpers accept structural responses.

**Experimental prerelease:** API is subject to change. The SDK is published on npm under the `alpha` dist-tag; do not install it expecting a stable API.

## Build locally

```bash
npm ci
npm run build -w @makinohq/agentmargin
node scripts/sdk-package-smoke.mjs
```

The published package exposes **compiled ESM JavaScript and .d.ts typings**, not runtime TypeScript source. It requires Node.js 22.18+ and has no runtime dependencies. Run from a trusted server; do not bundle workspace keys into browser code.

```ts
import { AgentMarginClient } from '@makinohq/agentmargin';

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

## Publishing and provenance

Install the public prerelease with `npm install @makinohq/agentmargin@alpha`.

The initial `0.4.0-alpha.1` version was published manually. Subsequent tested versions are released through [`publish-sdk.yml`](../../.github/workflows/publish-sdk.yml), using npm Trusted Publishing (GitHub OIDC) with the `npm-publish` environment; no long-lived npm publishing token is required.

For a new prerelease, bump the SDK and lockfile versions in one reviewed commit, merge after CI is green, create an immutable `sdk-vX.Y.Z-alpha.N` tag **on that tested commit**, then manually dispatch the workflow from GitHub Actions with the same tag. It checks that the tag and package version match before publishing to the `alpha` dist-tag. After a successful publish, confirm the registry version, tag and provenance on npm.

Do not rerun publishing for an existing version: npm versions are immutable. Do not use the `latest` dist-tag for an alpha release.

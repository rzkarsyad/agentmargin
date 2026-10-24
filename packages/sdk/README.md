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

Install the verified prerelease with `npm install @makinohq/agentmargin@0.4.0-alpha.2`. The `alpha` tag may move; pin the version for reproducible applications. The OIDC publication of this version succeeded; registry-consumer verification is documented in [developer adoption](https://github.com/rzkarsyad/agentmargin/blob/main/docs/V04_DEV_ADOPTION.md).

The initial `0.4.0-alpha.1` version was published manually. Subsequent tested versions are released through [`publish-sdk.yml`](../../.github/workflows/publish-sdk.yml), using npm Trusted Publishing (GitHub OIDC) with the `npm-publish` environment; no long-lived npm publishing token is required.

For a new prerelease, bump the SDK and lockfile versions in one reviewed commit, merge after CI is green, create an immutable `sdk-vX.Y.Z-alpha.N` tag **on that tested commit**, then manually dispatch the workflow from GitHub Actions with the same tag. It checks that the tag and package version match before publishing to the `alpha` dist-tag. After a successful publish, confirm the registry version, tag and provenance on npm.

Do not rerun publishing for an existing version: npm versions are immutable. Do not use the `latest` dist-tag for an alpha release.

## Delivery and source compatibility

The SDK sends one request per call. Supply AbortSignal to bound client work, persist failed usage/revenue in your own durable queue, and retry identical IDs/payloads. HTTP 409 is a payload conflict to investigate. Never replay the underlying billable provider request to retry analytics delivery.

Source changes after alpha.2 validate HTTP(S) URLs without embedded credentials, support IPv6 HTTP loopback, reject impossible Anthropic dates/oversized OpenAI IDs, and prefer Stripe invoice paid_at when present. They preserve method signatures and await separate review/publication. Existing records created with event-time fallback must retain their original payload on replay; changing an old record timestamp correctly yields an idempotency conflict. No SDK version is published automatically by a source PR.


The separate durable-delivery source candidate adds `enqueueRevenueDelivery` for verified normalized Stripe invoice payments. It commits to the tenant inbox before acknowledging; a scoped worker must complete replay. This additive method is unpublished and requires migration 008 plus the matching API/worker. See [integration contract](https://github.com/rzkarsyad/agentmargin/blob/main/docs/INTEGRATIONS.md); no live Stripe or production-readiness claim follows from synthetic tests.


## v0.9 platform candidate / SDK 0.5.0-alpha.1 (NOT PUBLISHED)

This checkout prepares the next additive SDK prerelease at `0.5.0-alpha.1`,
independently of platform `v0.9.0-alpha.1`. Existing usage, revenue, OpenAI and
Anthropic APIs remain compatible. New `trackAdjustments`, `enqueueRevenueDelivery`,
`enqueueAdjustmentDelivery`, current-schema Stripe credits and `platformAccount`
require matching reviewed API/schema 001–014 and a replay worker. API revenue
analytics now reports net recorded revenue after adjustments; explicit gross and
reduction fields preserve its derivation. Non-USD FX, mixed credits and positive
reinstatements remain unsupported. SDK alpha.2 does **not** gain source-only methods
through a server upgrade. Follow the authoritative [release dashboard](../../docs/ROADMAP.md)
and [integration contract](../../docs/INTEGRATIONS.md). No new npm version is released.

### Stripe security compatibility

The candidate Stripe converters require trusted `expectedLivemode` configuration.
Pass `{expectedLivemode:false, platformAccount: configuredAccount}` to
`stripeEventToFinancialDelivery`, or append the explicit boolean sixth argument
to the deprecated `stripeInvoicePaidToRevenue`. Missing/mismatched mode fails
closed. Connected events require exact `expectedAccount`; platform events must
omit `event.account`. Never infer either expectation from the incoming event.
`StripeAccountingReviewRequired` is non-retryable by the caller: durably quarantine
and reconcile unsupported financial events, rather than silently ignoring them or
retrying forever. See the repository integration contract for routing and limits.

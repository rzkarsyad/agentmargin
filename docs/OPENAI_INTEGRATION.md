# OpenAI usage tracking (v0.4 developer preview)

AgentMargin provides **post-call**, server-side usage tracking helpers. It does *not* auto-instrument OpenAI calls, capture prompts, or include an OpenAI pricing catalog.

```ts
import { AgentMarginClient } from '@agentmargin/sdk';

const meter = new AgentMarginClient({
  endpoint: 'http://127.0.0.1:8787',
  apiKey: process.env.AGENTMARGIN_API_KEY!, // server only
});

// response = completed result from an existing OpenAI Responses API call
await meter.trackOpenAIResponse(response, trustedCustomerId);
// completion = completed result from the Chat Completions API
await meter.trackOpenAIChatCompletion(completion, trustedCustomerId);
```

The SDK is prepared for npm as compiled ESM with TypeScript declarations, but **publication is not confirmed**. Until it is published and verified, consume the linked local workspace package or build from source. Token counts are submitted as usage metadata; the AgentMargin server estimates USD microdollar costs only when a trusted matching model price version exists. **No output content or prompts are included in ingestion**.

The service requires authenticated local API access, and customer attribution must come from **your application's authenticated server-side identity**, never untrusted browser input. If provider usage or pricing is missing, no complete margin should be asserted. Tracking failures require durable retries/reconciliation before production use.

See [Next.js integration recipe](../examples/nextjs-openai/README.md) and [synthetic local example](../examples/track-synthetic-openai.ts).
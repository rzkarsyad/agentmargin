# Next.js + OpenAI Responses integration recipe

**This is an integration recipe, not a standalone Next.js app and not a production deployment.** It assumes an existing Next.js App Router application, user authentication, the official `openai` server SDK, and a checked-out AgentMargin workspace. The AgentMargin SDK is currently *source-first*, not on npm. Replace `@agentmargin/sdk` with the import/link strategy for your project until it is published.

## Application requirements

- Server-side environment variables: `OPENAI_API_KEY`, `OPENAI_MODEL`, `AGENTMARGIN_API_KEY`, and `AGENTMARGIN_ENDPOINT`.
- A **real server-side session check** that resolves a trusted customer ID from an authenticated account. Never trust a customer ID sent by the browser.
- A locally running AgentMargin API (see [demo guide](../../docs/DEMO.md)); **do not publish its HTTP endpoint to the internet**.
- A correctly configured, reviewed provider model price version or provider-reported cost if you require complete margins. Missing prices remain `unknown`.

## Route Handler sketch

Next.js defines server-side handlers in `app/api/.../route.ts`. The following illustrates the integration **after you supply your own authentication and SDK import**:

```ts
import OpenAI from 'openai';
import { AgentMarginClient } from '@agentmargin/sdk'; // use your linked local SDK workspace
import { requireAuthenticatedCustomerId } from '@/lib/auth'; // implement in your app!

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY!});
const margin = new AgentMarginClient({
  endpoint: process.env.AGENTMARGIN_ENDPOINT ?? 'http://127.0.0.1:8787',
  apiKey: process.env.AGENTMARGIN_API_KEY!,
});

export async function POST(request: Request) {
  // Resolve identity through server-side auth / authorization, not request JSON.
  const customerId = await requireAuthenticatedCustomerId(request);
  if (!customerId) return Response.json({error:'Unauthorized'}, {status:401});

  const body: unknown = await request.json();
  const prompt = (body && typeof body === 'object' && 'prompt' in body)
    ? (body as {prompt: unknown}).prompt : null;
  if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 4000)
    return Response.json({error:'Invalid prompt'}, {status:400});
  if (!process.env.OPENAI_MODEL) throw new Error('OPENAI_MODEL required');

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL,
    input: prompt,
    store: false,
  });

  // Usage-only: sends customer ID, response ID, model, timestamp, token counts.
  // Does not send the prompt or response text to AgentMargin.
  let metering: 'recorded' | 'failed' = 'recorded';
  try {
    await margin.trackOpenAIResponse(response, customerId);
  } catch {
    // For a real app, create durable retriable outbox jobs and monitoring.
    // This recipe must not silently claim complete/accurate financial data.
    metering = 'failed';
  }
  return Response.json({text: response.output_text, metering});
}
```

The official OpenAI SDK returns model usage with input/output tokens and cached-token detail. AgentMargin's helper deliberately refuses missing usage instead of treating an unmetered response as free. The provider response ID becomes the ingestion event ID, so retrying *the same response* is idempotent. A new OpenAI request produces a new ID and is **not** a retry of the same event.

### Security and accounting notes

- Don't store AgentMargin, OpenAI, or session credentials in client-side bundles or response JSON.
- Don't expose unauthenticated route handlers. Apply your application's normal authentication, abuse protection, and spending limits to the AI endpoint.
- An AI request can succeed while a subsequent metering request fails. The recipe reports that limitation but is **not** durable accounting. A production app needs a queue/outbox, retries, reconciliation, and alerts before making margin claims.
- The demo supports loopback-only evaluation. Do not deploy AgentMargin as a public service until its production security blockers in [SECURITY.md](../../SECURITY.md) are addressed.
- Token usage might not equal final invoiced provider cost. Compare provider billing and version model prices by effective date.

## Test the SDK without OpenAI credentials

Run `npm run demo` in the repository, then in a **separate terminal**:

```bash
AGENTMARGIN_API_KEY='am_replace_with_demo_key' node --experimental-strip-types examples/track-synthetic-openai.ts
```

This sends a synthetic Responses-shaped object and a fictional $29 revenue event through the real local API. No prompt, provider API key, or OpenAI network request is involved. The calculated cost remains unknown until a matching price version exists. See [OpenAI docs](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) and [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers).
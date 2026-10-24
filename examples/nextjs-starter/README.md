# AgentMargin × Next.js: runnable starter

Source-first, no hosted AgentMargin service required. **This is a local demo, not production auth or billing code.**

### 1. Boot AgentMargin

From repository root with Node 22.18+ and OrbStack/Docker:

```bash
npm ci
npm run build -w @makinohq/agentmargin
npm run demo
```

The local demo prints an AgentMargin API key. Keep this terminal open.

### 2. Boot Next.js in another terminal

```bash
cd examples/nextjs-starter
cp .env.example .env.local
# Edit .env.local: paste the local AGENTMARGIN_API_KEY
npm install
npm run dev
```

Open http://127.0.0.1:3000. Click **Track synthetic request** to submit actual metadata and $0.29 illustrative revenue through compiled `@makinohq/agentmargin` to the local API/PostgreSQL. It requires **no OpenAI key**; the model price is intentionally unknown until you add a matching price in AgentMargin. This demonstrates that `unknown != 0`.

Optional: set `OPENAI_API_KEY` in **server-only** `.env.local`, then click **Optional real OpenAI request**. The server sends a fixed, non-sensitive prompt, reads the completed Responses API usage, and tracks metadata only; it does not return prompts or outputs to AgentMargin. A provider call may incur a small charge.

### Safety and limitations

- `DEMO_CUSTOMER_ID` is hard-coded. This is **not** a real authentication boundary. Derive customer identity from a verified server session in your own application.
- Routes have no external access controls; never host this demo publicly.
- Never use `NEXT_PUBLIC_` for keys and never commit `.env.local`.
- Example revenue is synthetic. In production, ingest actual payment provider IDs only after signature verification and reconciliation.
- No production-grade retries or durable queue; see root security policy.
- Uses local `file:../../packages/sdk` dependency so it works before npm publication. For registry installs, replace with the verified published prerelease version.

For a complete set of historical and scope limitations, see [the repo's security policy](../../SECURITY.md) and [SDK docs](../../packages/sdk/README.md).

The demo POST routes require application/json and exact same-origin browser
requests before reading provider credentials or recording financial fixtures.
Default host validation permits HTTP loopback only, preventing an arbitrary Host
from defining a trusted origin. A non-loopback installation must explicitly set
the server-only AGENTMARGIN_STARTER_ORIGIN to its exact HTTPS origin, and add real
user authentication, authorization and rate limiting before exposure. This guard
is CSRF/DNS-rebinding containment, not an authentication or billing quota system.
Server/curl JSON requests without browser Origin remain supported. No paid call
is required to test rejection; leave OPENAI_API_KEY unset for route smoke tests.

# AgentMargin

**Know your margin. Not just your tokens.**

**Current source release: v0.2.0-alpha.** This preview is intentionally localhost-only and should be tested with synthetic data.

[![CI](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml/badge.svg)](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-experimental%20alpha-orange.svg)](docs/releases/v0.2.0-alpha.md)

AgentMargin is an **open-source, self-hosted TypeScript toolkit** for understanding AI inference costs and *customer-level contribution margins*. Attribute usage and revenue to the same customer, distinguish known from unknown costs, and investigate customers whose AI usage outweighs what they pay.

> **Experimental software.** Built for local evaluation and contributors, **not** an internet-facing production deployment. Read [SECURITY.md](SECURITY.md) before using real data.

## Why AgentMargin?

Most model dashboards tell you how many tokens you spent. They don't answer: **which customer is profitable?**

AgentMargin brings these records together:

| Customer (illustrative) | Revenue | Tracked AI cost | AI contribution |
| --- | ---: | ---: | ---: |
| Customer A | $29.00 | $12.00 | $17.00 |
| Customer B | $29.00 | $42.00 | −$13.00 |

*AI contribution is revenue minus tracked AI inference cost—not gross profit or net profit. The illustration is not usage data from this repository.*

### What works today

- **Cost engine:** versioned model prices, input/output/cached token rates, integer microdollar calculations.
- **Trustworthy coverage:** distinguish provider-reported, estimated and **unknown** cost. Incomplete data means no final margin—not a misleading zero.
- **Customer attribution:** workspace-scoped, idempotent usage and revenue records with PostgreSQL.
- **Local API + TypeScript SDK:** authenticated `/v1/events`, `/v1/revenue`, and `/v1/analytics`.
- **OpenAI helpers:** manually map completed Responses or Chat Completions usage to AgentMargin events.
- **Local dashboard:** customer contribution, usage and coverage; explicitly warns when result sets are truncated.

**Not yet available:** automatic instrumentation, an official provider price catalog, Stripe synchronization, publicly hosted service, or production-hardening. The SDK is **source-first** and is not published to npm.

## One-command local demo (v0.2 alpha)

With **OrbStack/Docker Compose**, Node.js 22.18+ and npm:

```bash
npm run demo
```

Starts a localhost-only PostgreSQL database, applies migrations and seeds **fictional** revenue and model usage for three example customers. Copy the freshly generated AgentMargin API key from the terminal and open `http://127.0.0.1:8787/dashboard`. No OpenAI account or real customer data is required.

See [Local demo instructions](docs/DEMO.md) for stopping and intentionally resetting data. **This remains experimental software: do not expose the local API to the public internet.**

## Track a completed OpenAI request (v0.2 alpha)

The source-first SDK now accepts a completed OpenAI Responses or Chat Completions result in one call:

```ts
await margin.trackOpenAIResponse(response, trustedCustomerId);
// or
await margin.trackOpenAIChatCompletion(completion, trustedCustomerId);
```

The helpers send **usage metadata only**—no prompts or generated text—and refuse responses without usage. Use a trusted customer ID from server-side authentication; do not expose keys in a browser bundle.

- [Next.js App Router integration recipe](examples/nextjs-openai/README.md) (requires your own authentication and OpenAI SDK)
- [Synthetic end-to-end example](examples/track-synthetic-openai.ts) (no OpenAI API key or OpenAI request)
- [Tracking semantics and safety notes](docs/OPENAI_INTEGRATION.md)

## v0.3 in development: workspace pricing + Arc UI

The [draft v0.3 PR](https://github.com/rzkarsyad/agentmargin/pull/3) introduces authenticated, append-only pricing versions with explicit effective dates and a **React 19 dashboard using real Arc UI free MIT components**. The previous inline HTML interface remains in the repo as a legacy testing fixture; the local dashboard route now serves the built React/Vite UI when available.

- [Pricing API, immutable rate history and verification notes](docs/PRICING.md)
- [Arc source-first frontend and license](apps/web/README.md)
- [Official Arc UI](https://uiarc.dev/) (free source: [arc-library](https://github.com/kuratlielia/arc-library))

**This work is unreleased and must not be deployed as an internet-facing service.** The current public stable source release remains `v0.2.0-alpha`.

## Try the cost engine

Requires **Node.js 22.18+** (Node 24 recommended) and npm. No API key or database is necessary for this demo.

```bash
git clone https://github.com/rzkarsyad/agentmargin.git
cd agentmargin
npm ci
node --experimental-strip-types examples/calculate-margin.ts
```

The example verifies a $29 revenue record and $0.013 in calculated AI inference costs, then prints contribution and margin. Rates in the example are **illustrative**, not live OpenAI prices.

Run automated checks locally:

```bash
npm run check
```

To run the local PostgreSQL API and browser dashboard, follow **[Local self-hosted quickstart](docs/QUICKSTART.md)**.

## How it fits your app

```text
AI request completes
      ↓
Read model + token usage (or provider-reported cost)
      ↓
AgentMargin SDK → authenticated local API → PostgreSQL
      ↑
Record customer revenue through SDK/API
      ↓
/v1/analytics → local dashboard → contribution by customer
```

The OpenAI adapter is a **post-call helper**, not automatic capture. Never send model prompts, responses, provider API keys or real customer information to an unreviewed deployment.

## When AI cost is unknown

A missing model price is **not** a $0 expense. The v0.2 analytics preview shows which model names have unknown-cost events, counts them per workspace and time period, and warns when more than 20 distinct models are affected.

[Understand unknown costs and safe pricing remediation](docs/UNKNOWN_COSTS.md).

## Live-stack release check (v0.2 alpha)

The development branch includes a GitHub Actions end-to-end check against **real, disposable PostgreSQL**, a localhost API and real Chromium. It verifies seeded customer economics and posts synthetic usage/revenue through the TypeScript SDK without contacting any AI provider.

The test runs only in GitHub Actions CI and cleans up its demo containers. See [Local demo and verification](docs/DEMO.md). **Passing this test does not establish production security.**

## Accuracy and security

- Revenue and costs are stored in **USD microdollars** (`1 USD = 1,000,000 micros`).
- Cached input tokens are a subset of input tokens.
- A reported zero-dollar cost is valid; missing prices or missing usage are **not** zero.
- Unknown costs suppress the final contribution and margin.
- The dashboard is for **localhost**; the API binds to `127.0.0.1` by default.
- No PostgreSQL row-level security, TLS proxy, distributed abuse controls, or operational recovery process is shipped.

See [security policy](SECURITY.md), [limitations and setup](docs/QUICKSTART.md), and [release notes](docs/releases/v0.2.0-alpha.md). **Do not expose this alpha as a public production service.**

## Contribute and follow progress

- [Roadmap](docs/ROADMAP.md): what we're building next and what is intentionally out of scope.
- [Contributing guide](CONTRIBUTING.md): local tests, issue etiquette, and PR guidance.
- [Report a bug](https://github.com/rzkarsyad/agentmargin/issues/new?template=bug_report.yml) or [share a use case](https://github.com/rzkarsyad/agentmargin/issues/new?template=feedback.yml).
- [CI results](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml): TypeScript, unit tests, standalone PostgreSQL concurrency, secret scan, dependency audit, mocked-API Chromium smoke tests, and a live local Docker/PostgreSQL/API/SDK/Chromium integration test.

If you're building an AI-powered app and struggle to understand per-customer margins, **tell us what data you have, what you wish you knew, and what prevented you from trying this**. Practical feedback matters more than stars.

## License

[MIT](LICENSE).
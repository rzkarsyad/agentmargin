# AgentMargin

**Know your margin. Not just your tokens.**

[![CI](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml/badge.svg)](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-experimental%20alpha-orange.svg)](docs/releases/v0.1.0-alpha.md)

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

## One-command local demo (v0.2 candidate)

With **OrbStack/Docker Compose**, Node.js 22.18+ and npm:

```bash
npm run demo
```

Starts a localhost-only PostgreSQL database, applies migrations and seeds **fictional** revenue and model usage for three example customers. Copy the freshly generated AgentMargin API key from the terminal and open `http://127.0.0.1:8787/dashboard`. No OpenAI account or real customer data is required.

See [Local demo instructions](docs/DEMO.md) for stopping and intentionally resetting data. **This remains experimental software: do not expose the local API to the public internet.**

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

## Accuracy and security

- Revenue and costs are stored in **USD microdollars** (`1 USD = 1,000,000 micros`).
- Cached input tokens are a subset of input tokens.
- A reported zero-dollar cost is valid; missing prices or missing usage are **not** zero.
- Unknown costs suppress the final contribution and margin.
- The dashboard is for **localhost**; the API binds to `127.0.0.1` by default.
- No PostgreSQL row-level security, TLS proxy, distributed abuse controls, or operational recovery process is shipped.

See [security policy](SECURITY.md), [limitations and setup](docs/QUICKSTART.md), and [release notes](docs/releases/v0.1.0-alpha.md). **Do not expose this alpha as a public production service.**

## Contribute and follow progress

- [Roadmap](docs/ROADMAP.md): what we're building next and what is intentionally out of scope.
- [Contributing guide](CONTRIBUTING.md): local tests, issue etiquette, and PR guidance.
- [Report a bug](https://github.com/rzkarsyad/agentmargin/issues/new?template=bug_report.yml) or [share a use case](https://github.com/rzkarsyad/agentmargin/issues/new?template=feedback.yml).
- [CI results](https://github.com/rzkarsyad/agentmargin/actions/workflows/ci.yml): TypeScript, unit tests, standalone PostgreSQL concurrency, secret scan, dependency audit, and mocked-API Chromium smoke tests.

If you're building an AI-powered app and struggle to understand per-customer margins, **tell us what data you have, what you wish you knew, and what prevented you from trying this**. Practical feedback matters more than stars.

## License

[MIT](LICENSE).
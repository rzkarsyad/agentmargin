# Roadmap — AgentMargin

**Vision:** Help developers answer “Which AI customers are profitable?” with attributable, auditable usage and revenue—not just a token-spend total.

This is a direction of work, not a delivery promise. We prioritize problems supported by real user feedback.

## v0.1.0-alpha — foundational core (released)

- [x] Deterministic inference cost and customer-level contribution calculation
- [x] Workspace-scoped, idempotent PostgreSQL usage/revenue ingestion
- [x] OpenAI post-call usage helpers and local analytics
- [x] Standalone PostgreSQL concurrency, source scanning, dependency audit, mocked-browser CI
- [ ] Verify first-time contributor completes the quickstart without help
- [ ] Collect 5 detailed developer interviews or written workflows
- [ ] Get 3 developers to independently run a local demo and report where setup breaks
- [ ] Publish clear security limitations and triage reported issues

## v0.2.0-alpha — make setup genuinely effortless

- [x] Single-command local demo with seeded synthetic data, verified on OrbStack and GitHub Actions
- [x] Synthetic OpenAI Responses tracking fixture that does not send prompts/outputs
- [x] Tenant-scoped unknown-cost model diagnostics with bounded results and safe HTML rendering
- [ ] Provider pricing import workflow with auditable effective dates and version pinning
- [x] CI coverage for live Docker PostgreSQL + local API + SDK + desktop/mobile Chromium
- [x] Source-first Node/OpenAI example and a Next.js App Router integration recipe (not a packaged starter app)

## v0.3.0-alpha — pricing integrity and compact dark dashboard

- [x] Append-only workspace price versions with audited source notes, effective dates, and authenticated workspace scoping
- [x] Frontend migration from inline HTML to React 19/Vite with free MIT Arc UI primitives and a compact dark dashboard
- [x] Verify pricing creation/list, workspace isolation, immutable stored costs and real Chromium form behavior in CI
- [ ] Independent Mac/OrbStack acceptance of the **final v0.3 build** (GitHub Actions local Docker E2E passed; Mac run not yet confirmed for this final build)

## Later: make it useful for real teams

- [ ] Safer tenant isolation and least-privilege production database roles (assess RLS)
- [ ] Production ingress/TLS, distributed unauthenticated rate limiting, observability
- [ ] Backup and restore drills, retention/export/delete policies, incident response
- [ ] Billing system integrations such as Stripe (only after attribution semantics are clear)
- [ ] Multi-model/provider coverage and reconciliation with provider invoices
- [ ] Paginated analytics and server-computed workspace totals

## Not now

Hosted SaaS billing, predictive AI recommendations, multi-user RBAC, a no-code instrumentation promise, and speculative dashboards. Avoid adding surface area before real users complete the core tracking loop.

## Give input

Share a use case in [GitHub Issues](https://github.com/rzkarsyad/agentmargin/issues/new?template=feedback.yml). Helpful reports say:
- What type of AI application are you building (without customer information)?
- How do you identify a customer for accounting?
- Where do you get revenue and model usage today?
- What did you try, and where did you get stuck?

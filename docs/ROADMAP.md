# Roadmap — AgentMargin

**Vision:** Help developers answer “Which AI customers are profitable?” with attributable, auditable usage and revenue—not just a token-spend total.

This is a direction of work, not a delivery promise. We prioritize problems supported by real user feedback.

## Now: v0.1.0-alpha — validate the core loop

- [x] Deterministic inference cost and customer-level contribution calculation
- [x] Workspace-scoped, idempotent PostgreSQL usage/revenue ingestion
- [x] OpenAI post-call usage helpers and local analytics
- [x] Standalone PostgreSQL concurrency, source scanning, dependency audit, mocked-browser CI
- [ ] Verify first-time contributor completes the quickstart without help
- [ ] Collect 5 detailed developer interviews or written workflows
- [ ] Get 3 developers to independently run a local demo and report where setup breaks
- [ ] Publish clear security limitations and triage reported issues

## Next: make setup genuinely effortless

- [ ] Single-command self-hosted local demo with disposable seed data
- [ ] Automated integration fixture for the Responses API (no user prompts captured)
- [ ] Better visibility into unknown-price events and completeness
- [ ] Provider pricing import workflow with auditable effective dates and version pinning
- [ ] CI coverage for real API + database + browser flow
- [ ] Create starter examples for common Node/Next.js server applications

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

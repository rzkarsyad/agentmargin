# AgentMargin v0.4 — developer adoption candidate

Work on this branch is a **candidate, not a released or npm-published SDK**.

## Developer milestones

1. A compiled, typed, zero-runtime-dependency SDK package suitable for publishing with npm Trusted Publishing/OIDC.
2. Real Next.js App Router starter with local synthetic POST route and optional OpenAI Responses API call.
3. Opt-in external pricing importer with bounded HTTPS download, exact per-token rate parsing, source hash, preview and authenticated apply. Source is **community LiteLLM**, not provider-verified billing data.
4. Unit tests, SDK tarball contents check, full-stack CI and Next.js production build.
5. Independent developer trials and npm namespace authorization are **external gates**, not achievable by committing code.

## Required validation

- [ ] Main CI plus new Next.js starter workflow pass.
- [ ] Three developers install without assistance.
- [ ] npm `@agentmargin` namespace owner enables trusted publisher; GitHub Actions manual workflow publishes an `alpha` tagged package and npm registry returns verifiable version.
- [ ] Review community catalog estimates against official provider invoices before enabling any unattended import.
- [ ] One user confirms the full Next.js → AgentMargin → PostgreSQL → analytics loop with their own non-sensitive development workload.

## Explicitly not done

Production hardening, role-based pricing approval, a vetted provider price feed, Stripe signature handling/reconciliation, model/provider coverage outside OpenAI, server-side paginated analytics, historical provider pricing correctness, backups, incident response, and independent security review remain future work; this PR must not claim v1.0 readiness.

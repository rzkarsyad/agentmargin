# AgentMargin v0.4 — developer adoption verification

`@makinohq/agentmargin@0.4.0-alpha.2` is published. [PR #23](https://github.com/rzkarsyad/agentmargin/pull/23) is merged; [OIDC run 39898669098](https://github.com/rzkarsyad/agentmargin/actions/runs/39898669098) succeeded at `bea3962`. No subsequent version was published by this engineering continuation.

## Automated consumer evidence

On 2026-10-23, `scripts/sdk-registry-consumer-smoke.mjs` installed the **registry artifact**, not a workspace build, in a fresh temporary project outside the repository. ESM imports, TypeScript declarations, usage/revenue calls, OpenAI helper and Anthropic/Stripe exports passed. Registry SHA-512 integrity and SLSA provenance metadata were present. This is maintainer-run automated consumption, not an independent developer trial.

```bash
node scripts/sdk-registry-consumer-smoke.mjs
node scripts/sdk-registry-consumer-smoke.mjs --verify-signatures
```

The second command additionally requires cryptographic registry/provenance verification through `npm audit signatures`. Local verification failed to download trust data in the managed environment; metadata presence alone is **not** cryptographic verification. The [GitHub starter workflow](https://github.com/rzkarsyad/agentmargin/actions/runs/39908019043) subsequently passed this check: **two packages have verified registry signatures and one SDK package has a verified attestation**. The local download failure does not invalidate this separate successful evidence. Both commands clean up their temporary consumer project and never publish a package.

The Next.js starter production build passed locally; root and starter dependency audits found zero vulnerabilities. Main CI additionally validates compiled SDK package contents and a complete synthetic PostgreSQL/API/SDK/browser integration. New SDK edge fixes (IPv6 loopback, strict provider timestamps/IDs and stable invoice paid_at) are source changes awaiting review and a separately authorized future publication; they are not claimed to exist in the installed alpha.2 artifact.

## External release gates

- Three independent developers must install and use the core loop without maintainer assistance; record actual feedback and environments.
- A real non-sensitive provider development workload must be validated against official usage/billing evidence, including cached tokens and supported pricing tiers.
- Community catalog imports still require explicit operator review and source provenance. They are not official billing truth.
- Security, operations, financial reconciliation and independent release approval remain open in the [roadmap](ROADMAP.md).

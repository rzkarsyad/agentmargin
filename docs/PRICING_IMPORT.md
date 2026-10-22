# Opt-in model pricing import — v0.4 development

AgentMargin can pull a catalog entry from LiteLLM's **community-maintained** token price map, convert the rates to exact USD microdollars per million tokens, show the source digest and publish a workspace-specific version **only when explicitly requested**.

This is not an official provider price feed, and it is not an invoice reconciliation process. Providers can charge differently by model version, service tier, caching, region and batch mode. Some LiteLLM entries contain rate modifiers not represented in AgentMargin's basic rate schema.

## Quickstart

With the local demo running and an API key available:

```bash
npm run pricing:import -- --provider openai --model YOUR_EXACT_CATALOG_MODEL
# Carefully compare the preview against your provider's pricing page.
export AGENTMARGIN_API_KEY='am_YOUR_LOCAL_KEY' # Do not put keys in terminal history for real use
npm run pricing:import -- --provider openai --model YOUR_EXACT_CATALOG_MODEL --apply
```

Provider and model must exactly match the upstream community catalog entry. No arbitrary fetch URLs are supported. No AWS/GCP credentials, provider keys, customer data or prompts are transmitted by the importer. The source is pinned to the expected LiteLLM raw GitHub URL (mutable `main` snapshot), and a SHA-256 checksum is recorded in the source note. A catalog entry missing required per-token prices is rejected. Optional cached rates stay unknown when absent.

### Safe defaults

- Preview-only unless `--apply` is given.
- `--apply` writes through the authenticated workspace `/v1/prices` endpoint and its append-only audit records.
- Effective date defaults to the **moment of import**, **not** a claim about the actual historical provider price change. Do not silently backdate.
- Existing ingested usage costs do not change.
- Non-token fees, tiered rates, batch/flex/priority/long-context modifiers are **not** imported; such records print warnings.
- Review against the provider billing/pricing page. AgentMargin cannot guarantee LiteLLM data freshness or accuracy.
- For unattended imports, configure a separate scoped runtime secret, explicit approver process, alerting and provider reconciliation first. This initial importer is an operator-triggered automation, not an unattended repricer.

Upstream: https://docs.litellm.ai/docs/proxy/model_cost_map

## Weekly automatic candidate import (unapproved review artifact)

The read-only [weekly pricing scan](../.github/workflows/pricing-catalog-scan.yml) runs every Monday at 05:37 UTC and can also be started manually from GitHub Actions. It fetches the fixed LiteLLM community catalog (16 MB cap, timeout and SHA-256 digest), collects exactly representable OpenAI/Anthropic token-rate candidates, counts unsupported entries and uploads `pricing-candidates.json` as a 14-day artifact.

This is **automated discovery, not automatic billing-rate activation**. The workflow uses `contents: read`, accepts no provider credentials, and never calls `POST /v1/prices`. Every candidate remains unapproved; the artifact does not certify price effective dates, provider-specific tiers, cache-creation costs, or invoice accuracy. A maintainer must compare a selected candidate against the provider's **official** current pricing and a dated billing sample, then use the existing operator-reviewed `pricing:import -- --apply` path if appropriate. Do not use the artifact as a customer invoice or as an unattended repricer.

Run a local preview without an API key:

```bash
node --experimental-strip-types scripts/pricing-catalog-scan.ts > pricing-candidates.json
```

If the catalog is unavailable, too large, malformed or its relevant costs cannot be represented exactly, the scan fails or excludes those candidates; it never fills missing values with zero.

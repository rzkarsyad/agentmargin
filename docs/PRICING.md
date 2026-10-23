# AgentMargin workspace pricing (v0.5 alpha contract)

**Status:** experimental source-first alpha, localhost-only. Do not use actual customer or financial records in an unreviewed deployment.

## What changes from v0.2

- **Workspace-owned versions** in `workspace_price_versions`, rather than requiring manual writes to the original global `price_versions` table.
- Authenticated **`GET /v1/prices`** and **`POST /v1/prices`** endpoints. Identity comes exclusively from the AgentMargin bearer key; a caller-supplied workspace ID cannot widen scope.
- Strict input validation, source note, server-generated version ID, and creator **key digest** (never plaintext API key).
- Append-only PostgreSQL trigger rejects UPDATE and DELETE. Duplicate model + effective instant returns 409.
- New records supersede older records **from their effective timestamp** for future event ingestion, while stored usage costs and price links do not change.
- New React 19/Vite dashboard built with official **Arc UI free MIT components**, with local authenticated Overview and Model Pricing views. Arc source and MIT notice are checked in under `apps/web`. No Pro assets.
- Legacy global prices remain a read-only fallback for earlier event timestamps where no workspace version applies. These rates are operator-supplied and must not be assumed correct.

## POST /v1/prices

Request (all amounts are **USD microdollars per million tokens**, as decimal strings):

```http
POST /v1/prices HTTP/1.1
Authorization: Bearer am_YOUR_LOCAL_WORKSPACE_KEY
Content-Type: application/json
```

```json
{
  "model": "example-model",
  "effectiveFrom": "2026-10-22T00:00:00.000Z",
  "effectiveTo": null,
  "inputMicrosPerMillion": "1000000",
  "outputMicrosPerMillion": "4000000",
  "cachedInputMicrosPerMillion": null,
  "sourceNote": "Synthetic test rate; NOT a provider price quote"
}
```

A missing cached rate means **unknown cost for events with cached input tokens**. It does **not** mean $0. Both provider-reported event costs and explicit zero-value rates remain valid when applicable. The UI accepts human-readable dollars per million tokens and converts them to exact integer microdollars without floating-point calculations.

Response: HTTP `201` with `id`, `model`, `effectiveFrom`, `effectiveTo`, rates, `sourceNote`, and server-side `createdAt`. A duplicate model+effectiveFrom in the same workspace returns `409`; malformed input `400`; unknown key `401`; per-workspace rate limit `429`.

`GET /v1/prices` lists the newest 100 workspace-created price rows and a `truncated` flag. No other workspace's rows are returned. Legacy global operator prices are not included in this list.

## Effective-dated pricing semantics

For each model and event timestamp:
1. Find the latest workspace price row with `effectiveFrom <= event time`. That version applies if `effectiveTo` is absent or later than the event.
2. If a workspace version exists but expired, cost is **unknown** rather than silently falling back to another tenant or global version.
3. If no workspace row exists before the event, the old operator-managed global catalog can be used as a legacy fallback.
4. Provider-reported cost overrides estimates (including a valid reported zero).
5. Store the resolved `workspace_price_version_id` alongside the immutable usage cost. No background retroactive recalculation.

An inserted later version implicitly supersedes the earlier version for new ingestions at and after the new effective instant. Historical records remain unchanged, including records ingested before the price was added. **Backdated updates affect only future ingestion attempts for past timestamps**, not already stored events. Operators must choose accurate rates and effective dates and include evidence in `sourceNote`.

## Installation and migration

The disposable `npm run demo` applies the current 001–014 migration chain, then builds/starts the React/Arc frontend and seeded API. No network deployment.

For a clean disposable PostgreSQL 16 instance, use the [OpenAI local verification
commands](OPENAI_INTEGRATION.md#macos-disposable-postgresql--sdk--api--analytics-replay).
For an existing-schema upgrade, follow [database isolation and runtime ownership](DB_RUNTIME_ROLE.md)
and the numbered additive migration chain; never reapply or rewrite an already
applied migration. This documentation does not authorize a production migration.

## Exact event rounding and provider evidence

The engine sums the uncached-input, cached-input and output rational components
**before rounding once per event** to integer USD micros (half-up). At input
100000/output 500000 micros per million tokens, 25 input and 13 output tokens
produce 2.5 + 6.5 = **9 micros**, not 10. Aggregates sum recorded event costs;
provider aggregate rounding may differ and must remain a reported variance.

The [private OpenAI export workflow](OPENAI_INTEGRATION.md#private-openai-billing-validation-v05)
compares authentic exports using this engine and can replay supported quantities
through SDK/API/PostgreSQL/analytics. It records conditional rate provenance and
keeps historical dates, org-to-project attribution, complete product coverage and
policy approval separate. Current official pages and community catalogs cannot
silently establish historical customer prices. Provider-reported costs retain
source `reported`; CSV comparison does not turn an estimate into a reported cost.

## Security / verification

- Reading prices requires read/admin authority; adding versions requires admin. Credential-backed RLS, scoped keys and composite references contain restricted runtime access; apply the complete 007–014 chain and runtime grants together.
- The `created_by_key_digest` is immutable provenance, not an independent human approval. An admin key can affect future ingestion through added versions.
- Review [database isolation](DB_RUNTIME_ROLE.md) for ownership, direct-SQL/ingest authority and in-flight revocation limitations. Independent security approval remains open. TLS/shared deployment quotas and operational verification remain separate gates.
- The UI uses same-origin requests, no key persistence, native input labels, Arc keyboard-ready components and reduced-motion styles.
- CI checks TypeScript, migrations, PostgreSQL tenant isolation and immutability, Chromium overview, and SDK tracking. These checks are not a penetration test.

Code provenance: official free Arc UI repository, https://github.com/kuratlielia/arc-library; see `apps/web/ARC_LICENSE.txt`.

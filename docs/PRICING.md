# AgentMargin v0.3 workspace pricing (development preview)

**Status:** unreleased draft feature, localhost-only. Do not use actual customer or financial records in an unreviewed deployment.

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

The disposable `npm run demo` applies `db/004_workspace_pricing.sql` after migrations 001–003, then builds/starts the React/Arc frontend and seeded API. No network deployment.

For a manually managed, disposable PostgreSQL database that already has 001–003:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/004_workspace_pricing.sql
npm ci
npm run build:web
npm run start -w @agentmargin/api
```

Review database access and take a disposable backup first. **Do not apply this migration to production.** Existing release v0.2 does not include it. The migration is not reversible through a shipped automated down-migration.

## Security / verification

- Only the authenticated workspace can create and list prices, enforced by SQL workspace filters and a composite foreign key on linked usage.
- The `created_by_key_digest` records which workspace key introduced a price but is **not** an independent user/role system. Any valid workspace bearer key can currently change the *future* price history by adding new versions.
- Database role compromise bypasses application authorization. No RLS, RBAC, public TLS ingress, backups or incident-response processes are supplied.
- The UI uses same-origin requests, no key persistence, native input labels, Arc keyboard-ready components and reduced-motion styles.
- CI checks TypeScript, migrations, PostgreSQL tenant isolation and immutability, Chromium overview, and SDK tracking. These checks are not a penetration test.

Code provenance: official free Arc UI repository, https://github.com/kuratlielia/arc-library; see `apps/web/ARC_LICENSE.txt`.

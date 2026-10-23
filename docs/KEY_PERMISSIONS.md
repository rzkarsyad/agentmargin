# Workspace API key roles — v0.8 scoped credentials

AgentMargin supports three **workspace-level** API key roles after applying `db/005_api_key_roles.sql` and updating the API. All roles are bound to the workspace determined by the verified bearer key; client-supplied workspace IDs are ignored for authorization.

| API operation | `admin` | `ingest` | `read` |
| --- | :---: | :---: | :---: |
| `POST /v1/events` | Yes | Yes | No |
| `POST /v1/revenue` | Yes | Yes | No |
| `GET /v1/analytics`, `GET /v1/analytics/page` | Yes | No | Yes |
| `GET /v1/prices` | Yes | No | Yes |
| `POST /v1/prices` | Yes | No | No |
| Future or unrecognized `/v1/*` methods/paths | Admin only until explicitly reviewed | No | No |

An authenticated but unauthorized operation returns HTTP `403`; a missing, malformed, revoked or expired bearer token returns `401` (subject to invalid-auth throttling). A role is not a substitute for limiting what data an **authorized** key can see within its workspace.

## Upgrade and compatibility

These are **additive database migrations**, not a production rollout. Operators with a separately privileged migrator account should review the deployment and apply migrations 001–006 in order on a new database. For an existing database, apply **only migrations that have not yet been run**, before starting the updated API. If currently at 004, run both commands below; if already at 005, **skip the first command**:

```bash
psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/005_api_key_roles.sql
psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/006_api_key_expiry.sql
```

Existing API key rows gain `access_role='admin'` by default and `expires_at=NULL`, so integrations continue to work. This is **compatibility, not least privilege or a rotation policy**; migrate to lower-privilege, expiring keys and revoke broad legacy keys. Older API binaries ignore the added columns if rollback is needed; avoid destructive schema rollback. The new API requires migration 006 before startup.

To create a key from a trusted admin workstation (never from the public API), first configure `DATABASE_URL` securely in the shell or through a secret manager to point to the **admin/migrator** database connection. Then use the existing CLI with an explicit role:

```bash
node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID reader read 30
node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID writer ingest 90
```

The third positional argument is the key name; the fourth is `admin`, `ingest`, or `read`; the optional fifth argument is lifetime in days (`1`–`365`, default `90`). For backwards compatibility, omitting the role still creates an `admin` key, but newly issued CLI keys **always expire**. The CLI prints the raw secret **once** along with its UTC expiry; never paste it into issue trackers, CI logs or screenshots. Use `apps/api/src/revoke-key.ts` to invalidate keys after rotating them. Plan overlap so clients are updated before expiration; rotation is not automated.

## Risk and acceptance evidence

Unit tests exercise the authorization matrix, admin compatibility, fail-closed unknown `/v1/*` routes and revocation behavior. CI's disposable PostgreSQL 16 suite verifies that expired keys are rejected, existing keys remain valid and roles are persisted through the real adapter. The runtime SQL role remains separate from the schema migrator; it can SELECT key roles/expiry but cannot create or revoke keys.

**Production remains blocked:** manual rotation is still required, and no per-customer grant, independently verified access review, database RLS, distributed abuse limit or secure managed key lifecycle exists. Legacy keys do **not** automatically expire. A compromised `admin` key still gives full workspace API privileges until revocation/expiry, and a stolen shared DB runtime credential still bypasses application authorization. See [tenant threat model](TENANT_THREAT_MODEL.md) and [database role](DB_RUNTIME_ROLE.md).

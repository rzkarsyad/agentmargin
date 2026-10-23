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

An authenticated but unauthorized operation returns HTTP `403`; a missing, malformed or revoked bearer token returns `401` (subject to invalid-auth throttling). A role is not a substitute for limiting what data an **authorized** key can see within its workspace.

## Upgrade and compatibility

This is an **additive database migration**, not a production rollout. Operators with a separately privileged migrator account should review the deployment and apply migrations 001–005 in order on a new database; on an existing 004 database, **apply only 005 once, before starting the updated API**:

```bash
psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/005_api_key_roles.sql
```

Existing API key rows gain `access_role='admin'` by default so existing client integrations continue to work. This is **compatibility, not least privilege**; plan migration to new lower-privilege keys and revoke broad legacy keys. Older API binaries ignore the extra column if rollback is needed; avoid destructive schema rollback. A database still at migration 004 cannot run the new API's credential query successfully.

To create a key from a trusted admin workstation (never from the public API), use the existing CLI with an explicit role:

```bash
DATABASE_URL="$AGENTMARGIN_ADMIN_DATABASE_URL" node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID reader read
DATABASE_URL="$AGENTMARGIN_ADMIN_DATABASE_URL" node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID writer ingest
```

The third positional argument is the key name; the fourth is `admin`, `ingest`, or `read`. For backwards compatibility, omitting the role still creates an `admin` key. The CLI prints the raw secret **once**: never paste it into issue trackers, CI logs or screenshots. Use `apps/api/src/revoke-key.ts` to invalidate keys after rotating them.

## Risk and acceptance evidence

Unit tests exercise the authorization matrix, admin compatibility, fail-closed unknown `/v1/*` routes and revocation behavior. CI's disposable PostgreSQL 16 suite proves roles are persisted and enforced through the real adapter. The runtime SQL role remains separate from the schema migrator; it can SELECT key roles but cannot create or revoke keys.

**Production remains blocked:** no key expiry, per-customer grant, independently verified access review, database RLS, distributed abuse limit or secure managed key lifecycle. A compromised `admin` key still gives full workspace API privileges, and a stolen shared DB runtime credential still bypasses application authorization. See [tenant threat model](TENANT_THREAT_MODEL.md) and [database role](DB_RUNTIME_ROLE.md).

# PostgreSQL credential-backed tenant isolation (v0.7 candidate)

**Implemented candidate; independent review and deployment validation remain release gates.** Migration `007_credential_tenant_isolation.sql` adds RLS to customers, usage, revenue and workspace pricing. It preserves existing rows, keys and financial calculations. PostgreSQL 16 is the tested deployment target.

## Security design and alternatives

A workspace ID in a session setting is caller-controlled and cannot defend against theft of a shared database password. Per-tenant database logins would provide a strong identity boundary but require separate credential provisioning and pool routing. A complete stored-procedure API would prevent direct table access but duplicate the existing data-access layer. The selected smaller boundary is RLS backed by proof of possession of a workspace bearer key.

The API creates an immutable, request-local store sharing the existing pool. Every operation starts a transaction and installs the **raw bearer credential** with parameterized `set_config(..., true)`. RLS derives identity by hashing that secret inside PostgreSQL and checking the protected key table. An arbitrary ID, digest, invalid key, expired key or revoked key provides no authority. Context clears on commit/rollback; each new operation explicitly overwrites it. Never install tenant context outside a transaction. Session and transaction pooling are supported; statement pooling is not.

Only two narrow `SECURITY DEFINER` SQL functions read key metadata. Both have a fixed `pg_catalog` search path, fully qualified application references, no dynamic SQL and no PUBLIC execute grant. The runtime cannot select key digests or workspace metadata, provision keys, alter policies, update/delete financial rows or create schema objects. Global legacy model prices remain readable; they contain no workspace data.

All valid key roles can read their own tenant rows at the SQL boundary: ingestion needs existing payload digests and prices. HTTP `read` and `ingest` routes remain distinct. SQL inserts require `ingest`/`admin`; pricing inserts require `admin` and a matching creator digest. A stolen DB password **and** an ingest bearer key therefore permit tenant reads beyond that key's HTTP routes. Narrowing this further needs a stored-procedure ingestion interface. No role can cross tenants using a different workspace parameter.

## Trust and residual risks

- Owner/migrator and function owner are trusted. They can bypass or change RLS; they must never be API runtime credentials. The key table deliberately has no RLS because only trusted provisioning and definer functions can access it.
- The runtime must have no ownership, elevated memberships, superuser, `BYPASSRLS`, role creation, database creation or replication rights. Review effective PUBLIC grants, extensions and other definer functions; this template cannot neutralize unrelated deployment privileges.
- This protects against a stolen **runtime DB password alone**, not compromise of the API host, raw bearer keys, owner credentials, database host or backups. A compromised active request exposes its own tenant credential. Runtime connections share a PostgreSQL login; operators must restrict statistics/logging/extension access and must not record bound parameters or bearer secrets.
- Revocation is checked on subsequent statements. Existing repeatable-read snapshots and already-running queries can finish; statement and idle-transaction timeouts bound ordinary operations. This is not instantaneous cancellation of in-flight work.
- No production-ready claim follows from synthetic tests. Independent SQL/security review, configured TLS/ingress, secret management, recovery, privacy and distributed abuse controls remain open.

## Applying in a disposable development database

Use a dedicated empty local database, **never production**:

```bash
for migration in db/00*.sql; do
  psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
```

Create a separate `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT` role as DBA, set its password through a secret manager or `\password`, grant CONNECT only to this database, and give it no owner-role membership. Remove unneeded PUBLIC CREATE/TEMP privileges and audit inherited grants. Then:

```bash
psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v runtime_role=agentmargin_runtime -f db/runtime_privileges.psql
env DATABASE_URL="$AGENTMARGIN_RUNTIME_DATABASE_URL" node --experimental-strip-types apps/api/src/server.ts
```

For an existing schema, pause API traffic, apply **only 007 after 006**, reapply the grants, deploy the matching API, then test synthetic requests before resuming. Old API binaries cannot authenticate with the restricted grants. Do not restore broad grants to roll back: roll forward or restore an isolated verified backup. The migration takes table locks; assess lock duration on a staging copy. Key provisioning/revocation still uses owner tooling. There is no data rewrite or SDK contract change.

## Automated acceptance

`npm run check` tests the HTTP and SDK flow; `npm run test:postgres` requires a dedicated empty database named `agentmargin_ci` and runs against PostgreSQL 16 in CI. It verifies direct SQL default deny, forged workspace/digest context, cross-tenant SELECT/INSERT, all protected tables, HTTP roles, revoked/expired keys, write scopes, pooled A/B reuse, rollback cleanup, identical financial totals, existing-row upgrades and transaction-atomic migration failure/retry. Only synthetic random test roles are removed afterward.

See [threat model](TENANT_THREAT_MODEL.md), [key permissions](KEY_PERMISSIONS.md) and [PostgreSQL row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

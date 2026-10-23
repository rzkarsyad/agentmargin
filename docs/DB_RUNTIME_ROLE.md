# PostgreSQL runtime role — v0.7 least-privilege candidate

**Not a production deployment recipe or a substitute for RLS.** This is a separately administered runtime database role that allows AgentMargin's current API queries but not arbitrary SQL updates, deletes, truncation, table creation or schema changes. A compromised runtime credential can still **read all workspaces** until tenant-scoped row-level security has been designed and independently tested.

## Separation of duties

- **Owner/migrator:** creates roles and databases, applies `db/001_initial.sql` through `db/005_api_key_roles.sql`, and provisions/revokes workspace API keys. Never use its credentials in the API process.
- **Runtime:** a separate `LOGIN` role with no elevated membership, superuser, database/role creation, replication or RLS-bypass rights. It receives only schema `USAGE`, table `SELECT` required for authenticated ingestion/pricing/analytics, and `INSERT` for customers, usage, revenue and append-only price versions.
- **Operator:** reviews grants whenever migrations add or rename tables, functions, sequences or API SQL. The script does **not** install RLS policies or grant application key management.

## Manual deployment review (PostgreSQL 16+)

1. In a dedicated, initially **non-production** database, connect with a privileged DBA role and create `agentmargin_runtime` with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`. Set a high-entropy password via a secrets manager or psql's interactive `\password agentmargin_runtime`; never put it on a command line or in Git. Do not make it a member of the owner/migrator role.
2. Grant this role `CONNECT` to **only the intended application database**. Review effective `PUBLIC` grants on that database and on schema `public`; remove broad `CREATE`/temporary privileges if the deployment permits, with a DBA-approved change plan. A grant to `PUBLIC` can undo restrictive assumptions about an individual role.
3. Apply the optional grants from the repository root *to the intended database* as the owner/migrator:

   ```bash
   psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -v runtime_role=agentmargin_runtime -f db/runtime_privileges.psql
   ```

4. Check that the runtime user can authenticate, read pricing and analytics, and insert synthetic usage/revenue, but cannot insert API keys, update/delete/truncate records, select the `workspaces` table or create/alter tables. Use a **separate, non-production** connection URL as `DATABASE_URL` for the API process. Keep admin/migration credentials out of runtime environment variables.
5. Rotate credentials through the deployment's secret manager and retest after schema migrations. Configure TLS and trusted ingress before *any* public exposure.

The grants are **not part of the automatic schema migrations**. They may require additional restrictions in deployments with custom schemas, historical PostgreSQL defaults or extra roles. No default privileges are granted for future tables: review each new migration before granting runtime access.

## Automated evidence and remaining gaps

`npm run test:postgres` provisions a uniquely named, unprivileged throwaway role inside the explicitly named empty `agentmargin_ci` database, applies the same SQL grants with only the role identifier substituted, exercises the actual API PostgreSQL adapter, verifies denial of privileged SQL, then removes that test role. CI runs this on PostgreSQL 16.

This only proves **database operation least privilege**, not tenant isolation against a stolen DB credential. PostgreSQL table owners, superusers and roles with `BYPASSRLS` can bypass RLS; any future policy must be built around trusted, transaction-scoped workspace identity, default-deny tests and a separated migration role. Do not claim production safety from this test.

See [PostgreSQL GRANT](https://www.postgresql.org/docs/16/sql-grant.html), [role attributes](https://www.postgresql.org/docs/16/role-attributes.html), [row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) and [AgentMargin security policy](../SECURITY.md).

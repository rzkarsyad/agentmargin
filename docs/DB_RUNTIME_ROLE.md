# PostgreSQL credential-backed tenant isolation (v0.7 candidate)

**Implemented candidate; independent review and deployment validation remain release gates.** Migration `007_credential_tenant_isolation.sql` adds RLS to customers, usage, revenue and workspace pricing. It preserves existing rows, keys and financial calculations. PostgreSQL 16 is the tested deployment target.

## Security design and alternatives

A workspace ID in a session setting is caller-controlled and cannot defend against theft of a shared database password. Per-tenant database logins would provide a strong identity boundary but require separate credential provisioning and pool routing. A complete stored-procedure API would prevent direct table access but duplicate the existing data-access layer. The selected smaller boundary is RLS backed by proof of possession of a workspace bearer key.

The API creates an immutable, request-local store sharing the existing pool. Every operation starts a transaction and installs the **raw bearer credential** with parameterized `set_config(..., true)`. RLS derives identity by hashing that secret inside PostgreSQL and checking the protected key table. An arbitrary ID, digest, invalid key, expired key or revoked key provides no authority. Context clears on commit/rollback; each new operation explicitly overwrites it. Never install tenant context outside a transaction. Session and transaction pooling are supported; statement pooling is not.

The narrow principal/workspace helpers establish identity from protected key metadata with fixed catalog lookup, qualified application references, no dynamic SQL and no PUBLIC execute grant. Later migrations add catalog-safe validation, replay and reviewed recovery helpers, described below; their owners remain trusted. The runtime cannot select key digests or workspace metadata, provision keys, alter policies, update/delete financial rows or create schema objects. Global legacy model prices remain readable; they contain no workspace data.

Read/admin keys may read their tenant's financial rows. Migration 009 removes ingest bulk financial SELECT and uses an exact-ID digest helper for replay. Ingest still sees its tenant's pricing, inbox and source metadata beyond its HTTP routes; normal worker state authority remains, while 014 requires reviewed recovery for failed-row resets. SQL inserts require ingest/admin; pricing inserts require admin and the matching creator digest. Stronger separation needs reviewed procedures or separate identities. Another workspace parameter provides no authority.

## Trust and residual risks

- Owner/migrator and function owner are trusted. They can bypass or change RLS; they must never be API runtime credentials. The key table deliberately has no RLS because only trusted provisioning and definer functions can access it.
- The runtime must have no ownership, elevated memberships, superuser, `BYPASSRLS`, role creation, database creation or replication rights. The grants script now rejects elevated attributes, INHERIT, all role memberships, ownership of application objects, CREATE privileges and excess effective financial/auth-table privileges. It revokes direct/PUBLIC authentication-table grants, including tested column grants. Review extensions and other unrelated definer functions separately; the checks cannot prove an arbitrary deployment free from indirect escalation paths.
- This protects against a stolen **runtime DB password alone**, not compromise of the API host, raw bearer keys, owner credentials, database host or backups. A compromised active request exposes its own tenant credential. Runtime connections share a PostgreSQL login; operators must restrict statistics/logging/extension access and must not record bound parameters or bearer secrets.
- Migration 009 rejects authentication outside native READ COMMITTED. Revocation is checked on new statements, but admitted cursors/in-flight statements can finish with their prior snapshot. Statement and idle timeouts are operational defaults, not an absolute transaction lifetime or instantaneous revocation. See the containment procedure below.
- No production-ready claim follows from synthetic tests. Independent SQL/security review, configured TLS/ingress, secret management, recovery, privacy and distributed abuse controls remain open.

## Applying in a disposable development database

Use a dedicated empty local database, **never production**:

```bash
for migration in db/[0-9][0-9][0-9]_*.sql; do
  psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
```

Create a separate `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT` role as DBA, set its password through a secret manager or `\password`, grant CONNECT only to this database, and give it no owner-role membership. Remove unneeded PUBLIC CREATE/TEMP privileges and audit inherited grants. Then:

```bash
psql "$AGENTMARGIN_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v runtime_role=agentmargin_runtime -f db/runtime_privileges.psql
env DATABASE_URL="$AGENTMARGIN_RUNTIME_DATABASE_URL" node --experimental-strip-types apps/api/src/server.ts
```

For an existing schema, drain API/receiver/worker traffic and apply **only unapplied migrations through 014**, in order after the existing schema, reapply final grants, deploy the matching API/worker/receiver and test synthetic requests before resuming. Do not deploy intermediate 007–013 as the finished security boundary or replay applied migrations. Old API binaries cannot authenticate with the restricted grants. Do not restore broad grants to roll back: roll forward or restore an isolated verified backup. The migration takes table locks; assess lock duration on a staging copy. Key provisioning/revocation still uses owner tooling. There is no data rewrite or SDK contract change.

## Automated acceptance

`npm run check` tests the HTTP and SDK flow; `npm run test:postgres` requires a dedicated empty database named `agentmargin_ci` and runs against PostgreSQL 16 in CI. It verifies direct SQL default deny, forged workspace/digest context, cross-tenant SELECT/INSERT, all protected tables, HTTP roles, revoked/expired keys, write scopes, pooled A/B reuse, rollback cleanup, identical financial totals, existing-row upgrades and transaction-atomic migration failure/retry. Only synthetic random test roles are removed afterward.

See [threat model](TENANT_THREAT_MODEL.md), [key permissions](KEY_PERMISSIONS.md) and [PostgreSQL row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

## Preliminary integration-readiness review (2026-10-23)

This is an implementer review, **not independent security approval**. #24 → #25 → #26 → #27 remains unmerged; approval of the security migration and critical residual findings is required before any merge.

- Confirmed fixed-search-path, fully qualified SECURITY DEFINER lookups; no dynamic SQL or trusted workspace assertions. Added adversarial tests for a temporary shadow key table, SQL-shaped credential input, definer-function replacement/ownership and disabling RLS.
- A suspected stale column-grant bypass did **not** reproduce on PostgreSQL 16: REVOKE ALL removed the tested direct and PUBLIC column grants. This is recorded as a rejected hypothesis, not a vulnerability finding.
- Hardened the runtime grant template to refuse unsafe attributes, memberships (including NOINHERIT roles that could SET ROLE), ownership, PUBLIC CREATE and forbidden effective privileges. A failed setup transaction leaves rollout blocked; never start traffic after a failed grant check. The supported runtime is a dedicated login without any role memberships.
- Migration 007 now has a 5-second lock timeout and 60-second statement timeout. A real lock-contention regression test verifies full rollback and successful retry. No live schema was changed. The SQL migration is still an unmerged candidate: reset a disposable database if an older checksum was recorded; never silently edit an applied live migration.
- Revocation is enforced in subsequent fresh transactions. A PostgreSQL REPEATABLE READ/SERIALIZABLE snapshot can continue seeing the pre-revocation key row. **Statement/idle timeouts do not impose a hard lifetime on a continuously active malicious transaction.** Password-plus-bearer-key compromise therefore needs session termination/containment; independent review must explicitly accept this boundary or require stronger identity/lease isolation before rollout. No immediate revocation of arbitrary hostile SQL sessions is claimed.
- Owners/superusers, API-host compromise, SQL side channels through global constraints, unrelated extensions/definer functions, and distributed resource abuse remain deployment-review concerns. This review found no cross-tenant read/insert bypass for the correctly provisioned runtime password alone in the exercised tests; that is bounded evidence, not proof of absence.

After explicit approval, merge **24, then 25, then 26, then 27**, retargeting each remaining PR to main and rerunning checks as its base changes. Keep branches until dependents are retargeted. Pause/drain writers; provision and validate a separate runtime; apply 007 only after 006; reapply the grants; deploy the matching API; exercise synthetic tenant tests and schema-aware readiness before resuming. If lock/setup validation fails, leave traffic paused and roll forward or use a reviewed isolated restore. Never restore broad runtime grants as a rollback shortcut.


The separate durable-delivery candidate adds migration 008 and updates the grant template to require it. Its mutable inbox state columns are intentionally distinct from immutable financial payload fields; the template rejects excess payload-update and delete privileges. On that branch apply 008 before its grants and deploy the matching API/worker. The #24 branch itself still requires only 007. This optional migration needs separate review and inherits every unapproved security gate above.

### PostgreSQL 16 containment follow-up (migration 009)

Migration 009 is additive after 008. It rejects authentication unless PostgreSQL's **actual transaction isolation** is READ COMMITTED. Changing `default_transaction_isolation` does not change an existing snapshot; PostgreSQL refuses changing `transaction_isolation` after a query. READ UNCOMMITTED, REPEATABLE READ and SERIALIZABLE therefore fail closed. Analytics now gathers totals, page and diagnostics in a single READ COMMITTED SQL statement, preserving one financial snapshot without retaining authentication across statements. Upgrade requires a traffic drain, migration 009, updated grants and matching API; old REPEATABLE READ analytics binaries fail closed.

Adversarial PostgreSQL 16 tests reproduce the pre-009 stale-key snapshot, verify rejection under both reusable isolation levels (including attempted GUC disguises), revoke a key during a READ COMMITTED transaction, test next-statement denial, and verify pooled replay. Migration failure rolls back and existing revenue remains readable. These are implementer tests, **not independent review**.

Ingest credentials now cannot SELECT customer, usage or original revenue rows. A private SECURITY DEFINER function returns only the digest for an exact, known, same-tenant event ID after ingest authorization. It has a fixed `pg_catalog` search path, qualified tables, no dynamic SQL, no PUBLIC EXECUTE and no caller-asserted tenant authority. This still exposes an exact-ID existence/digest oracle. Ingest keys plus the database password can read tenant pricing and the durable inbox needed for replay, enqueue arbitrary normalized records, and change granted inbox state columns. They must not be represented as equivalent to HTTP-only ingest capabilities. A separate worker identity and restricted enqueue/replay procedures would further reduce inbox authority; per-workspace database identities reduce shared-password blast radius but require provisioning/pooling infrastructure. Neither is silently claimed to exist here.

READ COMMITTED does **not** revoke a statement's existing snapshot. A hostile statement begun before revocation can continue, including through a client-controlled server cursor. Runtime clients can change session timeouts. `statement_timeout` and `idle_in_transaction_session_timeout` are operational defaults, **not an absolute maximum transaction lifetime**. A stolen read/admin bearer credential plus the runtime password still permits its authorized tenant reads until effective containment. Owner, host, extension and migration-credential compromises remain outside this boundary.

`db/contain_runtime_sessions.psql` is an operator-only incident tool, not automatic key revocation. Under separately authorized incident response, stop ingress/workers, disable new logins for the dedicated shared runtime role, terminate **all** its database sessions, and confirm no sessions remain before any credential recovery/re-enable. Do not select victims using caller-controlled workspace GUCs or application names. The tool commits NOLOGIN before termination to stop reconnects; test it only against a generated disposable role. It interrupts all tenants sharing the role. Termination races, alternate credentials, privileged sessions and replica snapshots require operator investigation. Never automatically restore LOGIN as part of this tool.

**Gate remains open:** independent review must approve migrations 007–009, helper ownership/ACLs, the residual inbox/digest authority, in-flight statement behavior, credential separation and the incident containment procedure. Synthetic tests do not establish production readiness or a hard revocation deadline.

The adjustment/delivery follow-ups (010–011) preserve the same unapproved boundary. Ingest SQL credentials can read their tenant's normalized inbox financial payloads and payment-source metadata. The payment validation trigger also permits an own-tenant remaining-amount oracle through attempted writes/rollbacks. Narrowing original-table SELECT does not eliminate these capabilities. Strong separation requires different API enqueue and replay database identities plus reviewed restricted procedures (or isolated tenant credentials/infrastructure); it is not achieved by HTTP scopes or a session variable. Independent review must assess these authorities and every new fixed-search-path definer trigger before rollout.


## Delivery recovery extension (012)

Apply 012 after 011 with writers drained, then reapply runtime grants and deploy
the matching API/worker. Readiness now requires the recovery tables/function;
old intermediate schemas fail closed. `delivery_history` permits tenant read/admin
SELECT only; `delivery_requeues` permits tenant admin SELECT only. Neither grants
runtime INSERT/UPDATE/DELETE/TRUNCATE. The trigger and recovery function have
fixed `pg_catalog` search paths, qualified table names and revoked PUBLIC EXECUTE.
Only the admin-authorized function can increase retry cycles under runtime grants.
Its owner is the trusted migrator. Checkpoints preserve pre-012 receipts without
inventing historical attempts. Normal append-only protections also cover audit
rows. Independently review these new definer functions and inherited/effective
grants with 007–011; no independent acceptance has occurred.


## Catalog shadowing containment (013) — confirmed finding

PostgreSQL implicitly searches `pg_temp` first for **relations/types** even with
`search_path=pg_catalog`, unless `pg_temp` is explicitly placed last. The ownership
guards in 010/011/012 read unqualified `pg_roles`/`pg_class`. A restricted runtime
with TEMP privilege plus its own ingest key can forge those temporary catalogs,
skip the pre-RLS guard, and distinguish another tenant's hidden payment through
privileged BEFORE-trigger validation errors. The final RLS INSERT check still
blocks cross-tenant insertion; no cross-tenant SELECT result or write was
established. This is a confirmed cross-tenant error oracle, not a blanket RLS bypass.

Migration 013 replaces the three affected definer trigger functions with
**explicitly qualified `pg_catalog.pg_roles`/`pg_catalog.pg_class` references**
and `search_path=pg_catalog,pg_temp`. Application relations remain schema-qualified. The real PostgreSQL 16
suite reproduces the hidden-payment allowance error **before** 013, then requires
`42501 Adjustment authorization denied` for the exact same session, key and forged
temporary catalogs after 013. Failure/rollback/retry are tested. Readiness requires
the fixed paths. Apply after 012 with the entire review stack; do not deploy
007–012 alone as a completed security migration. Independent review must assess
this remediation and TEMP/extension/definer authority; the security gate remains open.


Restores performed with `--no-acl` recreate default PUBLIC function EXECUTE grants.
The runtime template now explicitly revokes PUBLIC access to `agentmargin_auth`
and all its functions **before** granting its exact runtime entry points. Reapply
it on the isolated restore before enabling runtime access. Do not treat restored
ownership/schema counts alone as privilege verification. This hardens the restored
permission contract; current proof-checking functions still require bearer keys,
so no new cross-tenant data bypass is asserted from default EXECUTE alone.


## Reviewed recovery containment (014)

Direct runtime UPDATE grants previously allowed a failed inbox row to be reset
without the reviewed RPC. Additive 014 uses a catalog-qualified SECURITY INVOKER
trigger: runtime callers may only advance pending attempts by one, retain their
cycle, and respect retry backoff. Failed/delivered rows cannot be reset directly,
even with an admin bearer key. The admin-authorized SECURITY DEFINER recovery
function updates as the trusted owner after checking proof, digest, classification,
review receipt and cycle bounds. Owner/migrator remains trusted. Readiness now
requires both transition triggers; apply through 014 before enabling the candidate.
PostgreSQL tests deny direct ingest/admin resets, allow reviewed recovery and
exercise migration rollback/retry and normal worker behavior. Pending-state
completion/state authority still belongs to the runtime worker; this is not a
separate writer/worker credential architecture or independent approval.


## Pre-migration session boundary for a separately approved rollout

Draining normal HTTP writers alone does not close admitted SQL cursors, including
WITH HOLD results retained after commit. Before an approved existing-schema
security rollout, the operator must inventory and close the old runtime pools and
sessions as part of the reviewed downtime/containment plan. The separately owned
NOLOGIN/session-termination tool has a shared-role, all-tenant availability impact;
its use on any deployed database requires explicit incident/rollout authorization.
No such action is authorized or performed by this source audit. A migration or key
revocation cannot recall previously returned rows. Independent reviewers must
accept this boundary or require a different credential/capability architecture.
Verify encrypted recovery evidence and migration hashes first, apply only unapplied
001–014 in order with matching code/final grants, and test negative tenant and
financial probes in quarantine before any independently authorized traffic resume.
Never silently rerun/edit a recorded migration or recover with broad runtime grants.

## AI review remediation: 015–016 deployment contract

Apply only unapplied 015 then 016 during a reviewed drained rollout. Do not edit
001–014 or re-run 016 to bless drift: its owner-only security_contract captures
the reviewed installation, including policy expressions/roles/commands, function
definitions/settings and trigger bindings/enabled state. Readiness compares the
installed contract and checks effective dangerous runtime privileges, PUBLIC
function access and common definer ownership. A migrator who can replace both
baseline and verifier remains trusted. Validate the installed baseline against a
clean reviewed migration chain; it is not an independent approval or arbitrary
extension audit. 016 adds explicit pg_temp-last to all remaining definers.

Provisioning now requires a DBA who may set superuser logging defaults. It removes
PUBLIC/runtime TEMP on the **dedicated** database (review other application roles
first). A direct or inherited TEMP grant makes provisioning fail. Inbox INSERT
is limited to payload columns; state/attempts/retry history default in PostgreSQL.
A separate completion trigger requires matching immutable ledger/account evidence;
the invoker transition guard and reviewed admin requeue path remain separate.
Shared runtime+ingest still permits own-tenant payload assertions, failure/worker
operations and within-tenant data poisoning; this is containment, not separation
of worker capabilities. The accepted cursor/in-flight boundary is unchanged.

### Bearer-safe logging and authenticated transport (AM-02)

Every credential-bound checkout checks effective log_parameter_max_length=0,
log_parameter_max_length_on_error=0, auto_explain.log_parameter_max_length=0,
auto_explain.log_min_duration=-1 and pgaudit.log_parameter=off (absent extension
settings use safe fallbacks), **before** any bearer bind. Disable auto_explain
for runtime sessions: EXPLAIN VERBOSE may expose literals even if bind logging
is truncated. Provisioning supplies role defaults. Per-database role settings,
startup options and reused-session overrides are checked, not assumed safe. A
bad setting rejects the request before transmitting a credential; readiness
fails too. Stop and review incompatible provider-managed settings; never restore
unsafe logging for convenience. Recycle pools after changing defaults.

For every non-loopback URL require **sslmode=verify-full** and a trusted CA,
matching certificate hostname and database identity, for example:

```sh
# Placeholder only. Supply credentials through the operator's private mechanism.
DATABASE_URL='postgresql://runtime@db.example.invalid/agentmargin?sslmode=verify-full&sslrootcert=/private/db-ca.pem'
```

The URL cannot override host via query parameters, and require/prefer/verify-ca
are rejected. A remote checkout additionally requires pg_stat_ssl.ssl=true.
Node pg handles certificate/hostname validation with verify-full; an observed TLS
bit alone would not authenticate the peer. Provisioned pools are trusted application
configuration; operators must not provide a custom pool disabling verification.
Loopback-only synthetic fixtures may use plaintext; their results do not validate
a deployed certificate. Test an untrusted CA and mismatched hostname in the target
nonproduction topology before approval. Unix socket/remote proxy topologies need
separate reviewed configuration rather than a silent TLS exception.

Synthetic PostgreSQL log tests reproduce unlimited bind logging with a fictional
key and verify protected application proof is absent. These controls cover standard
statement/error logs and the named extension settings. They cannot hide secrets
from a malicious DBA, debugger, unreviewed extension, driver trace or network/TLS
endpoint operator. Inventory installed extensions and logs/shipper access privately;
short-lived proof or distinct credential architecture remains a human design gate.

Readiness additionally pins the 47-entry PostgreSQL 16 policy/function/trigger
baseline to the source-generated SHA-256
b85b4896a7c818c4956b065b337f262618b62af3910c088af21e3db7837ad95c.
Ordering uses C collation. Recomputing the installation table from a pre-existing
weakened policy therefore still fails readiness; a regression tests that case.
Future reviewed migrations/PG definition-format changes require a reviewed source
fingerprint update and matching binaries, never rewriting 016 or automatically
blessing the installed database. This is drift detection, not remote attestation
against a malicious DBA who controls catalog queries and the verifier function.

The effective-session guard also requires debug_print_parse, debug_print_rewritten
and debug_print_plan to be off. PostgreSQL debug trees/plans may expose literal
or encoded constant values independently of bind-parameter truncation. Provisioning
sets their role defaults; pooled override negatives verify denial before proof.

# AgentMargin tenant threat model — owner draft (v0.7 review input)

**Status: preliminary, repository-based assessment — NOT an independent security review or authorization for a public production deployment.** Reassess this model when the deployment topology, database roles, integrations, or authentication model changes.

## Assets, actors and trust boundaries

AgentMargin holds tenant API-key **digests**, customer IDs, AI usage and model names, calculated/reported costs, revenue records, and effective-dated pricing. These are commercially sensitive even when prompts and model outputs are not stored. Customer IDs, model names, `sourceNote` text and operational metadata may contain personal data if an integrator sends it.

| Boundary | Trusted component and current behavior | Untrusted input or principal |
| --- | --- | --- |
| Internet/edge → API | Hono API binds to `127.0.0.1` in the example server; TLS/ingress are deployment responsibilities | Network clients, headers, endpoints and JSON bodies |
| Bearer key → workspace context | `apps/api/src/app.ts` validates the bearer format, hashes the token, authenticates through `workspace_api_keys`, then sets server-derived `workspaceId` | User-supplied `workspaceId`, customer IDs, models, period/cursors and token strings |
| API → shared PostgreSQL | `apps/api/src/postgres.ts` parameterizes queries and filters application data with `workspace_id`; an optional runtime role has read/append-only grants | A stolen API process credential, SQL injection, compromised deployment or extensions |
| Owner/migrator → database | Schema migrations and key provisioning require separate administrative credentials | Operators, CI secrets, migrations and supply-chain dependencies |
| Integrations/pricing → financial ledger | Stripe signatures and usage conversion have local tests; imports require explicit operator approval | Webhooks, provider responses, third-party/community pricing catalogs |
| Backups/logging → operators | Synthetic restore drill and opt-in allowlisted request logs exist | Cloud storage, reverse proxies, APM vendors, alert pipelines and persons with log/backup access |

The `@makinohq/agentmargin` npm SDK and example integrations must be treated as external-client components; their configuration must never contain database administrative credentials.

## Abuse cases, evidence and residual risk

| Threat | Present control / evidence | Remaining risk and required mitigation | Priority |
| --- | --- | --- | --- |
| Guess, reuse or steal a bearer key | Hashed keys, server-derived workspace context, revocation CLI, role-based permissions, expiry for new CLI-issued keys, malformed/unknown credential throttling | A stolen valid key retains its permitted capabilities until revoked/expired; legacy keys remain broad `admin` without expiration. Prove rotation drills, monitoring and more granular scopes | **Critical** |
| Force cross-tenant reads through `workspaceId` or cursor | Application SQL binds the authenticated workspace; PostgreSQL CI checks cross-tenant analytics, prices and totals | Credential-backed RLS candidate in migration 007 and direct PostgreSQL 16 SQL tests; independent review and effective deployment grants remain open | **Critical** |
| Compromise the API's PostgreSQL credential | Least-privilege runtime grants disallow UPDATE/DELETE/DDL and key creation; CI tests permissions | Migration 007 requires proof of a raw workspace key at the SQL boundary; runtime cannot read key digests. Owner/API-host compromise and stolen DB password plus bearer key remain trusted-boundary risks; see DB_RUNTIME_ROLE.md | **Critical** |
| Manipulate pricing or revenue to falsify margin | Positive-integer validation, append-only price history, idempotent ingestion, signed Stripe conversion unit tests; new `read`/`ingest` keys cannot change prices | Broad legacy `admin` keys retain pricing access until rotated. Managed rotation, invoice reconciliation and independent review trail are still absent | **High** |
| Exhaust authentication, ingestion or analytics resources | Per-process invalid-key and workspace limiters; JSON size, batch and date-window bounds; bounded page size | Limiters are not distributed; full-workspace aggregation can still be expensive. Require ingress limits, per-tenant quotas, query timeouts and load tests | **High** |
| Bypass transport protections or spoof proxy metadata | Example API binds loopback; app does not trust unverified forwarded client-IP headers | Production TLS termination, proxy allowlist, ingress configuration, secret storage and security headers must be verified end-to-end | **High** |
| Poison provider prices or replay webhook revenue | Operator-reviewed candidate imports, provenance digest; timestamp/signature and idempotency tests for Stripe adapter | Community catalog is not official billing truth; genuine single-platform USD signed sandbox recovery is operator-verified; independent provider invoice matching, broader lifecycle and multi-account routing remain unproven | **High** |
| Exfiltrate data through logs, dumps or support tooling | API request logs are opt-in and limited to fixed fields; CI uses synthetic backups | Operational and gateway logs may contain secrets; real backup encryption/key recovery, access, deletion/retention and incident workflows remain externally unverified (source hooks and synthetic drills exist) | **High** |
| Break availability/integrity during migrations, restores or incident response | Versioned SQL migrations; disposable PostgreSQL 16 restore drill validates sample data | Production-like recovery, PITR, migration rollback and RPO/RTO are not evidenced | **High** |
| Publish or execute compromised SDK/dependencies | SDK package smoke checks and CI dependency audit; OIDC publish workflow prepared | OIDC publication of 0.4.0-alpha.2 succeeded (Actions run 39898669098); independent clean consumption, provenance inspection and developer validation must be recorded separately | **High** |

This table is not exhaustive. It deliberately includes attacker access to a **valid workspace key**, a **runtime database password**, CI credentials, and a malicious upstream price source; passing HTTP-only cross-tenant tests does not cover all of those actors.

See [credential-backed isolation design, migration and limitations](DB_RUNTIME_ROLE.md). In particular, SQL bulk financial reads require read/admin after 009. Ingest retains own-tenant inbox/pricing/source reads and exact-ID replay oracles; HTTP capabilities remain distinct.

## Mandatory release gates and reviewer evidence

1. **Tenant isolation:** specify the privileged owner/migrator, runtime role and database identity model; enforce and independently test default-deny cross-tenant SELECT **and INSERT** at the database boundary, including direct SQL using stolen runtime credentials. Review PostgreSQL owner/BYPASSRLS behavior, transaction pooling, connection reuse, SECURITY DEFINER functions and failure of missing workspace context.
2. **Authentication and key capabilities:** migrate legacy broad keys to [read/ingest/admin roles](KEY_PERMISSIONS.md), document expiry/rotation/revocation, audit key use safely, and test stolen-key recovery. Operators/migrators must remain separate from API bearer-key holders.
3. **Ingress and abuse:** use a verified TLS endpoint and trusted proxy boundary; test distributed throttling, replay, payload caps, timeouts and denial-of-service behavior with multiple processes.
4. **Data lifecycle:** define tenant export/deletion/retention, immutability versus privacy erasure, backup expiration, and secure audit trails; obtain an operator/legal privacy decision before destructive account deletion.
5. **Recovery and supply chain:** record encrypted external backups, production-like timed restores, alerting and response ownership, migration recovery, npm artifact provenance and repeatable SDK installation.
6. **Independent validation:** invite a reviewer who did not implement the controls to reproduce the threat tests, document findings, and approve or block go-live. Record deployment-specific evidence, not only CI screenshots.

Until these gates are satisfied, serve the local demo only and do not put real customer data on an internet-exposed AgentMargin instance.

See [runtime DB grants](DB_RUNTIME_ROLE.md), [pre-auth security](PREAUTH_SECURITY.md), [backup/restore](BACKUP_RESTORE.md), [observability](OBSERVABILITY.md), [security policy](../SECURITY.md) and [roadmap](ROADMAP.md). PostgreSQL reference: [Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

## v0.9 independent review packet (no approval recorded)

Review the final combination, not just PR 24. Exact changes:

```sh
git diff bea396246af6495081f6bc596501c6af28750ff5..release/v0.9.0-alpha.1 -- db apps/api/src/postgres.ts
# Include independent CodeQL patch exactly once in an isolated rehearsal:
git show ec812275ce4ba3a030f981942fe15d619a21820d --stat
```

| Identity | Allowed authority | Denied / trust boundary |
| --- | --- | --- |
| Owner/migrator/function owner | DDL, key provisioning, reviewed recovery/maintenance | Trusted; outside runtime-password boundary; never API credentials |
| Shared restricted runtime password alone | Global public pricing, catalog metadata, CONNECT | No tenant proof, no key-table/workspace access; no ownership, elevated attrs/memberships/CREATE |
| Runtime + ingest key | Own-tenant inserts, pricing/inbox/source reads, inbox mutable state, narrow replay digest/allowance oracles | Bulk customer/usage/payment/adjustment reads denied; another tenant denied |
| Runtime + read key | Own-tenant financial/pricing/inbox reads | Inserts/worker mutation/requeue denied |
| Runtime + admin key | Own-tenant read/ingest/pricing and reviewed bounded recovery function | Another tenant, direct audit writes, DDL/key table mutations denied |
| Backup/operator credentials | Protected exports, independently authorized incident containment | Must be separate from runtime; sensitive data/role recovery require review |

The pg_temp catalog guard issue is **confirmed and contained in additive 013**;
see DB_RUNTIME_ROLE.md for exploitability bounds and exact pre/post regression.
RLS still prevented final cross-tenant writes; errors could disclose hidden payment
existence/allowance before remediation. Catalogs are now explicitly qualified and
pg_temp placed last. Direct runtime grants, trigger ownership and function ACLs
must be reviewed independently.

Acceptance checklist for a genuine reviewer:

- [ ] Reproduce guarded PostgreSQL 16 clean/upgrade/rollback/contention tests;
  inspect 007–014 diffs, all functions, grants, owners and installed extensions.
- [ ] Confirm forged/missing/revoked/expired keys, tenant SELECT/INSERT and read/
  ingest/admin scope violations fail; pool reuse overwrites transaction-local proof.
- [ ] Reproduce fixed catalog-shadow denial and ensure no earlier trigger emits
  cross-tenant financial existence/allowance errors.
- [ ] Review persisted cursor/in-flight authentication limits. Accept the residual
  boundary or require stronger credential/role isolation; no timeout is a hard max
  malicious transaction lifetime. Rehearse separately authorized shared-role
  NOLOGIN/session termination and incident ownership.
- [ ] Assess own-tenant ingest inbox payload/state visibility, source metadata and
  oracles, worker authorization and whether separate enqueue/worker DB identities
  are required. Audit history does not prove external provider authenticity.
- [ ] Verify immutable payments/reductions, cumulative row locking, account evidence,
  replay completion atomicity, requeue cycles/receipts and explicit financial policy.
- [ ] Inspect raw credentials in session context against host/log/statistics/extension
  exposure; prohibit bound-parameter logging, separate migration/backup secrets.
- [ ] Review CodeQL SARIF paths/false-positive recommendation; independently approve
  deployment ingress, privacy/retention, storage/recovery and release restrictions.

Human judgments needed: acceptable threat boundary for password-plus-tenant-key
compromise; revocation incident response versus separate identities; financial
credit/cross-period policy; real retention/erasure and operator recovery authority.
No automated reviewer or implementer self-review substitutes for these approvals.


Shared-role availability is not isolated by RLS. Runtime-password holders share
session/resource identity and can disrupt same-role work; review cancellation,
termination, connection/resource limits and incident blast radius independently.
The data-scope tests do not claim availability containment. Separate identities
or infrastructure may be required by the deployment's accepted threat model.


## v0.7 gate-closure audit — 2026-10-24 Asia/Jakarta

This is an implementer assessment, not independent approval. Audit base is #37
`ed2bf7586c060a440d24e75d93920ee3b1a2c524` plus independent #33
`ec812275ce4ba3a030f981942fe15d619a21820d`. The follow-up branches after #37;
no parent PR is rewritten or merged. CI's combined-source job merges #33 exactly
once in an isolated checkout. Match the final PR head, combined tree and unfiltered
SARIF before using evidence from a later run. Historical F-01/F-02 in the phase-13
audit describe the pre-007 implementation, not the current candidate.

| ID / preliminary severity | Reproduction and impact | Implemented containment / remaining decision | Gate |
| --- | --- | --- | --- |
| S-01 / Medium configuration detection | PG16: disabling delivery_history RLS left ready=true. A misconfigured runtime could read other tenants' audit rows without proof; a runtime alone cannot disable RLS | Readiness now includes all ten RLS tables, exact policy counts, expected recovery definer settings and financial/audit trigger bindings. Regression disables both audit RLS flags and nine critical triggers, and adds a permissive policy, restoring each afterward | Fix tested; independent review BLOCKED |
| S-02 / High, credential compromise required | READ COMMITTED admitted cursor and in-flight statement can finish after key revocation. WITH HOLD materializes rows at commit and permits later fetch with revoked proof. New SELECT rejects that proof | 009 denies RR/SERIALIZABLE; transaction-local proof and pool reuse tested. Existing separate-owner NOLOGIN + session termination drill interrupts the disposable shared role and denies reconnect. Already returned/materialized data cannot be recalled. Timeouts are not a hard transaction lifetime | Residual INCONCLUSIVE; reviewer must accept or require separate identities/procedures |
| S-03 / High, runtime password plus tenant ingest key | Ingest cannot bulk-read customers/usage/payments/adjustments or cross tenants. It can read own inbox, source and price metadata, use narrow digest/allowance oracles and act as the worker | 014 prevents direct failed/delivered resets; reviewed admin RPC has immutable receipts, bounded cycles and replay. Pending state and initial inbox values remain part of shared worker authority; raw SQL ingestion is not independently signed provider proof | Residual INCONCLUSIVE; review enqueue/worker identity separation |
| S-04 / High confidentiality, pre-013 only | Temporary pg_roles/pg_class shadowed unqualified owner checks and exposed hidden-payment validation errors; final RLS still denied INSERT | Exact same session is denied 42501 after additive 013; qualified catalogs, pg_temp-last, rollback/retry verified. 012 bytes preserved | Automated regression PASS; independent migration review BLOCKED |
| S-05 / High financial integrity, valid writer compromise | An ingest holder is authorized to append its tenant's financial data. Stripe signatures are verified by the receiver, not by PostgreSQL RLS or normalized inbox endpoints | Immutable rows/provenance, source-account linkage, cumulative locked reductions, deterministic IDs, rollback/replay tests constrain effects. They cannot certify authenticity of data submitted directly by an authorized writer | Boundary acceptance BLOCKED; assess separate receiver/worker capabilities |
| S-06 / High availability, shared password compromise | RLS does not isolate shared-login resources, same-role cancellation, locks, pool or storage exhaustion | Fixed connection/query/idle bounds and bounded concurrency tests; local limiter only. Ingress/shared atomic quotas and possibly separate identities need deployment evidence | Operator/reviewer BLOCKED |
| S-07 / CodeQL 8.1/7.8/6.3 candidates | SHA-256 bearer digest; QA webhook route condition; verified private receipt HTTP-to-file path | See PREAUTH_SECURITY.md and INTEGRATIONS.md: 256 random bits, unconditional signature check on handled route, bounded private verified evidence. No confirmed remote bypass from these paths. No suppressions/dismissals | Preliminary classification INCONCLUSIVE until independent triage; authoritative main alerts unavailable through connector |
| S-08 / High operational/privacy | Owner, function owner, host, backups and deployment extensions can bypass the supported runtime boundary; restored --no-acl defaults need quarantine | Trusted owners separated; template rejects elevated attributes, memberships, ownership, CREATE and excess effective/column grants. Restore quarantines private function defaults before runtime provisioning | Deployment/independent review BLOCKED |

The readiness fix detects expected schema drift; it is not an authorization
mechanism or a proof of arbitrary policy expressions, ownership, ACLs, trigger
bodies, extra definer functions or installed extensions. A trusted owner can change
both controls and their checks. Review those installed definitions independently.
No new schema migration, key digest, key issuance, financial amount, SDK API or UI
contract is introduced by this security follow-up.

### Immutable migration identity

Compare these candidate checksums with the prepared release manifest, the approved
review and the installed migration ledger. Never rerun/edit an applied migration.
An installed hash mismatch is a stop condition, not permission to overwrite it.

| Migration | SHA-256 |
| --- | --- |
| `007_credential_tenant_isolation.sql` | `a57538e3d571c6483215523194203de3f003bbe68b83818cb5c9533463db84aa` |
| `008_revenue_deliveries.sql` | `c4c64296f5796d0c35049efc51652ea8923ffd779f989d02c27ea13c574f174d` |
| `009_credential_containment.sql` | `4c4c4ec1a5dcecc47b0c73c14e805f10d14ba81dbc88d957b9a4908136813183` |
| `010_revenue_adjustments.sql` | `d2382b3d2d30c44c5594f6bbb26321662d7108f93807ac92bead7ff599cb5f0c` |
| `011_adjustment_deliveries.sql` | `2e7c010893fe58e24980ae48f12f7f9ed7a4d5c11b909451934eb5a754222c7d` |
| `012_delivery_audit.sql` | `718942452c62691b9f69c0f4970a396533ef38148fe14c5db53c67228a2feba6` |
| `013_definer_catalog_path.sql` | `5b9f9685211fdf6d264ae58554457ec5b239371d641c07cd6ec534d8d6b9469c` |
| `014_delivery_transition_guard.sql` | `63304dd1307cbe5651206b7a3e490e35596d10636edf800c4bfcc844eaf101b8` |

### Reviewer execution and decision record

Use the isolated macOS/Docker procedure in BACKUP_RESTORE.md. The guarded PG16
suite requires an empty literal agentmargin_ci and performs destructive fictional
fixtures only. It tests 007–014 upgrade/rollback/lock failure, baseline RR and
catalog-shadow reproductions, missing/forged/expired/revoked keys, scope/tenant
SELECT and INSERT, SQL injection-shaped proof, pooling, held/in-flight results,
separate session containment, immutable ledger/recovery, concurrency and privacy.
Full combined CI additionally exercises signed synthetic delivery, API lifecycle,
restart, browser/API/SDK, both restore drills and dependency auditing.

Before approval, a reviewer who did not implement these changes must:

- Pin the final combined tree and migration hashes; inspect all RLS expressions,
  policy roles/commands, security-definer owners/search paths/volatility and PUBLIC
  defaults, effective table/column/function privileges and unrelated extensions.
- Reproduce negative cases and confirm the expected legacy failures precede the
  fixes. Inspect new readiness drift regressions; do not infer semantic policy
  verification merely from its expected object/count checks.
- Decide S-02/S-03/S-05/S-06 boundaries explicitly. Record whether held results,
  in-flight admission, raw credential context and shared worker/session authority
  are acceptable or require separate login/capability architecture. Include a
  containment owner and blast-radius decision; no timeout guarantees hard expiry.
- Review inbox inserts/state transitions and recovery authorization independently
  of signed-webhook tests. A review_ref is recorded evidence, not proof that a
  separate person approved an operation.
- Inspect all unfiltered CodeQL paths and decide false-positive dispositions
  independently. Main alert closure needs approved integration/rescan and an
  authorized maintainer; workflow success is not absence of findings.
- Record reviewer identity, date, source tree, reproduced commands/results,
  remaining findings and a signed approve/block decision in the review process.
  Do not put credentials, raw events or customer evidence in the public PR.

**Independent reviewer identity/decision: none recorded. Security gate BLOCKED.**
Operator ingress, privacy, storage/recovery and release approvals remain separate.

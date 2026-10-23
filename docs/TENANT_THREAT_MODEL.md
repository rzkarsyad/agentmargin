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
| Guess, reuse or steal a bearer key | Hashed keys, server-derived workspace context, key revocation CLI, malformed/unknown credential throttling | A stolen valid key can ingest or query that workspace until revoked; define expiry, scoped key permissions, monitoring and rotation drill | **Critical** |
| Force cross-tenant reads through `workspaceId` or cursor | Application SQL binds the authenticated workspace; PostgreSQL CI checks cross-tenant analytics, prices and totals | No database-enforced tenant isolation. Current runtime grants still permit cross-workspace SELECT if the DB credential is stolen | **Critical** |
| Compromise the API's PostgreSQL credential | Least-privilege runtime grants disallow UPDATE/DELETE/DDL and key creation; CI tests permissions | Reads span tenants; permitted INSERT could inject financial data across workspaces. Design/test RLS or stronger tenant isolation. A caller-controlled session setting alone is **not** a security boundary against a compromised DB role | **Critical** |
| Manipulate pricing or revenue to falsify margin | Positive-integer validation, append-only price history, idempotent ingestion, signed Stripe conversion unit tests | Any workspace bearer key currently has broad workspace write authority, including pricing. Add authorization scopes, invoice reconciliation and review trail | **High** |
| Exhaust authentication, ingestion or analytics resources | Per-process invalid-key and workspace limiters; JSON size, batch and date-window bounds; bounded page size | Limiters are not distributed; full-workspace aggregation can still be expensive. Require ingress limits, per-tenant quotas, query timeouts and load tests | **High** |
| Bypass transport protections or spoof proxy metadata | Example API binds loopback; app does not trust unverified forwarded client-IP headers | Production TLS termination, proxy allowlist, ingress configuration, secret storage and security headers must be verified end-to-end | **High** |
| Poison provider prices or replay webhook revenue | Operator-reviewed candidate imports, provenance digest; timestamp/signature and idempotency tests for Stripe adapter | Community catalog is not official billing truth; live webhook delivery retries, refunds, provider invoice matching and multi-account routing remain unproven | **High** |
| Exfiltrate data through logs, dumps or support tooling | API request logs are opt-in and limited to fixed fields; CI uses synthetic backups | Operational and gateway logs may contain secrets; real backup encryption, access, deletion/retention and incident workflows are not implemented | **High** |
| Break availability/integrity during migrations, restores or incident response | Versioned SQL migrations; disposable PostgreSQL 16 restore drill validates sample data | Production-like recovery, PITR, migration rollback and RPO/RTO are not evidenced | **High** |
| Publish or execute compromised SDK/dependencies | SDK package smoke checks and CI dependency audit; OIDC publish workflow prepared | First npm publication, trusted publisher setup, provenance verification and independent consumption are pending | **High** |

This table is not exhaustive. It deliberately includes attacker access to a **valid workspace key**, a **runtime database password**, CI credentials, and a malicious upstream price source; passing HTTP-only cross-tenant tests does not cover all of those actors.

## Mandatory release gates and reviewer evidence

1. **Tenant isolation:** specify the privileged owner/migrator, runtime role and database identity model; enforce and independently test default-deny cross-tenant SELECT **and INSERT** at the database boundary, including direct SQL using stolen runtime credentials. Review PostgreSQL owner/BYPASSRLS behavior, transaction pooling, connection reuse, SECURITY DEFINER functions and failure of missing workspace context.
2. **Authentication and key capabilities:** distinguish read-only analytics keys, ingestion keys, pricing administrators and operators; document expiry/rotation/revocation, audit key use safely, and test stolen-key recovery.
3. **Ingress and abuse:** use a verified TLS endpoint and trusted proxy boundary; test distributed throttling, replay, payload caps, timeouts and denial-of-service behavior with multiple processes.
4. **Data lifecycle:** define tenant export/deletion/retention, immutability versus privacy erasure, backup expiration, and secure audit trails; obtain an operator/legal privacy decision before destructive account deletion.
5. **Recovery and supply chain:** record encrypted external backups, production-like timed restores, alerting and response ownership, migration recovery, npm artifact provenance and repeatable SDK installation.
6. **Independent validation:** invite a reviewer who did not implement the controls to reproduce the threat tests, document findings, and approve or block go-live. Record deployment-specific evidence, not only CI screenshots.

Until these gates are satisfied, serve the local demo only and do not put real customer data on an internet-exposed AgentMargin instance.

See [runtime DB grants](DB_RUNTIME_ROLE.md), [pre-auth security](PREAUTH_SECURITY.md), [backup/restore](BACKUP_RESTORE.md), [observability](OBSERVABILITY.md), [security policy](../SECURITY.md) and [roadmap](ROADMAP.md). PostgreSQL reference: [Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

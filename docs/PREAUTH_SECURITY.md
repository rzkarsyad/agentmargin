# v0.7 security baseline — development

This experimental branch adds a **pre-authentication invalid-key limiter** to `/v1/*`. It applies before JSON body parsing and counts missing, malformed, and unknown workspace bearer keys. It cannot be bypassed by forging `X-Forwarded-For`; instead it is process-local and global, and intentionally does not lock out authenticated keys if invalid attempts flood the service.

**Limitations:** This is NOT adequate internet-facing abuse prevention. Multiple Node processes do not share this state. A flood of valid-looking keys still incurs database lookup before being rejected; attackers may exhaust DB connections. Direct public use also needs a trusted TLS gateway, distributed/IP+account rate limiting, request size limits at ingress, alerting and adversarial review.

## Full v0.9 combined-source audit

The release rehearsal scans the whole 007–013/financial stack plus #33 with all
103 JavaScript security-extended queries and PR-range filtering disabled. The first
combined run found eight results: the known SHA-256 classification plus seven
filesystem check/use results in financial/recovery/sandbox CLIs and two tests.
Operator input files had separate path stat/read operations; those are hardened
using O_NOFOLLOW descriptor open, descriptor type/mode/size validation, a bounded
read from that same descriptor and canonical private output directories with
trusted ancestors. Tests inspect the same opened-file metadata and contents.
No query, path, fixture or result is excluded. The full unfiltered follow-up
[39970382041](https://github.com/rzkarsyad/agentmargin/actions/runs/39970382041)
reports **103 rules / one result**, solely `js/insufficient-password-hash`; all
seven filesystem results and both regex results are absent. Its preserved
[SARIF](https://github.com/rzkarsyad/agentmargin/actions/runs/39970382041/artifacts/12509345683)
identifies combined commit `250f3e3d3c2a859a31cc239dc051c848e8140127`, tree
`6af7eb9709dec27f5aa86e7fa6b89c01420fe4f8`, SARIF SHA-256
`eb639e81a2f2517a25e9daa6f5bb9580466eb8b9529fd0dfd99ac2fd029b9de0`.
Later source changes require their own final-head checks. Workflow success alone
is never a zero-findings assertion.

The full-stack SHA-256 result additionally reaches the unchanged digest helper
from `scripts/export-financial-ledger.ts` and `scripts/revenue-replay-worker.ts`
via `AGENTMARGIN_API_KEY`, as well as the two synthetic app-test fixtures. These
operator variables hold issued AgentMargin bearer credentials, whose supported
issuers use `randomBytes(32)`. They are not human passwords. Manually inserting
weak credentials violates that issuance contract. Preserve native UTF-8/hex
SHA-256 agreement with SQL RLS and existing keys; no KDF migration or suppression
is justified by these paths. A maintainer must formally triage the alert and an
independent reviewer must verify the complete credential boundary.

The database evaluation below records the historical pre-007 baseline. See the current [gate-closure risk register](TENANT_THREAT_MODEL.md) and independent reviewer checklist. The current
candidate boundary and fixes through 013 are in DB_RUNTIME_ROLE.md and ROADMAP.md.

## Historical pre-007 database least-privilege evaluation

PostgreSQL app credentials currently can view multiple workspaces if compromised because RLS is not enabled. The optional [runtime role grants](DB_RUNTIME_ROLE.md) now narrow database operations to specific SELECT/INSERT privileges and are exercised with a throwaway, non-owner role in CI. An authorized DBA must provision that role separately from the owner/migrator for each deployment. The local demo still uses a privileged synthetic database account by default; this is not evidence of secure production configuration.

Do not enable RLS solely from a copied SQL snippet: RLS requires a trusted tenant session identity, transaction ownership rules, no bypass privilege, a separate migration role, and denial-by-default tests. Until verified, the API must remain localhost-only.

## Historical gate notes (superseded by the current ROADMAP)

See [GitHub security gate #10](https://github.com/rzkarsyad/agentmargin/issues/10). Production controls, encrypted backups/restore drills, retention/export/delete, incident response, and independent penetration review remain **NOT DONE**.

AM-03 follow-up: the application now admits at most two concurrent authentication
lookups per createApp instance, without queueing or caching valid keys. Saturation
returns 503/Retry-After, and finally releases capacity on success/error. It bounds
unknown-key database occupancy while reserving the rest of the ten-connection pool
for admitted work; it does not cap total auth QPS, provide tenant fairness or stop
distributed abuse. A valid key is never blacklisted by the global invalid bucket.
Ingress identity/atomic quota and network overload tests remain deployment gates.

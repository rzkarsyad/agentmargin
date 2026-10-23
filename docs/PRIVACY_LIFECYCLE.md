# Privacy and financial evidence lifecycle — candidate policy

No legal/privacy compliance approval is claimed. Real-data deployment requires
approved retention, legal holds and an operator accountable for recovery/erasure.

| Data | Purpose / handling |
| --- | --- |
| Workspace/customer IDs and optional names | Attribution; identifiers may be personal; avoid emails/names in IDs |
| Usage IDs/model/token counts/timestamps | Financial attribution; never prompts or generated content |
| Reported/estimated costs, pricing and source notes | Exact explainability; restrict exports and operator access |
| Revenue/adjustments/account/source links | Immutable accounting evidence; record only required provider references |
| Normalized delivery payload/state/history/review refs | Retry and audit; references must not contain credentials or free-form sensitive text |
| API-key hashes/key UUID/expiry/revocation | Authentication; raw keys are not persisted; never include hashes in customer exports |
| Logs/metrics | Fixed classifications, correlation IDs and aggregate counters; no keys, customer IDs, bodies or financial records |
| Backups/private reports/sandbox evidence | Sensitive copies; encrypted storage, separate keys, access/retention/expiry controls |

Operators must specify per-category retention before real ingestion. The backup
utility defaults to seven days, but a retention hook and legal-hold policy must
actually enforce remote expiry. Delivery audit/ledger immutability prevents ordinary
updates/deletes and must not be silently disabled to implement a user request.
A reviewed financial retention/erasure decision is necessary; hashing an identifier
alone is not guaranteed anonymization. Restrict identity mapping outside AgentMargin
where possible. These policies have no automatic expiry scheduler in the candidate.

## Tested disposable export and erasure rehearsal

`scripts/workspace-data.ts` is **only** a fictional teardown tool: loopback
`/agentmargin_ci`, owner `agentmargin_ci`, and workspace name beginning
`agentmargin-qa `. It is not a production erasure API. Export contains bounded
workspace data with deterministic row ordering, fails rather than truncates,
uses a new mode-0600 file, and omits API key rows/digests. Store it outside Git.

```sh
node --experimental-strip-types scripts/workspace-data.ts "$FICTIONAL_WORKSPACE" /private/export.json
AGENTMARGIN_PRIVACY_REHEARSAL=delete-fictional-workspace \
  node --experimental-strip-types scripts/workspace-data.ts "$FICTIONAL_WORKSPACE" /private/export.json delete-after-export
```

The second operation locks tables, compares the export digest to current data,
requires the explicit guard, temporarily disables only user triggers under the
trusted owner inside one transaction, deletes exactly that fictional workspace,
re-enables protections and commits. Foreign keys stay enabled. Failure rolls back
all changes. The test verifies stale export denial, private/no-key exports,
unrelated financial rows and restored immutable triggers. Never adapt this tool
for a live database without a separately reviewed policy/implementation.

## Required real-data procedure (not implemented/approved)

Authenticate the requester and retention/legal authority; inventory all primary,
replica, export, log, provider and backup copies; approve whether deletion,
pseudonymization or legally retained finance records apply. Pause/drain affected
writers and resolve in-flight sessions. Export through an approved private channel,
record a secret-free reviewed operation, and execute the approved scoped lifecycle
procedure. Carry an erasure manifest separately through backup retention so an
isolated restore cannot resurrect prohibited data before cutover. Validate replica
and old-backup expiry, revoke relevant access and document completion. External
Stripe/provider records require their own approved lifecycle. No such production
procedure, retention decision or external expiry has been certified here.

# PostgreSQL backup and restore — v0.8 foundation

**Status: operator backup utility and synthetic CI drills. No production scheduler, external storage or recovery guarantee is configured.** Do not expose a production deployment on the strength of this test alone.

## Automated evidence

GitHub Actions uses PostgreSQL 16 and runs `npm run test:postgres` to populate an isolated `agentmargin_ci` database with synthetic events, revenue, customers, workspace API-key digests and versioned prices. Then a separate disposable PostgreSQL 16 client container runs [`scripts/postgres-restore-drill.sh`](../scripts/postgres-restore-drill.sh):

1. Fail closed unless explicitly running on GitHub Actions against `127.0.0.1:5432/agentmargin_ci` with the disposable CI database user and an opt-in guard.
2. Create a **custom-format** `pg_dump` of the populated fixture, validate its archive table of contents and restore into a uniquely named, newly created `agentmargin_restore_ci_*` database.
3. Compare row counts and content fingerprints for all application tables, plus counts of indexes, constraints and user-defined triggers. No row values or credential digests are printed.
4. Drop only that uniquely generated restoration database and delete the transient archive, including when the drill fails. Never drop, empty or modify the source database.

These checks establish that the current schema and synthetic sample data can be restored into a new database with matching logical rows. They do **not** establish a recovery time objective (RTO), recovery point objective (RPO), point-in-time recovery, backup confidentiality, retention compliance, or recovery under load. The drill intentionally excludes PostgreSQL cluster-wide roles and other infrastructure configuration.

## Production design gate — still required

Before using AgentMargin with real customer data, an operator must select and independently verify a deployment-specific recovery design:

- Define owners, RPO/RTO and failure scenarios (logical corruption, whole-database loss, credential compromise, region loss). Decide whether continuous WAL/PITR and physical backups are required beyond periodic logical dumps.
- Schedule backups to separately managed storage, encrypt **in transit and at rest** with access controlled independently of API/runtime credentials, enforce retention and disposal, and record successful/failed backups with alerting.
- Validate backup integrity and perform **periodic isolated restores** using production-like scale, extensions, privileges, schema versions and application smoke tests. Measure elapsed time against the selected RTO. Document secrets/role restoration separately; never write credentials into CI artifacts or logs.
- Establish an operator-reviewed incident runbook: isolate faulty writers, identify a trustworthy recovery point, restore into a **new** environment, verify data and account/workspace isolation, then cut over via an approved plan. Do not overwrite the current production database as the first step.
- Test migration rollback/forward compatibility, privacy deletion and expired-backup handling. Record drill date, PostgreSQL/server versions, retention policy, results, owner and sign-off without exposing personal or secret data.

**Do not run the CI script against production.** It purposefully grants temporary database creation/deletion power to the disposable CI test account and is not a general-purpose backup utility. Backup exports can contain sensitive usage, customer and account identifiers, so handle any real export as regulated production data.

References: [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html), [PostgreSQL 16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html), [continuous archiving and PITR](https://www.postgresql.org/docs/16/continuous-archiving.html).

## Operator backup utility and hook contract

`scripts/postgres-backup.sh` uses libpq PG*/PGSERVICE configuration and requires a private, operator-owned mode-700 `AGENTMARGIN_BACKUP_DIR`. It refuses overlapping runs, creates a custom-format dump, validates its archive, encrypts it, uploads it, invokes external retention, removes plaintext and updates `last-success.json` atomically only after success. Failures return nonzero with a fixed secret-free event; hook/libpq diagnostics are suppressed. The local directory and temporary files must reside on encrypted operator storage. A crash/SIGKILL can leave a private plaintext work directory and lock: investigate and securely expire these before clearing the lock.

Configure executable **absolute paths**, never shell snippets:

| Variable | Hook arguments / responsibility |
| --- | --- |
| `AGENTMARGIN_BACKUP_ENCRYPT` | input dump, output encrypted file; use authenticated encryption such as age and separately protected recovery keys; exit nonzero on failure |
| `AGENTMARGIN_BACKUP_UPLOAD` | encrypted file, object name; upload through verified TLS to an independently administered storage account and confirm durable completion |
| `AGENTMARGIN_BACKUP_PRUNE` | retention days; enforce remote retention, legal holds and deletion permissions; exit nonzero on failure |
| `AGENTMARGIN_BACKUP_RETENTION_DAYS` | positive integer, default 7; local deletion affects only utility-owned encrypted archives older than this policy |

Keep keys, hook config and libpq secrets outside the repository. Storage credentials must not be API runtime credentials. This interface does not prove that an arbitrary encryption hook encrypts or an upload hook durably stores bytes; operators must validate the selected implementations.

Schedule the utility under a dedicated account (for example, an hourly systemd timer with `OnFailure=` routing to the operator's alert service). Monitor the exit status **and freshness** of `last-success.json`, with an alert if no success occurs within two scheduled intervals. Disk exhaustion, upload, retention and encryption failures must alert. Do not log hook arguments or dump contents.

The synthetic automation CI drill uses an ephemeral public recipient and authenticated OpenSSL CMS AES-256-GCM envelope with a local storage fixture. It removes the initial private key, recovers a copy from a separate local directory, rejects missing/wrong keys and truncated/content-tampered envelopes, authenticates before restore, verifies full row fingerprints and checks failure cleanup. Same-UID local directories do not establish independent credential custody or external storage recovery. This is not cloud-storage validation. The separate full restore drill covers all application tables and schema integrity.

## Recovery runbook and objectives

For hourly logical dumps, planning RPO is **at least one hour plus failed/missed schedules**, not a guarantee. Logical dumps do not provide PITR. RTO remains unmeasured until a timed production-scale isolated restore includes storage download, key recovery, role/grant provisioning, application verification and approved cutover. Choose WAL/PITR if this RPO is insufficient.

1. Stop or isolate affected writers and record the incident window without exporting sensitive records.
2. Select a known-good successful object; retrieve/decrypt with separately managed keys into protected temporary storage.
3. Create a new isolated PostgreSQL 16 database. Restore with `pg_restore --exit-on-error --no-owner --no-acl`; restore trusted ownership and runtime grants separately.
4. Run row fingerprints, financial consistency and direct tenant-isolation tests; test the matching API/schema version. Do not apply old broad grants to bypass a failed check.
5. Measure recovery duration and backup age. Obtain operator cutover approval; preserve the old environment for investigation. Document the drill and expire temporary plaintext and old backups under the approved privacy policy.

Migration 008 adds normalized revenue deliveries to full restore fingerprints. Queue payloads, failed-job evidence and pending/delivered state must be restored together with the revenue ledger; replay is idempotent after recovery. Validate the worker and migration-008 grants before enabling delivery again.

Migration 012 adds immutable delivery transition/requeue history to the full restore fingerprints. Preserve it with inbox and ledger state; restoring only the economic ledger loses recovery provenance.


Both restore drills now run post-restore probes on the newly created isolated DB:
all ten RLS-enabled tables, catalog-safe definer settings, missing credential denial,
original/customer/currency/time linkage, cumulative reduction limits and Stripe
source-account attribution. `--no-acl` restores default PUBLIC EXECUTE on functions;
the isolated restore is quarantined by revoking PUBLIC auth-schema/function access.
Before enabling a provisioned runtime, reapply the final runtime template, which
also revokes those defaults and grants only the exact entry points. Synthetic
probes complement row/schema fingerprints; they do not replace staging role/secret
recovery and approved operational cutover.


## Recovery hardening and evidence limits

The success marker now additionally records startedAt, archive object name,
encrypted-byte SHA-256 and byte count. Preserve this inventory privately. Existing
encrypt/upload/prune hook arguments are unchanged; no manifest upload or vendor
access is silently added. A hash is a transport reference, not a MAC, signature or
proof that an arbitrary hook encrypts. Authenticated decryption must succeed before
pg_restore; some decryptors leave unauthenticated partial plaintext on failure.
Never pipe unchecked output directly into restore or infer success from file size.
The local work directory must be encrypted storage; SIGKILL/power loss can leave
plaintext and a stale lock. Isolate/investigate and expire it under the approved
storage policy. Cleanup is not guaranteed physical secure erasure on SSDs.

Both restore drills now provision a fresh synthetic restricted LOGIN in the
restored database, reapply the runtime template and connect with that identity.
They deny missing/revoked/expired proof, other-tenant SELECT and INSERT, auth-table
reads and financial deletion; verify legitimate access and transaction-local
context reset; then revoke/drop only that generated role. SET ROLE in the owner's
session would retain session_user exemptions and is deliberately not the evidence.
The restored database stays disposable and quarantined, with no cutover.

The encrypted drill also verifies failed dump/encryption/upload/retention leave the
previous success marker unchanged and remove temporary plaintext/lock; a held lock
rejects overlap without deleting that lock. It tests expiry just beyond seven days and preservation just inside the boundary,
plus unrelated-file preservation. Local retention uses an explicit UTC cutoff;
GNU -mtime +7 previously rounded down and retained almost eight days. A normal
backup succeeds again after the failed operations and held lock are resolved. Existing restart, financial rollback/idempotency
and bounded-concurrency suites remain separate checks. A failed remote retention
hook can leave a newly uploaded object, so operators must reconcile the protected
inventory rather than treating absence of a success marker as no remote upload.

### Safe macOS / Docker Desktop / OrbStack rehearsal

Requires Node 24, Git, Python 3 for the source scan, and Docker with a **local Unix-socket context**. No provider keys,
paid calls, external backup credentials or existing databases are used. Keep any
private reports outside the checkout. Preserve a dirty checkout and use a new
worktree; the following commands do not reset or overwrite existing work:

```bash
git fetch origin refs/heads/feat/backup-recovery-evidence:refs/remotes/origin/feat/backup-recovery-evidence
git worktree add --detach ../agentmargin-recovery-review origin/feat/backup-recovery-evidence
cd ../agentmargin-recovery-review
npm ci
npm run check
npm audit --audit-level=low
python3 scripts/check-release-files.py
# List contexts; choose default, desktop-linux or orbstack only if local.
docker context ls
AGENTMARGIN_DOCKER_CONTEXT=desktop-linux AGENTMARGIN_OPERATOR_DRILL=synthetic-only \
  bash scripts/operator-recovery-drill.sh
```

Replace desktop-linux with the actual local context (Linux often default; OrbStack
usually orbstack). The wrapper ignores inherited endpoint/TLS selectors, resolves
the named context and rejects TCP/SSH endpoints. It creates only a new labelled
PostgreSQL 16 container, binds a random port on 127.0.0.1, applies all 001–014 through
the guarded clean/upgrade suite, then runs both recovery drills using separate
client containers sharing **that fixture's** network namespace. GNU stat/find and
OpenSSL CMS are supplied by the Linux PostgreSQL image; no macOS GNU-tool install
is required. It deletes only the container it created and its anonymous volumes.
SIGKILL/host failure can prevent cleanup: inspect the agentmargin.synthetic-recovery
label and exact recorded container before separately removing leftover fixtures.
Do not prune unrelated containers or Docker volumes. Do not point this at production.

For the actual combined candidate, additionally merge the pinned independent #33
commit **only in this detached rehearsal worktree**, then rerun the checks/drill:

```bash
git fetch origin refs/heads/fix/codeql-alert-audit:refs/remotes/origin/fix/codeql-alert-audit
git -c user.name='Local recovery rehearsal' -c user.email='rehearsal@localhost' \
  merge --no-ff --no-edit ec812275ce4ba3a030f981942fe15d619a21820d
npm run check
AGENTMARGIN_DOCKER_CONTEXT=desktop-linux AGENTMARGIN_OPERATOR_DRILL=synthetic-only \
  bash scripts/operator-recovery-drill.sh
```

This creates a local merge commit only; do not push it, merge any GitHub PR, publish
or deploy. Record git rev-parse HEAD and HEAD^{tree} privately with the command exit
statuses. If pinned parents move or conflict, stop and review rather than forcing.
The normal PR and combined CI additionally cover SDK/Next.js, browser and restart
checks. This procedure is executable on local Docker; an actual Mac execution and
operator review of its evidence remain required, not inferred from Linux CI.

### Freshness and alert procedure

The backup utility itself runs in an operator-controlled Linux/libpq environment.
Run this read-only Node check where the private local marker is available:

```bash
AGENTMARGIN_BACKUP_DIR=/absolute/private/backup-directory \
  AGENTMARGIN_BACKUP_MAX_AGE_SECONDS=7200 \
  node --experimental-strip-types scripts/backup-status.ts
```

Exit 0=fresh marker, 1=stale, 2=unavailable/invalid/unsafe file or config. Output is
fixed aggregate status/age/duration, with no path, object name, hashes or arbitrary
marker fields. Old marker format remains accepted; future/invalid timestamps fail.
This checks only a local marker, not an external object or its decryptability.
Monitor both scheduler exit/failures **and** marker age; a recent success must not
hide a subsequent failed upload. A hung hook needs a scheduler-level deadline and
missed-heartbeat alarm; the utility does not enforce a portable hard hook timeout.

For real notification evidence, an authorized operator must use a labelled drill
in the approved staging monitoring route: record synthetic backup failure,
stale/missing marker, readiness loss, worker heartbeat/backlog and metrics scrape
failure; retain alert firing time, actual receipt/acknowledgement by the intended
on-call destination, escalation and recovery-resolved receipt. Test collector loss
out of band. Restore normal thresholds afterward. Use no customer/object IDs or
raw bodies in alert payloads. Unit tests and stdout logs are not delivered alerts.
No such external delivery is recorded by this source change.

### Recovery objectives / operator handoff

The local Linux Docker run measured full dump/restore/probes **2 seconds**,
authenticated backup/key-recovery/failure/restore probes **2 seconds**, and the
complete startup/migration/recovery wrapper **17 seconds** on tiny synthetic data.
These are elapsed test observations, not contractual RTOs; machine, load and dataset
differ. Each CI/operator run prints its own duration. No real backup age/RPO,
remote download latency, vault recovery, production-scale restore or approved
cutover was measured. Hourly scheduling still implies at least an hour plus failed
or missed intervals of logical-backup exposure, and provides no PITR.

Before external recovery can PASS, the founder/operator must select the scheduler,
retention/legal holds, independent storage and key custodians; create an approved
nonproduction exercise; destroy access to the writer's original key copy; recover
using the real separately authorized mechanism; download and authenticate a known
object; provision roles/ACLs; restore into a new isolated PG16 target; run tenant and
financial probes; measure full elapsed time and backup age; retain private evidence
and obtain the incident/recovery owner's acceptance. Include erased-subject manifest
reapplication before any cutover. No step in this follow-up authorizes production
access or cutover. See PRIVACY_LIFECYCLE.md for outstanding policy decisions.


The operator backup utility now resolves canonical directory/hook paths once and
rejects files or ancestors owned by another UID or writable by group/others,
except root-owned sticky directories such as /tmp. Hook files must not be writable
by other users. Previously only the mode-700 leaf directory was checked, allowing
unsafe ancestor/hook configuration and local replacement races. Regression fixtures
require rejection before a dump, hook or lock is started. Same-UID/root compromise
and malicious configured hooks are still trusted-boundary risks; this is not a
proof that arbitrary hooks implement encryption/storage correctly. Use encrypted
operator storage and independently controlled credentials, not a shared writable
working directory. The Docker wrapper waits for TCP readiness rather than the
entrypoint's temporary initialization socket.

The freshness command measures last-success completion age. It does not calculate
RPO or certify a recovery point; a long-running dump can complete recently with an
older snapshot. Use the protected start/snapshot/backup-age evidence when measuring
recovery objectives, and verify actual restore viability separately.

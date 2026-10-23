# PostgreSQL backup and restore — v0.8 foundation

**Status: operator backup utility and synthetic CI drills. No production scheduler, external storage or recovery guarantee is configured.** Do not expose a production deployment on the strength of this test alone.

## Automated evidence

GitHub Actions uses PostgreSQL 16 and runs `npm run test:postgres` to populate an isolated `agentmargin_ci` database with synthetic events, revenue, customers, workspace API-key digests and versioned prices. Then a separate disposable PostgreSQL 16 client container runs [`scripts/postgres-restore-drill.sh`](../scripts/postgres-restore-drill.sh):

1. Fail closed unless explicitly running on GitHub Actions against `127.0.0.1:5432/agentmargin_ci` with the disposable CI database user and an opt-in guard.
2. Create a **custom-format** `pg_dump` of the populated fixture, validate its archive table of contents and restore into a uniquely named, newly created `agentmargin_restore_ci_*` database.
3. Compare row counts and content fingerprints for all eight application tables, plus counts of indexes, constraints and user-defined triggers. No row values or credential digests are printed.
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

The synthetic automation CI drill uses an ephemeral OpenSSL test key and local external-storage fixture, decrypts the uploaded bytes, restores them into a new database, verifies revenue fingerprints and proves upload-failure cleanup. This is not cloud-storage validation. The separate full restore drill covers all eight tables and schema integrity.

## Recovery runbook and objectives

For hourly logical dumps, planning RPO is **at least one hour plus failed/missed schedules**, not a guarantee. Logical dumps do not provide PITR. RTO remains unmeasured until a timed production-scale isolated restore includes storage download, key recovery, role/grant provisioning, application verification and approved cutover. Choose WAL/PITR if this RPO is insufficient.

1. Stop or isolate affected writers and record the incident window without exporting sensitive records.
2. Select a known-good successful object; retrieve/decrypt with separately managed keys into protected temporary storage.
3. Create a new isolated PostgreSQL 16 database. Restore with `pg_restore --exit-on-error --no-owner --no-acl`; restore trusted ownership and runtime grants separately.
4. Run row fingerprints, financial consistency and direct tenant-isolation tests; test the matching API/schema version. Do not apply old broad grants to bypass a failed check.
5. Measure recovery duration and backup age. Obtain operator cutover approval; preserve the old environment for investigation. Document the drill and expire temporary plaintext and old backups under the approved privacy policy.

Migration 008 adds normalized revenue deliveries to full restore fingerprints. Queue payloads, failed-job evidence and pending/delivered state must be restored together with the revenue ledger; replay is idempotent after recovery. Validate the worker and migration-008 grants before enabling delivery again.

# PostgreSQL backup and restore — v0.8 foundation

**Status: synthetic CI drill only. No production backups, alerting, encryption policy, or recovery guarantees are configured by this repository.** Do not expose a production deployment on the strength of this test alone.

## Automated evidence

GitHub Actions uses PostgreSQL 16 and runs `npm run test:postgres` to populate an isolated `agentmargin_ci` database with synthetic events, revenue, customers, workspace API-key digests and versioned prices. Then a separate disposable PostgreSQL 16 client container runs [`scripts/postgres-restore-drill.sh`](../scripts/postgres-restore-drill.sh):

1. Fail closed unless explicitly running on GitHub Actions against `127.0.0.1:5432/agentmargin_ci` with the disposable CI database user and an opt-in guard.
2. Create a **custom-format** `pg_dump` of the populated fixture, validate its archive table of contents and restore into a uniquely named, newly created `agentmargin_restore_ci_*` database.
3. Compare row counts and content fingerprints for all seven application tables, plus counts of indexes, constraints and user-defined triggers. No row values or credential digests are printed.
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

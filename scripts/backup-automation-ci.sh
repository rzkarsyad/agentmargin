#!/usr/bin/env bash
# Synthetic disposable PostgreSQL only; never access real storage or real keys.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${AGENTMARGIN_BACKUP_DRILL:-}" == ci-only && \
   "${PGDATABASE:-}" == agentmargin_ci && "${PGUSER:-}" == agentmargin_ci && \
   "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 ]] || exit 2
umask 077
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/backups" "$fixture/external"
openssl rand -hex 32 > "$fixture/key"
cat > "$fixture/encrypt" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_FIXTURE/key" -in "$1" -out "$2"
HOOK
cat > "$fixture/upload" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
cp -- "$1" "$BACKUP_FIXTURE/external/$2"
HOOK
cat > "$fixture/prune" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == 7 ]]
HOOK
chmod 700 "$fixture/encrypt" "$fixture/upload" "$fixture/prune"
export BACKUP_FIXTURE=$fixture AGENTMARGIN_BACKUP_DIR="$fixture/backups" \
 AGENTMARGIN_BACKUP_ENCRYPT="$fixture/encrypt" AGENTMARGIN_BACKUP_UPLOAD="$fixture/upload" \
 AGENTMARGIN_BACKUP_PRUNE="$fixture/prune"
bash scripts/postgres-backup.sh
[[ $(find "$fixture/external" -type f | wc -l) == 1 ]]
for archive in "$fixture/external/"*; do
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$fixture/key" -in "$archive" -out "$fixture/restorable.dump"
done
pg_restore --list "$fixture/restorable.dump" >/dev/null
# Restore encrypted/uploaded bytes into an isolated new database, compare a
# financial table fingerprint, then remove only that test database.
restored="agentmargin_backup_ci_$(openssl rand -hex 6)"
createdb --template=template0 "$restored"
trap 'dropdb --if-exists "$restored"; rm -rf -- "$fixture"' EXIT
pg_restore --exit-on-error --no-owner --no-acl --dbname="$restored" "$fixture/restorable.dump"
for table in workspaces workspace_api_keys customers price_versions workspace_price_versions usage_events revenue_records revenue_deliveries revenue_adjustments revenue_payment_sources adjustment_deliveries delivery_history delivery_requeues; do
  query="SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text),'')) FROM $table t"
  [[ "$(psql -XAt -v ON_ERROR_STOP=1 -c "$query")" == "$(psql -XAt -v ON_ERROR_STOP=1 -d "$restored" -c "$query")" ]]
done
cp "$fixture/backups/last-success.json" "$fixture/before.json"
if AGENTMARGIN_BACKUP_UPLOAD=/bin/false bash scripts/postgres-backup.sh; then exit 1; fi
cmp "$fixture/backups/last-success.json" "$fixture/before.json"
[[ ! -d "$fixture/backups/.backup-lock" ]]
[[ $(find "$fixture/backups" -name plain.dump | wc -l) == 0 ]]
echo 'Encrypted backup hooks, isolated restore and failure detection: PASSED (synthetic only)'

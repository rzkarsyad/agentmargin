#!/usr/bin/env bash
# Synthetic disposable PostgreSQL only; never access real storage or real keys.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${AGENTMARGIN_BACKUP_DRILL:-}" == ci-only && \
   "${PGDATABASE:-}" == agentmargin_ci && "${PGUSER:-}" == agentmargin_ci && \
   "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 ]] || exit 2
umask 077
fixture=$(mktemp -d)
restored=''
cleanup(){
 local code=$?
 trap - EXIT
 if [[ -n "$restored" ]]; then dropdb --if-exists "$restored" || code=1; fi
 rm -rf -- "$fixture" || code=1
 exit "$code"
}
trap cleanup EXIT
started=$SECONDS
mkdir "$fixture/backups" "$fixture/external" "$fixture/recovery-store" "$fixture/recovered"
# The encryption hook uses a public recipient certificate. Private key recovery
# uses a distinct LOCAL directory; same-UID fixture access is NOT credential
# separation, a remote vault test, or an external-storage claim.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=agentmargin-synthetic-backup \
 -keyout "$fixture/initial-key" -out "$fixture/recipient" >/dev/null 2>&1
cp "$fixture/initial-key" "$fixture/recovery-store/recovery-key"
rm "$fixture/initial-key"
cat > "$fixture/encrypt" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
openssl cms -encrypt -aes-256-gcm -binary -in "$1" -outform DER -out "$2" "$BACKUP_FIXTURE/recipient"
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
cat > "$fixture/recover-key" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
[[ ! -e "$1" ]]
cp -- "$BACKUP_FIXTURE/recovery-store/recovery-key" "$1"
chmod 600 "$1"
HOOK
chmod 700 "$fixture/encrypt" "$fixture/upload" "$fixture/prune" "$fixture/recover-key"
export BACKUP_FIXTURE=$fixture AGENTMARGIN_BACKUP_DIR="$fixture/backups" \
 AGENTMARGIN_BACKUP_ENCRYPT="$fixture/encrypt" AGENTMARGIN_BACKUP_UPLOAD="$fixture/upload" \
 AGENTMARGIN_BACKUP_PRUNE="$fixture/prune"
# Local retention must preserve unrelated files and recent utility archives.
touch "$fixture/backups/agentmargin-old.dump.enc" "$fixture/backups/unrelated.dump.enc"
touch "$fixture/backups/agentmargin-expired-boundary.dump.enc" "$fixture/backups/agentmargin-fresh-boundary.dump.enc"
touch -d '7 days ago 5 minutes ago' "$fixture/backups/agentmargin-expired-boundary.dump.enc"
touch -d '6 days ago 23 hours ago' "$fixture/backups/agentmargin-fresh-boundary.dump.enc"
touch -d '10 days ago' "$fixture/backups/agentmargin-old.dump.enc" "$fixture/backups/unrelated.dump.enc"
bash scripts/postgres-backup.sh
[[ ! -e "$fixture/backups/agentmargin-old.dump.enc" && -e "$fixture/backups/unrelated.dump.enc" ]]
[[ ! -e "$fixture/backups/agentmargin-expired-boundary.dump.enc" && -e "$fixture/backups/agentmargin-fresh-boundary.dump.enc" ]]
[[ $(find "$fixture/external" -type f | wc -l) == 1 ]]
archive=("$fixture/external/"*)
archive=${archive[0]}
# Recover the key only after the writer completed. A missing/wrong key and a
# truncated authenticated envelope MUST fail before pg_restore is permitted.
if openssl cms -decrypt -binary -inform DER -in "$archive" -inkey "$fixture/recovered/key" \
 -out "$fixture/missing.dump" >/dev/null 2>&1; then exit 1; fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$fixture/wrong-key" >/dev/null 2>&1
if openssl cms -decrypt -binary -inform DER -in "$archive" -inkey "$fixture/wrong-key" \
 -out "$fixture/wrong.dump" >/dev/null 2>&1; then exit 1; fi
"$fixture/recover-key" "$fixture/recovered/key"
head -c -1 "$archive" > "$fixture/truncated.enc"
if openssl cms -decrypt -binary -inform DER -in "$fixture/truncated.enc" -inkey "$fixture/recovered/key" \
 -out "$fixture/truncated.dump" >/dev/null 2>&1; then exit 1; fi
# Alter the encrypted content while leaving DER metadata/tag intact.
# This must fail authentication, even if the archive container is still parseable.
openssl asn1parse -inform DER -in "$archive" > "$fixture/asn1"
offset=$(awk -F: '/prim: cont \[ 0 \]/{split($2,a,"hl="); split(a[2],b," "); print $1+b[1]; exit}' "$fixture/asn1")
[[ "$offset" =~ ^[0-9]+$ ]]
cp "$archive" "$fixture/tampered.enc"
original=$(od -An -tu1 -j "$offset" -N1 "$archive" | tr -d ' ')
replacement=$((original ^ 1))
printf '%b' "$(printf '\\%03o' "$replacement")" | dd of="$fixture/tampered.enc" bs=1 seek="$offset" count=1 conv=notrunc status=none
if openssl cms -decrypt -binary -inform DER -in "$fixture/tampered.enc" -inkey "$fixture/recovered/key" \
 -out "$fixture/tampered.dump" >/dev/null 2>&1; then exit 1; fi
# Use only successfully authenticated bytes. A failed decrypt can leave plaintext
# output, so never test only file existence or pipe unchecked bytes to a restore.
openssl cms -decrypt -binary -inform DER -in "$archive" -inkey "$fixture/recovered/key" -out "$fixture/restorable.dump" >/dev/null 2>&1
pg_restore --list "$fixture/restorable.dump" >/dev/null
actual_sha=$(sha256sum "$archive"); actual_sha=${actual_sha%% *}
[[ "$(cat "$fixture/backups/last-success.json")" == *"\"archiveSha256\":\"$actual_sha\""* ]]
restored="agentmargin_backup_ci_$(openssl rand -hex 6)"
createdb --template=template0 "$restored"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$restored" "$fixture/restorable.dump"
for table in workspaces workspace_api_keys customers price_versions workspace_price_versions usage_events revenue_records revenue_deliveries revenue_adjustments revenue_payment_sources adjustment_deliveries delivery_history delivery_requeues; do
  query="SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text),'')) FROM $table t"
  [[ "$(psql -XAt -v ON_ERROR_STOP=1 -c "$query")" == "$(psql -XAt -v ON_ERROR_STOP=1 -d "$restored" -c "$query")" ]]
done
cp "$fixture/backups/last-success.json" "$fixture/before.json"
expect_failure(){
 if "$@" > "$fixture/failure.log" 2>&1; then exit 1; fi
 cmp "$fixture/backups/last-success.json" "$fixture/before.json"
 [[ ! -d "$fixture/backups/.backup-lock" ]]
 [[ $(find "$fixture/backups" -name plain.dump | wc -l) == 0 ]]
 [[ "$(cat "$fixture/failure.log")" == *'{"kind":"backup_failed"}'* ]]
}
expect_failure env AGENTMARGIN_BACKUP_UPLOAD=/bin/false bash scripts/postgres-backup.sh
expect_failure env AGENTMARGIN_BACKUP_ENCRYPT=/bin/false bash scripts/postgres-backup.sh
expect_failure env AGENTMARGIN_BACKUP_PRUNE=/bin/false bash scripts/postgres-backup.sh
expect_failure env PGDATABASE=agentmargin_nonexistent_qa bash scripts/postgres-backup.sh
# An overlap never steals or removes the lock held by another run.
mkdir "$fixture/backups/.backup-lock"
if bash scripts/postgres-backup.sh >/dev/null 2>&1; then exit 1; fi
[[ -d "$fixture/backups/.backup-lock" ]]
rmdir "$fixture/backups/.backup-lock"
cmp "$fixture/backups/last-success.json" "$fixture/before.json"
# A subsequent normal run must recover after each failed operation/held lock.
bash scripts/postgres-backup.sh
if cmp -s "$fixture/backups/last-success.json" "$fixture/before.json"; then exit 1; fi
[[ ! -d "$fixture/backups/.backup-lock" ]]
bash scripts/postgres-restored-probes.sh "$restored"
printf '{"kind":"synthetic_backup_recovery","status":"pass","durationSeconds":%d,"authenticatedEncryption":true,"separateLocalKeyRecovery":true,"externalStorageVerified":false,"productionRtoMeasured":false}\n' "$((SECONDS-started))"

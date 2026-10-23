#!/usr/bin/env bash
# Operator-deployed logical backup. Uses standard libpq PG* / PGSERVICE config.
# No scheduler, credentials, encryption keys, or storage provider are installed.
set -euo pipefail
umask 077
backup_dir=${AGENTMARGIN_BACKUP_DIR:?Private local backup directory required}
retention=${AGENTMARGIN_BACKUP_RETENTION_DAYS:-7}
encrypt=${AGENTMARGIN_BACKUP_ENCRYPT:?Absolute encryption hook required}
upload=${AGENTMARGIN_BACKUP_UPLOAD:?Absolute external upload hook required}
prune=${AGENTMARGIN_BACKUP_PRUNE:?Absolute external retention hook required}
[[ "$backup_dir" == /* && ! -L "$backup_dir" && "$retention" =~ ^[1-9][0-9]{0,3}$ ]] || exit 2
for hook in "$encrypt" "$upload" "$prune"; do
  [[ "$hook" == /* && -f "$hook" && -x "$hook" ]] || exit 2
done
mkdir -p -- "$backup_dir"
# Resolve once, then use only canonical paths whose entry/ancestors cannot be
# replaced by another local UID. Root-owned sticky /tmp is a supported parent;
# same-UID/root compromise remains outside this operator filesystem boundary.
trusted_path(){
  local current=$1 owner permissions mode
  while :; do
    read -r owner permissions < <(stat -c '%u %a' -- "$current")
    [[ "$owner" == 0 || "$owner" == "$EUID" ]] || return 1
    mode=$((8#$permissions))
    if (( (mode & 0022) != 0 )); then
      [[ -d "$current" && "$owner" == 0 ]] && (( (mode & 01000) != 0 )) || return 1
    fi
    [[ "$current" == / ]] && break
    current=$(dirname -- "$current")
  done
}
backup_dir=$(realpath -e -- "$backup_dir")
[[ "$(stat -c '%a' "$backup_dir")" == 700 && -O "$backup_dir" ]] || { echo 'Backup directory must be owned by the operator with mode 700.' >&2; exit 2; }
encrypt=$(realpath -e -- "$encrypt")
upload=$(realpath -e -- "$upload")
prune=$(realpath -e -- "$prune")
for path in "$backup_dir" "$encrypt" "$upload" "$prune"; do
  trusted_path "$path" || { echo '{"kind":"backup_configuration_rejected"}' >&2; exit 2; }
done
# Refuse overlapping runs; stale locks require operator investigation.
mkdir -- "$backup_dir/.backup-lock" 2>/dev/null || { echo 'Backup already locked.' >&2; exit 1; }
work=''
success=0
cleanup(){
  local code=$?
  if [[ -n "$work" ]]; then rm -rf -- "$work"; fi
  rmdir -- "$backup_dir/.backup-lock"
  if [[ "$success" != 1 ]]; then echo '{"kind":"backup_failed"}' >&2; fi
  exit "$code"
}
trap cleanup EXIT
work=$(mktemp -d "$backup_dir/.work-XXXXXXXX")
started=$SECONDS
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
id="agentmargin-$(date -u +%Y%m%dT%H%M%SZ)-${work##*-}"
# Neither hook output nor libpq diagnostics are emitted: they may include secrets.
pg_dump --format=custom --no-owner --no-acl --file="$work/plain.dump" >/dev/null 2>&1
pg_restore --list "$work/plain.dump" >/dev/null 2>&1
"$encrypt" "$work/plain.dump" "$work/$id.dump.enc" >/dev/null 2>&1
[[ -s "$work/$id.dump.enc" ]]
# A transport integrity reference, not authentication of arbitrary hook output.
archive_sha=$(sha256sum -- "$work/$id.dump.enc")
archive_sha=${archive_sha%% *}
archive_bytes=$(stat -c '%s' "$work/$id.dump.enc")
rm -- "$work/plain.dump"
"$upload" "$work/$id.dump.enc" "$id.dump.enc" >/dev/null 2>&1
"$prune" "$retention" >/dev/null 2>&1
mv -- "$work/$id.dump.enc" "$backup_dir/$id.dump.enc"
# Local retention only touches this utility's regular encrypted artifacts.
# GNU -mtime +N rounds down whole days and would retain almost N+1 days.
# Use an explicit UTC cutoff so the configured day count is actually honored.
cutoff=$(date -u -d "$((retention*86400)) seconds ago" +%Y-%m-%dT%H:%M:%SZ)
find "$backup_dir" -maxdepth 1 -type f -name 'agentmargin-*.dump.enc' ! -newermt "$cutoff" -delete
printf '{"kind":"backup_succeeded","startedAt":"%s","completedAt":"%s","durationSeconds":%d,"retentionDays":%d,"archive":"%s.dump.enc","archiveSha256":"%s","archiveBytes":%d}\n' \
  "$started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$((SECONDS-started))" "$retention" \
  "$id" "$archive_sha" "$archive_bytes" > "$work/last-success.json"
mv -- "$work/last-success.json" "$backup_dir/last-success.json"
cat -- "$backup_dir/last-success.json"
success=1

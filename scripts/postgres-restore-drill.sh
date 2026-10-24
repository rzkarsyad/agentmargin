#!/usr/bin/env bash
# CI-only logical backup / restore test. Never point this at a real database.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${AGENTMARGIN_RESTORE_DRILL:-}" != "ci-only" || \
      "${PGHOST:-}" != "127.0.0.1" || "${PGDATABASE:-}" != "agentmargin_ci" || \
      "${PGUSER:-}" != "agentmargin_ci" || "${PGPORT:-}" != "5432" || -z "${PGPASSWORD:-}" ]]; then
  echo 'Refusing restore drill: expected disposable GitHub Actions PostgreSQL CI service.' >&2
  exit 2
fi

source_db=agentmargin_ci
restore_db="agentmargin_restore_ci_$(od -An -tx1 -N6 /dev/urandom | tr -d ' \n')"
if [[ ! "$restore_db" =~ ^agentmargin_restore_ci_[a-f0-9]{12}$ ]]; then
  echo 'Refusing restore drill: generated database name failed validation.' >&2
  exit 2
fi

backup_dir=$(mktemp -d)
backup_file="$backup_dir/agentmargin-ci.dump"
restore_created=0
restore_owner=''
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ "$restore_created" == 1 ]]; then
    if ! dropdb --if-exists -- "$restore_db"; then
      echo 'Failed to remove dedicated temporary restore database.' >&2
      exit_code=1
    fi
  fi
  if ! rm -f -- "$backup_file"; then exit_code=1; fi
  rm -f -- "$backup_dir/source-fingerprints" "$backup_dir/restored-fingerprints"
  if ! rmdir -- "$backup_dir"; then exit_code=1; fi
  if [[ -n "$restore_owner" ]]; then psql -Xq -v ON_ERROR_STOP=1 -c "DROP ROLE \"$restore_owner\"" >/dev/null || exit_code=1; fi
  exit "$exit_code"
}
trap cleanup EXIT

sql() {
  local database=$1 statement=$2
  psql -X -A -t -v ON_ERROR_STOP=1 -d "$database" -c "$statement"
}

# The fixture comes from the prior PostgreSQL integration suite, not user data.
if [[ "$(sql "$source_db" 'SELECT count(*) FROM public.workspaces')" -lt 2 || \
      "$(sql "$source_db" 'SELECT count(*) FROM public.usage_events')" -lt 1 || \
      "$(sql "$source_db" 'SELECT count(*) FROM public.revenue_records')" -lt 1 ]]; then
  echo 'Refusing restore drill: expected populated synthetic CI fixtures.' >&2
  exit 2
fi

source scripts/lib/restore-fixture.sh
prepare_restore_fixture
snapshot_restore_fingerprints "$backup_dir/source-fingerprints"
restore_started=$SECONDS
pg_dump --format=custom --no-owner --file="$backup_file" "$source_db"
pg_restore --list "$backup_file" >/dev/null
revoke_source_fixture
createdb --template=template0 --owner="$restore_owner" -- "$restore_db"
restore_created=1
pg_restore --exit-on-error --no-owner --role="$restore_owner" --dbname="$restore_db" "$backup_file"

# Check exact restored logical rows (including hashed API-key records) without
# printing values, plus integrity-related schema objects such as constraints.
compare_restore_fingerprints "$restore_db" "$backup_dir/restored-fingerprints"

for query in \
  "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace" \
  "SELECT count(*) FROM pg_indexes WHERE schemaname='public'" \
  "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal"; do
  if [[ "$(sql "$source_db" "$query")" != "$(sql "$restore_db" "$query")" ]]; then
    echo 'Restore verification mismatch for schema integrity objects.' >&2
    exit 1
  fi
done

expect_contract_failure(){
 if bash scripts/postgres-restored-probes.sh "$restore_db" > "$backup_dir/probe-failure" 2>&1; then exit 1; fi
 [[ $(cat "$backup_dir/probe-failure") == *'Post-restore security/financial probe failed.'* ]]
 rm -- "$backup_dir/probe-failure"
}
# Inspect drift BEFORE any repair. Each probe must reject its actual bad state.
sql "$restore_db" 'GRANT EXECUTE ON FUNCTION agentmargin_auth.principal(text) TO PUBLIC' >/dev/null
expect_contract_failure
sql "$restore_db" 'REVOKE EXECUTE ON FUNCTION agentmargin_auth.principal(text) FROM PUBLIC' >/dev/null
sql "$restore_db" 'ALTER FUNCTION agentmargin_auth.principal(text) OWNER TO agentmargin_ci' >/dev/null
expect_contract_failure
sql "$restore_db" "ALTER FUNCTION agentmargin_auth.principal(text) OWNER TO \"$restore_owner\"" >/dev/null
bash scripts/postgres-restored-probes.sh "$restore_db"
echo "PostgreSQL 16 restore drill: PASSED (full archive, row fingerprints, schema checks; synthetic dump/restore elapsed $((SECONDS-restore_started)) seconds)."

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
  if ! rmdir -- "$backup_dir"; then exit_code=1; fi
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

pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$source_db"
pg_restore --list "$backup_file" >/dev/null
createdb --template=template0 -- "$restore_db"
restore_created=1
pg_restore --exit-on-error --no-owner --no-acl --dbname="$restore_db" "$backup_file"

# Check exact restored logical rows (including hashed API-key records) without
# printing values, plus integrity-related schema objects such as constraints.
for table in workspaces workspace_api_keys customers price_versions \
             workspace_price_versions usage_events revenue_records revenue_deliveries revenue_adjustments revenue_payment_sources adjustment_deliveries delivery_history delivery_requeues; do
  query="SELECT count(*)::text || ':' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) FROM public.\"$table\" t"
  original=$(sql "$source_db" "$query")
  restored=$(sql "$restore_db" "$query")
  if [[ "$original" != "$restored" ]]; then
    echo "Restore verification mismatch for table: $table" >&2
    exit 1
  fi
done

for query in \
  "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace" \
  "SELECT count(*) FROM pg_indexes WHERE schemaname='public'" \
  "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal"; do
  if [[ "$(sql "$source_db" "$query")" != "$(sql "$restore_db" "$query")" ]]; then
    echo 'Restore verification mismatch for schema integrity objects.' >&2
    exit 1
  fi
done

echo 'PostgreSQL 16 restore drill: PASSED (full custom archive, row fingerprints, schema checks).'

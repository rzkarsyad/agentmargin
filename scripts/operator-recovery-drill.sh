#!/usr/bin/env bash
# Local Docker Desktop/OrbStack/Linux only. Synthetic fixture, no external hooks.
set -euo pipefail
[[ "${AGENTMARGIN_OPERATOR_DRILL:-}" == synthetic-only ]] || { echo 'Set AGENTMARGIN_OPERATOR_DRILL=synthetic-only.' >&2; exit 2; }
umask 077
context=${AGENTMARGIN_DOCKER_CONTEXT:-default}
# Resolve a named LOCAL context without inheriting remote endpoint/TLS overrides.
docker_local(){
 env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --context "$context" "$@"
}
endpoint=$(docker_local context inspect "$context" --format '{{.Endpoints.docker.Host}}')
[[ "$endpoint" == unix:///* ]] || { echo 'Refusing non-local Docker endpoint.' >&2; exit 2; }
docker_local info >/dev/null
[[ -f db/014_delivery_transition_guard.sql && -d node_modules ]] || { echo 'Run from candidate checkout after npm ci.' >&2; exit 2; }
container=''
cleanup(){
 local code=$?
 trap - EXIT
 if [[ -n "$container" ]]; then docker_local rm -fv "$container" >/dev/null || code=1; fi
 exit "$code"
}
trap cleanup EXIT
started=$SECONDS
container=$(docker_local run -d --label agentmargin.synthetic-recovery=true \
 -e POSTGRES_DB=agentmargin_ci -e POSTGRES_USER=agentmargin_ci -e POSTGRES_PASSWORD=ci-only-disposable \
 -p 127.0.0.1::5432 postgres:16)
[[ "$container" =~ ^[a-f0-9]{64}$ ]] || exit 1
for attempt in {1..60}; do
 if docker_local exec "$container" pg_isready -U agentmargin_ci -d agentmargin_ci >/dev/null 2>&1; then break; fi
 if [[ "$attempt" == 60 ]]; then echo 'Disposable PostgreSQL startup timed out.' >&2; exit 1; fi
 sleep 1
done
binding=$(docker_local port "$container" 5432/tcp)
[[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || exit 1
port=${BASH_REMATCH[1]}
AGENTMARGIN_STANDALONE_DATABASE_URL="postgresql://agentmargin_ci:ci-only-disposable@127.0.0.1:$port/agentmargin_ci" \
 node --experimental-strip-types scripts/standalone-postgres-test.ts
# Share only this fixture's network namespace; no host networking or remote DB.
for drill in postgres-restore-drill backup-automation-ci; do
 docker_local run --rm --network "container:$container" \
  -e GITHUB_ACTIONS=true -e AGENTMARGIN_RESTORE_DRILL=ci-only -e AGENTMARGIN_BACKUP_DRILL=ci-only \
  -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGDATABASE=agentmargin_ci -e PGUSER=agentmargin_ci \
  -e PGPASSWORD=ci-only-disposable -v "$PWD:/src:ro" -w /src \
  postgres:16 bash "scripts/$drill.sh"
done
printf '{"kind":"operator_disposable_drill","status":"pass","durationSeconds":%d,"externalStorageVerified":false,"productionRtoMeasured":false}\n' "$((SECONDS-started))"

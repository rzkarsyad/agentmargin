#!/usr/bin/env bash
# Disposable local PostgreSQL verification for Docker-compatible runtimes (including OrbStack).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
for cmd in docker node npm; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }
done
node -e 'const v=process.versions.node.split(".").map(Number); if(v[0]<22||(v[0]===22&&v[1]<18)) {console.error(`Node >=22.18 required; found ${process.version}`);process.exit(2)}'
docker info >/dev/null 2>&1 || { echo 'OrbStack / Docker engine is not running' >&2; exit 2; }
name="agentmargin-release-$(date +%s)-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Publish to 127.0.0.1 only on a randomly allocated ephemeral host port.
docker run -d --name "$name" -e POSTGRES_DB=agentmargin_ci -e POSTGRES_USER=agentmargin_ci -e POSTGRES_PASSWORD=ci-only-disposable -p 127.0.0.1::5432 postgres:16 >/dev/null
ready=0
for i in $(seq 1 60); do
  if docker exec "$name" pg_isready -U agentmargin_ci -d agentmargin_ci >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'PostgreSQL did not become ready' >&2; exit 1; }
port="$(docker port "$name" 5432/tcp | sed -n '1s/.*://p')"
[[ "$port" =~ ^[0-9]+$ ]] || { echo 'Cannot determine PostgreSQL localhost port' >&2; exit 1; }
export AGENTMARGIN_STANDALONE_DATABASE_URL="postgresql://agentmargin_ci:ci-only-disposable@127.0.0.1:$port/agentmargin_ci"
echo '[1/5] Installing locked dependencies'
npm ci
echo '[2/5] TypeScript and local tests'
npm run check
echo '[3/5] Standalone PostgreSQL integration and concurrency tests'
npm run test:postgres
echo '[4/5] Source secret and sensitive-file scan'
python3 scripts/check-release-files.py
echo '[5/5] Dependency vulnerability audit'
npm audit --audit-level=low
echo 'PASS: Local release checks completed. Browser checks and human security review are still separate gates.'

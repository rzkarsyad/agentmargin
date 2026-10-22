#!/usr/bin/env bash
# Local-only evaluation: disposable synthetic data, never production.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE=(docker compose -f compose.demo.yml)
ACTION="${1:-start}"
PORT="${AGENTMARGIN_DEMO_DB_PORT:-55432}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( 10#$PORT < 1024 || 10#$PORT > 65535 )); then
  echo 'AGENTMARGIN_DEMO_DB_PORT must be an unprivileged TCP port' >&2; exit 2
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo 'OrbStack or Docker with docker compose is required.' >&2; exit 2
fi
case "$ACTION" in
  stop)
    "${COMPOSE[@]}" down
    echo 'Stopped demo containers. The demo database volume was preserved.'
    exit 0 ;;
  reset)
    echo 'WARNING: this removes the AgentMargin demo database volume and ALL its data.'
    if [[ "${AGENTMARGIN_CONFIRM_DEMO_RESET:-}" != "YES" ]]; then
      echo 'To confirm: AGENTMARGIN_CONFIRM_DEMO_RESET=YES npm run demo:reset' >&2
      exit 2
    fi
    "${COMPOSE[@]}" down --volumes
    echo 'Deleted only the AgentMargin demo Compose volumes.'
    exit 0 ;;
  start) ;;
  *) echo 'Usage: scripts/demo-local.sh [start|stop|reset]' >&2; exit 2 ;;
esac
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Node.js >=22.18 and npm are required.' >&2; exit 2
fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<18)){console.error("Node >=22.18 required");process.exit(1)}'
if [[ ! -d node_modules/pg || ! -d node_modules/hono ]]; then
  echo '[demo 1/4] Installing locked Node dependencies'
  npm ci
fi
echo '[demo 1/4] Building React/Arc dashboard locally'
npm run build:web
echo '[demo 2/4] Starting local-only PostgreSQL using OrbStack/Docker'
"${COMPOSE[@]}" up -d --wait postgres
CONNECTION="postgresql://agentmargin_demo:local-development-only@127.0.0.1:${PORT}/agentmargin_demo"
echo '[demo 3/4] Migrating and seeding synthetic customer data'
env "DATABASE_URL=$CONNECTION" node --experimental-strip-types scripts/demo-seed.ts
echo '[demo 4/4] Starting dashboard at http://127.0.0.1:8787/dashboard'
echo 'Use Ctrl+C to stop the API. To stop PostgreSQL: npm run demo:stop'
exec env "DATABASE_URL=$CONNECTION" npm run start -w @agentmargin/api
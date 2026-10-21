# AgentMargin — OrbStack release verification

This is a **local-only** validation workflow. It does not push, publish, or deploy any code.

## Requirements

- OrbStack running on macOS with its Docker-compatible CLI available as `docker`.
- Node.js >= 22.18 (Node 24 LTS works), npm, and network access to npm registry and Docker Hub.
- Run from a trusted copy of this repository. Read the script before executing.

## Execute

```bash
bash scripts/orbstack-release-check.sh
```

The script starts a disposable **postgres:16** container with an empty `agentmargin_ci` database, publishes its port on **127.0.0.1 only** (random port), then runs `npm ci`, `npm run check`, `npm run test:postgres`, and `npm audit --audit-level=low`. Its `EXIT` trap forcibly removes only the container it created, including on test failures; it does not remove other containers or volumes. Logs and test output remain in your terminal.

If tests fail, record the failing assertion, fix the source, and rerun. A passing script is necessary but **not sufficient** for a GO decision: real-browser smoke/accessibility testing, review of tracked files and license, secret scanning including git history when available, and CI verification after authorized repository creation must also be handled separately.

## Security notes

The password is test-only and is never appropriate for production. The runner uses a disposable database and should not be configured against a real production database. Never substitute an existing database URL into this script. The script only runs the bundled standalone test against a database named `agentmargin_ci`.

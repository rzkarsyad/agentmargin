# One-command local demo — v0.2.0-alpha

This workflow is an **experimental, localhost-only, synthetic-data preview**. It is not an internet-facing deployment and should not be given real customer data.

## Requirements

- OrbStack or Docker with `docker compose` available in your terminal
- Node.js **22.18+** (24 recommended) and npm
- Ports `55432` (PostgreSQL) and `8787` (local AgentMargin API) free

From the AgentMargin repository root:

```bash
npm run demo
```

The command installs dependencies only when missing, starts PostgreSQL 16 with a local-only port, applies the existing schema migrations, inserts three fictional customers, creates a **fresh workspace-scoped demo API key**, and starts the existing API/dashboard on `http://127.0.0.1:8787/dashboard`.

Copy the printed **AgentMargin demo key** and paste it into the dashboard. Select a date range including the current UTC date. The demo includes a profitable customer, a negative-contribution customer, and a customer with unknown inference cost. The demo intentionally uses **synthetic reported costs**, not real provider pricing.


### Exercise the OpenAI-shaped SDK path

With the demo API running, open a second terminal and use the **new key printed by** `npm run demo`:

```bash
AGENTMARGIN_API_KEY='am_replace_with_local_key' node --experimental-strip-types examples/track-synthetic-openai.ts
```

This posts fictional usage and revenue; it does not call OpenAI or send a prompt. Because the demo has no trusted provider price for that model, the new event has **unknown** cost. See the [Next.js integration recipe](../examples/nextjs-openai/README.md).

### Run it again

`npm run demo` reuses the existing local Docker volume and refreshes the fictional events' timestamps. Every start revokes the previous `local-demo` key and prints a newly generated one; the key is **not** saved to a file or browser storage. No external telemetry or OpenAI calls are made.

### Stop, inspect, reset

Use `Ctrl+C` to stop the API, then:

```bash
npm run demo:stop
```

The container stops **without deleting** its database volume. To intentionally erase all AgentMargin demo data (and only the Compose project's demo volume), run:

```bash
AGENTMARGIN_CONFIRM_DEMO_RESET=YES npm run demo:reset
```

**Caution:** reset permanently removes the demo Compose volume. Never use it for data you want to keep. Other Docker/OrbStack containers or volumes are untouched.

For a different loopback PostgreSQL port, set `AGENTMARGIN_DEMO_DB_PORT=55433` on the `npm run demo` command. If 8787 is occupied, stop the conflicting process before starting the AgentMargin API. This demo doesn't open any service on a public network interface.

## Verification

- `npm run check` — unit, core, API and demo seeding tests, plus TypeScript typecheck
- GitHub CI — also verifies PostgreSQL concurrency, source secrets, dependencies, a mocked-API Chromium smoke test, and a full live-stack Docker/PostgreSQL/API/SDK/Chromium test
- `bash -n scripts/demo-local.sh` — shell syntax check

- `scripts/live-demo-smoke.py` — CI-only live end-to-end smoke test: launches `npm run demo` on an isolated GitHub runner, checks real HTTP authentication and seeded financial totals in Chromium (desktop + mobile), submits a synthetic event with the OpenAI SDK helper, verifies the updated dashboard, and stops the demo. The generated key is held in memory and redacted from diagnostics. This is not a production deployment or penetration test.

These checks do **not** establish production security. Refer to [SECURITY.md](../SECURITY.md).
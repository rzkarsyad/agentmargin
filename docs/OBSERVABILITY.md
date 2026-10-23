# Operational request telemetry — v0.8 foundation

AgentMargin's API supports **opt-in JSON request metadata**. Set `AGENTMARGIN_HTTP_LOGS=json` on the **API server process** to emit one JSON record per completed HTTP request. Unset (the default) to disable. Every response receives a freshly generated `X-Request-ID` that can help operators correlate a support incident without collecting a customer's request content.

## Allowlisted fields only

Records contain exactly `kind`, `requestId`, `timestamp`, `route`, `method`, `status`, and `durationMs`.

- `route` is an allowlisted name such as `events`, `revenue`, `analytics_page`, `dashboard` or `other`; it is **not** a raw URL/path.
- `method` is allowlisted (`GET`, `POST`, `HEAD`, `OPTIONS`, `OTHER`).
- **Never logged:** bearer tokens or key hashes, cookie/authorization headers, customer/workspace IDs, request/response bodies, query strings, database errors, IP addresses, provider prompts/outputs, user-agent strings or raw routes.
- The sink is opt-in and errors in a logging sink do not fail ingestion or billing operations. That means observability delivery is **not guaranteed**; configure out-of-band monitoring for the collection pipeline.

The automated unit tests exercise successful ingestion, a 404 containing a secret query string, a 500 caused by a secret-bearing exception, and a failing log sink. They assert that the allowlist is complete and sensitive strings are absent. Tests do not prove that every downstream log collector, reverse proxy, infrastructure service or APM integration is redacted.

## Production gate — not implemented

Before public deployment, the owner must explicitly approve telemetry handling: secure transport and access controls, log retention/deletion, operator access audit, dashboards for 5xx/429/errors/latency, alert thresholds, request volume and cardinality limits, and privacy review of infrastructure/edge logs. Structured stdout logs alone are **not** an alerting or incident response solution. Test with your real ingress and collector before processing customer data.

See [security](../SECURITY.md), [backup and restore](BACKUP_RESTORE.md), and [production roadmap](ROADMAP.md).

# Operational request telemetry — v0.8 foundation

AgentMargin's API supports **opt-in JSON request metadata**. Set `AGENTMARGIN_HTTP_LOGS=json` on the **API server process** to emit one JSON record per completed HTTP request. Unset (the default) to disable. Every response receives a freshly generated `X-Request-ID` that can help operators correlate a support incident without collecting a customer's request content.

## Allowlisted fields only

Records contain exactly `kind`, `requestId`, `timestamp`, `route`, `method`, `status`, `durationMs`, and `errorClass`.

- `route` is an allowlisted name such as `events`, `revenue`, `analytics_page`, `dashboard` or `other`; it is **not** a raw URL/path.
- `method` is allowlisted (`GET`, `POST`, `HEAD`, `OPTIONS`, `OTHER`).
- **Never logged:** bearer tokens or key hashes, cookie/authorization headers, customer/workspace IDs, request/response bodies, query strings, database errors, IP addresses, provider prompts/outputs, user-agent strings or raw routes.
- The sink is opt-in and errors in a logging sink do not fail ingestion or billing operations. That means observability delivery is **not guaranteed**; configure out-of-band monitoring for the collection pipeline.

The automated unit tests exercise successful ingestion, a 404 containing a secret query string, a 500 caused by a secret-bearing exception, and a failing log sink. They assert that the allowlist is complete and sensitive strings are absent. Tests do not prove that every downstream log collector, reverse proxy, infrastructure service or APM integration is redacted.

## Readiness, metrics and shutdown

`/health` is process liveness. `/ready` returns 200 only after DB connectivity and the migration-007 schema contract succeed and while the server is accepting traffic; otherwise 503 with no dependency detail. The schema probe checks four RLS-enabled tables with tenant policies and two callable fixed-search-path SECURITY DEFINER helpers. Pre-007 schemas and disabled RLS fail readiness. This checks deployment compatibility, not independent security approval or the safety of arbitrary additional grants/extensions. Do not use a liveness probe to decide whether the database is healthy. SIGTERM/SIGINT fail readiness, stop new connections, drain HTTP and then close the pool; a 30-second deadline exits with failure. Configure ingress drain/grace periods accordingly. Database sockets have 5-second connection and 15-second statement/idle-transaction bounds. Idle pool errors emit a fixed, secret-free event and replacement connections can be acquired. Transient DB errors return a sanitized 503; other failures return 500. No automatic write replay occurs after uncertain commits: clients retry the same immutable event/record IDs.

`errorClass` is derived solely from HTTP status: none, authentication, authorization, rate_limit, client, dependency or internal. Set a separate high-entropy `AGENTMARGIN_METRICS_TOKEN` to enable `/metrics`; scrape using an Authorization bearer header on a private network. Tenant API keys do not grant monitoring access. Prometheus counters and latency histograms use fixed route names and status codes, with no IDs, paths or payload labels. Scrape each process; counters reset on restart. They are operational metrics, never financial accounting totals.

Example Prometheus alert expressions (apply to your traffic and SLOs):

- Readiness: `up{job="agentmargin"} == 0` for 2 minutes, plus an HTTP probe of `/ready` expecting 200.
- Failures: `sum(rate(agentmargin_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(agentmargin_http_requests_total[5m])), 0.01) > 0.01` for 5 minutes.
- Latency: `histogram_quantile(0.95, sum by (le) (rate(agentmargin_http_duration_seconds_bucket[5m]))) > 1` for 5 minutes.

On an alert, correlate X-Request-ID and status/error class; inspect readiness, DB connections/timeouts, storage and ingress limits. For uncertain ingestion outcomes, replay unchanged IDs and investigate 409 conflicts; never generate replacement IDs blindly. For suspected key theft, use the owner revocation workflow, isolate affected writers and preserve sanitized evidence. Escalation ownership, on-call delivery and incident exercises are operator gates.

The application limiter is process-local. Multiple instances **require** a shared ingress/API gateway or Redis-backed atomic token bucket keyed by authenticated workspace and an ingress unauthenticated limit. A distributed design needs atomic increments/expiry, shared quotas, timeout bounds and a documented fail-closed outage policy; no distributed limiter is claimed here.

## Production gate — external validation required

Before public deployment, the owner must explicitly approve telemetry handling: secure transport and access controls, log retention/deletion, operator access audit, dashboards for 5xx/429/errors/latency, alert thresholds, request volume and cardinality limits, and privacy review of infrastructure/edge logs. Structured stdout logs alone are **not** an alerting or incident response solution. Test with your real ingress and collector before processing customer data.

See [security](../SECURITY.md), [backup and restore](BACKUP_RESTORE.md), and [production roadmap](ROADMAP.md).

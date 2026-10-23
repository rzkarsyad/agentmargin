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

`/health` is process liveness. `/ready` checks DB connectivity, all ten RLS tables, expected policy counts, financial/audit trigger bindings and helper contracts through migration 014, delivery audit/recovery objects and the three fixed catalog-safe trigger paths, and returns 503 while draining. Pre-014 schemas or disabled financial RLS fail readiness. This checks deployment compatibility, not independent security approval or the safety of arbitrary additional grants/extensions. Do not use a liveness probe to decide whether the database is healthy. SIGTERM/SIGINT fail readiness, stop new connections, drain HTTP and then close the pool; a 30-second deadline exits with failure. Configure ingress drain/grace periods accordingly. Database sockets have 5-second connection and 15-second statement/idle-transaction bounds. Idle pool errors emit a fixed, secret-free event and replacement connections can be acquired. Transient DB errors return a sanitized 503; other failures return 500. No automatic write replay occurs after uncertain commits: clients retry the same immutable event/record IDs.

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


## Durable worker and recovery signals

Schedule bounded `scripts/revenue-replay-worker.ts` passes externally per authorized
workspace. Fixed aggregate output includes delivered/retry/failed and payment/
adjustment backlog, oldest pending age and unmatched counts. Nonzero exit or
`revenue_replay_failed`/pool error must alert. Export these aggregate values through
an operator-owned collector; do not add account/customer/event IDs as metric labels.
Suggested starting alerts: failed > 0 immediately, unmatched > 0 for 15 minutes,
oldest pending > 300 seconds for 5 minutes, missed worker heartbeat for two schedule
intervals, and backup success older than two backup intervals. Tune with agreed
SLOs; no alert delivery or scheduler is configured by this repository.

For repeated unmatched jobs, inspect protected source/payment mapping evidence.
Do not reset mutable fields manually or edit payloads. Use the reviewed admin
requeue receipt/cycle contract (INTEGRATIONS.md) for eligible failures. Permanent
conflicts require investigation. Aborted DB transactions have no committed attempt
row; process-error/heartbeat signals cover them. Preserve both audit and inbox with
ledger backups. After a DB outage, readiness must recover and clients/workers retry
unchanged IDs; the synthetic restart drill verifies economic/inbox/history
fingerprints and pooled reconnection, not production RTO or multi-region recovery.

Distributed abuse controls remain deployment infrastructure: one authoritative
atomic quota service/gateway must arbitrate all instances, authenticate identities
before tenant quotas, bound unauthenticated edge traffic independently, and fail
closed on quota-store outage. Process-local counters cannot establish this. Test
multiple ingress instances and quota-store partition/recovery before public exposure.
TLS ingress examples must enforce body/time/connection bounds, trusted proxy
headers and private metrics/DB reachability under that operator's approved config;
no untested deployment file is represented as a certified ingress.


The readiness contract now rejects disabled audit/requeue RLS, unexpected extra
policies and disabled or misbound expected financial/audit triggers. PG16 regressions
reproduce the pre-fix false-ready result. These catalog checks do not prove policy
expressions or function bodies/ownership/ACLs correct; installed-definition review
and cross-tenant negative probes remain mandatory. Liveness still says only that
the process can respond. Monitor readiness separately and keep metrics private.

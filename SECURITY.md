# Security policy and threat model

**Status: experimental source code — NOT production certified.** Do not expose this service to the public internet or send real customer data until you have completed deployment-specific security testing and hardening.

## Reporting vulnerabilities

Do not publish vulnerability details in public issues. Once this project is on GitHub, configure **private vulnerability reporting** under Settings → Security → Private vulnerability reporting and report issues using the repository's Security tab. Before that channel is available, report privately to the maintainer using an existing trusted contact method.

## Implemented controls

- HTTP API listens on loopback (`127.0.0.1`) by default; never assumes a secure public proxy.
- Workspace identity is derived from a high-entropy bearer key and its SHA-256 digest; raw keys are not stored in PostgreSQL.
- SQL values are parameterized and analytics filter by workspace ID.
- PostgreSQL composite keys enforce tenant-scoped identity and event idempotency. Advisory locks reduce concurrency conflicts.
- JSON body limit: 256 KB. Max 100 records per batch. Strict timestamp and numeric validation.
- Browser dashboard sends the key as a bearer header, avoids local storage, uses `textContent` to render customer data, and receives CSP/no-store headers.
- Per-process per-workspace request limiter; revocation queries live database state.
- Basic source credential scan and dependency audit are included in CI.

## Known limitations — production deployment blockers

1. **No complete internet-facing authorization review or penetration test.** Database row-level security (RLS) is not configured. A compromised API database credential can access all tenants; use a dedicated least-privilege role and isolate deployments.
2. **No TLS terminator or reverse proxy is shipped.** Production use requires audited TLS termination, trusted forwarding, gateway rate limits before auth (including invalid tokens), and protection against abuse.
3. **Local limiter is in-memory only.** Multiple API instances do not share quotas, and unauthenticated invalid-key attempts are not throttled here.
4. **No operational assurance.** Set up encrypted backups, restore drills, log redaction, structured monitoring, alerts, secret rotation policy, upgrades, and incident response.
5. **Data governance unimplemented.** No tenant self-service deletion/export policy, retention controls, or compliance review. Customer identifiers may be personal data; avoid production usage.
6. **Dashboard browser checks use mocked API analytics.** They are not a substitute for a real reverse-proxy/auth/database browser E2E test.
7. **Credential scanning is heuristic.** A clean scan or `npm audit` result does not prove absence of secrets or exploitable vulnerabilities. Verify the entire Git history before publishing it, or create a fresh history from clean source.
8. **Price catalog is trusted operator input.** Do not assume estimated prices reflect provider billing; pricing history/integrity need financial review.

## Verification and release policy

- `npm run check`: TypeScript and unit/integration suites.
- `npm run test:postgres`: PostgreSQL 16 real-server concurrency and isolation tests on a disposable empty `agentmargin_ci` database.
- `python3 scripts/check-release-files.py`: source-file scan.
- `python3 scripts/browser-smoke.py`: Chromium UI smoke check using mocked API, requires Playwright and Chromium.
- `npm audit --audit-level=low`: known dependency advisories.
- `.github/workflows/ci.yml`: mirrors checks with PostgreSQL service and browser runner; only a successful Actions run verifies the workflow itself.

**GO for publication of experimental source** requires clean staged files, adequate license and warnings, local checks passing, and successful CI on a private repository before switching to public. **NO-GO for production internet service** until blockers 1–6 are resolved and separately evaluated.

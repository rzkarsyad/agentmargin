# Phase 13 — Security review and CI verification

## Scope and evidence

Manual source review of API routes, auth flow, data model, PostgreSQL queries, SDK, browser dashboard, and release scripts. Current environment cannot access an actual user's OrbStack, does not have a connected PostgreSQL server, and cannot reliably run npm dependency installation. Consequently, no claim of new npm/PostgreSQL test passes is made here. The maintainer's previously supplied OrbStack log (v0.10) showed 30 passing local tests, no failures, one TODO test (subsequently exercised by `test:postgres`), a separate standalone PostgreSQL concurrency pass, and 0 `npm audit` findings. Earlier Chromium mocked-API smoke tests passed. These results do not automatically apply to patched v0.13.

## Findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F-01 | High for production | Public-facing deployment lacks TLS reverse proxy, pre-auth rate limits, full authorization review, monitoring and back-up/restore. | **Open**: block internet-facing production. Loopback-only server retained. |
| F-02 | High for multi-tenant production | Application DB credential can query other tenants; DB RLS not configured. | **Open**: use dedicated credentials and isolate access until RLS/authorization review. |
| F-03 | Medium | GitHub CI did not check Chromium smoke, so dashboard regressions could be missed. | **Patched**: CI adds browser job step, must pass GitHub Actions. |
| F-04 | Medium | Previous secret scan missed certain known token formats and sensitive credential files. | **Patched**: broader patterns and forbidden-file detection; heuristic limitations remain. |
| F-05 | Medium | PostgreSQL standalone tests covered usage concurrency but not concurrent revenue inserts. | **Patched**: added concurrent revenue duplicate/conflict, SQL tenant isolation, and bearer-key API tenant-isolation assertions. Must run on OrbStack/GitHub CI. |
| F-06 | Medium | Security README still referred to unverified standalone PostgreSQL tests even after user-provided pass. | **Patched**: separate evidence and remaining work in SECURITY.md. |
| F-07 | Informational | Client-side API key exists in the dashboard input for the session, without browser storage. | **Accepted for local preview**; do not expose dashboard publicly. |
| F-08 | Informational | Source-only repository is not equivalent to a production security certification. | **Accepted with prominent warning**. |

## Verification gates

1. Install locked dependencies on supported Node version; run `npm run check`.
2. Run `npm run test:postgres` against dedicated empty `agentmargin_ci` on real PostgreSQL.
3. Run `npm audit --audit-level=low` and source secret scan.
4. Run browser smoke on Chromium, review for unexpected JS errors.
5. Push to **private GitHub repo** to trigger Actions, verify successful jobs/logs and no untracked sensitive files.
6. Only after these succeed, approve the public source release with a versioned experimental tag.

**Decision now: HOLD for publishing v0.13 until its new tests and Actions run.** Production deployment remains NO-GO. This is an internal review, not an independent penetration test.

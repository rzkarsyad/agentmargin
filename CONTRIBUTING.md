# Contributing to AgentMargin

Thanks for checking out AgentMargin. This is an **experimental open-source project** under the [MIT License](LICENSE), and contributions are welcome.

## Good first contributions

- Improve installation instructions or report where onboarding was confusing.
- Add tests for cost accounting, idempotency, unknown pricing or tenant boundaries.
- Report genuine edge cases from development and local experiments (without customer data).
- Propose better SDK ergonomics, examples and observability.

Before implementing large features, open a [feedback issue](https://github.com/rzkarsyad/agentmargin/issues/new?template=feedback.yml) to discuss the use case.

## Development

Requires Node.js 22.18+ (24 recommended).

```bash
npm ci
npm run check
node --experimental-strip-types examples/calculate-margin.ts
```

For full PostgreSQL concurrency tests, follow [the local quickstart](docs/QUICKSTART.md) and [OrbStack verification guide](docs/orbstack-release-verification.md). Never run integration tests against production databases.

## Pull requests

1. Keep changes focused; explain the problem and expected behavior.
2. Add tests for behavior changes and run `npm run check`.
3. Update docs whenever public behavior or setup changes.
4. Explain any changes to security or pricing semantics.
5. Never commit credentials, production data, .env files, or personal information.

GitHub Actions provides additional PostgreSQL, source-file, dependency, and Chromium checks. Passing CI is necessary but is **not** an independent security certification.

For sensitive reports, use the private reporting route in [SECURITY.md](SECURITY.md), not a public issue.

## v0.9 candidate verification

The complete disposable PostgreSQL 16 commands, protected merge order, security
review checklist and release blockers live in [ROADMAP](docs/ROADMAP.md). Run
`npm ci`, `npm run check`, `npm audit --audit-level=low`, the guarded
`npm run test:postgres` on a new empty `agentmargin_ci`, signed synthetic delivery
and lifecycle scripts before submitting. GitHub CI adds real Chromium desktop/mobile,
backup/restore, rotation and integrated rehearsal checks. Never publish the candidate
SDK or create tags without explicit authorization. Genuine Stripe tests use only a
selected sandbox and run-tagged synthetic fixtures; see [INTEGRATIONS](docs/INTEGRATIONS.md).

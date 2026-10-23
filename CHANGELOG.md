# Changelog

## 0.9.0-alpha.1 — prepared, unreleased

- Credential-backed PostgreSQL RLS, READ COMMITTED authentication containment and
  explicit catalog qualification/temporary-schema containment through migration 013.
- Bounded durable financial replay, immutable attempt/requeue history and reviewed
  dead-letter recovery; preserve original payments and append linked USD reductions.
- Exact net revenue and traceable signed reconciliation with unknown FX/tier/unmatched
  evidence. Current Stripe credit schemas and explicit platform-account routing;
  accept only explicit null for unused out-of-band allocation while rejecting mixed
  allocations. Operator-verified signed sandbox recovery passed with $10.75 net
  and zero variance; independent billing/security/accounting gates remain open.
- Operational/readiness/backup/restore/restart/privacy rehearsals and full-stack
  browser/SDK validation. No deployment-specific production certification.
- SDK candidate 0.5.0-alpha.1 adds adjustment and durable delivery methods while
  preserving prior methods. API analytics revenue now uses the documented net basis.

See [draft release notes](docs/releases/v0.9.0-alpha.1.md) for compatibility, approval
and external verification gates. Nothing in this entry claims publication.

## Published history

- SDK 0.4.0-alpha.2: GitHub Actions Trusted Publishing; existing public npm prerelease.
- Platform v0.3.0-alpha: workspace pricing and React dashboard.
- Platform v0.2.0-alpha: local demo and provider usage helper foundation.
- Platform v0.1.0-alpha: initial source preview.

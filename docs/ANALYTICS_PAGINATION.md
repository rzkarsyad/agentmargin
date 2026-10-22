# Paginated workspace analytics — v0.5 candidate

**Endpoint:** `GET /v1/analytics/page`

Requires the existing workspace bearer key. Identity is never read from a `workspaceId` query parameter.

```http
GET /v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=50
Authorization: Bearer am_LOCAL_WORKSPACE_KEY
```

The response contains a **server-calculated whole-workspace summary**, at most `limit` customers, a `nextCursor` (or null), plus bounded unknown-model diagnostics. Send `cursor=<nextCursor>` to get the next page. `limit` must be an integer 1–100 (default 50). The API validates an explicit timestamp with timezone, a period no longer than 366 days, and a canonical base64url pagination cursor.

## Summary fields

- `customerCount`, `verifiedCustomerCount`, `profitableCustomerCount`, `lossMakingCustomerCount`, `unknownCustomerCount`
- `usageEventCount` and `unknownUsageEventCount`
- `totalRevenueMicros`, `totalKnownAiCostMicros`
- `verifiedCustomerContributionMicros`: **only customers with fully known inference costs**. Never display as full workspace contribution if any unknown-cost customers exist.
- `completeContributionMicros`: null if **any** customer has an unknown-cost event in the selected period; otherwise revenue minus known AI cost.

Amounts and unbounded counts are serialized as **decimal integer strings**, not JavaScript floating-point values. Customer margin basis points may be null when cost is incomplete or revenue is zero.

## Accuracy boundaries

All summary and page SQL queries run inside a **read-only REPEATABLE READ** transaction on PostgreSQL. Summary covers all customers in the selected period, even beyond page size; the UI's per-customer bar chart is explicitly labeled as a **current-page preview**. Unknown costs are not converted to $0.

Pagination uses keyset ordering by customer identifier. Individual pages share a snapshot with their own summary, but **separate HTTP page requests do not share a frozen global snapshot** if events are concurrently ingested. The client must re-fetch the first page when it needs a newly consistent browsing session. A cursor is a position, not an authenticated capability token or a permanent snapshot.

The legacy `GET /v1/analytics` remains for existing clients but is bounded to the first 2,000 customers and marks `truncated`; use the new endpoint for complete totals. The frontend uses this new endpoint so full-workspace KPIs are no longer derived from a partial table.

This is a preview for synthetic/local usage, not invoice reconciliation or a production reporting SLA.

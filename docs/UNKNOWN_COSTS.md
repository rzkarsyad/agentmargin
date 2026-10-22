# Understanding unknown AI costs

AgentMargin deliberately does **not** interpret missing pricing as free model usage. If an event has neither a provider-reported cost nor a usable pricing version at ingestion time, its cost is marked `unknown`.

## What the v0.2 analytics preview shows

An authenticated request to `GET /v1/analytics?start=...&end=...` includes:

```json
{
  "unknownModels": [
    { "model": "example-model", "eventCount": 4 }
  ],
  "unknownModelsTruncated": false
}
```

- `unknownModels` lists up to 20 model names with the most unknown-cost events, ordered by count and name.
- `unknownModelsTruncated: true` means **more than 20 distinct unknown-cost models** exist in the selected period. Don't interpret this list as complete.
- The SQL always filters on the **authenticated workspace** and the selected UTC time window. Diagnostics include all workspace events in that window, even when the separate customer table is limited to 2,000 customers.
- Counts represent **events**, not customers, invoices, dollars, or an estimate of how much was spent.
- Model names are treated as untrusted text in the dashboard; never embed them as HTML.

## What to do when a model is listed

1. Confirm the provider response actually contains usage and that the model identifier is correctly mapped.
2. Prefer the provider's **reported cost** where trustworthy and available.
3. Otherwise, supply an independently verified pricing version with the correct effective dates. Pay particular attention to cached-input prices when cached tokens are present.
4. Retry newly generated **distinct events** only; existing event IDs and stored costs are immutable under the ingestion idempotency rules.

**Important:** Adding a price record now does **not** recalculate previously ingested unknown-cost events. This tool does not yet implement audited historical repricing, billing reconciliation, or an automatic vendor price catalog. Never guess missing costs just to make margin values appear complete.

Unknown events intentionally suppress the final AI contribution and margin for affected customers. Only known-cost events contribute to `knownAiCostMicros`.

This diagnostic feature is part of the v0.2 **development branch** until merged. It is not a production security guarantee. See [SECURITY.md](../SECURITY.md).

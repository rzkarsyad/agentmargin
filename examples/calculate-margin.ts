import { calculateCustomerMargin, formatUsdMicros } from '../packages/core/src/index.ts';

// Illustrative pricing, NOT a current provider price sheet.
const result = calculateCustomerMargin({
  workspaceId: 'local-demo',
  customerId: 'customer-1',
  periodStart: '2026-10-01T00:00:00Z',
  periodEnd: '2026-11-01T00:00:00Z',
  prices: [{
    id: 'demo-price-1',
    model: 'example-model',
    effectiveFrom: '2026-01-01T00:00:00Z',
    inputMicrosPerMillion: 1_000_000n,  // $1 per million input tokens
    outputMicrosPerMillion: 4_000_000n, // $4 per million output tokens
  }],
  events: [{
    id: 'event-1',
    workspaceId: 'local-demo',
    customerId: 'customer-1',
    occurredAt: '2026-10-10T12:00:00Z',
    model: 'example-model',
    inputTokens: 5000,
    outputTokens: 2000,
  }],
  revenues: [{
    id: 'revenue-1',
    workspaceId: 'local-demo',
    customerId: 'customer-1',
    occurredAt: '2026-10-01T00:00:00Z',
    amountMicros: 29_000_000n,
  }],
});

if (result.revenueMicros !== 29_000_000n ||
    result.knownAiCostMicros !== 13_000n ||
    result.contributionMicros !== 28_987_000n) {
  throw new Error('Quickstart example failed expected accounting totals');
}

console.log('Revenue (USD):', formatUsdMicros(result.revenueMicros));
console.log('AI cost (USD):', formatUsdMicros(result.knownAiCostMicros));
console.log('Contribution (USD):', formatUsdMicros(result.contributionMicros!));
console.log('AI contribution margin:', Number(result.marginBasisPoints) / 100 + '%');

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEventCost, calculateCustomerMargin, resolvePrice, formatUsdMicros, type UsageEvent, type PriceVersion } from '../src/index.ts';

const event: UsageEvent = { id:'e1', workspaceId:'w1', customerId:'c1', model:'model-a', occurredAt:'2026-10-01T00:00:00Z', inputTokens:1_000_000, outputTokens:500_000, cachedInputTokens:100_000 };
const price: PriceVersion = { id:'p1', model:'model-a', effectiveFrom:'2026-01-01T00:00:00Z', inputMicrosPerMillion:2_000_000n, outputMicrosPerMillion:8_000_000n, cachedInputMicrosPerMillion:500_000n };
const base = { workspaceId:'w1', customerId:'c1', periodStart:'2026-10-01T00:00:00Z', periodEnd:'2026-11-01T00:00:00Z', events:[event], prices:[price], revenues:[{id:'r1',workspaceId:'w1',customerId:'c1',occurredAt:'2026-10-01T01:00:00Z',amountMicros:10_000_000n}] };

test('token classes and microdollar calculations are exact', () => {
  assert.deepEqual(calculateEventCost(event,[price]), {source:'estimated', amountMicros:5_850_000n, priceVersionId:'p1'});
});
test('provider cost takes precedence including zero', () => {
  assert.equal(calculateEventCost({...event, reportedCostMicros:0n},[]).amountMicros,0n);
});
test('unknown pricing prevents misleading margin', () => {
  const m=calculateCustomerMargin({...base,prices:[]});
  assert.equal(m.contributionMicros,null); assert.equal(m.marginBasisPoints,null); assert.equal(m.unknownEventCount,1);
});
test('computes contribution and basis points', () => {
  const m=calculateCustomerMargin(base);
  assert.equal(m.contributionMicros,4_150_000n); assert.equal(m.marginBasisPoints,4150n);
});
test('negative contribution with revenue', () => {
  const m=calculateCustomerMargin({...base,revenues:[{...base.revenues[0]!,amountMicros:1_000_000n}]});
  assert.equal(m.marginBasisPoints,-48500n);
});
test('zero revenue has undefined margin', () => {
  assert.equal(calculateCustomerMargin({...base,revenues:[]}).marginBasisPoints,null);
});
test('isolation by customer, workspace, and exclusive period end', () => {
  const events=[event,{...event,id:'other',customerId:'c2'},{...event,id:'other-workspace',workspaceId:'w2'}, {...event,id:'end',occurredAt:'2026-11-01T00:00:00Z'}];
  assert.equal(calculateCustomerMargin({...base,events}).knownEventCount,1);
});
test('duplicate event id is rejected instead of double-charged', () => {
  assert.throws(()=>calculateCustomerMargin({...base,events:[event,event]}),/duplicate event ID/);
});
test('rejects unsafe token values, negative price and invalid cache counts', () => {
  assert.throws(()=>calculateEventCost({...event,inputTokens:Number.MAX_SAFE_INTEGER+1},[price]),/safe integer/);
  assert.throws(()=>calculateEventCost({...event,cachedInputTokens:1_000_001},[price]),/exceeds/);
  assert.throws(()=>calculateEventCost(event,[{...price,inputMicrosPerMillion:-1n}]),/nonnegative/);
});
test('cached usage without cached price is unknown', () => {
  assert.equal(calculateEventCost(event,[{...price,cachedInputMicrosPerMillion:null}]).source,'unknown');
});
test('effective dates and overlapping prices', () => {
  assert.equal(resolvePrice(event,[{...price,effectiveTo:'2026-10-01T00:00:00Z'}]),null);
  assert.throws(()=>resolvePrice(event,[price,{...price,id:'p2'}]),/Overlapping prices/);
});
test('micro formatting preserves six decimal places',()=>{
  assert.equal(formatUsdMicros(-1n),'-0.000001');
});
test('rejects estimated event costs beyond the PostgreSQL BIGINT storage range',()=>{
  assert.throws(()=>calculateEventCost({...event,inputTokens:Number.MAX_SAFE_INTEGER,cachedInputTokens:0},[{...price,inputMicrosPerMillion:9_223_372_036_854_775_807n}]),/BIGINT range/);
});

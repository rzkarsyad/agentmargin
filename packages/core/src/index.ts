/** Deterministic USD-micro accounting; no provider or database dependencies. */
export type CostSource = 'reported' | 'estimated' | 'unknown';
export const MAX_DATABASE_MICROS = 9_223_372_036_854_775_807n; // PostgreSQL BIGINT
export interface UsageEvent {
  id: string; workspaceId: string; customerId: string; model: string; occurredAt: string;
  inputTokens: number; outputTokens: number; cachedInputTokens?: number;
  reportedCostMicros?: bigint | null;
}
export interface PriceVersion {
  id: string; model: string; effectiveFrom: string; effectiveTo?: string | null;
  /** USD micros per million tokens. */
  inputMicrosPerMillion: bigint; outputMicrosPerMillion: bigint;
  cachedInputMicrosPerMillion?: bigint | null;
}
export interface RevenueRecord {
  id: string; workspaceId: string; customerId: string; occurredAt: string; amountMicros: bigint;
}
export interface CostResult { source: CostSource; amountMicros: bigint | null; priceVersionId: string | null }
export interface CustomerMargin {
  workspaceId: string; customerId: string; revenueMicros: bigint; knownAiCostMicros: bigint;
  contributionMicros: bigint | null; marginBasisPoints: bigint | null;
  knownEventCount: number; unknownEventCount: number; estimatedEventCount: number; reportedEventCount: number;
}

function time(value: string): number {
  const t = Date.parse(value);
  if (!Number.isFinite(t) || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new Error(`Invalid timestamp: ${value}`);
  return t;
}
function tokens(n: number, key: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${key} must be a nonnegative safe integer`);
}
function money(n: bigint, key: string): void { if (n < 0n) throw new Error(`${key} must be nonnegative`); }
export function roundDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error('Invalid division');
  return (n + d / 2n) / d;
}
function signedRoundDiv(n: bigint, d: bigint): bigint { return n < 0n ? -roundDiv(-n, d) : roundDiv(n, d); }

export function resolvePrice(event: UsageEvent, prices: readonly PriceVersion[]): PriceVersion | null {
  const at = time(event.occurredAt);
  const found = prices.filter(p => {
    if (p.model !== event.model) return false;
    const from = time(p.effectiveFrom);
    const to = p.effectiveTo == null ? Infinity : time(p.effectiveTo);
    if (to <= from) throw new Error(`Invalid price interval: ${p.id}`);
    return from <= at && at < to;
  });
  if (found.length > 1) throw new Error(`Overlapping prices: ${event.model}`);
  return found[0] ?? null;
}

export function calculateEventCost(event: UsageEvent, prices: readonly PriceVersion[]): CostResult {
  tokens(event.inputTokens, 'inputTokens'); tokens(event.outputTokens, 'outputTokens');
  const cached = event.cachedInputTokens ?? 0;
  tokens(cached, 'cachedInputTokens');
  if (cached > event.inputTokens) throw new Error('cachedInputTokens exceeds inputTokens');
  if (event.reportedCostMicros != null) {
    money(event.reportedCostMicros, 'reportedCostMicros');
    if (event.reportedCostMicros > MAX_DATABASE_MICROS) throw new Error('Cost exceeds PostgreSQL BIGINT range');
    return { source: 'reported', amountMicros: event.reportedCostMicros, priceVersionId: null };
  }
  const price = resolvePrice(event, prices);
  if (!price) return { source: 'unknown', amountMicros: null, priceVersionId: null };
  money(price.inputMicrosPerMillion, 'inputRate'); money(price.outputMicrosPerMillion, 'outputRate');
  if (price.cachedInputMicrosPerMillion != null) money(price.cachedInputMicrosPerMillion, 'cachedRate');
  if (cached > 0 && price.cachedInputMicrosPerMillion == null)
    return { source: 'unknown', amountMicros: null, priceVersionId: price.id };
  const n = BigInt(event.inputTokens - cached) * price.inputMicrosPerMillion
    + BigInt(event.outputTokens) * price.outputMicrosPerMillion
    + BigInt(cached) * (price.cachedInputMicrosPerMillion ?? 0n);
  const cost=roundDiv(n,1_000_000n);
  if(cost>MAX_DATABASE_MICROS)throw new Error('Cost exceeds PostgreSQL BIGINT range');
  return { source: 'estimated', amountMicros: cost, priceVersionId: price.id };
}

export function calculateCustomerMargin(input: {
  workspaceId: string; customerId: string; periodStart: string; periodEnd: string;
  events: readonly UsageEvent[]; revenues: readonly RevenueRecord[]; prices: readonly PriceVersion[];
}): CustomerMargin {
  const start = time(input.periodStart), end = time(input.periodEnd);
  if (start >= end) throw new Error('Invalid period');
  const scoped = (x: {workspaceId: string; customerId: string; occurredAt: string}) =>
    x.workspaceId === input.workspaceId && x.customerId === input.customerId && time(x.occurredAt) >= start && time(x.occurredAt) < end;
  let revenueMicros = 0n, knownAiCostMicros = 0n;
  for (const r of input.revenues.filter(scoped)) { money(r.amountMicros, 'revenue'); revenueMicros += r.amountMicros; }
  let unknownEventCount = 0, estimatedEventCount = 0, reportedEventCount = 0;
  const seen = new Set<string>();
  for (const event of input.events.filter(scoped)) {
    if (!event.id || seen.has(event.id)) throw new Error(`Missing/duplicate event ID: ${event.id}`);
    seen.add(event.id);
    const cost = calculateEventCost(event, input.prices);
    if (cost.amountMicros == null) unknownEventCount++;
    else {
      knownAiCostMicros += cost.amountMicros;
      if (cost.source === 'estimated') estimatedEventCount++;
      if (cost.source === 'reported') reportedEventCount++;
    }
  }
  const contributionMicros = unknownEventCount ? null : revenueMicros - knownAiCostMicros;
  const marginBasisPoints = contributionMicros == null || revenueMicros === 0n ? null
    : signedRoundDiv(contributionMicros * 10_000n, revenueMicros);
  return { workspaceId: input.workspaceId, customerId: input.customerId, revenueMicros,
    knownAiCostMicros, contributionMicros, marginBasisPoints,
    knownEventCount: seen.size - unknownEventCount, unknownEventCount, estimatedEventCount, reportedEventCount };
}

export function formatUsdMicros(micros: bigint): string {
  const sign = micros < 0n ? '-' : '';
  const n = micros < 0n ? -micros : micros;
  return `${sign}${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`;
}

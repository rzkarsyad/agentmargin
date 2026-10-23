/** Diagnostic precision only. The production ledger remains integer USD micros. */
import { calculateEventCost, type PriceVersion, type UsageEvent } from '../../packages/core/src/index.ts';
export const COST_DENOMINATOR = 1000000n;
export function fractionalMicros(numerator: bigint): string {
    const sign = numerator < 0n ? '-' : '', n = numerator < 0n ? -numerator : numerator;
    const fraction = (n % COST_DENOMINATOR).toString().padStart(6, '0').replace(/0+$/, '');
    return sign + (n / COST_DENOMINATOR).toString() + (fraction ? '.' + fraction : '');
}
/** Token/rate numerator in millionths of a microdollar; never round a daily bucket. */
export function tokenCostNumerator(tokens: {
    input: number;
    output: number;
    cached: number;
}, price: PriceVersion): bigint | null {
    if (![tokens.input, tokens.output, tokens.cached].every(n => Number.isSafeInteger(n) && n >= 0) || tokens.cached > tokens.input)
        throw new Error('Invalid precision quantities');
    if ([price.inputMicrosPerMillion, price.outputMicrosPerMillion, price.cachedInputMicrosPerMillion ?? 0n].some(n => n < 0n))
        throw new Error('Invalid precision rates');
    if (tokens.cached > 0 && price.cachedInputMicrosPerMillion == null)
        return null;
    return BigInt(tokens.input - tokens.cached) * price.inputMicrosPerMillion + BigInt(tokens.output) * price.outputMicrosPerMillion + BigInt(tokens.cached) * (price.cachedInputMicrosPerMillion ?? 0n);
}
/** A deterministic workload illustration, NOT a measured provider distribution. */
export function scaleEventRounding(event: UsageEvent, price: PriceVersion, count: bigint) {
    if (count < 1n)
        throw new Error('Positive event count required');
    const cost = calculateEventCost(event, [price]);
    if (cost.source !== 'estimated' || cost.amountMicros === null)
        throw new Error('Priced estimated event required');
    const numerator = tokenCostNumerator({ input: event.inputTokens, output: event.outputTokens, cached: event.cachedInputTokens ?? 0 }, price)!;
    const error = (cost.amountMicros * COST_DENOMINATOR - numerator) * count;
    return { basis: 'hypothetical_identical_events_not_observed_provider_usage', events: count.toString(), ledgerMicros: (cost.amountMicros * count).toString(), unroundedEstimatedMicros: fractionalMicros(numerator * count), roundingErrorMicros: fractionalMicros(error), maximumAbsoluteErrorBoundMicros: fractionalMicros(count * COST_DENOMINATOR / 2n), relativeErrorRatio: numerator === 0n ? null : { numerator: error.toString(), denominator: (numerator * count).toString() } };
}

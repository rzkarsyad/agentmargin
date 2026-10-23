/** Read-only, narrow before/after corroboration. Never creates usage events. */
import { createHash } from 'node:crypto';
import { calculateEventCost } from '../../packages/core/src/index.ts';
import { fromOpenAIResponse } from '../../packages/sdk/src/openai.ts';
import { validateCapturedResponse } from './openai-live.ts';
import { validateOpenAiBilling, decimalUnits, exactMicros, BillingInputError, type BillingConfig, type EvidenceCheck } from './openai-billing.ts';
import { fractionalMicros, tokenCostNumerator } from './openai-cost-precision.ts';
export interface BillingSnapshot {
    usage: string;
    cost: string;
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function reconcileOpenAiSnapshots(before: BillingSnapshot, after: BillingSnapshot, config: BillingConfig, receipt?: unknown) {
    if (config.expected)
        throw new BillingInputError('single_sample_expectation_not_valid_for_snapshots');
    const a = validateOpenAiBilling(before.usage, before.cost, config), b = validateOpenAiBilling(after.usage, after.cost, config);
    const checks: EvidenceCheck[] = [], add = (check: string, status: EvidenceCheck['status'], reason: string) => checks.push({ check, status, reason });
    add('snapshot_validation', [a, b].some(r => r.report.status === 'FAIL') ? 'FAIL' : 'PASS', 'Each original snapshot independently parsed, hashed and checked; external gates stay in nested reports.');
    const u = a.usage[0], v = b.usage[0], c = a.costs[0], d = b.costs[0];
    const shape = a.usage.length === 1 && b.usage.length === 1 && a.costs.length === 1 && b.costs.length === 1;
    const samePeriod = shape && u!.start === v!.start && u!.end === v!.end && c!.start === u!.start && c!.end === u!.end && d!.start === v!.start && d!.end === v!.end;
    const sameUsage = shape && u!.dimensionRef === v!.dimensionRef;
    const sameCost = shape && c!.project === d!.project && c!.apiKey === d!.apiKey && c!.model === d!.model && c!.tier === d!.tier && c!.batch === d!.batch;
    const orgKnown = shape && !!c!.organization && !!d!.organization;
    const sameOrg = orgKnown && c!.organization === d!.organization;
    add('single_bucket_snapshot_shape', shape ? 'PASS' : 'INCONCLUSIVE', 'Only one active usage bucket and one active USD cost row per snapshot are supported; never choose a matching row from mixed scopes.');
    add('snapshot_scope', samePeriod && sameUsage && sameCost ? 'PASS' : 'FAIL', 'The UTC period and all usage attribution/non-quantity dimensions must stay identical.');
    add('same_organization', !orgKnown ? 'INCONCLUSIVE' : sameOrg ? 'PASS' : 'FAIL', 'Organization IDs are compared privately; neither IDs nor names are copied into the report.');
    let delta: {
        requests: string;
        inputTokens: string;
        outputTokens: string;
        cachedInputTokens: string;
        providerMicros: string;
        unroundedEstimatedMicros: string | null;
        ledgerMicros: string | null;
        ledgerMinusProviderMicros: string | null;
        eventRoundingErrorMicros: string | null;
        unroundedEstimateVarianceMicros: string | null;
        conditionalTwoEventSumMicros: string | null;
    } | null = null;
    let privateMetadata: {
        supplied: boolean;
        sha256: string | null;
        responseMetadataMatchesDelta: boolean;
        responseIdentityReportedPreserved: boolean;
        localPipelineReportedPass: boolean;
    } = { supplied: receipt !== undefined, sha256: receipt === undefined ? null : digest(JSON.stringify(receipt)), responseMetadataMatchesDelta: false, responseIdentityReportedPreserved:false, localPipelineReportedPass: false };
    const blocking = new Set(['duplicate_usage_bucket', 'duplicate_cost_bucket', 'overlapping_billing_scopes', 'billing_dimensions', 'billing_adjustment', 'billing_currency', 'missing_billing_amount', 'missing_billing_line', 'unmatched_billing_line', 'bucket_coverage']);
    const comparisonsSafe = shape && samePeriod && sameUsage && sameCost && (!orgKnown || sameOrg) && [a, b].every(r => !r.report.checks.some(c => blocking.has(c.check))) && u!.pricingSupported && v!.pricingSupported && u!.exactCostMicros!==null && v!.exactCostMicros!==null && u!.price && v!.price && u!.price.id === v!.price.id && c!.amount !== null && d!.amount !== null;
    add('delta_comparability', comparisonsSafe ? 'PASS' : 'INCONCLUSIVE', 'Both snapshots need comparable supported pricing, complete simple USD amounts and stable scopes; see nested source checks.');
    if (comparisonsSafe) {
        const requests = BigInt(v!.requests) - BigInt(u!.requests), input = BigInt(v!.input) - BigInt(u!.input), output = BigInt(v!.output) - BigInt(u!.output), cached = BigInt(v!.cached) - BigInt(u!.cached), provider = d!.amount! - c!.amount!;
        const monotonic = requests > 0n && input >= 0n && output >= 0n && cached >= 0n && cached <= input && provider >= 0n;
        add('monotonic_snapshot_delta', monotonic ? 'PASS' : 'FAIL', 'Positive request delta and nonnegative compatible quantities/cost are required; corrections/credits are not inferred usage.');
        if (monotonic) {
            const exact = tokenCostNumerator({ input: Number(input), output: Number(output), cached: Number(cached) }, v!.price!);
            const exactMicrosValue = exact === null ? null : fractionalMicros(exact);
            delta = { requests: requests.toString(), inputTokens: input.toString(), outputTokens: output.toString(), cachedInputTokens: cached.toString(), providerMicros: exactMicros(provider), unroundedEstimatedMicros: exactMicrosValue, ledgerMicros: null, ledgerMinusProviderMicros: null, eventRoundingErrorMicros: null, unroundedEstimateVarianceMicros: exactMicrosValue === null ? null : exactMicros(decimalUnits(exactMicrosValue) / 1000000n - provider), conditionalTwoEventSumMicros: null };
            add('delta_linear_price_consistency', exactMicrosValue === null ? 'INCONCLUSIVE' : decimalUnits(exactMicrosValue) / 1000000n === provider ? 'PASS' : 'FAIL', 'Unrounded net token delta compared with exact USD billing delta, conditional on reviewed rates; no aggregate rounding.');
            if (receipt !== undefined) {
                if (!receipt || typeof receipt !== 'object')
                    throw new BillingInputError('invalid_private_response_receipt');
                const r = receipt as {
                    schemaVersion?: unknown;
                    state?: unknown;
                    response?: unknown;
                    pipeline?: {
                        status?: unknown;
                        responseIdentityPreserved?: unknown;
                        calculatedMicros?: unknown;
                    };
                };
                if (r.schemaVersion !== 1 || r.state !== 'tracked')
                    throw new BillingInputError('tracked_private_response_receipt_required');
                const response = validateCapturedResponse(r.response), event = fromOpenAIResponse(response, 'synthetic-snapshot-verification');
                const matches = requests === 1n && event.model === v!.model && Date.parse(event.occurredAt) >= Date.parse(v!.start) && Date.parse(event.occurredAt) < Date.parse(v!.end) && BigInt(event.inputTokens) === input && BigInt(event.outputTokens) === output && BigInt(event.cachedInputTokens ?? 0) === cached;
                privateMetadata.responseMetadataMatchesDelta = matches;
                privateMetadata.responseIdentityReportedPreserved=r.pipeline?.responseIdentityPreserved===true;
                add('private_response_delta_match', matches ? 'PASS' : 'FAIL', 'Private response model/time/tokens are consistent with one net increment. Identity is supplied only by the receipt and cannot be matched or inferred from CSV.');
                if (matches) {
                    const calculated = calculateEventCost({ ...event, reportedCostMicros: undefined, workspaceId: 'local-read-only-snapshot-review' }, [v!.price!]);
                    const localPass = calculated.source==='estimated' && calculated.amountMicros!==null && typeof r.pipeline?.calculatedMicros==='string' && r.pipeline?.status === 'PASS' && r.pipeline.responseIdentityPreserved === true && r.pipeline.calculatedMicros === calculated.amountMicros?.toString();
                    privateMetadata.localPipelineReportedPass = localPass;
                    add('private_pipeline_receipt', localPass ? 'PASS' : 'FAIL', 'Receipt reports preserved identity, successful local pipeline and the same production-engine cost; not independent database/provider attestation.');
                    if (localPass && calculated.amountMicros !== null) {
                        const ledger = decimalUnits(calculated.amountMicros.toString()) / 1000000n;
                        delta.ledgerMicros = calculated.amountMicros.toString();
                        delta.ledgerMinusProviderMicros = exactMicros(ledger - provider);
                        delta.eventRoundingErrorMicros = exactMicros(ledger - decimalUnits(exactMicrosValue!) / 1000000n);
                        // Explicitly conditional: this does not read or certify a full ledger cohort.
                        if (u!.requests === 1 && u!.costMicros !== null)
                            delta.conditionalTwoEventSumMicros = (BigInt(u!.costMicros) + calculated.amountMicros).toString();
                        add('delta_rounding_decomposition', 'PASS', 'Ledger/provider variance is retained separately from rounding and unrounded rate/billing residual; no implicit tolerance.');
                    }
                }
            }
            else
                add('private_response_delta_match', 'INCONCLUSIVE', 'No private response receipt supplied; a net daily count increase is not proof of one identified request and supplies no rounded ledger cost.');
        }
    }
    add('snapshot_order_and_finality', 'INCONCLUSIVE', 'Before/after ordering is operator-supplied; asynchronous settlement and retrospective corrections can affect deltas.');
    add('source_billing_attribution', 'INCONCLUSIVE', 'Organization-level arithmetic never proves response/project/key billing allocation or exclusive activity between snapshots.');
    add('historical_pricing_coverage_policy', 'INCONCLUSIVE', 'Historical authority, wider provider/product coverage and financial policy/materiality approval remain pending.');
    const status = checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE';
    return { schemaVersion: 1, kind: 'openai_billing_snapshot_delta', status, checks, sourceOrdering: 'operator_supplied_before_after_not_provider_finalized', before: a.report, after: b.report, delta, privateMetadata, conditionalTwoEventSumBasis: 'Before single-request QA estimate plus matching private tracked receipt; not an independently read complete ledger cohort', varianceConvention: 'AgentMargin ledger minus provider, in exact decimal USD micros', providerNetworkCalls: 0, originalsModified: false };
}

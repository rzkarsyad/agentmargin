/** Private OpenAI export validation. No network calls, repricing or credentials.
 * CSV buckets are aggregate evidence, never fabricated provider response IDs. */
import { createHash } from 'node:crypto';
import { fractionalMicros, tokenCostNumerator } from './openai-cost-precision.ts';
import { calculateEventCost, MAX_DATABASE_MICROS, type UsageEvent, type PriceVersion } from '../../packages/core/src/index.ts';
export type EvidenceStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export interface EvidenceCheck {
    check: string;
    status: EvidenceStatus;
    reason: string;
}
export interface BillingRate {
    id: string;
    model: string;
    effectiveFrom: string;
    effectiveTo: string;
    inputMicrosPerMillion: string;
    outputMicrosPerMillion: string;
    cachedInputMicrosPerMillion: string | null;
    source: {
        kind: 'official_current' | 'community' | 'unverified';
        url: string;
        observedAt: string;
        historicalEffectiveDateRef?: string;
    };
}
export interface BillingConfig {
    rates: BillingRate[];
    expected?: {
        model: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
    };
}
export interface BillingUsage {
    row: number;
    start: string;
    end: string;
    model: string;
    project: string;
    apiKey: string;
    requests: number;
    input: number;
    output: number;
    cached: number;
    supported: boolean;
    issues: string[];
    event: UsageEvent | null;
    pricingSupported: boolean;
    exactCostMicros: string | null;
    dimensionRef: string;
    price: PriceVersion | null;
    costMicros: string | null;
}
export class BillingInputError extends Error {
}
function bad(code: string): never { throw new BillingInputError(code); }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,149}$/;
const validModel = (value: unknown): value is string => typeof value === 'string' && modelPattern.test(value);
function validInstant(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
        return false;
    return new Date(value.slice(0, 19) + 'Z').toISOString().slice(0, 19) === value.slice(0, 19);
}
/** Bounded RFC4180 scanner; rejects duplicate headers, ragged rows and junk after quotes. */
export function parseBillingCsv(text: string): {
    headers: string[];
    rows: Record<string, string>[];
} {
    if (Buffer.byteLength(text) > 10000000 || text.includes('\uFFFD'))
        bad('csv_size_or_encoding');
    text = text.replace(/^\uFEFF/, '');
    const records: string[][] = [];
    let row: string[] = [], cell = '', quoted = false, closed = false;
    const pushCell = () => {
        row.push(cell);
        cell = '';
        closed = false;
        if (row.length > 100)
            bad('too_many_columns');
    };
    const pushRow = () => {
        pushCell();
        if (row.some(v => v !== ''))
            records.push(row);
        row = [];
        if (records.length > 100001)
            bad('too_many_rows');
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                }
                else {
                    quoted = false;
                    closed = true;
                }
            }
            else
                cell += c;
        }
        else if (c === '"') {
            if (cell || closed)
                bad('invalid_csv_quote');
            quoted = true;
        }
        else if (c === ',')
            pushCell();
        else if (c === '\r' || c === '\n') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            pushRow();
        }
        else {
            if (closed)
                bad('invalid_csv_after_quote');
            cell += c;
        }
        if (cell.length > 10000)
            bad('csv_cell_too_large');
    }
    if (quoted)
        bad('unterminated_csv_quote');
    if (cell || row.length || closed)
        pushRow();
    const headers = records.shift();
    if (!headers?.length || headers.some(h => !h || h.length > 100) || new Set(headers).size !== headers.length)
        bad('invalid_csv_headers');
    const rows = records.map(values => {
        if (values.length !== headers.length)
            bad('ragged_csv_row');
        const result: Record<string, string> = Object.create(null);
        headers.forEach((h, i) => { result[h] = values[i]!; });
        return result;
    });
    return { headers, rows };
}
// USD values retain up to 60 fractional places. All arithmetic remains BigInt.
const SCALE = 10n ** 60n;
export function decimalUnits(value: string): bigint {
    if (value.length > 150)
        bad('decimal_too_long');
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/.exec(value);
    if (!m)
        bad('invalid_decimal');
    const fraction = m[3] ?? '', power = 60 + Number(m[4] ?? 0) - fraction.length;
    if (power < 0 || power > 120)
        bad('unsupported_decimal_precision');
    return (m[1] ? -1n : 1n) * BigInt(m[2]! + fraction) * 10n ** BigInt(power);
}
export function exactMicros(units: bigint): string {
    const neg = units < 0n, absolute = neg ? -units : units, d = 10n ** 54n;
    const f = (absolute % d).toString().padStart(54, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + (absolute / d).toString() + (f ? '.' + f : '');
}
function quantity(value: string | undefined): number {
    if (value === undefined || value === '')
        bad('missing_usage_quantity');
    const n = decimalUnits(value);
    if (n < 0n || n % SCALE || n / SCALE > BigInt(Number.MAX_SAFE_INTEGER))
        bad('invalid_usage_quantity');
    return Number(n / SCALE);
}
function period(row: Record<string, string>) {
    const parse = (field: string) => {
        const raw = row[field];
        if (!raw || !/^\d{1,12}$/.test(raw))
            bad('invalid_bucket_epoch');
        const ms = Number(raw) * 1000, iso = new Date(ms).toISOString();
        const label = row[field + '_iso'];
        if (label) {
            const withZone = /([zZ]|[+-]\d\d:\d\d)$/.test(label) ? label : label + 'Z';
            if (Date.parse(withZone) !== ms)
                bad('bucket_epoch_iso_mismatch');
        }
        return { ms, iso };
    };
    const a = parse('start_time'), b = parse('end_time');
    if (a.ms >= b.ms || b.ms - a.ms > 31 * 86400000)
        bad('invalid_bucket_interval');
    return { start: a.iso, end: b.iso };
}
export function parseBillingConfig(value: unknown): BillingConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        bad('invalid_pricing_config');
    const c = structuredClone(value) as BillingConfig;
    if (!Array.isArray(c.rates) || c.rates.length > 100)
        bad('invalid_pricing_config');
    if (new Set(c.rates.map(p => p?.id)).size !== c.rates.length)
        bad('duplicate_price_id');
    for (const p of c.rates) {
        if (!p || !validModel(p.model) || !validModel(p.id) || !validInstant(p.effectiveFrom) || !validInstant(p.effectiveTo) || Date.parse(p.effectiveFrom) >= Date.parse(p.effectiveTo))
            bad('invalid_price_version');
        for (const rate of [p.inputMicrosPerMillion, p.outputMicrosPerMillion, ...(p.cachedInputMicrosPerMillion === null ? [] : [p.cachedInputMicrosPerMillion])])
            if (typeof rate !== 'string' || !/^\d{1,19}$/.test(rate) || BigInt(rate) > MAX_DATABASE_MICROS)
                bad('invalid_rate_precision');
        if (!p.source || !['official_current', 'community', 'unverified'].includes(p.source.kind) || !validInstant(p.source.observedAt))
            bad('invalid_price_provenance');
        const url = new URL(p.source.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
            bad('invalid_price_source_url');
        if (p.source.kind === 'official_current' && !['developers.openai.com', 'openai.com', 'platform.openai.com'].includes(url.hostname))
            bad('unofficial_price_source');
    }
    if (c.expected) {
        for (const n of [c.expected.requests, c.expected.inputTokens, c.expected.outputTokens, c.expected.cachedInputTokens])
            if (!Number.isSafeInteger(n) || n < 0)
                bad('invalid_expected_usage');
        if (!validModel(c.expected.model))
            bad('invalid_expected_model');
    }
    return c;
}
export function rateVersion(p: BillingRate): PriceVersion { return { id: p.id, model: p.model, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, inputMicrosPerMillion: BigInt(p.inputMicrosPerMillion), outputMicrosPerMillion: BigInt(p.outputMicrosPerMillion), cachedInputMicrosPerMillion: p.cachedInputMicrosPerMillion === null ? null : BigInt(p.cachedInputMicrosPerMillion) }; }
const periodKey = (p: {
    start: string;
    end: string;
}) => p.start + '|' + p.end;
export function validateOpenAiBilling(usageText: string, costText: string, config: BillingConfig) {
    config = parseBillingConfig(config);
    const usageCsv = parseBillingCsv(usageText), costCsv = parseBillingCsv(costText);
    for (const [csv, required] of [[usageCsv, ['start_time', 'end_time', 'model', 'num_model_requests', 'input_tokens', 'output_tokens', 'input_cached_tokens']], [costCsv, ['start_time', 'end_time', 'amount_value', 'amount_currency']]] as const)
        if (required.some(h => !csv.headers.includes(h)))
            bad('missing_required_csv_columns');
    const checks: EvidenceCheck[] = [], add = (check: string, status: EvidenceStatus, reason: string) => checks.push({ check, status, reason });
    const usage: BillingUsage[] = [], costs: {
        row: number;
        start: string;
        end: string;
        amount: bigint | null;
        project: string;
        apiKey: string;
        model: string;
        tier: string;
        batch: string;
        organization: string;
    }[] = [];
    const periods = { usage: new Set<string>(), cost: new Set<string>() }, seen = { usage: new Set<string>(), cost: new Set<string>() };
    let emptyUsage = 0, emptyCost = 0;
    const placeholder = (r: Record<string, string>) => Object.entries(r).every(([k, v]) => k.startsWith('start_time') || k.startsWith('end_time') || v === '');
    for (const [index, row] of usageCsv.rows.entries()) {
        const p = period(row);
        periods.usage.add(periodKey(p));
        if (placeholder(row)) {
            emptyUsage++;
            continue;
        }
        const signature = hash(JSON.stringify(row));
        if (seen.usage.has(signature))
            add('duplicate_usage_bucket', 'FAIL', 'Identical active aggregate rows require review; never silently deduplicate.');
        seen.usage.add(signature);
        const input = quantity(row.input_tokens), output = quantity(row.output_tokens), cached = quantity(row.input_cached_tokens), requests = quantity(row.num_model_requests);
        if (cached > input)
            bad('cached_exceeds_input');
        if (!modelPattern.test(row.model ?? ''))
            bad('invalid_model_identity');
        const issues: string[] = [];
        if (row.batch !== 'False' && row.batch !== 'false')
            issues.push('batch_or_unspecified_batch');
        if (row.service_tier !== 'default')
            issues.push('unsupported_or_missing_service_tier');
        // These dimensions cannot be represented by the production price contract.
        for (const name of ['input_cache_write_tokens', 'input_cache_write_30m_tokens', 'input_cache_write_12h_tokens', 'input_audio_tokens', 'input_cached_audio_tokens', 'output_audio_tokens', 'input_image_tokens', 'input_cached_image_tokens', 'output_image_tokens']) {
            if (row[name] === undefined || row[name] === '')
                issues.push('unavailable_' + name);
            else if (quantity(row[name]) !== 0)
                issues.push('unsupported_' + name);
        }
        for (const [name, wanted] of [['input_text_tokens', input], ['output_text_tokens', output], ['input_cached_text_tokens', cached], ['input_uncached_tokens', input - cached]] as const) {
            if (row[name] === undefined || row[name] === '')
                issues.push('unavailable_' + name);
            else if (quantity(row[name]) !== wanted)
                issues.push('inconsistent_' + name);
        }
        if (requests !== 1)
            issues.push('aggregate_not_one_request');
        if (input > 272000)
            issues.push(requests === 1 ? 'unsupported_long_context' : 'unavailable_per_request_long_context');
        for (const name of usageCsv.headers.filter(h => /(?:token|tier|batch|region|processing|modality|provider|discount|rate)/i.test(h) && !['model', 'num_model_requests', 'input_tokens', 'output_tokens', 'input_cached_tokens', 'batch', 'service_tier', 'input_text_tokens', 'output_text_tokens', 'input_cached_text_tokens', 'input_uncached_tokens', 'input_cache_write_tokens', 'input_cache_write_30m_tokens', 'input_cache_write_12h_tokens', 'input_audio_tokens', 'input_cached_audio_tokens', 'output_audio_tokens', 'input_image_tokens', 'input_cached_image_tokens', 'output_image_tokens'].includes(h)))
            if (row[name] !== '' && row[name] !== '0' && row[name] !== '0.0')
                issues.push('unrecognized_pricing_dimension');
        if (row.api_source)
            issues.push('unavailable_endpoint_interpretation');
        const event: UsageEvent | null = requests === 1 ? { id: 'csv-qa-' + hash(usageText).slice(0, 16) + '-' + (index + 2), workspaceId: 'local-aggregate-qa', customerId: 'synthetic-csv-qa', model: row.model!, occurredAt: p.start, inputTokens: input, outputTokens: output, cachedInputTokens: cached } : null;
        const available = config.rates.filter(r => r.source.kind === 'official_current').map(rateVersion);
        const bucketPrices = available.filter(rate => rate.model === row.model && Date.parse(rate.effectiveFrom) < Date.parse(p.end) && Date.parse(rate.effectiveTo!) > Date.parse(p.start));
        if (bucketPrices.length > 1 || bucketPrices.length === 1 && (Date.parse(bucketPrices[0]!.effectiveFrom) > Date.parse(p.start) || Date.parse(bucketPrices[0]!.effectiveTo!) < Date.parse(p.end)))
            issues.push('ambiguous_price_within_bucket');
        const pricingSupported = issues.every(i => i === 'aggregate_not_one_request') && requests > 0;
        const price = pricingSupported && bucketPrices.length === 1 ? bucketPrices[0]! : null;
        const numerator = price ? tokenCostNumerator({ input, output, cached }, price) : null;
        const calculated = event ? calculateEventCost(event, issues.length ? [] : available) : null;
        const dimensionRef = hash(JSON.stringify(Object.entries(row).filter(([name]) => !name.endsWith('_tokens') && name !== 'num_model_requests').sort(([a], [b]) => a.localeCompare(b))));
        usage.push({ row: index + 2, ...p, model: row.model!, project: row.project_id ?? '', apiKey: row.api_key_id ?? '', requests, input, output, cached, supported: !issues.length, pricingSupported, issues, event, price, dimensionRef, exactCostMicros: numerator === null ? null : fractionalMicros(numerator), costMicros: calculated?.amountMicros?.toString() ?? null });
        const unsupported = issues.some(i => (i.startsWith('unsupported_') && !i.startsWith('unsupported_or_missing')) || i.startsWith('inconsistent_') || i === 'unrecognized_pricing_dimension')
            || (!!row.service_tier && row.service_tier !== 'default') || (!!row.batch && !['False', 'false'].includes(row.batch));
        if (issues.length)
            add('usage_dimensions', unsupported ? 'FAIL' : 'INCONCLUSIVE', `usage_row_${index + 2}: ` + issues.join(', '));
    }
    for (const [index, row] of costCsv.rows.entries()) {
        const p = period(row);
        periods.cost.add(periodKey(p));
        if (placeholder(row)) {
            emptyCost++;
            continue;
        }
        const signature = hash(JSON.stringify(row));
        if (seen.cost.has(signature))
            add('duplicate_cost_bucket', 'FAIL', 'Identical active billing rows require review; never silently deduplicate.');
        seen.cost.add(signature);
        let amount: bigint | null = null;
        if (row.amount_value === '')
            add('missing_billing_amount', 'INCONCLUSIVE', `cost_row_${index + 2}: missing is not zero`);
        else
            amount = decimalUnits(row.amount_value!);
        if (row.amount_currency?.toLowerCase() !== 'usd') {
            add('billing_currency', 'INCONCLUSIVE', 'Non-USD or missing currency requires explicit FX evidence.');
            amount = null;
        }
        if (amount !== null && amount < 0n) {
            add('billing_adjustment', 'INCONCLUSIVE', 'Signed credits/adjustments require reviewed allocation; not inferred token expenses.');
        }
        if (row.quantity || row.quantity_unit || row.line_item || row.api_source)
            add('billing_dimensions', 'INCONCLUSIVE', 'Additional billing dimensions require reviewed interpretation.');
        if (costCsv.headers.some(h => /(?:region|processing|modality|provider|discount|rate)/i.test(h) && row[h]))
            add('billing_dimensions', 'INCONCLUSIVE', 'Additional pricing/account dimensions require reviewed interpretation.');
        costs.push({ row: index + 2, ...p, amount, project: row.project_id ?? '', apiKey: row.api_key_id ?? '', model: row.model ?? '', tier: row.service_tier ?? '', batch: row.batch ?? '', organization: row.organization_id ?? '' });
    }
    add('source_structure', 'PASS', 'Original exports parsed read-only with exact decimals; source hashes and row references retained.');
    if (!usage.length)
        add('usage_evidence', 'INCONCLUSIVE', 'No active usage rows; blank buckets are not proof of zero activity.');
    if (!costs.length)
        add('billing_evidence', 'INCONCLUSIVE', 'No active billing lines; missing is not zero.');
    for (const k of periods.usage)
        if (!periods.cost.has(k))
            add('bucket_coverage', 'INCONCLUSIVE', 'A usage UTC bucket has no cost bucket.');
    for (const u of usage)
        if (!costs.some(c => periodKey(c) === periodKey(u)))
            add('missing_billing_line', 'INCONCLUSIVE', `usage_row_${u.row} has no billed line`);
    for (const c of costs)
        if (!usage.some(u => periodKey(c) === periodKey(u)))
            add('unmatched_billing_line', 'INCONCLUSIVE', `cost_row_${c.row} has no usage evidence`);
    const matches = (c: typeof costs[number], u: BillingUsage) => periodKey(c) === periodKey(u) && (!c.project || u.project === c.project) && (!c.apiKey || u.apiKey === c.apiKey) && (!c.model || u.model === c.model) && (!c.tier || c.tier === 'default') && (!c.batch || ['False', 'false'].includes(c.batch));
    const projectAttributable = costs.length > 0 && usage.length > 0 && costs.every(c => !!c.project && usage.some(u => matches(c, u))) && usage.every(u => costs.some(c => !!c.project && matches(c, u)));
    const keyAttributable = costs.length > 0 && usage.length > 0 && costs.every(c => !!c.apiKey && usage.some(u => matches(c, u))) && usage.every(u => costs.some(c => !!c.apiKey && matches(c, u)));
    add('project_cost_attribution', projectAttributable ? 'PASS' : 'INCONCLUSIVE', projectAttributable ? 'Cost rows contain matching project identifiers.' : 'Organization cost cannot be assigned to one project from amount agreement.');
    add('api_key_cost_attribution', keyAttributable ? 'PASS' : 'INCONCLUSIVE', keyAttributable ? 'Cost rows contain matching key identifiers.' : 'Billing key attribution is unavailable or unmatched.');
    const groups = new Map<string, typeof costs>();
    for (const c of costs) {
        const k = JSON.stringify([c.start, c.end, c.project, c.apiKey, c.model, c.tier, c.batch]);
        groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    for (const group of groups.values()) {
        const c = group[0]!, matching = usage.filter(u => matches(c, u));
        if ([...groups.values()].some(other => other !== group && matching.some(u => matches(other[0]!, u)))) {
            add('overlapping_billing_scopes', 'INCONCLUSIVE', `cost_row_${c.row}: overlapping aggregate scopes cannot be allocated automatically`);
            continue;
        }
        if (!matching.length || matching.some(u => u.exactCostMicros === null) || group.some(c => c.amount === null))
            add('scoped_bucket_consistency', 'INCONCLUSIVE', `cost_row_${c.row}: matching usage/pricing/amount unavailable`);
        else {
            const estimate = matching.reduce((n, u) => n + decimalUnits(u.exactCostMicros!) / 1000000n, 0n), bill = group.reduce((n, c) => n + c.amount!, 0n);
            add('scoped_bucket_consistency', estimate === bill ? 'PASS' : 'FAIL', `cost_row_${c.row}: exact unrounded token estimate compared by UTC bucket and available project/key/model/tier dimensions; ledger rounding remains separate`);
        }
    }
    let calculatedTotal = 0n;
    for (const u of usage)
        if (u.costMicros !== null)
            calculatedTotal += BigInt(u.costMicros);
    const allPriced = usage.length > 0 && usage.every(u => u.costMicros !== null), allBilled = costs.length > 0 && costs.every(c => c.amount !== null);
    const billedTotal = costs.reduce((sum, c) => sum + (c.amount ?? 0n), 0n), variance = allPriced && allBilled ? calculatedTotal * SCALE / 1000000n - billedTotal : null;
    add('production_engine_calculation', allPriced ? 'PASS' : 'INCONCLUSIVE', allPriced ? 'Existing calculateEventCost resolves exact models/effective dates and rounds once per single-request event; rate history remains conditional.' : 'Missing official-observed rate or unsupported/aggregate dimensions keep cost unknown.');
    const allExact = usage.length > 0 && usage.every(u => u.exactCostMicros !== null);
    const exactTotal = usage.reduce((n, u) => n + (u.exactCostMicros === null ? 0n : decimalUnits(u.exactCostMicros) / 1000000n), 0n);
    const exactVariance = allExact && allBilled ? exactTotal - billedTotal : null;
    const roundingError = allPriced && allExact ? calculatedTotal * SCALE / 1000000n - exactTotal : null;
    add('exact_token_estimate_consistency', exactVariance === null ? 'INCONCLUSIVE' : exactVariance === 0n ? 'PASS' : 'FAIL', 'Conditional linear token/rate arithmetic, without rounding a multi-request bucket or proving source allocation.');
    add('provided_export_amount_consistency', variance === null ? 'INCONCLUSIVE' : variance === 0n ? 'PASS' : exactVariance === 0n ? 'INCONCLUSIVE' : 'FAIL', variance === null ? 'Per-event rounded totals cannot be reconstructed from daily aggregates.' : variance === 0n ? 'Conditional ledger/export amounts agree; allocation remains separate.' : exactVariance === 0n ? 'Nonzero ledger variance is explained arithmetically by event rounding; it remains visible and requires policy/materiality review.' : 'Variance remains unexplained by event rounding; investigate inputs and billing.');
    if (roundingError !== null && variance !== null && exactVariance !== null)
        add('rounding_decomposition', 'PASS', 'ledger - provider = (ledger - unrounded token estimate) + (unrounded token estimate - provider); no tolerance or ledger correction applied.');
    const totals = { requests: usage.reduce((n, u) => n + BigInt(u.requests), 0n), input: usage.reduce((n, u) => n + BigInt(u.input), 0n), output: usage.reduce((n, u) => n + BigInt(u.output), 0n), cached: usage.reduce((n, u) => n + BigInt(u.cached), 0n) };
    if (config.expected) {
        const e = config.expected;
        add('observed_sample', usage.length === 1 && usage[0]!.model === e.model && totals.requests === BigInt(e.requests) && totals.input === BigInt(e.inputTokens) && totals.output === BigInt(e.outputTokens) && totals.cached === BigInt(e.cachedInputTokens) ? 'PASS' : 'FAIL', 'Compare declared sample quantities/model with original usage export; no response ID is invented.');
    }
    if (config.rates.some(p => p.source.kind !== 'official_current'))
        add('unverified_pricing_sources', 'INCONCLUSIVE', 'Community/unverified rates are retained as provenance only; never selected or applied to stored customer costs.');
    add('official_historical_effective_dates', 'INCONCLUSIVE', 'Current official documentation is not a dated historical price-change attestation; operator must review effective-date evidence.');
    add('original_response_ingestion', 'INCONCLUSIVE', 'Aggregate CSV buckets do not identify the original provider response or prove it was tracked.');
    add('complete_provider_billing_coverage', 'INCONCLUSIVE', 'Completion exports do not prove all billed products, adjustments, regional modifiers or account usage are covered.');
    add('accounting_policy_approval', 'INCONCLUSIVE', 'Founder/accountant approval must be recorded independently.');
    const status: EvidenceStatus = checks.some(c => c.status === 'FAIL') ? 'FAIL' : checks.some(c => c.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
    const report = { schemaVersion: 2, provider: 'openai', status, checks,
        sources: { usage: { sha256: hash(usageText), bytes: Buffer.byteLength(usageText), rows: usageCsv.rows.length, blankBuckets: emptyUsage }, cost: { sha256: hash(costText), bytes: Buffer.byteLength(costText), rows: costCsv.rows.length, blankBuckets: emptyCost }, pricingConfig: { sha256: hash(JSON.stringify(config)), basis: 'Parsed configuration JSON, not original file bytes' } },
        totals: { requests: totals.requests.toString(), inputTokens: totals.input.toString(), outputTokens: totals.output.toString(), cachedInputTokens: totals.cached.toString(), calculatedMicros: allPriced ? calculatedTotal.toString() : null, knownCalculatedSubtotalMicros: calculatedTotal.toString(), billedMicros: allBilled ? exactMicros(billedTotal) : null, knownBilledSubtotalMicros: exactMicros(billedTotal), varianceMicros: variance === null ? null : exactMicros(variance), unroundedEstimatedMicros: allExact ? exactMicros(exactTotal) : null, knownUnroundedSubtotalMicros: exactMicros(exactTotal), unroundedEstimateVarianceMicros: exactVariance === null ? null : exactMicros(exactVariance), eventRoundingErrorMicros: roundingError === null ? null : exactMicros(roundingError) },
        attribution: { projectCostProven: projectAttributable, apiKeyCostProven: keyAttributable, usageProjectPresent: usage.some(u => !!u.project), usageApiKeyPresent: usage.some(u => !!u.apiKey), originalResponseIdAvailable: false },
        pricingSources: config.rates.map(p => ({ ...p, periodBasis: 'operator_supplied_QA_window_not_official_historical_attestation' })),
        rows: usage.map(u => ({ row: u.row, start: u.start, end: u.end, model: u.model, requests: u.requests, inputTokens: u.input, outputTokens: u.output, cachedInputTokens: u.cached, issues: u.issues, costMicros: u.costMicros, unroundedEstimatedMicros: u.exactCostMicros, priceVersionRef: u.price?.id ?? null, eventIdentityBasis: u.event ? 'local_single_request_QA_ID_not_provider_response_ID' : 'daily_aggregate_no_event_identity', timestampBasis: u.event ? 'UTC_bucket_start_for_disposable_replay' : 'UTC_aggregate_interval_only' })),
        roundingPolicy: { unit: 'USD_microdollar', mode: 'per_event_half_up', aggregateBucketRoundingAllowed: false, maximumAbsoluteEventRoundingErrorMicros: fractionalMicros(totals.requests * 500000n), boundIsAcceptanceTolerance: false, boundAppliesOnlyTo: 'fully_priced_events_under_reviewed_rates', financialPolicyApproval: 'pending' }, providerNetworkCalls: 0, originalsModified: false };
    return { report, usage, costs, config };
}

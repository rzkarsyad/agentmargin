import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calculateEventCost } from '../src/index.ts';
import { fixtureCsv, fixtureConfig, usageRow, costRow, secondUsageRow, afterUsageRow, snapshotBeforeCost, snapshotAfterCost, syntheticSecondReceipt } from '../../../scripts/lib/openai-billing-fixture.ts';
import { validateOpenAiBilling, rateVersion } from '../../../scripts/lib/openai-billing.ts';
import { reconcileOpenAiSnapshots } from '../../../scripts/lib/openai-billing-snapshots.ts';
import { scaleEventRounding } from '../../../scripts/lib/openai-cost-precision.ts';
import { readCheckedFile } from '../../../scripts/lib/private-files.ts';
const validate = (rows: Record<string, string>[], bill: string) => validateOpenAiBilling(fixtureCsv(rows), fixtureCsv([{ ...costRow, amount_value: bill }]), fixtureConfig());
const before = () => ({ usage: fixtureCsv([usageRow]), cost: fixtureCsv([snapshotBeforeCost]) });
const after = () => ({ usage: fixtureCsv([afterUsageRow]), cost: fixtureCsv([snapshotAfterCost]) });
const checks = (r: ReturnType<typeof reconcileOpenAiSnapshots>, name: string) => r.checks.filter(c => c.check === name);
test('10 input/5 output rounds 3.5 to 4; provider precision and +0.5 variance are retained', () => {
    const r = validate([secondUsageRow], '0.0000035');
    assert.equal(r.usage[0]!.costMicros, '4');
    assert.equal(r.report.totals.unroundedEstimatedMicros, '3.5');
    assert.equal(r.report.totals.billedMicros, '3.5');
    assert.equal(r.report.totals.varianceMicros, '0.5');
    assert.equal(r.report.totals.eventRoundingErrorMicros, '0.5');
    assert.equal(r.report.totals.unroundedEstimateVarianceMicros, '0');
    assert.equal(r.report.checks.find(c => c.check === 'provided_export_amount_consistency')!.status, 'INCONCLUSIVE');
    assert.equal(r.report.status, 'INCONCLUSIVE');
});
test('two distinct single-request QA rows sum 9 + 4; unexplained billing differences still fail', () => {
    const r = validate([usageRow, secondUsageRow], '0.0000125');
    assert.equal(r.report.totals.calculatedMicros, '13');
    assert.equal(r.report.totals.unroundedEstimatedMicros, '12.5');
    assert.equal(r.report.totals.varianceMicros, '0.5');
    assert.equal(r.report.totals.eventRoundingErrorMicros, '0.5');
    assert.equal(r.report.status, 'INCONCLUSIVE');
    const unexplained = validate([usageRow, secondUsageRow], '0.0000124');
    assert.equal(unexplained.report.status, 'FAIL');
    assert.equal(unexplained.report.totals.varianceMicros, '0.6');
    assert.equal(unexplained.report.totals.unroundedEstimateVarianceMicros, '0.1');
});
test('daily two-request totals have exact 12.5 estimate but no event ID or reconstructable rounded cost', () => {
    const r = validate([afterUsageRow], '0.0000125');
    assert.equal(r.usage[0]!.event, null);
    assert.equal(r.usage[0]!.costMicros, null);
    assert.equal(r.report.totals.calculatedMicros, null);
    assert.equal(r.report.totals.unroundedEstimatedMicros, '12.5');
    assert.equal(r.report.totals.unroundedEstimateVarianceMicros, '0');
    assert.equal(r.report.totals.varianceMicros, null);
    assert.equal(r.report.totals.eventRoundingErrorMicros, null);
    assert.equal(r.report.rows[0]!.eventIdentityBasis, 'daily_aggregate_no_event_identity');
    assert.equal(r.report.roundingPolicy.maximumAbsoluteEventRoundingErrorMicros, '1');
    assert.equal(r.report.roundingPolicy.boundIsAcceptanceTolerance, false);
});
test('the same daily totals can produce 12 or 13 rounded micros with different event partitions', () => {
    const price = rateVersion(fixtureConfig().rates[0]!);
    const event = { id: 'synthetic', workspaceId: 'synthetic', customerId: 'synthetic', model: price.model, occurredAt: '2026-10-23T01:00:00Z', inputTokens: 25, outputTokens: 13, cachedInputTokens: 0 };
    const sum = (parts: [
        number,
        number
    ][]) => parts.reduce((n, [inputTokens, outputTokens]) => n + calculateEventCost({ ...event, inputTokens, outputTokens }, [price]).amountMicros!, 0n);
    assert.equal(sum([[25, 13], [10, 5]]), 13n);
    assert.equal(sum([[1, 0], [34, 18]]), 12n);
});
test('repeated half ties cause linear upward drift; low fractions can cause downward drift', () => {
    const r = validate([secondUsageRow], '0.0000035'), row = r.usage[0]!;
    const million = scaleEventRounding(row.event!, row.price!, 1000000n);
    assert.equal(million.roundingErrorMicros, '500000');
    assert.equal(million.ledgerMicros, '4000000');
    assert.equal(million.unroundedEstimatedMicros, '3500000');
    assert.equal(scaleEventRounding(row.event!, row.price!, 1000000000n).roundingErrorMicros, '500000000');
    const down = scaleEventRounding({ ...row.event!, inputTokens: 4, outputTokens: 0 }, row.price!, 1000000n);
    assert.equal(down.roundingErrorMicros, '-400000');
    assert.equal(down.ledgerMicros, '0');
    assert.throws(() => scaleEventRounding(row.event!, row.price!, 0n));
});
test('uniform tenths do not cancel half-up ties: mean drift is +0.05 micro per event', () => {
    const r = validate([secondUsageRow], '0.0000035'), row = r.usage[0]!;
    let integer = 0n;
    for (let inputTokens = 1; inputTokens <= 10; inputTokens++)
        integer += calculateEventCost({ ...row.event!, inputTokens, outputTokens: 0 }, [row.price!]).amountMicros!;
    assert.equal(integer, 6n); // Unrounded sum is 5.5 micros; +0.5 across 10 events.
});
test('snapshots without a private receipt expose only net aggregate arithmetic', () => {
    const r = reconcileOpenAiSnapshots(before(), after(), fixtureConfig());
    assert.equal(r.delta!.requests, '1');
    assert.equal(r.delta!.inputTokens, '10');
    assert.equal(r.delta!.outputTokens, '5');
    assert.equal(r.delta!.providerMicros, '3.5');
    assert.equal(r.delta!.unroundedEstimatedMicros, '3.5');
    assert.equal(r.delta!.ledgerMicros, null);
    assert.equal(r.delta!.conditionalTwoEventSumMicros, null);
    assert.equal(r.privateMetadata.responseMetadataMatchesDelta, false);
    assert.equal(r.status, 'INCONCLUSIVE');
    assert.equal(checks(r, 'snapshot_order_and_finality')[0]!.status, 'INCONCLUSIVE');
});
test('matching tracked receipt verifies real-shape identity privately and preserves +0.5 delta', () => {
    const r = reconcileOpenAiSnapshots(before(), after(), fixtureConfig(), syntheticSecondReceipt());
    assert.equal(r.privateMetadata.responseMetadataMatchesDelta, true);
    assert.equal(r.privateMetadata.localPipelineReportedPass, true);
    assert.equal(r.delta!.ledgerMicros, '4');
    assert.equal(r.delta!.ledgerMinusProviderMicros, '0.5');
    assert.equal(r.delta!.eventRoundingErrorMicros, '0.5');
    assert.equal(r.delta!.conditionalTwoEventSumMicros, '13');
    assert.equal(JSON.stringify(r).includes('resp_synthetic_second_request'), false);
    assert.equal(JSON.stringify(r).includes('synthetic-organization'), false);
    assert.equal(JSON.stringify(r).includes('synthetic-project'), false);
    assert.equal(r.status, 'INCONCLUSIVE');
});
test('cross-organization, scope changes, reversed snapshots and zero deltas cannot claim a match', () => {
    assert.equal(reconcileOpenAiSnapshots(after(), before(), fixtureConfig()).status, 'FAIL');
    assert.equal(reconcileOpenAiSnapshots(before(), before(), fixtureConfig()).status, 'FAIL');
    const wrongOrg = after();
    wrongOrg.cost = fixtureCsv([{ ...snapshotAfterCost, organization_id: 'other-synthetic-organization' }]);
    assert.equal(reconcileOpenAiSnapshots(before(), wrongOrg, fixtureConfig()).delta, null);
    assert.equal(checks(reconcileOpenAiSnapshots(before(), wrongOrg, fixtureConfig()), 'same_organization')[0]!.status, 'FAIL');
    const wrongKey = after();
    wrongKey.usage = fixtureCsv([{ ...afterUsageRow, api_key_id: 'other-synthetic-key' }]);
    assert.equal(reconcileOpenAiSnapshots(before(), wrongKey, fixtureConfig()).delta, null);
});
test('missing costs, missing org attribution and aggregate increments retain uncertainty', () => {
    const missing = after();
    missing.cost = fixtureCsv([{ ...snapshotAfterCost, amount_value: '' }]);
    assert.equal(reconcileOpenAiSnapshots(before(), missing, fixtureConfig()).delta, null);
    const a = before(), b = after();
    a.cost = fixtureCsv([costRow]);
    b.cost = fixtureCsv([{ ...costRow, amount_value: '0.0000125' }]);
    assert.equal(checks(reconcileOpenAiSnapshots(a, b, fixtureConfig()), 'same_organization')[0]!.status, 'INCONCLUSIVE');
    const multi = after();
    multi.usage = fixtureCsv([{ ...afterUsageRow, num_model_requests: '3' }]);
    assert.equal(reconcileOpenAiSnapshots(before(), multi, fixtureConfig(), syntheticSecondReceipt()).privateMetadata.responseMetadataMatchesDelta, false);
});
test('receipt token/time/cost mismatch fails; single-sample expectations are never silently ignored', () => {
    for (const field of ['tokens', 'time', 'cost'] as const) {
        const receipt = syntheticSecondReceipt();
        if (field === 'tokens')
            receipt.response.usage.input_tokens = 11;
        if (field === 'time')
            receipt.response.created_at = 1792800000;
        if (field === 'cost')
            receipt.pipeline.calculatedMicros = '3';
        assert.equal(reconcileOpenAiSnapshots(before(), after(), fixtureConfig(), receipt).status, 'FAIL');
    }
    assert.throws(() => reconcileOpenAiSnapshots(before(), after(), { ...fixtureConfig(), expected: { model: 'gpt-6-luna', requests: 1, inputTokens: 25, outputTokens: 13, cachedInputTokens: 0 } }), /single_sample_expectation/);
});
test('snapshot CLI is private, read-only, replay deterministic and has no provider credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentmargin-snapshot-test-'));
    try {
        const files = ['before-usage.csv', 'before-cost.csv', 'after-usage.csv', 'after-cost.csv', 'rates.json'].map(name => join(directory, name));
        for (const [i, value] of [before().usage, before().cost, after().usage, after().cost, JSON.stringify(fixtureConfig())].entries())
            writeFileSync(files[i]!, value, { mode: 0o600 });
        const receiptFile = join(directory, 'response-metadata.json');
        writeFileSync(receiptFile, JSON.stringify(syntheticSecondReceipt()), { mode: 0o600 });
        const run = () => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/openai-billing-snapshots.ts', ...files, join(directory, 'reports'), '--receipt', receiptFile], { encoding: 'utf8', env: { ...process.env, AGENTMARGIN_OPENAI_BILLING_QA: 'local-only', OPENAI_API_KEY: '' } });
        const first = run(), second = run();
        assert.equal(first.error, undefined);
        assert.equal(first.status, 3);
        assert.equal(second.status, 3);
        assert.equal(first.stdout.includes('synthetic'), false);
        assert.equal(first.stdout.includes('12.5'), false);
        const reports = readdirSync(join(directory, 'reports')).map(name => readCheckedFile(join(directory, 'reports', name), { privateFile: true }));
        assert.equal(reports.length, 2);
        assert.equal(reports[0]!.mode & 0o777, 0o600);
        assert.equal(reports[0]!.contents, reports[1]!.contents);
        assert.equal(readCheckedFile(files[0]!).contents, before().usage);
        assert.equal(readCheckedFile(receiptFile).contents, JSON.stringify(syntheticSecondReceipt()));
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('downward rounding and cached fractional micros are explained without changing the ledger', () => {
    const down = { ...secondUsageRow, input_tokens: '4', input_text_tokens: '4', input_uncached_tokens: '4', output_tokens: '0', output_text_tokens: '0' };
    const r = validate([down], '0.0000004');
    assert.equal(r.report.totals.calculatedMicros, '0');
    assert.equal(r.report.totals.varianceMicros, '-0.4');
    assert.equal(r.report.status, 'INCONCLUSIVE');
    const cached = { ...secondUsageRow, input_cached_tokens: '5', input_cached_text_tokens: '5', input_uncached_tokens: '5' };
    const c = validate([cached], '0.00000305');
    assert.equal(c.report.totals.calculatedMicros, '3');
    assert.equal(c.report.totals.unroundedEstimatedMicros, '3.05');
    assert.equal(c.report.totals.eventRoundingErrorMicros, '-0.05');
});
test('daily aggregates with unknown per-request long-context exposure remain unpriced', () => {
    const large = { ...afterUsageRow, input_tokens: '300000', input_text_tokens: '300000', input_uncached_tokens: '300000' };
    const r = validate([large], '0.03');
    assert.equal(r.usage[0]!.exactCostMicros, null);
    assert.equal(r.usage[0]!.event, null);
    assert.equal(r.report.status, 'INCONCLUSIVE');
});
test('existing integer-micro reconciliation rejects fractional ledger inputs instead of silently rounding', async () => {
    const { reconcileFinancialRecords } = await import('../src/reconciliation.ts');
    const at = '2026-10-23T01:00:00Z';
    assert.throws(() => reconcileFinancialRecords({ scope: { workspaceId: 'synthetic', provider: 'openai', accountId: 'synthetic', currency: 'USD', periodStart: '2026-10-23T00:00:00Z', periodEnd: '2026-10-24T00:00:00Z', kind: 'cost' }, recordedExportRef: 'synthetic-ledger', billingExportRef: 'synthetic-billing', records: [{ id: 'synthetic', sourceRef: 'synthetic', currency: 'USD', occurredAt: at, amountMicros: '4', source: 'estimated', pricingRef: 'synthetic-price' }], billed: [{ id: 'synthetic-line', sourceRef: 'synthetic', currency: 'USD', occurredAt: at, amountMicros: '3.5', kind: 'charge', recordIds: ['synthetic'] }], tolerance: { absoluteMicros: '0', basisPoints: 0 } }), /Invalid signed micro amount/);
});

test('unknown cached rates cannot turn a private PASS label into verified money',()=>{
 const config=fixtureConfig();config.rates[0]!.cachedInputMicrosPerMillion=null;
 const a=before(),b=after();
 a.usage=fixtureCsv([{...usageRow,input_cached_tokens:'1',input_cached_text_tokens:'1',input_uncached_tokens:'24'}]);
 b.usage=fixtureCsv([{...afterUsageRow,input_cached_tokens:'2',input_cached_text_tokens:'2',input_uncached_tokens:'33'}]);
 const receipt=syntheticSecondReceipt();receipt.response.usage.input_tokens_details.cached_tokens=1;
 const r=reconcileOpenAiSnapshots(a,b,config,receipt);
 assert.equal(r.delta,null);assert.equal(r.privateMetadata.localPipelineReportedPass,false);
 assert.equal(checks(r,'delta_comparability')[0]!.status,'INCONCLUSIVE');
});

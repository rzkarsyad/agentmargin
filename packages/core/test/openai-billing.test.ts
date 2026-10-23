import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calculateEventCost, roundDiv } from '../src/index.ts';
import { parseBillingCsv, decimalUnits, exactMicros, validateOpenAiBilling, parseBillingConfig } from '../../../scripts/lib/openai-billing.ts';
import { fixtureCsv, fixtureConfig, usageRow, costRow } from '../../../scripts/lib/openai-billing-fixture.ts';
import { readCheckedFile } from '../../../scripts/lib/private-files.ts';
const validate = (u: Record<string, string>[] = [usageRow], c: Record<string, string>[] = [costRow], config = fixtureConfig()) => validateOpenAiBilling(fixtureCsv(u, Object.keys(usageRow)), fixtureCsv(c, Object.keys(costRow)), config);
const check = (result: ReturnType<typeof validate>, name: string) => result.report.checks.filter(c => c.check === name);
test('exact observed quantities use production event rounding: 2.5 + 6.5 = 9, not 10', () => {
    const r = validate(), u = r.usage[0]!;
    assert.equal(u.costMicros, '9');
    assert.equal(r.report.totals.billedMicros, '9');
    assert.equal(r.report.totals.varianceMicros, '0');
    assert.equal(calculateEventCost(u.event, [u.price!]).amountMicros, 9n);
    assert.equal(roundDiv(25n * 100000n, 1000000n) + roundDiv(13n * 500000n, 1000000n), 10n);
    assert.equal(u.price!.id, 'synthetic-rate');
    assert.equal(check(r, 'provided_export_amount_consistency')[0]!.status, 'PASS');
    assert.equal(r.report.status, 'INCONCLUSIVE');
    assert.equal(r.report.attribution.originalResponseIdAvailable, false);
    assert.match(u.event.id, /^csv-qa-/);
});
test('RFC4180 handles BOM, CRLF, escaped quotes and embedded newlines without executing cells', () => {
    const r = parseBillingCsv('\uFEFFa,b\r\n"quoted, value","line\n""two"""\r\n');
    assert.equal(r.rows[0]!.a, 'quoted, value');
    assert.equal(r.rows[0]!.b, 'line\n"two"');
    assert.equal(parseBillingCsv('a\n=HYPERLINK()\n').rows[0]!.a, '=HYPERLINK()');
    for (const invalid of ['a,a\n1,2\n', 'a,b\n1\n', 'a\n"unclosed', 'a\n"x"junk\n', 'a\n\uFFFD'])
        assert.throws(() => parseBillingCsv(invalid));
});
test('blank daily placeholders are counted and never manufacture active zero-cost rows', () => {
    const blank = Object.fromEntries(Object.entries(usageRow).map(([k, v]) => [k, k.startsWith('start_time') || k.startsWith('end_time') ? v : '']));
    const costBlank = Object.fromEntries(Object.entries(costRow).map(([k, v]) => [k, k.startsWith('start_time') || k.startsWith('end_time') ? v : '']));
    const r = validate([blank, usageRow], [costBlank, costRow]);
    assert.equal(r.usage.length, 1);
    assert.equal(r.report.sources.usage.blankBuckets, 1);
    assert.equal(r.report.sources.cost.blankBuckets, 1);
    assert.equal(validate([blank], [costBlank]).report.totals.calculatedMicros, null);
});
test('decimal counts are exact integers; submicrodollar billing remains visible', () => {
    assert.equal(exactMicros(decimalUnits('0.0000005')), '0.5');
    assert.equal(exactMicros(decimalUnits('9e-6')), '9');
    assert.equal(exactMicros(decimalUnits('-0.000001')), '-1');
    assert.equal(validate([usageRow], [{ ...costRow, amount_value: '0.0000085' }]).report.totals.varianceMicros, '0.5');
    for (const value of ['25.1', '-1', 'NaN', '9007199254740992'])
        assert.throws(() => validate([{ ...usageRow, input_tokens: value }]));
    for (const value of ['NaN', 'Infinity', '0.0junk', '1e-99'])
        assert.throws(() => decimalUnits(value));
});
test('missing amount is unknown, explicit zero is compared and cannot equal 9', () => {
    const r = validate([usageRow], [{ ...costRow, amount_value: '' }]);
    assert.equal(r.report.totals.billedMicros, null);
    assert.equal(check(r, 'missing_billing_amount')[0]!.status, 'INCONCLUSIVE');
    assert.equal(validate([usageRow], [{ ...costRow, amount_value: '0' }]).report.status, 'FAIL');
});
test('organization-level agreement never implies project/key attribution or original ingestion', () => {
    const r = validate();
    assert.equal(r.report.attribution.projectCostProven, false);
    assert.equal(r.report.attribution.apiKeyCostProven, false);
    assert.equal(check(r, 'original_response_ingestion')[0]!.status, 'INCONCLUSIVE');
    const scoped = validate([usageRow], [{ ...costRow, project_id: usageRow.project_id!, api_key_id: usageRow.api_key_id! }]);
    assert.equal(scoped.report.attribution.projectCostProven, true);
    assert.equal(scoped.report.attribution.apiKeyCostProven, true);
    assert.equal(validate([usageRow], [{ ...costRow, project_id: 'unmatched' }]).report.attribution.projectCostProven, false);
    assert.equal(JSON.stringify(r.report).includes('synthetic-project'), false, 'Report leaked attribution identifier');
    assert.equal(JSON.stringify(r.report).includes('synthetic-key'), false);
});
test('community disagreements are retained but never priced instead of official observations', () => {
    const c = fixtureConfig();
    c.rates.push({ ...c.rates[0]!, id: 'community', inputMicrosPerMillion: '999999', source: { ...c.rates[0]!.source, kind: 'community', url: 'https://example.com/prices' } });
    const r = validate([usageRow], [costRow], c);
    assert.equal(r.usage[0]!.costMicros, '9');
    assert.equal(check(r, 'unverified_pricing_sources')[0]!.status, 'INCONCLUSIVE');
    c.rates.shift();
    assert.equal(validate([usageRow], [costRow], c).usage[0]!.costMicros, null);
    assert.throws(() => parseBillingConfig({ ...c, rates: [c.rates[0], c.rates[0]] }), /duplicate_price_id/);
    assert.throws(() => parseBillingConfig({ rates: [{ ...c.rates[0]!, source: { ...c.rates[0]!.source, kind: 'official_current' } }] }), /unofficial_price_source/);
});
test('exact model and effective interval are required; dated history is never inferred', () => {
    assert.equal(validate([{ ...usageRow, model: 'unknown-model' }]).usage[0]!.costMicros, null);
    assert.equal(validate([usageRow], [costRow], { rates: [] }).usage[0]!.costMicros, null);
    const c = fixtureConfig();
    c.rates[0]!.effectiveFrom = '2026-10-23T00:00:01Z';
    assert.equal(validate([usageRow], [costRow], c).usage[0]!.costMicros, null);
    c.rates[0]!.effectiveFrom = '2026-10-22T00:00:00Z';
    c.rates[0]!.effectiveTo = '2026-10-23T00:00:00Z';
    assert.equal(validate([usageRow], [costRow], c).usage[0]!.costMicros, null);
    assert.equal(check(validate(), 'official_historical_effective_dates')[0]!.status, 'INCONCLUSIVE');
});
test('cached tokens use distinct rates; missing cached rate remains unknown', () => {
    const cached = { ...usageRow, input_cached_tokens: '20.0', input_cached_text_tokens: '20.0', input_uncached_tokens: '5.0' };
    assert.equal(validate([cached], [{ ...costRow, amount_value: '0.000007' }]).usage[0]!.costMicros, '7');
    const c = fixtureConfig();
    c.rates[0]!.cachedInputMicrosPerMillion = null;
    assert.equal(validate([cached], [costRow], c).usage[0]!.costMicros, null);
    assert.throws(() => validate([{ ...cached, input_cached_tokens: '26' }]), /cached_exceeds_input/);
});
test('nondefault tiers, batch, multimodal, writes and long-context fail visibly', () => {
    const changes: Record<string, string>[] = [{ service_tier: 'flex' }, { service_tier: 'priority' }, { batch: 'True' }, { input_audio_tokens: '1' },
        { input_cache_write_30m_tokens: '1' }, { input_image_tokens: '1' },
        { input_tokens: '272001', input_text_tokens: '272001', input_uncached_tokens: '272001' }];
    for (const change of changes) {
        const r = validate([{ ...usageRow, ...change }]);
        assert.equal(r.usage[0]!.costMicros, null);
        assert.equal(r.report.status, 'FAIL');
    }
    assert.equal(validate([{ ...usageRow, service_tier: '' }]).report.status, 'INCONCLUSIVE');
    assert.equal(validate([{ ...usageRow, input_audio_tokens: '' }]).report.status, 'INCONCLUSIVE');
});
test('multiple requests per bucket cannot reproduce per-event rounding and stay unknown', () => {
    const r = validate([{ ...usageRow, num_model_requests: '2.0' }]);
    assert.equal(r.usage[0]!.costMicros, null);
    assert.equal(r.report.status, 'INCONCLUSIVE');
});
test('duplicate active usage and billing lines fail; they are never silently deduplicated', () => {
    assert.equal(check(validate([usageRow, usageRow]), 'duplicate_usage_bucket')[0]!.status, 'FAIL');
    assert.equal(check(validate([usageRow], [costRow, costRow]), 'duplicate_cost_bucket')[0]!.status, 'FAIL');
});
test('UTC epoch is checked against ISO; local calendar guesses are rejected', () => {
    assert.throws(() => validate([{ ...usageRow, start_time_iso: '2026-10-24T00:00:00+07:00' }]), /bucket_epoch_iso_mismatch/);
    const match = { ...usageRow, start_time_iso: '2026-10-23T07:00:00+07:00' };
    assert.equal(validate([match]).usage[0]!.costMicros, '9');
});
test('missing and unmatched cost buckets are explicit; foreign currency/credits require review', () => {
    assert.equal(check(validate([usageRow], []), 'missing_billing_line')[0]!.status, 'INCONCLUSIVE');
    assert.equal(check(validate([]), 'unmatched_billing_line')[0]!.status, 'INCONCLUSIVE');
    assert.equal(validate([usageRow], [{ ...costRow, amount_currency: 'eur' }]).report.totals.billedMicros, null);
    assert.equal(check(validate([usageRow], [{ ...costRow, amount_value: '-0.000009' }]), 'billing_adjustment')[0]!.status, 'INCONCLUSIVE');
});
test('equal grand totals cannot conceal swapped daily billing amounts', () => {
    const day2 = { start_time: '1792800000', end_time: '1792886400', start_time_iso: '2026-10-24T00:00:00Z', end_time_iso: '2026-10-25T00:00:00Z' };
    const c = fixtureConfig();
    c.rates[0]!.effectiveTo = '2026-10-25T00:00:00Z';
    const r = validate([usageRow, { ...usageRow, ...day2, input_tokens: '35', input_text_tokens: '35', input_uncached_tokens: '35' }], [{ ...costRow, amount_value: '0.000010' }, { ...costRow, ...day2, amount_value: '0.000009' }], c);
    assert.equal(r.report.totals.varianceMicros, '0');
    assert.equal(check(r, 'scoped_bucket_consistency').filter(c => c.status === 'FAIL').length, 2);
    assert.equal(r.report.status, 'FAIL');
});
test('overlapping organization/project billing scopes require allocation review', () => {
    const r = validate([usageRow], [costRow, { ...costRow, project_id: usageRow.project_id! }]);
    assert.equal(check(r, 'overlapping_billing_scopes')[0]!.status, 'INCONCLUSIVE');
});
test('CLI stores private redacted evidence, never prints cells, and records pipeline failures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentmargin-billing-test-'));
    try {
        const paths = ['usage.csv', 'cost.csv', 'rates.json'].map(p => join(dir, p));
        writeFileSync(paths[0]!, fixtureCsv([usageRow]));
        writeFileSync(paths[1]!, fixtureCsv([costRow]));
        writeFileSync(paths[2]!, JSON.stringify(fixtureConfig()));
        const run = (flags: string[] = []) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/openai-billing-qa.ts', ...paths, join(dir, 'reports'), ...flags], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, AGENTMARGIN_OPENAI_BILLING_QA: 'local-only', AGENTMARGIN_STANDALONE_DATABASE_URL: '', AGENTMARGIN_OPENAI_QA_RUNTIME_URL: '' } });
        const original = readFileSync(paths[0]!);
        const r = run();
        assert.equal(r.status, 3);
        assert.equal(r.stdout.includes('synthetic-project'), false);
        assert.equal(r.stdout.includes('9'), false);
        assert.deepEqual(readFileSync(paths[0]!), original);
        assert.equal(statSync(join(dir, 'reports')).mode & 0o777, 0o700);
        const failed = run(['--postgres']);
        assert.equal(failed.status, 1);
        const reports = readdirSync(join(dir, 'reports')).map(p => {
            const input = readCheckedFile(join(dir, 'reports', p), { privateFile: true });
            assert.equal(input.mode & 0o777, 0o600);
            return JSON.parse(input.contents);
        });
        assert.ok(reports.some(r => r.status === 'FAIL' && r.pipeline.status === 'FAIL'));
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('unknown request time cannot select a rate that changes inside the daily bucket', () => {
    const c = fixtureConfig();
    c.rates[0]!.effectiveTo = '2026-10-23T12:00:00Z';
    assert.equal(validate([usageRow], [costRow], c).usage[0]!.costMicros, null);
    c.rates.push({ ...c.rates[0]!, id: 'afternoon-rate', effectiveFrom: '2026-10-23T12:00:00Z', effectiveTo: '2026-10-24T00:00:00Z' });
    assert.equal(validate([usageRow], [costRow], c).usage[0]!.costMicros, null);
});
test('populated billed model and tier are matched; unknown region modifiers fail visibly', () => {
    const dimensions: Record<string, string>[] = [{ model: 'other-model' }, { service_tier: 'flex' }, { batch: 'True' }];
    for (const dimension of dimensions) {
        const result = validateOpenAiBilling(fixtureCsv([usageRow]), fixtureCsv([{ ...costRow, ...dimension }]), fixtureConfig());
        assert.equal(check(result, 'scoped_bucket_consistency')[0]!.status, 'INCONCLUSIVE');
    }
    const regional = validateOpenAiBilling(fixtureCsv([{ ...usageRow, processing_region: 'eu' }]), fixtureCsv([costRow]), fixtureConfig());
    assert.equal(regional.usage[0]!.costMicros, null);
    assert.equal(regional.report.status, 'FAIL');
});
test('result snapshots cannot be rewritten by later caller pricing mutations', () => {
    const config = fixtureConfig(), r = validate([usageRow], [costRow], config);
    config.rates[0]!.source.url = 'https://example.com/changed';
    assert.equal(r.report.pricingSources[0]!.source.url, 'https://developers.openai.com/api/docs/models/gpt-6-luna');
});

test('pricing config requires exact string identities and timezone-qualified valid instants',()=>{
 for(const change of [{model:undefined},{id:undefined},{effectiveFrom:'2026-10-23'},{effectiveTo:'2026-02-31T00:00:00Z'}]){
  const config=fixtureConfig();Object.assign(config.rates[0]!,change);assert.throws(()=>parseBillingConfig(config));
 }
});
test('disposable replay refuses connection-string overrides before connecting',async()=>{
 const {replayBillingInDisposableDatabase}=await import('../../../scripts/lib/openai-billing-postgres.ts');
 const {withOpenAiDisposableRuntime}=await import('../../../scripts/lib/openai-disposable-runtime.ts');
 const prior={owner:process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,runtime:process.env.AGENTMARGIN_OPENAI_QA_RUNTIME_URL};
 try{
  process.env.AGENTMARGIN_STANDALONE_DATABASE_URL='postgresql://agentmargin_ci@127.0.0.1/agentmargin_ci?host=example.com';
  process.env.AGENTMARGIN_OPENAI_QA_RUNTIME_URL='postgresql://runtime@127.0.0.1/agentmargin_ci';
  await assert.rejects(replayBillingInDisposableDatabase([]),/Disposable local database only/);
  await assert.rejects(withOpenAiDisposableRuntime(async()=>assert.fail('Must not connect')),/Disposable local database only/);
 }finally{
  for(const [name,value] of [['AGENTMARGIN_STANDALONE_DATABASE_URL',prior.owner],['AGENTMARGIN_OPENAI_QA_RUNTIME_URL',prior.runtime]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});

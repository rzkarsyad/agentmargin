/** Explicit local read-only CSV audit; optional disposable API/PG replay. No provider calls. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { readCheckedFile, requirePrivateDirectory } from './lib/private-files.ts';
import { parseBillingConfig, validateOpenAiBilling, BillingInputError, type EvidenceStatus } from './lib/openai-billing.ts';
async function main() {
    const [usageFile, costFile, ratesFile, output, ...flags] = process.argv.slice(2);
    if (!usageFile || !costFile || !ratesFile || !output || flags.some(f => f !== '--postgres') || process.env.AGENTMARGIN_OPENAI_BILLING_QA !== 'local-only')
        throw new Error('configuration');
    const root = resolve('.'), requested = resolve(output), outside = (p: string) => relative(root, p) === '..' || relative(root, p).startsWith('../');
    if (!outside(requested))
        throw new Error('private_output_outside_checkout_required');
    mkdirSync(requested, { mode: 0o700, recursive: true });
    const directory = requirePrivateDirectory(requested);
    if (!outside(directory))
        throw new Error('private_output_outside_checkout_required');
    const usage = readCheckedFile(usageFile).contents, cost = readCheckedFile(costFile).contents;
    const config = parseBillingConfig(JSON.parse(readCheckedFile(ratesFile, { maxBytes: 100000 }).contents));
    const result = validateOpenAiBilling(usage, cost, config);
    let pipeline: {
        status: string;
        reason?: string;
    } = { status: 'INCONCLUSIVE', reason: 'Disposable PostgreSQL replay not requested; no original response ID is available.' };
    if (flags.includes('--postgres')) {
        try {
            const { replayBillingInDisposableDatabase } = await import('./lib/openai-billing-postgres.ts');
            pipeline = await replayBillingInDisposableDatabase(result.usage);
        }
        catch {
            pipeline = { status: 'FAIL', reason: 'Disposable pipeline failed; review local configuration/migrations. Driver details are withheld to avoid credential disclosure.' };
        }
    }
    result.report.checks.push({ check: 'disposable_ingestion_analytics', status: pipeline.status as EvidenceStatus, reason: pipeline.reason ?? 'Actual SDK/HTTP/restricted-runtime PostgreSQL/analytics replay passed; CSV aggregate identity only.' });
    const status: EvidenceStatus = result.report.checks.some(c => c.status === 'FAIL') ? 'FAIL' : result.report.checks.some(c => c.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
    const report = { ...result.report, status, pipeline };
    const target = resolve(directory, 'openai-billing-' + report.sources.usage.sha256.slice(0, 16) + '-' + Date.now() + '.json');
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // No CSV cells, identifiers, provider totals or private paths on stdout.
    console.log(JSON.stringify({ kind: 'openai_billing_qa', status: report.status, reportWritten: true, networkProviderCalls: 0, checks: report.checks.map(c => ({ check: c.check, status: c.status })) }));
    process.exitCode = report.status === 'FAIL' ? 1 : report.status === 'INCONCLUSIVE' ? 3 : 0;
}
await main().catch(error => { console.error(JSON.stringify({ kind: 'openai_billing_qa_failed', reason: error instanceof BillingInputError ? error.message : 'configuration_io_or_disposable_pipeline_failure' })); process.exitCode = 1; });

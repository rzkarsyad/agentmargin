/** Opt-in local evidence only; no provider requests, API calls or ledger writes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { readCheckedFile, requirePrivateDirectory } from './lib/private-files.ts';
import { parseBillingConfig, BillingInputError } from './lib/openai-billing.ts';
import { reconcileOpenAiSnapshots } from './lib/openai-billing-snapshots.ts';
async function main() {
    const [beforeUsage, beforeCost, afterUsage, afterCost, rates, output, ...flags] = process.argv.slice(2);
    if (!beforeUsage || !beforeCost || !afterUsage || !afterCost || !rates || !output || !([0, 2].includes(flags.length)) || flags.length === 2 && flags[0] !== '--receipt' || process.env.AGENTMARGIN_OPENAI_BILLING_QA !== 'local-only')
        throw new Error('configuration');
    const root = resolve('.'), requested = resolve(output), outside = (p: string) => relative(root, p) === '..' || relative(root, p).startsWith('../');
    if (!outside(requested))
        throw new Error('private_output_outside_checkout_required');
    mkdirSync(requested, { mode: 0o700, recursive: true });
    const directory = requirePrivateDirectory(requested);
    if (!outside(directory))
        throw new Error('private_output_outside_checkout_required');
    const originals = [beforeUsage, beforeCost, afterUsage, afterCost].map(p => readCheckedFile(p).contents);
    const config = parseBillingConfig(JSON.parse(readCheckedFile(rates, { maxBytes: 100000 }).contents));
    const receiptText = flags.length ? readCheckedFile(flags[1]!, { privateFile: true, maxBytes: 100000 }).contents : undefined;
    const report = reconcileOpenAiSnapshots({ usage: originals[0]!, cost: originals[1]! }, { usage: originals[2]!, cost: originals[3]! }, config, receiptText === undefined ? undefined : JSON.parse(receiptText));
    if (receiptText !== undefined)
        report.privateMetadata.sha256 = createHash('sha256').update(receiptText).digest('hex');
    const target = resolve(directory, 'openai-snapshot-delta-' + Date.now() + '.json');
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ kind: report.kind, status: report.status, reportWritten: true, providerNetworkCalls: 0, ledgerWrites: 0, checks: report.checks.map(c => ({ check: c.check, status: c.status })) }));
    process.exitCode = report.status === 'FAIL' ? 1 : 3;
}
await main().catch(error => { console.error(JSON.stringify({ kind: 'openai_billing_snapshot_failed', reason: error instanceof BillingInputError ? error.message : 'configuration_io_or_private_evidence_failure' })); process.exitCode = 1; });

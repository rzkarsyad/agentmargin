/** Optional future paid experiment. Never used by CI or historical CSV validation. */
import { mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fromOpenAIResponse } from '../packages/sdk/src/openai.ts';
import { calculateEventCost } from '../packages/core/src/index.ts';
import { parseBillingConfig, rateVersion, type BillingUsage } from './lib/openai-billing.ts';
import { readCheckedFile, requirePrivateDirectory } from './lib/private-files.ts';
import { captureOneOpenAiRequest, loadLiveReceipt, writeLiveReceipt } from './lib/openai-live.ts';
async function main() {
    const [mode, ratesFile, output, ...extra] = process.argv.slice(2);
    if (!['--check', '--request', '--track'].includes(mode ?? '') || !ratesFile || !output || extra.length)
        throw new Error('configuration');
    const root = resolve('.'), requested = resolve(output), outside = (p: string) => relative(root, p) === '..' || relative(root, p).startsWith('../');
    if (!outside(requested))
        throw new Error('private_output_outside_checkout_required');
    mkdirSync(requested, { mode: 0o700, recursive: true });
    const directory = requirePrivateDirectory(requested);
    if (!outside(directory))
        throw new Error('private_output_outside_checkout_required');
    const config = parseBillingConfig(JSON.parse(readCheckedFile(ratesFile, { maxBytes: 100000 }).contents));
    const prices = config.rates.filter(p => p.source.kind === 'official_current').map(rateVersion);
    if (mode !== '--track' && !prices.some(p => p.model === 'gpt-6-luna' && Date.parse(p.effectiveFrom) <= Date.now() && Date.parse(p.effectiveTo!) > Date.now()))
        throw new Error('current_reviewed_QA_rate_window_required');
    if (mode !== '--track') {
        // Conservative fixture estimate, not a provider-side cap or charge guarantee.
        const estimate = calculateEventCost({ id: 'budget-check', workspaceId: 'synthetic', customerId: 'synthetic', model: 'gpt-6-luna', occurredAt: new Date().toISOString(), inputTokens: 128, outputTokens: 16, cachedInputTokens: 0 }, prices);
        if (estimate.amountMicros === null || estimate.amountMicros > 1000000n)
            throw new Error('reviewed_request_estimate_exceeds_one_dollar_target');
    }
    if (mode === '--check') {
        if (!process.env.OPENAI_API_KEY)
            throw new Error('missing_provider_configuration');
        console.log(JSON.stringify({ kind: 'openai_live_qa', status: 'configuration_checked', networkCalls: 0, paidRequestAuthorized: false }));
        return;
    }
    if (mode === '--request') {
        await captureOneOpenAiRequest(directory, process.env.OPENAI_API_KEY ?? '', process.env.AGENTMARGIN_OPENAI_LIVE_QA);
        console.log(JSON.stringify({ kind: 'openai_live_qa', status: 'metadata_captured_privately', providerRequests: 1, tracked: false }));
        return;
    }
    const response = loadLiveReceipt(directory), event = fromOpenAIResponse(response, 'synthetic-priced'), at = event.occurredAt;
    const { reportedCostMicros: unusedReported, ...usageInput } = event;
    const usage = { ...usageInput, workspaceId: 'disposable-live-qa' }, calculated = calculateEventCost(usage, prices), price = prices.find(p => p.id === calculated.priceVersionId) ?? null;
    if (!price || calculated.amountMicros === null)
        throw new Error('matching_reviewed_price_required_before_tracking');
    const row: BillingUsage = { row: 1, start: at, end: new Date(Date.parse(at) + 1000).toISOString(), model: event.model, project: '', apiKey: '', requests: 1, input: event.inputTokens, output: event.outputTokens, cached: event.cachedInputTokens ?? 0, supported: true, issues: [], event: usage, price, costMicros: calculated.amountMicros.toString() };
    const { withOpenAiDisposableRuntime } = await import('./lib/openai-disposable-runtime.ts');
    const pipeline = await withOpenAiDisposableRuntime(async (runtimeUrl) => {
        process.env.AGENTMARGIN_OPENAI_QA_RUNTIME_URL = runtimeUrl;
        const { replayBillingInDisposableDatabase } = await import('./lib/openai-billing-postgres.ts');
        return replayBillingInDisposableDatabase([row], response);
    });
    writeLiveReceipt(directory, { schemaVersion: 1, state: 'tracked', basis: 'Provider response tracked in disposable database; compare with later billing exports', response, pipeline });
    console.log(JSON.stringify({ kind: 'openai_live_qa', status: 'tracked_and_verified_locally', providerRequests: 0, billingReconciled: false }));
}
await main().catch(() => { console.error(JSON.stringify({ kind: 'openai_live_qa_failed', reason: 'configuration_or_request_or_private_tracking_failure', retryProviderRequest: false })); process.exitCode = 1; });

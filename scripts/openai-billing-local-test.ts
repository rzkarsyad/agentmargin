/** Local PG16 fixture/replay runner. No provider API calls. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureCsv, fixtureConfig, usageRow, costRow } from './lib/openai-billing-fixture.ts';
import { validateOpenAiBilling } from './lib/openai-billing.ts';
import { replayBillingInDisposableDatabase } from './lib/openai-billing-postgres.ts';
import { withOpenAiDisposableRuntime } from './lib/openai-disposable-runtime.ts';
import { writeLiveReceipt } from './lib/openai-live.ts';
await withOpenAiDisposableRuntime(async (runtimeUrl) => {
    const files = process.argv.slice(2);
    if (files.length) {
        if (files.length !== 4)
            throw new Error('Expected usage.csv cost.csv rates.json private-output-dir');
        const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/openai-billing-qa.ts', ...files, '--postgres'], { env: { ...process.env, AGENTMARGIN_OPENAI_BILLING_QA: 'local-only', AGENTMARGIN_OPENAI_QA_RUNTIME_URL: runtimeUrl }, stdio: 'inherit', timeout: 120000 });
        process.exitCode = child.error ? 1 : child.status ?? 1;
    }
    else {
        process.env.AGENTMARGIN_OPENAI_QA_RUNTIME_URL = runtimeUrl;
        const result = validateOpenAiBilling(fixtureCsv([usageRow]), fixtureCsv([costRow]), fixtureConfig());
        assert.equal(result.report.totals.calculatedMicros, '9');
        const replay = await replayBillingInDisposableDatabase(result.usage);
        assert.equal(replay.status, 'PASS');
        // Exercise future receipt recovery with explicitly fictional metadata; no provider call.
        const directory = mkdtempSync(join(tmpdir(), 'agentmargin-openai-receipt-test-'));
        try {
            const ratesFile = join(directory, 'rates.json');
            writeFileSync(ratesFile, JSON.stringify(fixtureConfig()), { mode: 0o600 });
            writeLiveReceipt(directory, { schemaVersion: 1, state: 'captured', response: { id: 'resp_synthetic_pg_recovery', model: 'gpt-6-luna', created_at: 1792713600, status: 'completed', service_tier: 'default', usage: { input_tokens: 25, output_tokens: 13, input_tokens_details: { cached_tokens: 0 } } } });
            const tracked = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/openai-live-qa.ts', '--track', ratesFile, directory], { env: { ...process.env, OPENAI_API_KEY: '', AGENTMARGIN_OPENAI_LIVE_QA: '' }, encoding: 'utf8', timeout: 30000 });
            assert.equal(tracked.error, undefined);
            assert.equal(tracked.status, 0, 'Fictional receipt recovery failed');
            const receipt = JSON.parse(readFileSync(join(directory, 'response-metadata.json'), 'utf8'));
            assert.equal(receipt.state, 'tracked');
            assert.equal(receipt.response.id, 'resp_synthetic_pg_recovery');
            assert.equal(receipt.pipeline.responseIdentityPreserved, true);
        }
        finally {
            rmSync(directory, { recursive: true, force: true });
        }
        console.log(JSON.stringify({ kind: 'synthetic_openai_billing_pipeline', ...replay }));
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureOneOpenAiRequest, validateCapturedResponse, loadLiveReceipt } from '../../../scripts/lib/openai-live.ts';
const response = () => ({ id: 'resp_synthetic_not_real', model: 'gpt-6-luna', created_at: 1792713600, status: 'completed', service_tier: 'default', usage: { input_tokens: 25, output_tokens: 13, input_tokens_details: { cached_tokens: 0 } }, output: [{ text: 'MUST_NOT_BE_SAVED' }] });
test('paid request requires explicit authorization before any request/attempt marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentmargin-live-test-'));
    let requests = 0;
    try {
        const fetchImpl: typeof fetch = async () => { requests++; return Response.json(response()); };
        await assert.rejects(captureOneOpenAiRequest(dir, 'synthetic-test-key', undefined, fetchImpl));
        assert.equal(requests, 0);
        assert.equal(existsSync(join(dir, 'request-attempt.json')), false);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('one mocked bounded request captures only real-shape metadata; repeat refuses to spend', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentmargin-live-test-'));
    let requests = 0;
    try {
        const fetchImpl: typeof fetch = async (url, init) => {
            requests++;
            assert.equal(url, 'https://api.openai.com/v1/responses');
            assert.equal(init!.redirect, 'error');
            const body = JSON.parse(init!.body as string);
            assert.equal(body.max_output_tokens, 16);
            assert.equal(body.store, false);
            assert.equal(body.service_tier, 'default');
            assert.equal(body.tools, undefined);
            return Response.json(response());
        };
        await captureOneOpenAiRequest(dir, 'synthetic-test-key', 'one-paid-request', fetchImpl);
        const raw = readFileSync(join(dir, 'response-metadata.json'), 'utf8');
        assert.equal(raw.includes('MUST_NOT_BE_SAVED'), false);
        assert.equal(raw.includes('synthetic-test-key'), false);
        assert.equal(loadLiveReceipt(dir).id, 'resp_synthetic_not_real');
        assert.equal(statSync(join(dir, 'response-metadata.json')).mode & 0o777, 0o600);
        await assert.rejects(captureOneOpenAiRequest(dir, 'synthetic-test-key', 'one-paid-request', fetchImpl));
        assert.equal(requests, 1);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('ambiguous provider timeout leaves a durable attempt and cannot trigger an automatic retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentmargin-live-test-'));
    let requests = 0;
    try {
        const fetchImpl: typeof fetch = async () => { requests++; throw new Error('mock timeout'); };
        await assert.rejects(captureOneOpenAiRequest(dir, 'synthetic-test-key', 'one-paid-request', fetchImpl));
        await assert.rejects(captureOneOpenAiRequest(dir, 'synthetic-test-key', 'one-paid-request', fetchImpl));
        assert.equal(requests, 1);
        assert.equal(existsSync(join(dir, 'request-attempt.json')), true);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('unsupported provider metadata never becomes a known-cost tracked event', () => {
    for (const item of [{ ...response(), service_tier: 'flex' }, { ...response(), status: 'incomplete' }, { ...response(), model: 'other' },
        { ...response(), usage: { input_tokens: 25, output_tokens: 13 } },
        { ...response(), usage: { input_tokens: 25, output_tokens: 13, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } } }])
        assert.throws(() => validateCapturedResponse(item));
});

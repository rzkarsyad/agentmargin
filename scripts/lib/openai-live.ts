/** Separately opt-in ONE request. No automatic retries after an ambiguous outcome. */
import { writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fromOpenAIResponse, type ResponsesUsage } from '../../packages/sdk/src/openai.ts';
import { readCheckedFile, requirePrivateDirectory } from './private-files.ts';
export interface CapturedOpenAiResponse extends ResponsesUsage {
    status: 'completed';
    service_tier: 'default';
}
export function validateCapturedResponse(value: unknown): CapturedOpenAiResponse {
    if (!value || typeof value !== 'object')
        throw new Error('unsupported_response_shape');
    const r = value as CapturedOpenAiResponse;
    if (r.status !== 'completed' || r.model !== 'gpt-6-luna' || r.service_tier !== 'default' || !/^resp_[A-Za-z0-9_-]{1,180}$/.test(r.id) || r.usage?.input_tokens_details?.cached_tokens === undefined)
        throw new Error('unsupported_response_shape');
    if (r.usage.input_tokens > 272000 || Object.entries(r.usage.input_tokens_details).some(([key, value]) => key !== 'cached_tokens' && value !== 0))
        throw new Error('unsupported_response_dimensions');
    fromOpenAIResponse(r, 'synthetic-live-validation');
    // Retain only usage metadata, never prompts/output/provider credentials.
    return { id: r.id, model: r.model, created_at: r.created_at, status: r.status, service_tier: r.service_tier, usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, input_tokens_details: { cached_tokens: r.usage.input_tokens_details.cached_tokens } } };
}
export function writeLiveReceipt(directory: string, value: unknown) {
    const base = requirePrivateDirectory(directory), temp = join(base, '.receipt-' + randomUUID() + '.json');
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, join(base, 'response-metadata.json'));
}
export async function captureOneOpenAiRequest(directory: string, apiKey: string, authorization: string | undefined, fetchImpl: typeof fetch = fetch) {
    if (authorization !== 'one-paid-request' || !apiKey || /[\r\n]/.test(apiKey))
        throw new Error('explicit_paid_request_authorization_required');
    const base = requirePrivateDirectory(directory), claim = join(base, 'request-attempt.json');
    if (existsSync(join(base, 'response-metadata.json')))
        throw new Error('existing_run_do_not_recreate');
    // Written before network I/O. A timeout/crash requires manual provider lookup, never another request.
    writeFileSync(claim, JSON.stringify({ kind: 'one_openai_request_attempt', model: 'gpt-6-luna', attemptedAt: new Date().toISOString(), retryAllowed: false }) + '\n', { mode: 0o600, flag: 'wx' });
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', input: 'Reply with OK.', max_output_tokens: 16, reasoning: { effort: 'none' }, service_tier: 'default', store: false }),
        redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
        throw new Error('provider_http_rejection_no_automatic_retry');
    if (!response.body)
        throw new Error('provider_missing_body_no_automatic_retry');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.length;
            if (size > 100000) {
                await reader.cancel();
                throw new Error('provider_response_too_large');
            }
            chunks.push(part.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const selected = validateCapturedResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    writeLiveReceipt(base, { schemaVersion: 1, state: 'captured', basis: 'Authenticated provider API response; not independent billing evidence', capturedAt: new Date().toISOString(), response: selected });
    return selected;
}
export function loadLiveReceipt(directory: string): CapturedOpenAiResponse {
    const base = requirePrivateDirectory(directory), value = JSON.parse(readCheckedFile(join(base, 'response-metadata.json'), { maxBytes: 100000, privateFile: true }).contents);
    if (value.schemaVersion !== 1 || !['captured', 'tracked'].includes(value.state))
        throw new Error('unsupported_receipt');
    return validateCapturedResponse(value.response);
}

/** Fictional public fixtures. Never use private export rows as checked-in fixtures. */
import type { BillingConfig } from './openai-billing.ts';
export const usageRow: Record<string, string> = {
    start_time: '1792713600', end_time: '1792800000', start_time_iso: '2026-10-23T00:00:00Z', end_time_iso: '2026-10-24T00:00:00Z',
    project_id: 'synthetic-project', api_key_id: 'synthetic-key', model: 'gpt-6-luna', batch: 'False', service_tier: 'default',
    num_model_requests: '1.0', input_tokens: '25.0', output_tokens: '13.0', input_cached_tokens: '0.0',
    input_cache_write_tokens: '0.0', input_cache_write_30m_tokens: '0.0', input_cache_write_12h_tokens: '0.0',
    input_uncached_tokens: '25.0', input_text_tokens: '25.0', output_text_tokens: '13.0', input_cached_text_tokens: '0.0',
    input_audio_tokens: '0.0', input_cached_audio_tokens: '0.0', output_audio_tokens: '0.0',
    input_image_tokens: '0.0', input_cached_image_tokens: '0.0', output_image_tokens: '0.0', api_source: '',
};
export const costRow: Record<string, string> = {
    start_time: '1792713600', end_time: '1792800000', start_time_iso: '2026-10-23T00:00:00', end_time_iso: '2026-10-24T00:00:00',
    amount_value: '0.000009000000000000000000000000000', amount_currency: 'usd', project_id: '', api_key_id: '', line_item: '', api_source: '',
};
export function fixtureConfig(): BillingConfig {
    return { rates: [{
                id: 'synthetic-rate', model: 'gpt-6-luna', effectiveFrom: '2026-10-23T00:00:00Z', effectiveTo: '2026-10-24T00:00:00Z',
                inputMicrosPerMillion: '100000', outputMicrosPerMillion: '500000', cachedInputMicrosPerMillion: '10000',
                source: { kind: 'official_current', url: 'https://developers.openai.com/api/docs/models/gpt-6-luna', observedAt: '2026-10-23T18:48:54Z' },
            }] };
}
export function fixtureCsv(rows: Record<string, string>[], headers = Object.keys(rows[0]!)): string {
    const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    return [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))].map(r => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

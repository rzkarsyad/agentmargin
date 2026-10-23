/** Disposable replay of aggregate CSV quantities, NOT the original provider event.
 * Owner provisions fixtures; all prices, ingestion and analytics use restricted
 * runtime credentials through the actual localhost HTTP API and existing SDK. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { PostgresEventStore } from '../../apps/api/src/postgres.ts';
import { createApp, digest, type AnalyticsPage } from '../../apps/api/src/app.ts';
import { AgentMarginClient } from '../../packages/sdk/src/index.ts';
import { fromOpenAIResponse, type ResponsesUsage } from '../../packages/sdk/src/openai.ts';
import type { BillingUsage } from './openai-billing.ts';
export async function replayBillingInDisposableDatabase(rows: BillingUsage[], originalResponse?: ResponsesUsage) {
    const ownerUrl = process.env.AGENTMARGIN_STANDALONE_DATABASE_URL, runtimeUrl = process.env.AGENTMARGIN_OPENAI_QA_RUNTIME_URL;
    if (!ownerUrl || !runtimeUrl)
        throw new Error('Disposable owner/runtime configuration required');
    const a = new URL(ownerUrl), b = new URL(runtimeUrl);
    if (!['postgres:', 'postgresql:'].includes(a.protocol) || !['postgres:', 'postgresql:'].includes(b.protocol) || a.search || a.hash || b.search || b.hash || !b.username || a.hostname !== '127.0.0.1' || a.pathname !== '/agentmargin_ci' || a.username !== 'agentmargin_ci' || b.hostname !== a.hostname || b.port !== a.port || b.pathname !== a.pathname || b.username === a.username)
        throw new Error('Disposable local database only');
    const selected = rows.filter(r => r.requests === 1 && r.event && r.supported && r.costMicros !== null && r.price);
    if (!selected.length)
        return { status: 'INCONCLUSIVE', reason: 'No supported single-request rows with official-observed rate hypotheses; no replay performed.' };
    if (selected.length > 100)
        throw new Error('Disposable replay limited to 100 rows; partition reviewed evidence explicitly');
    if (originalResponse) {
        assert.equal(selected.length, 1);
        const normalized = fromOpenAIResponse(originalResponse, 'synthetic-priced'), row = selected[0]!;
        assert.equal(normalized.id, row.event!.id);
        assert.equal(normalized.model, row.model);
        assert.equal(normalized.occurredAt, row.start);
        assert.equal(normalized.inputTokens, row.input);
        assert.equal(normalized.outputTokens, row.output);
        assert.equal(normalized.cachedInputTokens, row.cached);
    }
    const owner = new PostgresEventStore(ownerUrl), key = 'am_' + randomBytes(32).toString('base64url'), otherKey = 'am_' + randomBytes(32).toString('base64url'), workspace = randomUUID(), other = randomUUID();
    const runtime = new PostgresEventStore(runtimeUrl);
    let server: ReturnType<typeof serve> | undefined;
    try {
        assert.ok(await owner.ready());
        const role = (await runtime.pool.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
    pg_has_role(current_user,'agentmargin_ci','MEMBER') AS owns FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`)).rows[0];
        assert.ok(role && !role.rolsuper && !role.rolbypassrls && !role.rolcreatedb && !role.rolcreaterole && !role.owns, 'Restricted runtime required');
        for (const [id, k] of [[workspace, key], [other, otherKey]]) {
            await owner.pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [id, 'Synthetic OpenAI aggregate QA']);
            await owner.pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)', [randomUUID(), id, digest(k!), 'Synthetic OpenAI aggregate QA']);
        }
        server = serve({ fetch: createApp(runtime).fetch, hostname: '127.0.0.1', port: 0 });
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const endpoint = 'http://127.0.0.1:' + address.port;
        const client = new AgentMarginClient({ endpoint, apiKey: key });
        const postPrice = async (price: Record<string, unknown>) => {
            const r = await fetch(endpoint + '/v1/prices', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(price), signal: AbortSignal.timeout(10000) });
            assert.equal(r.status, 201);
            return await r.json() as {
                id: string;
            };
        };
        const versions = new Map<string, string>(), models = new Set<string>();
        for (const row of selected) {
            const p = row.price!;
            if (!models.has(row.model)) {
                const earliest = Math.min(...selected.filter(r => r.model === row.model).map(r => Date.parse(r.price!.effectiveFrom)));
                const before = new Date(earliest - 2 * 86400000).toISOString(), until = new Date(earliest - 86400000).toISOString();
                await postPrice({ model: row.model, effectiveFrom: before, effectiveTo: until, inputMicrosPerMillion: '1', outputMicrosPerMillion: '1', cachedInputMicrosPerMillion: null, sourceNote: 'Synthetic expired shadow; ensures unknown pricing before the QA-only rate arrives' });
                models.add(row.model);
            }
        }
        const events = selected.map(r => ({ id: r.event!.id, customerId: 'synthetic-priced', model: r.model, occurredAt: r.start, inputTokens: r.input, outputTokens: r.output, cachedInputTokens: r.cached }));
        const late = events.map(e => ({ ...e, id: 'late-' + e.id, customerId: 'synthetic-late' }));
        await client.track(late);
        for (const row of selected) {
            const p = row.price!;
            if (versions.has(p.id))
                continue;
            const saved = await postPrice({ model: p.model, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, inputMicrosPerMillion: p.inputMicrosPerMillion.toString(), outputMicrosPerMillion: p.outputMicrosPerMillion.toString(), cachedInputMicrosPerMillion: p.cachedInputMicrosPerMillion?.toString() ?? null, sourceNote: 'QA-only current official-observed rate hypothesis; historical effective date NOT independently verified; no customer repricing' });
            versions.set(p.id, saved.id);
        }
        const track = () => originalResponse ? client.trackOpenAIResponse(originalResponse, 'synthetic-priced') : client.track(events);
        assert.equal((await track()).inserted, events.length);
        assert.equal((await track()).duplicate, events.length);
        assert.equal((await client.track(late)).duplicate, late.length);
        await client.track([{ ...events[0]!, id: 'unknown-' + randomUUID(), customerId: 'synthetic-unknown', model: 'unknown-' + randomUUID() }]);
        const stored = (await owner.pool.query('SELECT event_id,calculated_cost_micros::text,cost_source,workspace_price_version_id FROM usage_events WHERE workspace_id=$1', [workspace])).rows;
        for (const row of selected) {
            const priced = stored.find(s => s.event_id === row.event!.id), unknown = stored.find(s => s.event_id === 'late-' + row.event!.id);
            assert.equal(priced.calculated_cost_micros, row.costMicros);
            assert.equal(priced.cost_source, 'estimated');
            assert.equal(priced.workspace_price_version_id, versions.get(row.price!.id));
            assert.equal(unknown.calculated_cost_micros, null);
            assert.equal(unknown.cost_source, 'unknown');
        }
        assert.equal(stored.length, selected.length * 2 + 1);
        assert.equal((await runtime.pool.query('SELECT count(*)::text AS n FROM public.usage_events')).rows[0].n, '0', 'Pooled tenant context leaked after transaction');
        const start = selected.map(r => r.start).sort()[0]!, end = selected.map(r => r.end).sort().at(-1)!, expected = selected.reduce((n, r) => n + BigInt(r.costMicros!), 0n).toString();
        const path = '/v1/analytics/page?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&limit=1';
        assert.equal((await fetch(endpoint + path)).status, 401);
        let cursor = '', customers = 0, customerCost = 0n;
        do {
            const response = await fetch(endpoint + path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
            assert.equal(response.status, 200);
            const page = await response.json() as AnalyticsPage;
            assert.equal(page.summary.totalKnownAiCostMicros, expected);
            assert.equal(page.summary.completeContributionMicros, null);
            assert.equal(page.summary.usageEventCount, String(selected.length * 2 + 1));
            assert.equal(page.summary.unknownUsageEventCount, String(selected.length + 1));
            customers += page.customers.length;
            customerCost += page.customers.reduce((n, c) => n + BigInt(c.knownAiCostMicros), 0n);
            cursor = page.nextCursor ?? '';
        } while (cursor);
        assert.equal(customers, 3);
        assert.equal(customerCost.toString(), expected);
        const otherResult = await fetch(endpoint + path, { headers: { authorization: 'Bearer ' + otherKey }, signal: AbortSignal.timeout(10000) });
        assert.equal(otherResult.status, 200);
        assert.equal((await otherResult.json() as AnalyticsPage).summary.totalKnownAiCostMicros, '0');
        return { status: 'PASS', basis: originalResponse ? 'SDK Responses normalization retains supplied ID/time; capture provenance and billing need separate review' : 'Synthetic local aggregate replay; not proof of original provider response ingestion', responseIdentityPreserved: !!originalResponse, replayedSingleRequestRows: selected.length, excludedAggregateRows: rows.filter(r => r.requests !== 1).length, calculatedMicros: expected, priceVersionReferences: [...versions.values()], priceReferenceVerified: true, duplicateTrackingVerified: true, latePricingPreservesUnknown: true, unknownPricingVerified: true, paginationAndWorkspaceTotalsVerified: true, tenantIsolationVerified: true, missingAuthDenied: true };
    }
    finally {
        if (server)
            await new Promise<void>(r => server!.close(() => r()));
        await runtime.pool.end();
        await owner.pool.end();
    }
}

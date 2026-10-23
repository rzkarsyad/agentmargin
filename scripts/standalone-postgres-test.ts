/** Opt-in test. Requires a dedicated, empty database literally named agentmargin_ci. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp, type StoredEvent, type StoredRevenue} from '../apps/api/src/app.ts';

const connectionString=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!connectionString)throw new Error('AGENTMARGIN_STANDALONE_DATABASE_URL is required');
const url=new URL(connectionString);
if(!['postgresql:','postgres:'].includes(url.protocol)||url.pathname!=='/agentmargin_ci')
  throw new Error('Refusing to test: database URL must target /agentmargin_ci exactly');
const pool=new pg.Pool({connectionString,max:2});
let store:PostgresEventStore|undefined;
try {
  const tables=await pool.query<{count:string}>(`SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'`);
  if(Number(tables.rows[0]?.count)!==0)throw new Error('Refusing to test: agentmargin_ci must be empty');
  await pool.query(readFileSync(new URL('../db/001_initial.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/002_ingestion.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/003_revenue_ingestion.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/004_workspace_pricing.sql',import.meta.url),'utf8'));
  const workspace=randomUUID(),other=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO workspaces(id,name) VALUES ($1,$2),($3,$4)',[workspace,'A',other,'B']);
  await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES ($1,$2,$3,$4)',
    [randomUUID(),workspace,createHash('sha256').update(key).digest('hex'),'test']);
  store=new PostgresEventStore(connectionString);
  const event={id:'race-1',workspaceId:workspace,customerId:'customer-1',model:'m',occurredAt:'2026-10-10T00:00:00Z',inputTokens:1,outputTokens:1};
  const stored:StoredEvent={event,payloadDigest:'same-payload',costMicros:100n,source:'reported',priceId:null};
  const concurrent=await Promise.all(Array.from({length:20},()=>store!.ingest(workspace,[stored])));
  assert.equal(concurrent.reduce((sum,r)=>sum+r.inserted,0),1);
  assert.equal(concurrent.reduce((sum,r)=>sum+r.duplicate,0),19);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE workspace_id=$1',[workspace])).rows[0]?.n,1);
  await assert.rejects(store.ingest(workspace,[{...stored,payloadDigest:'changed'}]),/Idempotency conflict/);
  // Conflicting lock acquisition order used to cause deadlock risks in batches.
  const first:StoredEvent={...stored,event:{...event,id:'ordered-a'},payloadDigest:'ordered-a'};
  const second:StoredEvent={...stored,event:{...event,id:'ordered-b'},payloadDigest:'ordered-b'};
  const swapped=await Promise.all([
    store.ingest(workspace,[first,second]),
    store.ingest(workspace,[second,first]),
  ]);
  assert.equal(swapped.reduce((sum,result)=>sum+result.inserted,0),2);
  assert.equal(swapped.reduce((sum,result)=>sum+result.duplicate,0),2);
  // A separate workspace must not observe any of the first workspace's events or revenue.
  assert.equal((await store.analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')).customers.length,0);
  const rev:StoredRevenue={id:'invoice-concurrent',customerId:'customer-1',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'29000000',payloadDigest:'revenue-payload-v1'};
  const revenueRuns=await Promise.all(Array.from({length:20},()=>store!.ingestRevenue(workspace,[rev])));
  assert.equal(revenueRuns.reduce((n,result)=>n+result.inserted,0),1);
  assert.equal(revenueRuns.reduce((n,result)=>n+result.duplicate,0),19);
  await assert.rejects(store.ingestRevenue(workspace,[{...rev,amountMicros:'30000000',payloadDigest:'changed'}]),/Idempotency conflict/);
  const a=await store.analytics(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
  assert.equal(a.customers.find(c=>c.customerId==='customer-1')?.revenueMicros,'29000000');
  const b=await store.analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
  assert.equal(b.customers.length,0);
  // Authorization must always derive scope from the bearer key, never query strings.
  const otherKey='am_'+randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[
    randomUUID(),other,createHash('sha256').update(otherKey).digest('hex'),'other-workspace']);
  const otherEvent:StoredEvent={...stored,event:{...event,id:'private-other-workspace',workspaceId:other,customerId:'other-customer'},payloadDigest:'other-workspace-event'};
  await store.ingest(other,[otherEvent]);
  const api=createApp(store);
  const path='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&workspaceId='+other;
  const visibleA=await api.request(path,{headers:{authorization:'Bearer '+key}});
  const visibleB=await api.request(path,{headers:{authorization:'Bearer '+otherKey}});
  assert.equal(visibleA.status,200);assert.equal(visibleB.status,200);
  const responseA=await visibleA.json() as {customers:{customerId:string}[]};
  const responseB=await visibleB.json() as {customers:{customerId:string}[]};
  assert.ok(!responseA.customers.some(c=>c.customerId==='other-customer'),'Cross-tenant data leaked into workspace A');
  assert.deepEqual(responseB.customers.map(c=>c.customerId),['other-customer']);
  // v0.3: workspace A prices must never bleed into B, even for identical models.
  const sourceNote='CI synthetic source for isolated pricing';
  const firstPrice={id:randomUUID(),model:'workspace-only-model',
    effectiveFrom:'2026-01-01T00:00:00.000Z',effectiveTo:null,
    inputMicrosPerMillion:'1000000',outputMicrosPerMillion:'2000000',
    cachedInputMicrosPerMillion:null,sourceNote};
  const createdPrice=await store.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),firstPrice);
  assert.equal(createdPrice.model,'workspace-only-model');
  assert.equal((await store.listPriceVersions(other)).items.length,0,'Other workspace must not list pricing data');
  assert.equal((await store.prices(other,'workspace-only-model','2026-10-01T00:00:00Z')).length,0,
    'Other workspace must not reuse workspace A pricing');
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-10-01T00:00:00Z'))[0]?.id,createdPrice.id);
  const later={...firstPrice,id:randomUUID(),effectiveFrom:'2026-11-01T00:00:00.000Z',inputMicrosPerMillion:'3000000'};
  await store.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),later);
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-10-01T00:00:00Z'))[0]?.id,createdPrice.id);
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-11-02T00:00:00Z'))[0]?.id,later.id);
  await assert.rejects(pool.query('UPDATE workspace_price_versions SET input_micros_per_million=0 WHERE id=$1',[createdPrice.id]),
    /append-only/);
  await assert.rejects(pool.query('DELETE FROM workspace_price_versions WHERE id=$1',[createdPrice.id]),/append-only/);
  // API must scope price listings from auth, not client-supplied workspaceId.
  const priceListA=await api.request('/v1/prices?workspaceId='+other,{headers:{authorization:'Bearer '+key}});
  const priceListB=await api.request('/v1/prices?workspaceId='+workspace,{headers:{authorization:'Bearer '+otherKey}});
  assert.equal(priceListA.status,200);assert.equal(priceListB.status,200);
  assert.equal((await priceListA.json() as {items:{id:string}[]}).items.length,2);
  assert.equal((await priceListB.json() as {items:{id:string}[]}).items.length,0);
  // v0.5: full-workspace totals must include customers beyond a single page.
  await pool.query(`INSERT INTO customers(workspace_id,id)
    SELECT $1,'bulk-'||lpad(n::text,4,'0') FROM generate_series(1,125) AS n
    ON CONFLICT DO NOTHING`,[workspace]);
  await pool.query(`INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros)
    SELECT $1,'bulk-rev-'||n::text,'bulk-'||lpad(n::text,4,'0'),
      '2026-10-10T00:00:00Z'::timestamptz,1000000
    FROM generate_series(1,125) AS n`,[workspace]);
  const pageFirst=await store.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',null,20);
  assert.equal(pageFirst.customers.length,20);
  assert.equal(pageFirst.summary.customerCount,'126');
  assert.equal(pageFirst.summary.totalRevenueMicros,'154000000');
  assert.equal(pageFirst.summary.unknownCustomerCount,'0');
  assert.equal(pageFirst.summary.completeContributionMicros,
    (BigInt(pageFirst.summary.totalRevenueMicros)-BigInt(pageFirst.summary.totalKnownAiCostMicros)).toString());
  assert.ok(pageFirst.nextCursor,'More customers must be accessible');
  const pageSecond=await store.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',
    Buffer.from(pageFirst.nextCursor,'base64url').toString('utf8'),20);
  assert.equal(pageSecond.customers.length,20);
  assert.equal(pageSecond.summary.totalRevenueMicros,pageFirst.summary.totalRevenueMicros);
  assert.equal(new Set([...pageFirst.customers,...pageSecond.customers].map(c=>c.customerId)).size,40);
  const pageA=await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=20&workspaceId='+other,
    {headers:{authorization:'Bearer '+key}});
  assert.equal(pageA.status,200);
  const pageResult=await pageA.json() as {summary:{customerCount:string};nextCursor:string};
  assert.equal(pageResult.summary.customerCount,'126','Query workspaceId must not change scope');
  const pageB=await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=20',
    {headers:{authorization:'Bearer '+otherKey}});
  assert.equal((await pageB.json() as {summary:{customerCount:string}}).summary.customerCount,'1',
    'Other tenant must not inherit aggregate totals');
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=0',
    {headers:{authorization:'Bearer '+key}})).status,400);
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&cursor=!',
    {headers:{authorization:'Bearer '+key}})).status,400);
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z')).status,401);
  // v0.7: prove the documented runtime grants support API queries while blocking
  // schema/accounting mutations. The role exists only for this isolated CI run.
  const runtimeRole='agentmargin_ci_runtime_'+randomBytes(6).toString('hex');
  const runtimePassword=randomBytes(24).toString('base64url');
  const roleDDL=await pool.query<{sql:string}>(
    `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', $1, $2) AS sql`,
    [runtimeRole,runtimePassword]);
  await pool.query(roleDDL.rows[0]!.sql);
  let runtimeStore:PostgresEventStore|undefined;
  try{
    const grants=readFileSync(new URL('../db/runtime_privileges.psql',import.meta.url),'utf8')
      .replaceAll(':"runtime_role"','"'+runtimeRole+'"')
      .split('\n').filter(line=>!line.startsWith('--')).join('\n');
    await pool.query(grants);
    const runtimeURL=new URL(connectionString);
    runtimeURL.username=runtimeRole;
    runtimeURL.password=runtimePassword;
    runtimeStore=new PostgresEventStore(runtimeURL.toString());
    assert.equal(await runtimeStore.authenticate(createHash('sha256').update(key).digest('hex')),workspace);
    const runtimeEvent:StoredEvent={...stored,event:{...event,id:'runtime-role-usage',customerId:'runtime-customer'},
      payloadDigest:'runtime-role-usage'};
    assert.equal((await runtimeStore.ingest(workspace,[runtimeEvent])).inserted,1);
    const runtimeRevenue:StoredRevenue={...rev,id:'runtime-role-revenue',customerId:'runtime-customer',
      payloadDigest:'runtime-role-revenue'};
    assert.equal((await runtimeStore.ingestRevenue(workspace,[runtimeRevenue])).inserted,1);
    const runtimePrice={...firstPrice,id:randomUUID(),model:'runtime-priced',
      effectiveFrom:'2026-12-01T00:00:00Z'};
    assert.equal((await runtimeStore.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),runtimePrice)).id,
      runtimePrice.id);
    assert.equal((await runtimeStore.prices(workspace,'runtime-priced','2026-12-02T00:00:00Z'))[0]?.id,runtimePrice.id);
    assert.ok((await runtimeStore.analyticsPage(workspace,'2026-10-01T00:00:00Z',
      '2026-11-01T00:00:00Z',null,20)).summary.customerCount);
    const denied=[
      'SELECT * FROM workspaces',
      'INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES (gen_random_uuid(),gen_random_uuid(),repeat(\'a\',64),\'forbidden\')',
      'UPDATE revenue_records SET amount_micros=0',
      'DELETE FROM revenue_records',
      'TRUNCATE TABLE usage_events',
      'ALTER TABLE customers ADD COLUMN forbidden text',
      'CREATE TABLE public.forbidden_table(id integer)',
    ];
    for(const sql of denied){
      await assert.rejects(runtimeStore.pool.query(sql),
        (err:unknown)=>(err as {code?:string}).code==='42501',
        'Runtime role unexpectedly allowed: '+sql);
    }
  }finally{
    await runtimeStore?.pool.end();
    // Drop only the randomly named role created by this test, never an existing role.
    await pool.query('DROP OWNED BY "'+runtimeRole+'"');
    await pool.query('DROP ROLE "'+runtimeRole+'"');
  }
  process.stdout.write('Standalone PostgreSQL concurrency: PASSED (usage/revenue idempotency, reversed batch order, tenant isolation).\n');
} finally {
  await store?.pool.end();
  await pool.end();
}

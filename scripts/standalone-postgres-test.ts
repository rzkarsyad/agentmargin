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
  process.stdout.write('Standalone PostgreSQL concurrency: PASSED (usage/revenue idempotency, reversed batch order, tenant isolation).\n');
} finally {
  await store?.pool.end();
  await pool.end();
}

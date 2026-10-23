import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {PostgresEventStore} from '../src/postgres.ts';
import {createApp,digest} from '../src/app.ts';
import {AgentMarginClient} from '../../../packages/sdk/src/index.ts';

const workspace='11111111-1111-4111-8111-111111111111';
const key='am_'+randomBytes(32).toString('base64url');
const price='33333333-3333-4333-8333-333333333333';
test('SDK -> authenticated API -> pg adapter -> persisted cost -> analytics', {timeout:30_000}, async()=>{
  const db=new PGlite();
  const port=55438;
  const socket=new PGLiteSocketServer({db,port,host:'127.0.0.1'});
  let started=false;
  let store:PostgresEventStore|undefined;
  try{
    await db.exec(readFileSync(new URL('../../../db/001_initial.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/002_ingestion.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/003_revenue_ingestion.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/004_workspace_pricing.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/005_api_key_roles.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/006_api_key_expiry.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/007_credential_tenant_isolation.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/008_revenue_deliveries.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/009_credential_containment.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/010_revenue_adjustments.sql',import.meta.url),'utf8'));
    await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Integration']);
    await db.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',
      ['22222222-2222-4222-8222-222222222222',workspace,digest(key),'e2e']);
    await db.query(`INSERT INTO price_versions(id,model,effective_from,input_micros_per_million,output_micros_per_million)
      VALUES($1,'sample','2026-01-01T00:00:00Z',1000000,2000000)`,[price]);
    await socket.start();started=true;
    store=new PostgresEventStore(`postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
    const app=createApp(store);
    // Fail with the underlying database error rather than Hono's generic HTTP 500 during this test.
    app.onError((error)=>{throw error;});
    const sdk=new AgentMarginClient({endpoint:'http://localhost:8787',apiKey:key,
      fetchImpl:async(url,init)=>app.request(new Request(url,init))});
    const event={id:'e2e-1',customerId:'customer-1',model:'sample',occurredAt:'2026-10-10T00:00:00Z',inputTokens:500_000,outputTokens:250_000};
    assert.deepEqual(await sdk.track([event]),{inserted:1,duplicate:0,received:1});
    assert.deepEqual(await sdk.track([event]),{inserted:0,duplicate:1,received:1});
    await assert.rejects(sdk.track([{...event,outputTokens:200_000}]),/409/);
    const revenueBody={records:[{id:'revenue-1',customerId:'customer-1',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'10000000'}]};
    const sendRevenue=(body:unknown)=>app.request('/v1/revenue',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.deepEqual(await (await sendRevenue(revenueBody)).json(),{inserted:1,duplicate:0,received:1});
    assert.deepEqual(await (await sendRevenue(revenueBody)).json(),{inserted:0,duplicate:1,received:1});
    assert.equal((await sendRevenue({records:[{...revenueBody.records[0],amountMicros:'999'}]})).status,409);
    assert.equal((await sendRevenue({records:[{...revenueBody.records[0],id:'bad-negative',amountMicros:'-1'}]})).status,400);
    assert.equal((await sendRevenue({records:[{...revenueBody.records[0],id:'bad-overflow',amountMicros:'9223372036854775808'}]})).status,400);
    assert.equal((await sendRevenue({records:[revenueBody.records[0],revenueBody.records[0]]})).status,400);
    assert.equal((await app.request('/v1/revenue',{method:'POST',headers:{authorization:'Bearer am_invalid','content-type':'application/json'},body:JSON.stringify(revenueBody)})).status,401);
    const analytics=await app.request('/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z',
      {headers:{authorization:'Bearer '+key}});
    assert.equal(analytics.status,200);
    const data=await analytics.json();
    assert.equal(data.customers[0].knownAiCostMicros,'1000000');
    assert.equal(data.customers[0].contributionMicros,'9000000');
    assert.equal(data.customers[0].marginBasisPoints,'9000');
    const newPricing={model:'fresh-model',effectiveFrom:'2026-01-01T00:00:00Z',
      effectiveTo:null,inputMicrosPerMillion:'1000000',outputMicrosPerMillion:'2000000',
      cachedInputMicrosPerMillion:null,sourceNote:'Manually confirmed test rate'};
    const postPrice=(input:unknown)=>app.request('/v1/prices',{method:'POST',
      headers:{authorization:'Bearer '+key,'content-type':'application/json'},
      body:JSON.stringify(input)});
    const created=await postPrice(newPricing);
    assert.equal(created.status,201);
    const row=await created.json() as {id:string};
    assert.match(row.id,/^[0-9a-f-]{36}$/);
    assert.equal((await postPrice(newPricing)).status,409,'Same effective instant must be unique');
    assert.equal((await postPrice({...newPricing,inputMicrosPerMillion:'-1'})).status,400);
    assert.equal((await postPrice({...newPricing,effectiveTo:'2025-01-01T00:00:00Z'})).status,400);
    assert.equal((await postPrice({...newPricing,sourceNote:'x'})).status,400);
    assert.equal((await app.request('/v1/prices')).status,401);
    const list=await app.request('/v1/prices',{headers:{authorization:'Bearer '+key}});
    assert.equal(list.status,200);
    assert.equal((await list.json() as {items:{id:string}[]}).items[0]?.id,row.id);
    const newEvent={id:'priced-1',customerId:'customer-1',model:'fresh-model',
      occurredAt:'2026-10-11T00:00:00Z',inputTokens:1000000,outputTokens:0};
    assert.equal((await sdk.track([newEvent])).inserted,1);
    const persisted=await db.query<{workspace_price_version_id:string;price_version_id:string|null;calculated_cost_micros:string}>(
      'SELECT workspace_price_version_id,price_version_id,calculated_cost_micros FROM usage_events WHERE workspace_id=$1 AND event_id=$2',
      [workspace,newEvent.id]);
    assert.equal(persisted.rows[0]?.workspace_price_version_id,row.id);
    assert.equal(persisted.rows[0]?.price_version_id,null);
    assert.equal(String(persisted.rows[0]?.calculated_cost_micros),'1000000');
    await assert.rejects(db.query('DELETE FROM workspace_price_versions WHERE id=$1',[row.id]),/append-only/i);
    const shifted=await postPrice({...newPricing,effectiveFrom:'2026-11-01T00:00:00Z',inputMicrosPerMillion:'3000000'});
    assert.equal(shifted.status,201);
    assert.equal((await db.query<{calculated_cost_micros:string}>('SELECT calculated_cost_micros FROM usage_events WHERE event_id=$1',['priced-1'])).rows[0]?.calculated_cost_micros.toString(),'1000000',
      'New price cannot silently rewrite stored costs');
    const delivery={providerEventId:'evt_e2e_queue',providerAccount:'acct_synthetic',record:{id:'queued-invoice',customerId:'queued-customer',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'987654'}};
    assert.deepEqual(await sdk.enqueueRevenueDelivery(delivery),{duplicate:false,state:'pending'});
    assert.deepEqual(await sdk.enqueueRevenueDelivery(delivery),{duplicate:true,state:'pending'});
    assert.equal((await store.forCredential(key).processNextRevenueDelivery(workspace)).inserted,1);
    assert.deepEqual(await sdk.enqueueRevenueDelivery(delivery),{duplicate:true,state:'delivered'});
    await db.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE workspace_id=$1',[workspace]);
    assert.equal((await app.request('/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z',{headers:{authorization:'Bearer '+key}})).status,401);
  }finally{
    if(store)await store.pool.end();
    if(started)await socket.stop();
    await db.close();
  }
});
test.todo('standalone PostgreSQL: concurrent same-ID requests across independent connections yield one insert and one duplicate');

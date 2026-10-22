import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, digest, type EventStore, type StoredEvent } from '../src/app.ts';
import type { PriceVersion } from '../../../packages/core/src/index.ts';
import {WorkspaceRateLimiter} from '../src/rate-limit.ts';

const apiKey='am_'+'x'.repeat(40);
const price:PriceVersion={id:'p1',model:'m',effectiveFrom:'2026-01-01T00:00:00Z',inputMicrosPerMillion:1_000_000n,outputMicrosPerMillion:2_000_000n};
const entry={id:'e1',customerId:'c1',model:'m',occurredAt:'2026-10-01T00:00:00Z',inputTokens:100,outputTokens:50};
class MemoryStore implements EventStore {
  rows=new Map<string,StoredEvent>();
  async authenticate(keyDigest:string){return keyDigest===digest(apiKey)?'w1':null;}
  async prices(){return [price];}
  async analytics(_workspace:string,start:string,end:string){return {periodStart:start,periodEnd:end,truncated:false,customers:[{customerId:'c1',revenueMicros:'1000000',knownAiCostMicros:'200',contributionMicros:'999800',marginBasisPoints:'9998',usageEvents:1,unknownEvents:0}]};}
  async ingest(_workspace:string,events:readonly StoredEvent[]){
    let inserted=0,duplicate=0;
    for(const item of events){
      const old=this.rows.get(item.event.id);
      if(old){if(old.payloadDigest!==item.payloadDigest)throw new Error('Idempotency conflict');duplicate++;}
      else{this.rows.set(item.event.id,item);inserted++;}
    }
    return {inserted,duplicate};
  }
}
function send(app:ReturnType<typeof createApp>,body:unknown,key=apiKey){
  return app.request('/v1/events',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});
}
test('rejects unauthenticated events',async()=>{
  const r=await send(createApp(new MemoryStore()),{events:[entry]},'bad');assert.equal(r.status,401);
});
test('ingests and idempotently retries a batch',async()=>{
  const store=new MemoryStore(),app=createApp(store);
  assert.equal((await send(app,{events:[entry]})).status,202);
  assert.deepEqual(await (await send(app,{events:[entry]})).json(),{inserted:0,duplicate:1,received:1});
  assert.equal(store.rows.get('e1')?.costMicros,200n);
});
test('conflicting retry is rejected',async()=>{
  const app=createApp(new MemoryStore());await send(app,{events:[entry]});
  assert.equal((await send(app,{events:[{...entry,inputTokens:999}]})).status,409);
});
test('blocks invalid token counts, duplicate batch IDs and invalid reported cost',async()=>{
  const app=createApp(new MemoryStore());
  assert.equal((await send(app,{events:[{...entry,inputTokens:-1}]})).status,400);
  assert.equal((await send(app,{events:[entry,entry]})).status,400);
  assert.equal((await send(app,{events:[{...entry,reportedCostMicros:'1.50'}]})).status,400);
  assert.equal((await send(app,{events:[{...entry,occurredAt:'2026-10-01T00:00:00'}]})).status,400);
  assert.equal((await send(app,{events:[{...entry,occurredAt:'2026-10-01'}]})).status,400);
  assert.equal((await send(app,{events:[{...entry,occurredAt:'2026-02-31T00:00:00Z'}]})).status,400);
});
test('unknown provider pricing remains unknown',async()=>{
  const store=new MemoryStore();store.prices=async()=>[];
  const r=await send(createApp(store),{events:[entry]});
  assert.equal(r.status,202);assert.equal(store.rows.get('e1')?.costMicros,null);
});
test('analytics requires auth and validates period',async()=>{
  const app=createApp(new MemoryStore());
  assert.equal((await app.request('/v1/analytics')).status,401);
  assert.equal((await app.request('/v1/analytics?start=invalid&end=2026-11-01T00:00:00Z',{headers:{authorization:`Bearer ${apiKey}`}})).status,400);
  assert.equal((await app.request('/v1/analytics?start=2026-10-01T00:00:00&end=2026-11-01T00:00:00Z',{headers:{authorization:`Bearer ${apiKey}`}})).status,400);
  const r=await app.request('/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z',{headers:{authorization:`Bearer ${apiKey}`}});
  assert.equal(r.status,200);assert.equal((await r.json()).customers[0].customerId,'c1');
});
test('dashboard serves local analytics shell',async()=>{
  const r=await createApp(new MemoryStore()).request('/dashboard');
  assert.equal(r.status,200);
  const body=await r.text();
  assert.match(body,/id="root"/);
  assert.match(body,/dashboard\/assets\/[A-Za-z0-9_.-]+\.js/);
  assert.match(r.headers.get('content-security-policy')??'',/script-src 'self'/);
  assert.equal(r.headers.get('cache-control'),'no-store');
});
test('authenticated requests share a workspace rate limit',async()=>{
  const app=createApp(new MemoryStore(),new WorkspaceRateLimiter(1));
  assert.equal((await send(app,{events:[entry]})).status,202);
  assert.equal((await send(app,{events:[{...entry,id:'e2'}]})).status,429);
  assert.equal((await app.request('/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z',{headers:{authorization:`Bearer ${apiKey}`}})).status,429);
});

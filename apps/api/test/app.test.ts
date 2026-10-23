import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, digest, type EventStore, type StoredEvent, type SafeRequestLog, type AuthenticatedWorkspace } from '../src/app.ts';
import type { PriceVersion } from '../../../packages/core/src/index.ts';
import {WorkspaceRateLimiter,InvalidCredentialLimiter} from '../src/rate-limit.ts';

const apiKey='am_'+'x'.repeat(40);
const price:PriceVersion={id:'p1',model:'m',effectiveFrom:'2026-01-01T00:00:00Z',inputMicrosPerMillion:1_000_000n,outputMicrosPerMillion:2_000_000n};
const entry={id:'e1',customerId:'c1',model:'m',occurredAt:'2026-10-01T00:00:00Z',inputTokens:100,outputTokens:50};
class MemoryStore implements EventStore {
  rows=new Map<string,StoredEvent>();
  authenticationQueries=0;
  async authenticate(keyDigest:string):Promise<AuthenticatedWorkspace|null>{this.authenticationQueries++;return keyDigest===digest(apiKey)?{workspaceId:'w1',accessRole:'admin'}:null;}
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

test('unauthenticated abuse guard counts malformed and unknown keys, not valid workspace requests',async()=>{
  let now=100_000;
  const guard=new InvalidCredentialLimiter(2,60_000,()=>now);
  const app=createApp(new MemoryStore(),new WorkspaceRateLimiter(50),guard);
  const valid={authorization:'Bearer '+apiKey};
  const url='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z';
  assert.equal((await app.request(url,{headers:{authorization:'invalid'}})).status,401);
  assert.equal((await app.request(url,{headers:{authorization:'Bearer am_'+ 'q'.repeat(40)}})).status,401);
  assert.equal((await app.request(url,{headers:{authorization:'invalid'}})).status,429);
  // A spike of bad keys does not lock out legitimate customers via global bucket.
  assert.equal((await app.request(url,{headers:valid})).status,200);
  now+=61_000;
  assert.equal((await app.request(url,{headers:{authorization:'invalid'}})).status,401);
});

// Pre-auth middleware must be the only credential lookup; route handlers consume its trusted context.
test('each API request authenticates exactly once before route handling',async()=>{
  const store=new MemoryStore(),app=createApp(store);
  assert.equal((await send(app,{events:[entry]})).status,202);
  assert.equal(store.authenticationQueries,1);
  const headers={authorization:'Bearer '+apiKey};
  const url='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z';
  assert.equal((await app.request(url,{headers})).status,200);
  assert.equal(store.authenticationQueries,2);
  // Unimplemented optional endpoints still require auth, but never authenticate twice.
  assert.equal((await app.request('/v1/prices',{headers})).status,503);
  assert.equal(store.authenticationQueries,3);
  assert.equal((await send(app,{events:[entry]},'bad')).status,401);
  assert.equal(store.authenticationQueries,3);
  assert.equal((await send(app,{events:[entry]},'am_'+'q'.repeat(40))).status,401);
  assert.equal(store.authenticationQueries,4);
});

test('read and ingest keys can only use their assigned routes; admin keeps legacy access',async()=>{
  const readKey='am_'+'r'.repeat(40),ingestKey='am_'+'i'.repeat(40);
  const store=new MemoryStore();
  store.authenticate=async keyDigest=>{
    store.authenticationQueries++;
    if(keyDigest===digest(readKey))return {workspaceId:'w1',accessRole:'read'};
    if(keyDigest===digest(ingestKey))return {workspaceId:'w1',accessRole:'ingest'};
    if(keyDigest===digest(apiKey))return {workspaceId:'w1',accessRole:'admin'};
    return null;
  };
  const app=createApp(store);
  const period='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z';
  const auth=(key:string)=>({headers:{authorization:'Bearer '+key}});
  const eventBody={events:[entry]};
  assert.equal((await app.request(period,auth(readKey))).status,200);
  assert.equal((await app.request('/v1/prices',auth(readKey))).status,503,'Read permitted; optional store feature absent');
  assert.equal((await send(app,eventBody,readKey)).status,403);
  assert.equal((await app.request('/v1/revenue',{method:'POST',headers:{authorization:'Bearer '+readKey}})).status,403);
  assert.equal((await app.request('/v1/prices',{method:'POST',headers:{authorization:'Bearer '+readKey}})).status,403);
  assert.equal((await send(app,eventBody,ingestKey)).status,202);
  assert.equal((await app.request(period,auth(ingestKey))).status,403);
  assert.equal((await app.request('/v1/prices',auth(ingestKey))).status,403);
  assert.equal((await app.request('/v1/prices',{method:'POST',headers:{authorization:'Bearer '+ingestKey}})).status,403);
  assert.equal((await app.request('/v1/future-feature',auth(readKey))).status,403,'Unknown endpoint defaults to admin-only');
  assert.equal((await app.request('/v1/future-feature',auth(apiKey))).status,404);
  assert.equal((await app.request(period,auth(apiKey))).status,200);
  assert.equal((await send(app,eventBody,apiKey)).status,202);
  assert.equal((await app.request('/v1/prices',{method:'POST',headers:{authorization:'Bearer '+apiKey}})).status,503);
});

test('request telemetry is opt-in, allowlisted and never logs customer details or secrets',async()=>{
  const logs:SafeRequestLog[]=[];
  const app=createApp(new MemoryStore(),new WorkspaceRateLimiter(50),new InvalidCredentialLimiter(),event=>logs.push(event));
  const querySecret='private-query-customer-123';
  const r=await app.request('/v1/events?customerId='+querySecret,{
    method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json','x-secret-test':'private-header'},
    body:JSON.stringify({events:[{...entry,customerId:'private-body-customer'}]})});
  assert.equal(r.status,202);
  assert.equal(logs.length,1);
  assert.match(r.headers.get('x-request-id')??'',/^[0-9a-f-]{36}$/);
  assert.equal(logs[0]?.requestId,r.headers.get('x-request-id'));
  assert.equal(logs[0]?.route,'events');
  assert.equal(logs[0]?.method,'POST');
  assert.equal(logs[0]?.status,202);
  assert.ok(logs[0]!.durationMs>=0);
  assert.deepEqual(Object.keys(logs[0]!).sort(),
    ['kind','requestId','timestamp','route','method','status','durationMs','errorClass'].sort());
  const text=JSON.stringify(logs);
  for(const forbidden of [apiKey,querySecret,'private-body-customer','private-header','authorization','workspaceId'])
    assert.ok(!text.includes(forbidden),'Sensitive value appeared in request telemetry');
  const missing=await app.request('/private-path?token=very-private');
  assert.equal(missing.status,404);
  assert.equal(logs[1]?.route,'other');
  assert.ok(!JSON.stringify(logs).includes('very-private'));
});

test('request telemetry preserves sanitised errors and remains non-blocking',async()=>{
  const logs:SafeRequestLog[]=[];
  const store=new MemoryStore();
  store.ingest=async()=>{throw new Error('private-db-message');};
  const app=createApp(store,new WorkspaceRateLimiter(50),new InvalidCredentialLimiter(),event=>logs.push(event));
  const r=await send(app,{events:[entry]});
  assert.equal(r.status,500);
  assert.equal((await r.json()).error,'Internal server error');
  assert.equal(logs[0]?.status,500);
  assert.ok(!JSON.stringify(logs).includes('private-db-message'));
  const explodingLogger=createApp(new MemoryStore(),new WorkspaceRateLimiter(50),new InvalidCredentialLimiter(),()=>{throw new Error('logger offline');});
  assert.equal((await send(explodingLogger,{events:[entry]})).status,202);
});

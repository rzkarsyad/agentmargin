import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentMarginClient} from '../src/index.ts';

const apiKey='am_'+'z'.repeat(40);
test('SDK rejects insecure nonlocal HTTP endpoints',()=>{
  assert.throws(()=>new AgentMarginClient({endpoint:'http://example.com',apiKey}),/HTTPS required/);
});
test('SDK posts event JSON with auth header',async()=>{
  let seen=false;
  const client=new AgentMarginClient({endpoint:'http://localhost:8787',apiKey,fetchImpl:async(request,init)=>{
    seen=true;
    assert.equal(String(request),'http://localhost:8787/v1/events');
    assert.equal((init?.headers as Record<string,string>).authorization,`Bearer ${apiKey}`);
    return new Response(JSON.stringify({inserted:1,duplicate:0,received:1}),{status:202});
  }});
  assert.equal((await client.track([{id:'e1',customerId:'c1',model:'m',occurredAt:'2026-10-01T00:00:00Z',inputTokens:1,outputTokens:1}])).inserted,1);
  assert.equal(seen,true);
});

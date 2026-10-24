import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectDemoRequest} from '../../../examples/nextjs-starter/lib/request-guard.ts';
test('starter rejects cross-origin/form/DNS-rebinding before financial side effects',()=>{
 const req=(headers:Record<string,string>,url='http://localhost:3000/api/live')=>new Request(url,{method:'POST',headers,body:'{}'});
 for(const origin of ['https://foreign.invalid','null','http://localhost:3001'])
   assert.equal(rejectDemoRequest(req({'content-type':'application/json',origin}))?.status,403);
 for(const type of ['text/plain','application/x-www-form-urlencoded','multipart/form-data'])
   assert.equal(rejectDemoRequest(req({'content-type':type}))?.status,415);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json','sec-fetch-site':'cross-site'}))?.status,403);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json',origin:'http://rebound.invalid'},'http://rebound.invalid/api/live'))?.status,403);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json',origin:'http://localhost:3000'})),null);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json',host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'})),null);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json',host:'foreign.invalid',origin:'http://foreign.invalid'}))?.status,403);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json'})),null,'Non-browser JSON callers remain compatible');
 assert.equal(rejectDemoRequest(req({'content-type':'application/json',origin:'https://app.example.invalid'},'https://app.example.invalid/api/live'),'https://app.example.invalid'),null);
 assert.equal(rejectDemoRequest(req({'content-type':'application/json'},'https://foreign.invalid/api/live'),'https://app.example.invalid')?.status,403);
});

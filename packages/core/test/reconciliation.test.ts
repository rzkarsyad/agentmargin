import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFinancialRecords,type ReconciliationInput} from '../src/reconciliation.ts';
const fixture=():ReconciliationInput=>({
 scope:{workspaceId:'synthetic-workspace',provider:'synthetic-provider',accountId:'synthetic-account',currency:'USD',kind:'cost',periodStart:'2026-10-01T00:00:00Z',periodEnd:'2026-11-01T00:00:00Z'},
 recordedExportRef:'synthetic:ledger-export:sha256:1',billingExportRef:'synthetic:invoice-export:sha256:2',
 tolerance:{absoluteMicros:'1',basisPoints:0},
 records:[{id:'usage-1',sourceRef:'synthetic:request-1',currency:'USD',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'123456',source:'estimated',pricingRef:'workspace-price-effective-2026-10-01',tokens:{input:100,output:50,cachedInput:20}}],
 billed:[{id:'line-1',sourceRef:'synthetic:invoice-1:line-1',currency:'USD',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'123457',kind:'charge',recordIds:['usage-1'],tokens:{input:100,output:50,cachedInput:20}}],
});
test('exact variances, tolerance and cached token evidence remain traceable',()=>{
 const input=fixture(),report=reconcileFinancialRecords(input);
 assert.equal(report.summary.complete,true);
 assert.equal(report.lines[0]?.varianceMicros,'1');
 assert.equal(report.inputs.records[0]?.pricingRef,input.records[0]?.pricingRef);
 assert.match(report.inputDigest,/^[a-f0-9]{64}$/);
 input.billed[0]!.tokens!.cachedInput=21;
 assert.equal(reconcileFinancialRecords(input).lines[0]?.status,'token_variance');
 assert.notEqual(reconcileFinancialRecords(input).inputDigest,report.inputDigest);
 assert.equal(report.inputs.billed[0]?.tokens?.cachedInput,20,'Report snapshot changed after caller mutation');
});
test('missing events, unknown pricing, unmatched records and credits never disappear',()=>{
 const input=fixture();input.records[0]!.amountMicros=null;input.records[0]!.source='unknown';input.records[0]!.unknownReason='missing_cached_price';
 const unknown=reconcileFinancialRecords(input);
 assert.equal(unknown.summary.varianceMicros,null);assert.equal(unknown.summary.complete,false);
 assert.equal(unknown.lines[0]?.status,'unknown_cost');
 input.billed[0]!.recordIds=['missing-event'];
 const missing=reconcileFinancialRecords(input);
 assert.equal(missing.lines[0]?.status,'missing_records');assert.deepEqual(missing.unmatchedRecordIds,['usage-1']);
 input.billed.push({...input.billed[0]!,id:'credit-1',kind:'credit',amountMicros:'-1000',recordIds:[]});
 const credit=reconcileFinancialRecords(input);
 assert.equal(credit.summary.externalNetMicros,'122457');assert.equal(credit.lines[0]?.status,'unmatched');
});
test('duplicate deliveries deduplicate, conflicting payloads and allocations fail closed',()=>{
 const input=fixture(),first=reconcileFinancialRecords(input);
 input.records.push({...input.records[0]!});input.billed.push({...input.billed[0]!});
 assert.equal(reconcileFinancialRecords(input).inputDigest,first.inputDigest);
 input.billed[1]!.amountMicros='9';
 assert.throws(()=>reconcileFinancialRecords(input),/Conflicting duplicate/);
 const overlap=fixture();overlap.billed.push({...overlap.billed[0]!,id:'other-line'});
 assert.throws(()=>reconcileFinancialRecords(overlap),/Ambiguous/);
});
test('revenue refunds and out-of-order evidence reconcile signed net amounts without FX guesses',()=>{
 const input=fixture();input.scope.kind='revenue';input.scope.provider='stripe';input.billed[0]!.tokens=undefined;input.records[0]!.tokens=undefined;
 input.records.push({...input.records[0]!,id:'refund-1',source:'reported',amountMicros:'-10000'});
 input.billed.push({...input.billed[0]!,id:'refund-line',kind:'credit',amountMicros:'-10000',recordIds:['refund-1']});
 const report=reconcileFinancialRecords(input);
 input.records.reverse();input.billed.reverse();
 assert.deepEqual(reconcileFinancialRecords(input),report);
 assert.equal(report.summary.externalNetMicros,'113457');
 input.billed[0]!.currency='EUR';assert.throws(()=>reconcileFinancialRecords(input),/Currency/);
});
test('large exact values, relative tolerances, exclusive windows and malformed evidence',()=>{
 const input=fixture();input.records[0]!.amountMicros='9000000000000000000';input.billed[0]!.amountMicros='9000000000000000001';input.tolerance={absoluteMicros:'0',basisPoints:1};
 assert.equal(reconcileFinancialRecords(input).lines[0]?.varianceMicros,'1');
 input.records[0]!.occurredAt=input.scope.periodEnd;assert.throws(()=>reconcileFinancialRecords(input),/outside/);
 const cached=fixture();cached.records[0]!.tokens!.cachedInput=101;assert.throws(()=>reconcileFinancialRecords(cached),/cached/);
 const provenance=fixture();delete provenance.records[0]!.pricingRef;assert.throws(()=>reconcileFinancialRecords(provenance),/provenance/);
 const zero=fixture();zero.billed=[];assert.equal(reconcileFinancialRecords(zero).summary.complete,false);
 zero.records=[];assert.equal(reconcileFinancialRecords(zero).summary.complete,false,'Missing evidence cannot imply verified financials');
});

// Exercise report persistence rather than mirroring implementation details.
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('CLI persists complete report bytes and supports replay without overwriting evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'agentmargin-report-'));
 try{
  const input=join(root,'input.json'),out=join(root,'reports');
  writeFileSync(input,JSON.stringify(fixture()));
  const run=()=>execFileSync(process.execPath,['--experimental-strip-types','scripts/reconcile.ts',input,out],{encoding:'utf8'});
  const first=JSON.parse(run());assert.equal(first.kind,'reconciliation_report');
  const report=join(out,first.inputDigest+'.json'),original=readFileSync(report,'utf8');
  const reordered=fixture();reordered.scope=Object.fromEntries(Object.entries(reordered.scope).reverse()) as typeof reordered.scope;
  writeFileSync(input,JSON.stringify(reordered));
  assert.deepEqual(JSON.parse(run()),first);assert.equal(readFileSync(report,'utf8'),original);
  assert.equal(readdirSync(out).length,1);
  writeFileSync(report,'tampered');assert.throws(run);assert.equal(readFileSync(report,'utf8'),'tampered');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('JSON allocation shapes fail closed before iterable coercion or unbounded copying',()=>{
 for(const malformed of ['usage-1',null,{},42]){
  const input=fixture();(input.billed[0] as unknown as {recordIds:unknown}).recordIds=malformed;
  assert.throws(()=>reconcileFinancialRecords(input),/Invalid billing allocation/);
 }
 const over=fixture();over.billed=Array.from({length:3},(_,n)=>({...over.billed[0]!,id:'line-'+n,recordIds:Array.from({length:10000},(_,i)=>'id-'+n+'-'+i)}));
 assert.throws(()=>reconcileFinancialRecords(over),/Too many billing allocations/);
 const negative=fixture();negative.records[0]!.amountMicros='-1';
 assert.throws(()=>reconcileFinancialRecords(negative),/cannot be negative/);
});

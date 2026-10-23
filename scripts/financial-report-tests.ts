import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {readCheckedFile} from './lib/private-files.ts';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {digest} from '../apps/api/src/app.ts';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';
import {reconcileLedgerRevenue} from '../packages/core/src/financial-ledger.ts';
export async function testFinancialReports(pool:pg.Pool,runtimeURL:string){
 const workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
 await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Synthetic financial equations']);
 await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,digest(key),'synthetic-report']);
 const store=new PostgresEventStore(runtimeURL).forCredential(key);
 const start='2026-10-01T00:00:00Z',end='2026-11-01T00:00:00Z';
 try{
  const payment={id:'stripe:invoice:in_equations',customerId:'stripe:cus_equations',occurredAt:'2026-10-10T00:00:00.000Z',amountMicros:'1000000',payloadDigest:'e'.repeat(64)};
  await store.enqueueRevenueDelivery(workspace,{providerEventId:'evt_equations_payment',providerAccount:'acct_equations',record:payment});
  assert.equal((await store.processNextRevenueDelivery(workspace)).inserted,1);
  const adjustments=[['refund','200001'],['credit','100002'],['payment_reversal','99997']].map(([kind,amountMicros])=>parseAdjustment({
    originalPaymentId:payment.id,customerId:payment.customerId,kind,amountMicros,currency:'USD',occurredAt:'2026-10-11T00:00:00Z',provider:'stripe',providerAccount:'acct_equations',sourceObjectId:'source_'+kind,evidenceRef:'synthetic:'+kind}));
  await store.ingestAdjustments(workspace,adjustments);
  await store.ingest(workspace,[{event:{id:'usage-equations',workspaceId:workspace,customerId:payment.customerId,model:'synthetic-model',occurredAt:payment.occurredAt,inputTokens:10,outputTokens:20},payloadDigest:'usage-equations',costMicros:123456n,source:'reported',priceId:null}]);
  const report=await store.financialLedger(workspace,start,end),page=await store.analyticsPage(workspace,start,end,null,1),legacy=await store.analytics(workspace,start,end);
  assert.deepEqual(report.summary,{currency:'USD',grossRevenueMicros:'1000000',refundsMicros:'200001',creditsMicros:'100002',paymentReversalsMicros:'99997',netRevenueMicros:'600000',
    knownInferenceCostMicros:'123456',knownContributionMicros:'476544',completeContributionMicros:'476544',unknownCostEvents:0,unresolvedEvidenceCount:0,complete:true});
  assert.equal(page.summary.totalRevenueMicros,report.summary.netRevenueMicros);
  assert.equal(page.summary.grossRevenueMicros,report.summary.grossRevenueMicros);
  assert.equal(page.summary.completeContributionMicros,report.summary.completeContributionMicros);
  assert.equal(legacy.customers[0]?.revenueMicros,'600000');assert.equal(legacy.customers[0]?.contributionMicros,'476544');
  assert.equal((await store.financialLedger(randomUUID(),start,end)).inputs.payments.length,0,'Cross-tenant report leaked payments');
  const billing={scope:{workspaceId:workspace,provider:'stripe',accountId:'acct_equations',currency:'USD',kind:'revenue' as const,periodStart:start,periodEnd:end},billingExportRef:'sha256:synthetic:export',tolerance:{absoluteMicros:'0',basisPoints:0},
    billed:[{id:'paid',sourceRef:'synthetic:payment',currency:'USD',occurredAt:payment.occurredAt,amountMicros:payment.amountMicros,kind:'charge' as const,recordIds:['payment:'+payment.id]},
      ...adjustments.map(a=>({id:a.id,sourceRef:a.evidenceRef,currency:'USD',occurredAt:a.occurredAt,amountMicros:(-BigInt(a.amountMicros)).toString(),kind:'credit' as const,recordIds:['adjustment:'+a.id]}))]};
  const reconciled=reconcileLedgerRevenue(report.inputs,billing);
  assert.equal(reconciled.reconciliation.summary.complete,true);assert.equal(reconciled.reconciliation.summary.varianceMicros,'0');
  const directory=mkdtempSync(join(tmpdir(),'agentmargin-ledger-export-'));
  try{
    const output=join(directory,'ledger.json'),input=join(directory,'reconcile.json'),reports=join(directory,'reports');
    const exported=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','scripts/export-financial-ledger.ts',start,end,output],
      {encoding:'utf8',env:{...process.env,DATABASE_URL:runtimeURL,AGENTMARGIN_API_KEY:key}}));
    assert.equal(exported.inputDigest,report.inputDigest);assert.equal(readCheckedFile(output,{privateFile:true}).mode&0o077,0);
    assert.deepEqual(JSON.parse(readCheckedFile(output,{privateFile:true}).contents),report);
    writeFileSync(input,JSON.stringify({ledger:report.inputs,billing}));
    const run=()=>execFileSync(process.execPath,['--experimental-strip-types','scripts/reconcile.ts',input,reports],{encoding:'utf8'});
    const first=JSON.parse(run());assert.equal(first.complete,true);
    writeFileSync(input,JSON.stringify({ledger:{...report.inputs,adjustments:[...report.inputs.adjustments].reverse()},billing:{...billing,billed:[...billing.billed].reverse()}}));
    assert.deepEqual(JSON.parse(run()),first,'Ledger report replay changed after evidence ordering');
  }finally{rmSync(directory,{recursive:true,force:true});}

  // Later reductions belong to their effective period, even with an older payment.
  await store.ingestAdjustments(workspace,[parseAdjustment({...adjustments[0]!,sourceObjectId:'source_later',amountMicros:'1',occurredAt:'2026-11-02T00:00:00Z'})]);
  const later=await store.analyticsPage(workspace,end,'2026-12-01T00:00:00Z',null,1);
  assert.equal(later.summary.grossRevenueMicros,'0');assert.equal(later.summary.totalRevenueMicros,'-1');assert.equal(later.customers[0]?.marginBasisPoints,null);
  await store.ingest(workspace,[{event:{id:'unknown-equations',workspaceId:workspace,customerId:payment.customerId,model:'unknown-tier',occurredAt:payment.occurredAt,inputTokens:1,outputTokens:1},payloadDigest:'unknown',costMicros:null,source:'unknown',priceId:null}]);
  assert.equal((await store.financialLedger(workspace,start,end)).summary.completeContributionMicros,null);
  process.stdout.write('Financial reporting: exact gross/reductions/net/cost/contribution, signed reconciliation, period attribution, unknown costs and tenant isolation PASSED.\n');
 }finally{await store.pool.end();}
}

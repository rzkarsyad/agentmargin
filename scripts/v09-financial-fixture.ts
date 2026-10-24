/** Synthetic $128 / $117.25 / $10.75 acceptance fixture. Not Stripe evidence. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import type pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp,digest} from '../apps/api/src/app.ts';
import {AgentMarginClient,stripeEventToFinancialDelivery} from '../packages/sdk/src/index.ts';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';
import {reconcileLedgerRevenue} from '../packages/core/src/financial-ledger.ts';
export async function testV09FinancialFixture(pool:pg.Pool,runtimeURL:string){
 const workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url'),now=Math.floor(Date.now()/1000),account='acct_qa_fixture';
 await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Synthetic v0.9 acceptance']);
 await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,digest(key),'synthetic-QA']);
 const store=new PostgresEventStore(runtimeURL).forCredential(key),app=createApp(store);
 const client=new AgentMarginClient({endpoint:'http://127.0.0.1:8787',apiKey:key,fetchImpl:async(input,init)=>app.request(String(input),init)});
 const secret='whsec_synthetic_v09_fixture',customer='cus_v09_fixture';
 const links={re_625:{originalPaymentId:'stripe:invoice:in_29',customerId:'stripe:'+customer},re_9900:{originalPaymentId:'stripe:invoice:in_99',customerId:'stripe:'+customer}};
 const objects=[{id:'re_625',amount:625},{id:'re_9900',amount:9900}].map(r=>({...r,created:now-5,currency:'usd',status:'succeeded'}));
 const credit={id:'cn_1200',invoice:'in_29',customer,created:now-3,currency:'usd',status:'issued',type:'post_payment',amount:1200,
   pre_payment_amount:0,post_payment_amount:1200,out_of_band_amount:0,refunds:[],customer_balance_transaction:'cbtxn_1200'};
 const normalize=(id:string,type:string,object:unknown)=>{
   const raw=JSON.stringify({id,type,created:now,livemode:false,api_version:'2026-09-30.endive',data:{object}});
   const signature='t='+now+',v1='+createHmac('sha256',secret).update(now+'.'+raw).digest('hex');
   return stripeEventToFinancialDelivery(raw,signature,secret,now,{expectedLivemode:false,platformAccount:account,refundLinks:links});
 };
 const reductions=[normalize('evt_625','refund.created',objects[0]),normalize('evt_9900','refund.created',objects[1]),normalize('evt_1200','credit_note.created',credit)];
 const payments=[29,99].map(n=>normalize('evt_paid'+n,'invoice.paid',{id:'in_'+n,customer,currency:'usd',status:'paid',amount_paid:n*100,status_transitions:{paid_at:now-10}}));
 try{
   for(const d of reductions){assert.equal(d?.kind,'adjustment');if(d?.kind==='adjustment')await client.enqueueAdjustmentDelivery(d);}
   assert.equal((await store.processNextAdjustmentDelivery(workspace)).state,'retry');
   for(const d of payments){assert.equal(d?.kind,'payment');if(d?.kind==='payment')await client.enqueueRevenueDelivery(d);}
   while((await store.processNextRevenueDelivery(workspace)).state!=='empty'){}
   await pool.query('UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1',[workspace]);
   while((await store.processNextAdjustmentDelivery(workspace)).state!=='empty'){}
   // Retry both the same event and a new event for the same economic refund.
   const duplicate=normalize('evt_625_again','refund.updated',objects[0]);
   if(duplicate?.kind==='adjustment'){await client.enqueueAdjustmentDelivery(duplicate);assert.equal((await store.processNextAdjustmentDelivery(workspace)).duplicate,1);}
   await client.track([{id:'qa-known',customerId:'stripe:'+customer,model:'synthetic',occurredAt:new Date(now*1000).toISOString(),inputTokens:1,outputTokens:1,reportedCostMicros:'1250000'}]);
   const start=new Date((now-86400)*1000).toISOString(),end=new Date((now+86400)*1000).toISOString();
   const ledger=await store.financialLedger(workspace,start,end),page=await store.analyticsPage(workspace,start,end,null,100);
   assert.equal(ledger.summary.grossRevenueMicros,'128000000');assert.equal(ledger.summary.refundsMicros,'105250000');
   assert.equal(ledger.summary.creditsMicros,'12000000');assert.equal(ledger.summary.netRevenueMicros,'10750000');
   assert.equal(ledger.summary.completeContributionMicros,'9500000');assert.equal(page.summary.totalRevenueMicros,'10750000');
   const api=await app.request('/v1/analytics/page?start='+encodeURIComponent(start)+'&end='+encodeURIComponent(end),{headers:{authorization:'Bearer '+key}});
   assert.equal(api.status,200);assert.equal((await api.json() as any).summary.totalRevenueMicros,'10750000');
   const billed=[...payments.filter(d=>d?.kind==='payment').map(d=>({id:d!.record.id,sourceRef:'synthetic:'+d!.providerEventId,currency:'USD',occurredAt:d!.record.occurredAt,amountMicros:d!.record.amountMicros,kind:'charge' as const,recordIds:['payment:'+d!.record.id]})),
     ...reductions.filter(d=>d?.kind==='adjustment').map(d=>{const a=parseAdjustment(d!.record);return {id:a.id,sourceRef:a.evidenceRef,currency:'USD',occurredAt:a.occurredAt,amountMicros:(-BigInt(a.amountMicros)).toString(),kind:'credit' as const,recordIds:['adjustment:'+a.id]};})];
   const report=reconcileLedgerRevenue(ledger.inputs,{scope:{workspaceId:workspace,provider:'stripe',accountId:account,currency:'USD',kind:'revenue',periodStart:start,periodEnd:end},billingExportRef:'synthetic:128-fixture',tolerance:{absoluteMicros:'0',basisPoints:0},billed});
   assert.equal(report.reconciliation.summary.varianceMicros,'0');
   await client.track([{id:'qa-unknown',customerId:'stripe:'+customer,model:'unpriced-qa',occurredAt:new Date(now*1000).toISOString(),inputTokens:1,outputTokens:1}]);
   assert.equal((await store.analyticsPage(workspace,start,end,null,100)).summary.completeContributionMicros,null);
   process.stdout.write('Synthetic v0.9 fixture: gross 128000000, reductions 117250000, net 10750000; API/ledger/reconciliation, replay and unknown pricing PASSED.\n');
   return {workspace,key};
 }finally{await store.pool.end();}
}

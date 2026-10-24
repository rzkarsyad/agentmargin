/** Disposable PostgreSQL regression: reproduce 014, then apply additive 015. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp} from '../apps/api/src/app.ts';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';

export async function testPaymentBinding(pool:pg.Pool,runtime:PostgresEventStore,workspace:string,key:string){
 const writer=runtime.forCredential(key),api=createApp(runtime);
 const payment={id:'binding-payment',customerId:'binding-customer',occurredAt:'2026-10-10T00:00:00.000Z',amountMicros:'1000000',payloadDigest:'a'.repeat(64)};
 await writer.enqueueRevenueDelivery(workspace,{providerEventId:'evt_binding_payment',providerAccount:'acct_original',record:payment});
 assert.equal((await writer.processNextRevenueDelivery(workspace)).state,'delivered');
 const record={originalPaymentId:payment.id,customerId:payment.customerId,kind:'refund',currency:'USD',amountMicros:'1',occurredAt:'2026-10-11T00:00:00Z',provider:'manual',providerAccount:'acct_wrong',sourceObjectId:'baseline_sql',evidenceRef:'synthetic:binding'};
 const send=(r:unknown)=>api.request('/v1/revenue/adjustments',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({records:[r]})});
 const direct=async(r:unknown)=>{
   const a=parseAdjustment(r),c=await writer.pool.connect();
   try{
     await c.query('BEGIN');await c.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
     await c.query(`INSERT INTO revenue_adjustments(workspace_id,id,original_payment_id,customer_id,kind,amount_micros,currency,occurred_at,provider,provider_account,source_object_id,evidence_ref,payload_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[workspace,a.id,a.originalPaymentId,a.customerId,a.kind,a.amountMicros,a.currency,a.occurredAt,a.provider,a.providerAccount,a.sourceObjectId,a.evidenceRef,a.payloadDigest]);
     await c.query('COMMIT');
   }finally{await c.query('ROLLBACK');c.release();}
 };
 // These deliberately invalid synthetic baseline rows are preserved by 015.
 // A migration must not silently rewrite existing immutable accounting evidence.
 await direct(record);
 assert.equal((await send({...record,sourceObjectId:'baseline_http'})).status,202);
 const migration=readFileSync(new URL('../db/015_original_payment_binding.sql',import.meta.url),'utf8');
 const c=await pool.connect();
 try{
   await assert.rejects(c.query(migration.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
   await c.query('ROLLBACK');
   assert.match((await c.query("SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='agentmargin_auth.validate_stripe_adjustment_source()'::regprocedure")).rows[0].prosrc,/NEW.provider<>'stripe' THEN RETURN NEW/);
   await c.query(migration);
 }finally{c.release();}
 for(const provider of ['manual','stripe_','other'])for(const providerAccount of ['acct_original','acct_wrong']){
   const r={...record,provider,providerAccount,sourceObjectId:'deny_'+provider+'_'+providerAccount};
   assert.equal((await send(r)).status,409,'HTTP must bind to the original payment provider');
   await assert.rejects(direct(r),(e:unknown)=>(e as {code?:string}).code==='23514');
 }
 await assert.rejects(direct({...record,provider:'stripe',sourceObjectId:'stripe_wrong'}),(e:unknown)=>(e as {code?:string}).code==='23514');
 const valid={...record,provider:'stripe',providerAccount:'acct_original',sourceObjectId:'stripe_valid'};
 assert.equal((await send(valid)).status,202);
 const replay=await send(valid);assert.equal(replay.status,202);assert.equal((await replay.json() as {duplicate:number}).duplicate,1);
 await assert.rejects(direct({...valid,providerAccount:'acct_other',sourceObjectId:'other_account'}),(e:unknown)=>(e as {code?:string}).code==='23514');
 await writer.ingestRevenue(workspace,[{...payment,id:'unbound-payment',payloadDigest:'b'.repeat(64)}]);
 assert.equal((await send({...record,originalPaymentId:'unbound-payment',sourceObjectId:'legitimate_manual'})).status,202);
 assert.equal((await send({...valid,originalPaymentId:'unbound-payment',sourceObjectId:'unproven_stripe'})).status,409);
 // The inverse order must also fail: source evidence cannot be attached later
 // to legit generic history and silently relabel that history as Stripe-backed.
 await writer.enqueueRevenueDelivery(workspace,{providerEventId:'evt_late_binding',providerAccount:'acct_original',record:{...payment,id:'unbound-payment',payloadDigest:'b'.repeat(64)}});
 assert.equal((await writer.processNextRevenueDelivery(workspace)).state,'failed');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM revenue_payment_sources WHERE workspace_id=$1 AND record_id='unbound-payment'",[workspace])).rows[0].n,0);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM revenue_adjustments WHERE workspace_id=$1 AND source_object_id LIKE 'baseline_%'",[workspace])).rows[0].n,2);
 process.stdout.write('AM-01: baseline HTTP/SQL bypass reproduced; 015 rollback/upgrade, provider/account negatives, replay and generic compatibility PASSED.\n');
}

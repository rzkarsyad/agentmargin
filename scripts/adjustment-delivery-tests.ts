/** Adversarial real PostgreSQL fixtures, called only by the disposable CI suite. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp} from '../apps/api/src/app.ts';
export async function testAdjustmentDeliveries(pool:pg.Pool,runtime:PostgresEventStore,runtimeURL:string,workspace:string,other:string,ingestKey:string,readKey:string){
 const writer=runtime.forCredential(ingestKey);
 const payment={id:'stripe:invoice:in_adjust_delivery',customerId:'stripe:cus_adjust_delivery',
   occurredAt:'2026-10-10T00:00:00.000Z',amountMicros:'1000000',payloadDigest:'d'.repeat(64)};
 const record=parseAdjustment({originalPaymentId:payment.id,customerId:payment.customerId,kind:'refund',currency:'USD',
   amountMicros:'100000',occurredAt:'2026-10-11T00:00:00Z',provider:'stripe',providerAccount:'acct_delivery',
   sourceObjectId:'re_delivery',evidenceRef:'stripe:refund:re_delivery'});
 const delivery={providerEventId:'evt_adjustment_before_payment',providerAccount:'acct_delivery',record};
 assert.equal((await writer.enqueueAdjustmentDelivery(workspace,delivery)).state,'pending');
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'retry');
 assert.equal((await writer.adjustmentDeliveryStatus(workspace)).unmatched,'1');
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'empty','Missing payment retry ignored backoff');
 await writer.enqueueRevenueDelivery(workspace,{providerEventId:'evt_adjustment_payment',providerAccount:'acct_delivery',record:payment});
 assert.equal((await writer.processNextRevenueDelivery(workspace)).state,'delivered');
 await pool.query("UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1",[workspace]);
 // Held row claims simulate a crashed worker; no lease survives rollback.
 const claim=await writer.pool.connect();
 const worker=new PostgresEventStore(runtimeURL).forCredential(ingestKey);
 try{
  await claim.query('BEGIN');await claim.query("SELECT set_config('agentmargin.api_key',$1,true)",[ingestKey]);
  await claim.query('SELECT * FROM adjustment_deliveries WHERE workspace_id=$1 FOR UPDATE',[workspace]);
  assert.equal((await worker.processNextAdjustmentDelivery(workspace)).state,'empty');
  await claim.query('ROLLBACK');
 }finally{claim.release();}
 try{
  await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_second_delivery'});
  const results=await Promise.all([writer.processNextAdjustmentDelivery(workspace),worker.processNextAdjustmentDelivery(workspace)]);
  assert.equal(results.filter(r=>r.state==='delivered').length,2);
  assert.equal(results.reduce((n,r)=>n+(r.inserted??0),0),1);assert.equal(results.reduce((n,r)=>n+(r.duplicate??0),0),1);
 }finally{await worker.pool.end();}
 assert.deepEqual(await writer.enqueueAdjustmentDelivery(workspace,delivery),{duplicate:true,state:'delivered'});
 await assert.rejects(writer.enqueueAdjustmentDelivery(workspace,{...delivery,record:parseAdjustment({...record,amountMicros:'2'})}),/Idempotency conflict/);
 await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_conflict',record:parseAdjustment({...record,amountMicros:'2'})});
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'failed');
 await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_wrong_account',providerAccount:'acct_wrong',
   record:parseAdjustment({...record,providerAccount:'acct_wrong',sourceObjectId:'re_wrong_account'})});
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'failed');
 // Distinct partial credit and reversal are incremental, not cumulative amounts.
 for(const [kind,source] of [['credit','cn_partial'],['payment_reversal','dp_partial']] as const){
  await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_'+source,
    record:parseAdjustment({...record,kind,sourceObjectId:source})});
  assert.equal((await writer.processNextAdjustmentDelivery(workspace)).inserted,1);
 }
 assert.equal((await pool.query('SELECT sum(amount_micros)::text AS n FROM revenue_adjustments WHERE workspace_id=$1 AND original_payment_id=$2',[workspace,payment.id])).rows[0].n,'300000');
 await assert.rejects(writer.enqueueAdjustmentDelivery(other,delivery),(e:unknown)=>(e as {code?:string}).code==='42501');
 await assert.rejects(runtime.forCredential(readKey).enqueueAdjustmentDelivery(workspace,delivery),(e:unknown)=>(e as {code?:string}).code==='42501');
 await assert.rejects(writer.pool.query("UPDATE adjustment_deliveries SET record='{}'::jsonb"),(e:unknown)=>(e as {code?:string}).code==='42501');
 assert.equal((await writer.pool.query('SELECT * FROM adjustment_deliveries')).rowCount,0);
 await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_never_matched',
   record:parseAdjustment({...record,sourceObjectId:'re_never_matched',originalPaymentId:'missing-payment'})});
 for(let attempt=1;attempt<=8;attempt++){
  assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,attempt===8?'failed':'retry');
  const row=(await pool.query("SELECT attempts,error_class FROM adjustment_deliveries WHERE provider_event_id='evt_adjustment_never_matched'")).rows[0];
  assert.equal(row.attempts,attempt);assert.equal(row.error_class,'unmatched_payment');
  if(attempt<8)await pool.query("UPDATE adjustment_deliveries SET available_at=now() WHERE provider_event_id='evt_adjustment_never_matched'");
 }
 // A failure after INSERT but before inbox completion must leave no ledger row.
 await pool.query(`CREATE FUNCTION adjustment_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF NEW.provider_event_id='evt_adjustment_crash' AND NEW.state='delivered' THEN
     RAISE EXCEPTION 'synthetic interruption' USING ERRCODE='40001'; END IF; RETURN NEW; END$$;
   CREATE TRIGGER adjustment_test_failure BEFORE UPDATE ON adjustment_deliveries FOR EACH ROW EXECUTE FUNCTION adjustment_test_failure()`);
 const crashRecord=parseAdjustment({...record,sourceObjectId:'re_crash'});
 try{
  await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_crash',record:crashRecord});
  await assert.rejects(writer.processNextAdjustmentDelivery(workspace),(e:unknown)=>(e as {code?:string}).code==='40001');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM revenue_adjustments WHERE id=$1',[crashRecord.id])).rows[0].n,0);
  assert.equal((await pool.query("SELECT attempts FROM adjustment_deliveries WHERE provider_event_id='evt_adjustment_crash'")).rows[0].attempts,0);
 }finally{await pool.query('DROP TRIGGER adjustment_test_failure ON adjustment_deliveries; DROP FUNCTION adjustment_test_failure()');}
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).inserted,1);
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'empty');
 const scopeRecord=parseAdjustment({...record,sourceObjectId:'re_scope_change'});
 await writer.enqueueAdjustmentDelivery(workspace,{...delivery,providerEventId:'evt_adjustment_scope_change',record:scopeRecord});
 await pool.query(`CREATE FUNCTION adjustment_scope_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
   IF NEW.source_object_id='re_scope_change' THEN UPDATE public.workspace_api_keys SET access_role='read'
     WHERE key_digest=encode(sha256(convert_to(current_setting('agentmargin.api_key'),'UTF8')),'hex'); END IF; RETURN NEW; END$$;
   CREATE TRIGGER adjustment_scope_change AFTER INSERT ON revenue_adjustments FOR EACH ROW EXECUTE FUNCTION adjustment_scope_change()`);
 try{
  await assert.rejects(writer.processNextAdjustmentDelivery(workspace),/Delivery authorization changed/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM revenue_adjustments WHERE id=$1',[scopeRecord.id])).rows[0].n,0);
  assert.equal((await writer.authenticate('ignored'))?.accessRole,'ingest','Scope mutation escaped rollback');
 }finally{await pool.query('DROP TRIGGER adjustment_scope_change ON revenue_adjustments; DROP FUNCTION adjustment_scope_change()');}
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).inserted,1);
 const api=createApp(runtime);
 const response=await api.request('/v1/revenue/adjustments/deliveries',{method:'POST',headers:{authorization:'Bearer '+ingestKey,'content-type':'application/json'},body:JSON.stringify(delivery)});
 assert.equal(response.status,202);
 process.stdout.write('Adjustment delivery: out-of-order, atomic crash/replay, concurrent duplicates, partials, account/RLS boundaries and bounded unmatched retries PASSED.\n');
}

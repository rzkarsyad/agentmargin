import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';

export async function testDeliveryRecovery(pool:pg.Pool,runtime:PostgresEventStore,workspace:string,other:string,
 adminKey:string,ingestKey:string,readKey:string){
 const record=parseAdjustment({originalPaymentId:'recovery_missing',customerId:'recovery_customer',kind:'refund',
   currency:'USD',amountMicros:'10000',occurredAt:'2026-10-11T00:00:00Z',provider:'stripe',providerAccount:'acct_recovery',
   sourceObjectId:'re_recovery',evidenceRef:'stripe:refund:re_recovery'});
 const writer=runtime.forCredential(ingestKey),event='evt_reviewed_recovery',request=randomUUID();
 await writer.enqueueAdjustmentDelivery(workspace,{providerEventId:event,providerAccount:'acct_recovery',record});
 const history=async()=> (await pool.query('SELECT * FROM delivery_history WHERE workspace_id=$1 AND provider_event_id=$2 ORDER BY recorded_at,id',[workspace,event])).rows;
 assert.equal((await history()).length,1);
 for(let attempt=1;attempt<=8;attempt++){
   assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,attempt===8?'failed':'retry');
   if(attempt<8)await pool.query('UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1 AND provider_event_id=$2',[workspace,event]);
 }
 assert.deepEqual((await history()).map(r=>r.attempts),[0,1,2,3,4,5,6,7,8]);
 for(const key of [ingestKey,adminKey]){
   const direct=await runtime.pool.connect();
   try{
     await direct.query('BEGIN');await direct.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
     await assert.rejects(direct.query("UPDATE adjustment_deliveries SET state='pending',attempts=0,error_class=NULL WHERE workspace_id=$1 AND provider_event_id=$2",[workspace,event]),(e:unknown)=>(e as {code?:string}).code==='42501');
   }finally{await direct.query('ROLLBACK');direct.release();}
 }
 const recover=async(key:string,tenant=workspace,id=request,review='incident:synthetic-qa',hash=record.payloadDigest)=>{
   const c=await runtime.pool.connect();
   try{
     await c.query('BEGIN');await c.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
     const q=await c.query('SELECT agentmargin_auth.requeue_delivery($1,$2,$3,$4,$5,$6) AS cycle',
       [tenant,'adjustment',event,hash,review,id]);
     await c.query('COMMIT');return q.rows[0].cycle as number;
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 };
 for(const key of ['',readKey,ingestKey])await assert.rejects(recover(key),(e:unknown)=>(e as {code?:string}).code==='42501');
 await assert.rejects(recover(adminKey,other),(e:unknown)=>(e as {code?:string}).code==='42501');
 await assert.rejects(recover(adminKey,workspace,request,'incident:synthetic-qa','0'.repeat(64)),/not eligible/);
 assert.deepEqual(await Promise.all([recover(adminKey),recover(adminKey)]),[1,1]);
 await assert.rejects(recover(adminKey,workspace,request,'incident:different'),/request conflict/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM delivery_requeues WHERE workspace_id=$1 AND request_id=$2',[workspace,request])).rows[0].n,1);
 assert.equal((await history()).at(-1).operation,'requeue');
 assert.equal((await writer.processNextAdjustmentDelivery(workspace)).state,'retry');
 assert.equal(await recover(adminKey),1,'Receipt replay must not reset a subsequently attempted job');
 assert.equal((await pool.query('SELECT attempts FROM adjustment_deliveries WHERE workspace_id=$1 AND provider_event_id=$2',[workspace,event])).rows[0].attempts,1);
 // A rolled-back transition also rolls back its audit record. Aborted transactions
 // cannot be durably logged in that same PostgreSQL transaction.
 const before=(await history()).length,c=await pool.connect();
 try{
   await c.query('BEGIN');await c.query("UPDATE adjustment_deliveries SET state='failed',error_class='invalid_record' WHERE workspace_id=$1 AND provider_event_id=$2",[workspace,event]);
   await c.query('ROLLBACK');assert.equal((await history()).length,before);
 }finally{c.release();}
 for(const table of ['delivery_history','delivery_requeues']){
   await assert.rejects(runtime.pool.query('INSERT INTO '+table+' DEFAULT VALUES'),(e:unknown)=>(e as {code?:string}).code==='42501');
   await assert.rejects(pool.query('DELETE FROM '+table),/append-only/);
   assert.equal((await runtime.pool.query('SELECT * FROM '+table)).rowCount,0);
 }
 // Permanent evidence conflicts cannot be requeued. No payload is editable.
 await pool.query("UPDATE adjustment_deliveries SET state='failed',error_class='idempotency_conflict' WHERE workspace_id=$1 AND provider_event_id=$2",[workspace,event]);
 await assert.rejects(recover(adminKey,workspace,randomUUID()),/not eligible/);
 await pool.query("UPDATE adjustment_deliveries SET error_class='unmatched_payment',retry_cycle=3 WHERE workspace_id=$1 AND provider_event_id=$2",[workspace,event]);
 await assert.rejects(recover(adminKey,workspace,randomUUID()),/not eligible/);
 process.stdout.write('Immutable delivery history and reviewed recovery: scopes, concurrency, bounded cycles, conflicting replay and rollback PASSED.\n');
}

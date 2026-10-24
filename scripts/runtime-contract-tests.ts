import assert from 'node:assert/strict';
import type pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';

export async function testRuntimeContract(pool:pg.Pool,runtime:PostgresEventStore,url:string,workspace:string,key:string){
 const role=new URL(url).username;
 assert.equal((await pool.query("SELECT has_database_privilege($1,current_database(),'TEMP') AS allowed",[role])).rows[0].allowed,false);
 const policies=(await pool.query("SELECT pg_get_expr(polqual,polrelid) AS expr FROM pg_catalog.pg_policy WHERE polrelid='usage_events'::regclass AND polname='tenant_read'")).rows[0];
 await pool.query('ALTER POLICY tenant_read ON usage_events USING (true)');
 try{assert.equal(await runtime.ready(),false,'A weakened existing policy must fail readiness');}
 finally{await pool.query('ALTER POLICY tenant_read ON usage_events USING ('+policies.expr+')');}
 const baseline=(await pool.query("SELECT digest FROM agentmargin_auth.security_contract WHERE kind='policy' AND identity='public.usage_events.tenant_read'")).rows[0].digest;
 await pool.query('ALTER POLICY tenant_read ON usage_events USING (true)');
 await pool.query("UPDATE agentmargin_auth.security_contract SET digest=(SELECT digest FROM agentmargin_auth.installed_contract() WHERE kind='policy' AND identity='public.usage_events.tenant_read') WHERE kind='policy' AND identity='public.usage_events.tenant_read'");
 try{assert.equal(await runtime.ready(),false,'Capturing pre-existing weak policy state must not bless it');}
 finally{
   await pool.query('ALTER POLICY tenant_read ON usage_events USING ('+policies.expr+')');
   await pool.query("UPDATE agentmargin_auth.security_contract SET digest=$1 WHERE kind='policy' AND identity='public.usage_events.tenant_read'",[baseline]);
 }
 for(const [grant,revoke] of [
   ['GRANT SELECT ON workspace_api_keys TO','REVOKE SELECT ON workspace_api_keys FROM'],
   ['GRANT UPDATE ON revenue_records TO','REVOKE UPDATE ON revenue_records FROM'],
   ['GRANT INSERT(state) ON revenue_deliveries TO','REVOKE INSERT(state) ON revenue_deliveries FROM'],
 ]){
   await pool.query(grant+' "'+role+'"');
   try{assert.equal(await runtime.ready(),false,'Unsafe effective grants must fail readiness');}
   finally{await pool.query(revoke+' "'+role+'"');}
 }
 const def=(await pool.query("SELECT pg_get_functiondef('agentmargin_auth.principal(text)'::regprocedure) AS sql")).rows[0].sql;
 await pool.query("ALTER FUNCTION agentmargin_auth.principal(text) SET search_path=pg_catalog");
 try{assert.equal(await runtime.ready(),false);}finally{await pool.query(def);}
 await pool.query(def.replace('k.revoked_at IS NULL','true'));
 try{assert.equal(await runtime.ready(),false,'Function body drift must fail readiness');}finally{await pool.query(def);}
 assert.equal(await runtime.ready(),true);
 for(const [setting,value,safe] of [['auto_explain.log_min_duration','0','-1'],['auto_explain.log_parameter_max_length','20','0'],['pgaudit.log_parameter','on','off'],
   ['debug_print_parse','on','off'],['debug_print_rewritten','on','off'],['debug_print_plan','on','off']]){
   await runtime.pool.query('SET '+setting+'='+value);
   try{
     assert.equal(await runtime.ready(),false);
     await assert.rejects(runtime.forCredential(key).authenticate('ignored'),/Unsafe database session configuration/);
   }finally{await runtime.pool.query('SET '+setting+'='+safe);}
 }
 const c=await runtime.pool.connect();
 try{
   await c.query('SET log_parameter_max_length_on_error=-1');
 }finally{c.release();}
 try{
   assert.equal(await runtime.ready(),false);
   await assert.rejects(runtime.forCredential(key).authenticate('ignored'),/Unsafe database session configuration/);
 }finally{await runtime.pool.query('SET log_parameter_max_length_on_error=0');}
 // Per-database role configuration wins over role defaults. A fresh connection
 // must detect this rather than relying on provisioning defaults alone.
 await pool.query('ALTER ROLE "'+role+'" IN DATABASE agentmargin_ci SET log_parameter_max_length=-1');
 const unsafe=new PostgresEventStore(url);
 try{
   assert.equal(await unsafe.ready(),false);
   await assert.rejects(unsafe.forCredential(key).authenticate('ignored'),/Unsafe database session configuration/);
 }finally{await unsafe.pool.end();await pool.query('ALTER ROLE "'+role+'" IN DATABASE agentmargin_ci RESET log_parameter_max_length');}
 const client=await runtime.pool.connect();
 try{
   await assert.rejects(client.query('CREATE TEMP TABLE forbidden_temp(id int)'),(e:unknown)=>(e as {code?:string}).code==='42501');
   for(const column of ['state','attempts','retry_cycle','error_class']){
     await assert.rejects(client.query(`INSERT INTO revenue_deliveries(workspace_id,provider_event_id,provider_account,record_id,customer_id,occurred_at,amount_micros,payload_digest,${column})
       VALUES($1,'evt_terminal','acct_terminal','missing','missing','2026-10-10Z',1,$2,$3)`,[workspace,'a'.repeat(64),column==='state'?'failed':column==='error_class'?'invalid_record':1]),(e:unknown)=>(e as {code?:string}).code==='42501');
   }
   await client.query('BEGIN');await client.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
   await client.query("INSERT INTO revenue_deliveries(workspace_id,provider_event_id,provider_account,record_id,customer_id,occurred_at,amount_micros,payload_digest) VALUES($1,'evt_fake_complete','acct_terminal','missing','missing','2026-10-10Z',1,$2)",[workspace,'a'.repeat(64)]);
   await assert.rejects(client.query("UPDATE revenue_deliveries SET state='delivered',attempts=1,delivered_at=now(),available_at=statement_timestamp()+interval '2 seconds' WHERE provider_event_id='evt_fake_complete'"),/Delivered payment evidence missing/);
 }finally{await client.query('ROLLBACK');client.release();}
 process.stdout.write('Runtime contract: policy/body/grant/log inheritance drift, TEMP and false completion denial PASSED.\n');
}

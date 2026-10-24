import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
/** Reproduce a real pre-013 cross-tenant existence/allowance error oracle, then
 * prove the SAME temporary catalogs cannot bypass the authorization guard. */
export async function testDefinerCatalogShadow(pool:pg.Pool,url:string){
 const role='agentmargin_ci_shadow_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
 const tenant=randomUUID(),victim=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
 await pool.query(`CREATE ROLE "${role}" LOGIN NOINHERIT PASSWORD '${password}'`);
 const runtimeURL=new URL(url);runtimeURL.username=role;runtimeURL.password=password;
 const client=new pg.Client(runtimeURL.toString());
 try{
   const grants=readFileSync(new URL('../db/runtime_privileges.psql',import.meta.url),'utf8')
     .replaceAll(':"runtime_role"','"'+role+'"').replaceAll(":'runtime_role'","'"+role+"'");
   await pool.query(grants);
   await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2),($3,$4)',[tenant,'Catalog attacker',victim,'Catalog victim']);
   await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role) VALUES($1,$2,$3,$4,$5)',
     [randomUUID(),tenant,createHash('sha256').update(key).digest('hex'),'shadow-test','ingest']);
   await pool.query("INSERT INTO customers(workspace_id,id) VALUES($1,'hidden')",[victim]);
   await pool.query("INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros) VALUES($1,'hidden-payment','hidden','2026-10-10Z',1)",[victim]);
   // Explicitly grant TEMP solely to reproduce the historical pre-013 condition.
   // Final provisioning revokes and guards it; this is never a production grant.
   await pool.query('GRANT TEMP ON DATABASE agentmargin_ci TO "'+role+'"');
   await client.connect();
   await client.query('CREATE TEMP TABLE pg_roles(oid oid,rolname name); CREATE TEMP TABLE pg_class(oid oid,relowner oid)');
   await client.query('INSERT INTO pg_roles SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname=session_user');
   await client.query("INSERT INTO pg_class SELECT 'public.revenue_adjustments'::regclass,oid FROM pg_catalog.pg_roles WHERE rolname=session_user");
   const source='shadow_probe',providerAccount='synthetic',id='adj:'+createHash('sha256').update('import\n'+providerAccount+'\n'+source).digest('hex');
   const probe=async()=>{
     await client.query('BEGIN');
     try{
       await client.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
       await client.query(`INSERT INTO revenue_adjustments(workspace_id,id,original_payment_id,customer_id,kind,amount_micros,currency,occurred_at,provider,provider_account,source_object_id,evidence_ref,payload_digest)
         VALUES($1,$2,'hidden-payment','hidden','refund',2,'USD','2026-10-11Z','import',$3,$4,'synthetic:probe',$5)`,[victim,id,providerAccount,source,'a'.repeat(64)]);
       throw new Error('Unexpected forged insertion');
     }catch(e){return {code:(e as {code?:string}).code,message:(e as Error).message};}
     finally{await client.query('ROLLBACK');}
   };
   assert.deepEqual(await probe(),{code:'23514',message:'Adjustment exceeds original payment'},'Baseline must reproduce privileged hidden-payment probe');
   const sql=readFileSync(new URL('../db/013_definer_catalog_path.sql',import.meta.url),'utf8');
   const migration=await pool.connect();
   try{
     await assert.rejects(migration.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
     await migration.query('ROLLBACK');await migration.query(sql);
   }finally{migration.release();}
   assert.deepEqual(await probe(),{code:'42501',message:'Adjustment authorization denied'});
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM revenue_adjustments WHERE workspace_id=$1",[victim])).rows[0].n,0);
   process.stdout.write('Definer catalog shadow: pre-013 cross-tenant error oracle REPRODUCED; explicit pg_temp-last containment PASSED.\n');
 }finally{
   await client.end();await pool.query('DROP OWNED BY "'+role+'"; DROP ROLE "'+role+'"');
 }
}

import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {testPaymentBinding} from './payment-binding-tests.ts';

export async function testSecurityUpgrades(pool:pg.Pool,url:string){
 const role='agentmargin_ci_upgrade_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
 const workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
 await pool.query(`CREATE ROLE "${role}" LOGIN NOINHERIT PASSWORD '${password}'`);
 const runtimeURL=new URL(url);runtimeURL.username=role;runtimeURL.password=password;
 let runtime:PostgresEventStore|undefined;
 try{
   await pool.query(readFileSync(new URL('../db/runtime_privileges.psql',import.meta.url),'utf8').replaceAll(':"runtime_role"','"'+role+'"').replaceAll(":'runtime_role'","'"+role+"'"));
   await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'AM-01 synthetic upgrade']);
   await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role) VALUES($1,$2,$3,$4,$5)',[randomUUID(),workspace,createHash('sha256').update(key).digest('hex'),'synthetic-upgrade','ingest']);
   runtime=new PostgresEventStore(runtimeURL.toString());
   await testPaymentBinding(pool,runtime,workspace,key);
   const sql=readFileSync(new URL('../db/016_runtime_security_contract.sql',import.meta.url),'utf8'),c=await pool.connect();
   try{
     await assert.rejects(c.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
     await c.query('ROLLBACK');
     assert.equal((await c.query("SELECT to_regclass('agentmargin_auth.security_contract') AS name")).rows[0].name,null);
     await c.query(sql);
   }finally{await c.query('ROLLBACK');c.release();}
 }finally{await runtime?.pool.end();await pool.query('DROP OWNED BY "'+role+'"; DROP ROLE "'+role+'"');}
}

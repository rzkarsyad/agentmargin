import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
export async function testPrivacyLifecycle(pool:pg.Pool,url:string){
 const workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url'),directory=mkdtempSync(join(tmpdir(),'agentmargin-privacy-')),output=join(directory,'export.json');
 const before=(await pool.query('SELECT count(*)::int AS n FROM revenue_records')).rows[0].n;
 try{
   await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'agentmargin-qa privacy lifecycle']);
   await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,createHash('sha256').update(key).digest('hex'),'privacy-fixture']);
   await pool.query("INSERT INTO customers(workspace_id,id,name) VALUES($1,'privacy','Fictional customer')",[workspace]);
   await pool.query("INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros) VALUES($1,'privacy','privacy',now(),100)",[workspace]);
   const run=(action:string,guard?:string)=>execFileSync(process.execPath,['--experimental-strip-types','scripts/workspace-data.ts',workspace,output,action],{stdio:'pipe',env:{...process.env,AGENTMARGIN_STANDALONE_DATABASE_URL:url,AGENTMARGIN_PRIVACY_REHEARSAL:guard??''}});
   run('export');assert.equal(statSync(output).mode&0o077,0);
   const exported=readFileSync(output,'utf8');assert.ok(!exported.includes(key));assert.ok(!exported.includes('key_digest'));
   assert.equal(JSON.parse(exported).data.revenue_records.length,1);
   assert.throws(()=>run('delete-after-export'));
   await pool.query("INSERT INTO customers(workspace_id,id) VALUES($1,'changed-after-export')",[workspace]);
   assert.throws(()=>run('delete-after-export','delete-fictional-workspace'),'Stale export must not authorize teardown');
   rmSync(output);run('export');run('delete-after-export','delete-fictional-workspace');
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM workspaces WHERE id=$1',[workspace])).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM revenue_records')).rows[0].n,before,'Unrelated financial records changed');
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_catalog.pg_trigger WHERE tgname IN ('immutable_payment','immutable_adjustment','immutable_payment_source','immutable_delivery_history','immutable_delivery_requeue') AND tgenabled='O'")).rows[0].n,5);
   process.stdout.write('Disposable privacy lifecycle: private export, no credential digests, stale-export denial, scoped teardown and restored immutability PASSED.\n');
 }finally{rmSync(directory,{recursive:true,force:true});}
}

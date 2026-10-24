/** Observe synthetic credential parameter exposure without printing either key. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {digest} from '../apps/api/src/app.ts';
import {withOpenAiDisposableRuntime} from './lib/openai-disposable-runtime.ts';
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,container=process.env.AGENTMARGIN_CI_POSTGRES_CONTAINER;
if(!url||!container||!/^[a-zA-Z0-9_-]+$/.test(container))throw new Error('Synthetic container fixture required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')throw new Error('Synthetic database only');
const baseline='am_'+randomBytes(32).toString('base64url'),protectedKey='am_'+randomBytes(32).toString('base64url');
const admin=new pg.Client({connectionString:url,options:'-c log_parameter_max_length=-1 -c log_min_duration_statement=0'});
await admin.connect();
try{
 await admin.query("SELECT set_config('agentmargin.synthetic_probe',$1,false)",[baseline]);
 // The caller captures stdout AND stderr because docker keeps both streams.
 // Use spawnSync rather than printing either, even on assertion failure.
 const readLogs=async()=>{
   const {spawnSync}=await import('node:child_process');
   const r=spawnSync('docker',['logs',container],{encoding:'utf8',maxBuffer:20_000_000});
   if(r.status!==0)throw new Error('Synthetic log capture failed');return r.stdout+r.stderr;
 };
 assert.ok((await readLogs()).includes(baseline),'Baseline logging exposure must be demonstrated');
 const workspace=randomUUID();
 await admin.query('SET log_parameter_max_length=0');
 await admin.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'synthetic logging']);
 await admin.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,digest(protectedKey),'synthetic logging']);
 await withOpenAiDisposableRuntime(async runtimeUrl=>{
   const owner=new pg.Client({connectionString:url});await owner.connect();
   try{await owner.query('ALTER ROLE "'+new URL(runtimeUrl).username+'" SET log_min_duration_statement=0');}finally{await owner.end();}
   const store=new PostgresEventStore(runtimeUrl).forCredential(protectedKey);
   try{
     assert.equal((await store.authenticate('ignored'))?.workspaceId,workspace);
     // Error-parameter logging is independently protected, including reuse.
     await store.pool.query('SET log_parameter_max_length_on_error=1');
     await assert.rejects(store.authenticate('ignored'),/Unsafe database session configuration/);
     await store.pool.query('SET log_parameter_max_length_on_error=0');
     assert.equal((await store.authenticate('ignored'))?.workspaceId,workspace);
   }finally{await store.pool.end();}
 });
 assert.ok(!(await readLogs()).includes(protectedKey),'Protected bearer must not occur in server logs');
 process.stdout.write('AM-02 synthetic server logs: baseline parameter exposure reproduced; protected bearer absent; unsafe reuse denied.\n');
}finally{await admin.end();}

/** Restart only the explicitly identified GitHub Actions PostgreSQL 16 service. */
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,id=process.env.AGENTMARGIN_CI_POSTGRES_CONTAINER;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AGENTMARGIN_RESTART_DRILL!=='ci-only'||!url||!id||! /^[a-f0-9]{64}$/.test(id))throw new Error('Disposable service restart guard required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.port!=='5432'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')throw new Error('CI database only');
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args:string[])=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000});
const config=JSON.parse(docker(['inspect',id]))[0];
if(config.Config.Image!=='postgres:16'||!config.Config.Env.includes('POSTGRES_DB=agentmargin_ci')||!config.Config.Env.includes('POSTGRES_USER=agentmargin_ci'))throw new Error('Wrong service identity');
const store=new PostgresEventStore(url);let disconnects=0;
store.pool.on('error',()=>{disconnects++;});
const tables=['revenue_records','revenue_adjustments','revenue_payment_sources','revenue_deliveries','adjustment_deliveries','delivery_history','delivery_requeues'];
const snapshot=()=>store.pool.query('SELECT '+tables.map((t,i)=>`(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) FROM public.${t} t) AS hash_${i}`).join(','));
try{
 const before=(await snapshot()).rows[0],started=Date.now();
 docker(['restart',id]);
 let ready=false;
 for(let i=0;i<100;i++){
   try{ready=await store.ready();}catch{}
   if(ready)break;await delay(100);
 }
 assert.equal(ready,true,'Pool failed to reconnect after disposable DB restart');
 assert.deepEqual((await snapshot()).rows[0],before,'Economic/inbox/recovery history changed after restart');
 process.stdout.write(JSON.stringify({kind:'synthetic_database_restart',passed:true,recoveryMillis:Date.now()-started,handledPoolDisconnects:disconnects})+'\n');
}finally{await store.pool.end();}

/** Actual Next.js HTTP rejection tests; no provider key or financial write. */
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();if(!address||typeof address==='string')throw new Error('Loopback port unavailable');
await new Promise<void>((r,j)=>reservation.close(e=>e?j(e):r()));
const endpoint='http://127.0.0.1:'+address.port;
const env={...process.env};
for(const name of ['OPENAI_API_KEY','AGENTMARGIN_API_KEY','AGENTMARGIN_STARTER_ORIGIN'])delete env[name];
env.NEXT_TELEMETRY_DISABLED='1';
const child=spawn(process.execPath,[resolve('examples/nextjs-starter/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(address.port)],{cwd:resolve('examples/nextjs-starter'),env,stdio:'ignore'});
const exited=once(child,'exit');
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
   if(child.exitCode!==null)throw new Error('Isolated starter exited before readiness');
   try{ready=(await fetch(endpoint,{signal:AbortSignal.timeout(500)})).status===200;}catch{}
   if(ready)break;await delay(100);
 }
 assert.ok(ready,'Isolated starter startup timed out');
 for(const path of ['/api/live','/api/simulate']){
   const post=(headers:Record<string,string>)=>fetch(endpoint+path,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(3000)});
   assert.equal((await post({'content-type':'text/plain'})).status,415);
   assert.equal((await post({'content-type':'application/json',origin:'https://foreign.invalid'})).status,403);
   assert.equal((await post({'content-type':'application/json',origin:'null'})).status,403);
   assert.equal((await post({'content-type':'application/json','sec-fetch-site':'cross-site'})).status,403);
 }
 const valid=await fetch(endpoint+'/api/live',{method:'POST',headers:{'content-type':'application/json',origin:endpoint},body:'{}'});
 assert.equal(valid.status,400);assert.match((await valid.json() as {message:string}).message,/not configured/);
 process.stdout.write('PASS: actual starter HTTP rejects form/cross-origin/null/cross-site requests before side effects; provider key absent.\n');
}finally{
 child.kill('SIGTERM');
 const timer=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();
 await exited;clearTimeout(timer);
}

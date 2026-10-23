/** Runs only against the disposable loopback CI database. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!url)throw new Error('Synthetic database URL required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')throw new Error('Refusing non-synthetic database');
const child=spawn(process.execPath,['--experimental-strip-types','apps/api/src/server.ts'],{
  env:{...process.env,DATABASE_URL:url,PORT:'18787',AGENTMARGIN_METRICS_TOKEN:'synthetic-lifecycle-metrics-token'},stdio:'ignore',
});
const exit=once(child,'exit');
const deadline=setTimeout(()=>child.kill('SIGKILL'),10_000);
try{
  let ready=false;
  for(let n=0;n<50;n++){
    try{ready=(await fetch('http://127.0.0.1:18787/ready',{signal:AbortSignal.timeout(300)})).status===200;}catch{}
    if(ready)break;
    await delay(50);
  }
  assert.equal(ready,true,'Server did not become ready');
  assert.equal((await fetch('http://127.0.0.1:18787/metrics')).status,401);
  child.kill('SIGTERM');
  assert.deepEqual(await exit,[0,null],'Server did not drain HTTP and PostgreSQL cleanly');
  process.stdout.write('API lifecycle readiness, metrics protection and SIGTERM shutdown: PASSED\n');
}finally{clearTimeout(deadline);if(child.exitCode===null)child.kill('SIGKILL');}

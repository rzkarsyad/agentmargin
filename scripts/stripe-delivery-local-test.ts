/** Signed fictional webhook -> real localhost API -> durable PostgreSQL -> replay. */
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {serve} from '@hono/node-server';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp,digest} from '../apps/api/src/app.ts';
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!url)throw new Error('Synthetic database URL required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')throw new Error('Refusing non-synthetic database');
const store=new PostgresEventStore(url),workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
const secret='whsec_synthetic_local_delivery',now=Math.floor(Date.now()/1000);
const server=serve({fetch:createApp(store).fetch,hostname:'127.0.0.1',port:0});
await once(server,'listening');
const address=server.address();
if(!address||typeof address==='string')throw new Error('Missing local port');
let apiClosed=false;
const fixtureDir=mkdtempSync(join(tmpdir(),'agentmargin-stripe-adjustment-'));
const linksFile=join(fixtureDir,'links.json');
writeFileSync(linksFile,JSON.stringify({re_synthetic_signed:{originalPaymentId:'stripe:invoice:in_synthetic_signed',customerId:'stripe:cus_synthetic_signed'}}),{mode:0o600});
const child=spawn(process.execPath,['--experimental-strip-types','examples/stripe-webhook-local.ts'],{
  env:{...process.env,AGENTMARGIN_ENDPOINT:'http://127.0.0.1:'+address.port,AGENTMARGIN_API_KEY:key,
    AGENTMARGIN_STRIPE_REFUND_LINKS_FILE:linksFile,STRIPE_WEBHOOK_SECRET:secret,STRIPE_ACCOUNT_ID:'acct_synthetic',AGENTMARGIN_DURABLE_REVENUE:'true',STRIPE_LOCAL_PORT:'18788'},stdio:'ignore',
});
const exit=once(child,'exit'),deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
const closeApi=()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
try{
  await store.pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Synthetic signed webhook fixture']);
  await store.pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(),workspace,digest(key),'synthetic-receiver','ingest']);
  let listening=false;
  for(let n=0;n<50;n++){
    try{listening=(await fetch('http://127.0.0.1:18788/',{signal:AbortSignal.timeout(200)})).status===404;}catch{}
    if(listening)break;await delay(50);
  }
  assert.ok(listening,'Local receiver did not start');
  const raw=JSON.stringify({id:'evt_synthetic_signed',account:'acct_synthetic',type:'invoice.paid',created:now,
    data:{object:{id:'in_synthetic_signed',customer:'cus_synthetic_signed',currency:'usd',status:'paid',amount_paid:50,status_transitions:{paid_at:now-10}}}});
  const sign=(body:string)=>'t='+now+',v1='+createHmac('sha256',secret).update(now+'.'+body).digest('hex');
  const post=(body:string,signature=sign(body))=>fetch('http://127.0.0.1:18788/stripe/webhook',{
    method:'POST',headers:{'stripe-signature':signature},body,signal:AbortSignal.timeout(7000)});
  const refund=JSON.stringify({id:'evt_synthetic_refund_before',account:'acct_synthetic',type:'refund.created',created:now,
    data:{object:{id:'re_synthetic_signed',created:now-5,status:'succeeded',currency:'usd',amount:10,charge:'ch_synthetic'}}});
  assert.equal((await post(refund)).status,200);
  assert.equal((await store.forCredential(key).processNextAdjustmentDelivery(workspace)).state,'retry');
  assert.equal((await store.forCredential(key).adjustmentDeliveryStatus(workspace)).unmatched,'1');
  assert.equal((await post(raw)).status,200);
  assert.equal((await store.pool.query('SELECT state FROM revenue_deliveries WHERE workspace_id=$1',[workspace])).rows[0].state,'pending');
  assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM revenue_records WHERE workspace_id=$1',[workspace])).rows[0].n,0);
  assert.equal((await store.forCredential(key).processNextRevenueDelivery(workspace)).inserted,1);
  assert.equal((await post(raw)).status,200);
  assert.equal((await store.forCredential(key).processNextRevenueDelivery(workspace)).state,'empty');
  assert.equal((await store.pool.query('SELECT amount_micros::text FROM revenue_records WHERE workspace_id=$1',[workspace])).rows[0].amount_micros,'500000');
  await store.pool.query('UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1',[workspace]);
  assert.equal((await store.forCredential(key).processNextAdjustmentDelivery(workspace)).inserted,1);
  assert.equal((await post(refund.replace('evt_synthetic_refund_before','evt_synthetic_refund_again').replace('refund.created','refund.updated'))).status,200);
  assert.equal((await store.forCredential(key).processNextAdjustmentDelivery(workspace)).duplicate,1);
  const credit=JSON.stringify({id:'evt_synthetic_balance_credit',account:'acct_synthetic',type:'credit_note.created',created:now,
    data:{object:{id:'cn_synthetic_signed',created:now-3,status:'issued',type:'post_payment',currency:'usd',invoice:'in_synthetic_signed',customer:'cus_synthetic_signed',
      pre_payment_amount:0,post_payment_amount:5,credit_amount:5,refund_amount:0,out_of_band_amount:0,refund:null,customer_balance_transaction:'cbtxn_synthetic'}}});
  assert.equal((await post(credit)).status,200);
  assert.equal((await store.forCredential(key).processNextAdjustmentDelivery(workspace)).inserted,1);
  assert.equal((await store.pool.query('SELECT sum(amount_micros)::text AS n FROM revenue_adjustments WHERE workspace_id=$1',[workspace])).rows[0].n,'150000');
  assert.equal((await post(refund.replace('evt_synthetic_refund_before','evt_synthetic_conflict').replace('"amount":10','"amount":11'))).status,200);
  assert.equal((await store.forCredential(key).processNextAdjustmentDelivery(workspace)).state,'failed');

  assert.equal((await post(raw+' ',sign(raw))).status,400);
  assert.equal((await post(raw.replace('acct_synthetic','acct_wrong'))).status,400);
  await closeApi();apiClosed=true;
  assert.equal((await post(raw.replace('evt_synthetic_signed','evt_synthetic_unavailable'))).status,503,'Receiver acknowledged unavailable persistence');
  assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM revenue_deliveries WHERE workspace_id=$1',[workspace])).rows[0].n,1);
  process.stdout.write('Signed synthetic Stripe -> durable inbox -> replay and persistence-outage handling: PASSED\n');
}finally{
  child.kill('SIGTERM');await exit;clearTimeout(deadline);rmSync(fixtureDir,{recursive:true,force:true});
  if(!apiClosed)await closeApi();await store.pool.end();
}

/** Genuine Stripe sandbox QA, explicitly opt-in. Never signs fabricated events.
 * Requires Stripe CLI with a restricted TEST key and an isolated sandbox account.
 * Private evidence stays outside the repository; stdout contains aggregate results.
 */
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createHmac,timingSafeEqual,randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readCheckedFile,requirePrivateDirectory} from './lib/private-files.ts';
import {resolve,relative} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {serve} from '@hono/node-server';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp,digest} from '../apps/api/src/app.ts';
import {AgentMarginClient,stripeEventToFinancialDelivery,type StripeRefundLink} from '../packages/sdk/src/index.ts';
import {reconcileLedgerRevenue} from '../packages/core/src/financial-ledger.ts';

const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,account=process.env.STRIPE_SANDBOX_ACCOUNT_ID,
 apiKey=process.env.STRIPE_API_KEY,output=process.env.AGENTMARGIN_SANDBOX_EVIDENCE;
if(process.env.AGENTMARGIN_STRIPE_SANDBOX_QA!=='test-only'||!url||!account||!/^acct_[A-Za-z0-9]+$/.test(account)||
 !apiKey||! /^(?:rk|sk)_test_/.test(apiKey)||!output){
 process.stderr.write('{"kind":"stripe_sandbox_qa_blocked","reason":"Explicit sandbox account, TEST credential, private evidence directory and disposable database required"}\n');process.exit(2);
}
const target=new URL(url),requestedDirectory=resolve(output),root=resolve('.');
if(target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci'||
 !relative(root,requestedDirectory).startsWith('..'))throw new Error('Require isolated loopback CI database and evidence outside repository');
mkdirSync(requestedDirectory,{recursive:true,mode:0o700});
const directory=requirePrivateDirectory(requestedDirectory);
if(!relative(root,directory).startsWith('..'))throw new Error('Evidence must be outside checkout');
const runFile=resolve(directory,'qa-run.json');
let existing:Record<string,any>|null=null;
try{existing=JSON.parse(readCheckedFile(runFile,{privateFile:true,maxBytes:100000}).contents);}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const run:string=existing?.run??randomUUID(),workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
if(!/^[a-f0-9-]{36}$/.test(run)||existing&&(existing.account!==account||Date.now()-existing.createdAt>23*3600000))throw new Error('QA replay namespace expired or account changed; use a new private run directory');
if(!existing)writeFileSync(runFile,JSON.stringify({run,account,createdAt:Date.now()}),{mode:0o600,flag:'wx'});

// Never pass secrets as command-line arguments or print Stripe's error bodies.
const stripe=(method:string,path:string,data:Record<string,string|number|boolean>={},operation='read')=>{
 const args=[method,path,'--stripe-version','2026-09-30.endive'];
 if(method==='post')args.push('--idempotency','agentmargin-qa:'+run+':'+operation);
 for(const [name,value] of Object.entries(data))args.push('-d',name+'='+String(value));
 let result:Record<string,any>;
 try{result=JSON.parse(execFileSync('stripe',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));}
 catch{throw new Error('Stripe sandbox operation failed: '+operation);}
 if(result.error||result.livemode===true)throw new Error('Stripe sandbox operation rejected: '+operation);
 return result;
};
const owner=new PostgresEventStore(url),links:Record<string,StripeRefundLink>={},allowedInvoices=new Set<string>();
let listener:ChildProcess|undefined,secret='',listenerError='',active:PostgresEventStore|undefined;
let customer='',api:ReturnType<typeof serve>|undefined,webhook:ReturnType<typeof createServer>|undefined;
const captured:{raw:Buffer;signature:string;event:Record<string,any>;accepted:boolean}[]=[];
const observations:{scenario:string;status:string;expectedMicros?:string;actualMicros?:string;varianceMicros?:string}[]=[];
const accept=async(raw:Buffer,signature:string)=>{
 const t=signature.split(',').find(s=>s.startsWith('t='))?.slice(2);
 if(!t||! /^\d+$/.test(t)||Math.abs(Date.now()/1000-Number(t))>300)throw new Error('Invalid signature');
 const mac=createHmac('sha256',secret).update(t+'.').update(raw).digest();
 if(!signature.split(',').some(s=>/^v1=[a-f0-9]{64}$/.test(s)&&timingSafeEqual(Buffer.from(s.slice(3),'hex'),mac)))throw new Error('Invalid signature');
 const event=JSON.parse(raw.toString('utf8'));
 if(event.livemode!==false||event.account!=null)throw new Error('Sandbox platform events only');
 const o=event.data?.object;
 if(!o||(!allowedInvoices.has(o.id)&&!allowedInvoices.has(o.invoice)&&!links[o.id]))throw new Error('Unrelated or not-yet-mapped fixture');
 const delivery=stripeEventToFinancialDelivery(raw,signature,secret,Math.floor(Date.now()/1000),{platformAccount:account,refundLinks:links});
 if(delivery){
   if(delivery.kind==='payment')await client!.enqueueRevenueDelivery(delivery);
   else await client!.enqueueAdjustmentDelivery(delivery);
 }
 return event;
};
let client:AgentMarginClient|undefined;
try{
 assert.equal(stripe('get','/v1/account').id,account,'Selected sandbox account mismatch');
 assert.ok(await owner.ready(),'Apply tested migrations to the disposable CI database first');
 await owner.pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Stripe sandbox QA '+run]);
 await owner.pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,digest(key),'sandbox-QA']);
 // Uses the existing configured disposable runtime, never the owner as HTTP/worker.
 const runtimeURL=process.env.AGENTMARGIN_SANDBOX_RUNTIME_URL;
 if(!runtimeURL)throw new Error('Restricted disposable runtime URL required');
 const runtimeTarget=new URL(runtimeURL);
 if(runtimeTarget.hostname!==target.hostname||runtimeTarget.port!==target.port||runtimeTarget.pathname!==target.pathname||runtimeTarget.username===target.username)throw new Error('Invalid isolated runtime');
 active=new PostgresEventStore(runtimeURL).forCredential(key);
 api=serve({fetch:createApp(active).fetch,hostname:'127.0.0.1',port:0});await once(api,'listening');
 const a=api.address();if(!a||typeof a==='string')throw new Error('Missing API address');
 client=new AgentMarginClient({endpoint:'http://127.0.0.1:'+a.port,apiKey:key});
 webhook=createServer(async(req,res)=>{
   if(req.method!=='POST'||req.url!=='/stripe/webhook'){res.writeHead(404).end();return;}
   const chunks:Buffer[]=[];let size=0;
   try{
     for await(const b of req){size+=b.length;if(size>256000)throw new Error('Oversize');chunks.push(b);}
     const raw=Buffer.concat(chunks),signature=req.headers['stripe-signature'];
     if(typeof signature!=='string')throw new Error('Missing signature');
     // Keep bounded private raw receipts, including mapping races for later replay.
     // Their signature is rechecked at replay; these are not synthetic successes.
     const entry={raw,signature,event:JSON.parse(raw.toString('utf8')),accepted:false};
     if(captured.length>=200)throw new Error('Receipt bound exceeded');captured.push(entry);
     try{entry.event=await accept(raw,signature);entry.accepted=true;res.writeHead(200).end();}
     catch{res.writeHead(503).end();}
   }catch{res.writeHead(400).end();}
 });webhook.listen(0,'127.0.0.1');await once(webhook,'listening');
 const w=webhook.address();if(!w||typeof w==='string')throw new Error('Missing webhook address');
 listener=spawn('stripe',['listen','--events-from','@self','--latest','--events','invoice.paid,refund.created,refund.updated,credit_note.created','--forward-to','http://127.0.0.1:'+w.port+'/stripe/webhook'],{stdio:['ignore','pipe','pipe']});
 listener.on('error',()=>{listenerError='CLI listener unavailable';});
 const inspect=(b:Buffer)=>{const match=b.toString().match(/whsec_[A-Za-z0-9]+/);if(match)secret=match[0];};
 listener.stdout!.on('data',inspect);listener.stderr!.on('data',inspect);
 for(let i=0;i<100&&!secret&&!listenerError;i++)await delay(100);
 assert.ok(secret,'Stripe CLI listener did not provide a signing secret');
 customer=stripe('post','/v1/customers',{'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run,name:'agentmargin-qa-'+run,description:'Synthetic AgentMargin QA'},'customer').id;
 const pm=stripe('post','/v1/payment_methods/pm_card_visa/attach',{customer},'payment-method').id;
 stripe('post','/v1/payment_methods/'+pm,{'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},'payment-method-label');
 const invoice=(cents:number,currency:string,paid:boolean,label:string)=>{
   const product=stripe('post','/v1/products',{name:'agentmargin-qa '+label,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-product');
   const price=stripe('post','/v1/prices',{product:product.id,currency,unit_amount:cents,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-price');
   const inv=stripe('post','/v1/invoices',{customer,auto_advance:false,default_payment_method:pm,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-invoice');
   allowedInvoices.add(inv.id);
   stripe('post','/v1/invoiceitems',{customer,invoice:inv.id,'pricing[price]':price.id,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-item');
   stripe('post','/v1/invoices/'+inv.id+'/finalize',{auto_advance:false},label+'-finalize');
   return paid?stripe('post','/v1/invoices/'+inv.id+'/pay',{},label+'-pay'):stripe('get','/v1/invoices/'+inv.id);
 };
 const p29=invoice(2900,'usd',true,'paid29'),p99=invoice(9900,'usd',true,'paid99'),unpaid=invoice(1500,'usd',false,'unpaid15');
 assert.equal(unpaid.amount_paid,0);assert.equal(unpaid.status,'open');
 const refund=(inv:Record<string,any>,cents:number,label:string)=>{
   const payments=stripe('get','/v1/invoice_payments',{invoice:inv.id,status:'paid'}).data;
   assert.equal(payments?.length,1,'Ambiguous original payment mapping');
   const payment=payments[0];assert.equal(payment.invoice,inv.id);assert.equal(payment.currency,'usd');
   assert.equal(payment.payment?.type,'payment_intent');
   const r=stripe('post','/v1/refunds',{payment_intent:payment.payment.payment_intent,amount:cents,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label);
   assert.notEqual(r.livemode,true);assert.equal(r.status,'succeeded');
   links[r.id]={originalPaymentId:'stripe:invoice:'+inv.id,customerId:'stripe:'+customer};return r;
 };
 const partial=refund(p29,625,'partial-refund'),full=refund(p99,9900,'full-refund');
 const credit=stripe('post','/v1/credit_notes',{invoice:p29.id,credit_amount:1200,'lines[0][type]':'invoice_line_item',
   'lines[0][invoice_line_item]':p29.lines.data[0].id,'lines[0][amount]':1200,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},'balance-credit');
 assert.equal(credit.post_payment_amount,1200);assert.ok(credit.customer_balance_transaction);
 // Actual EUR evidence must remain unsupported; no exchange rate is invented.
 const eur=invoice(1000,'eur',true,'eur-unsupported');
 const expectedObjects=[p29.id,p99.id,partial.id,full.id,credit.id,eur.id];
 for(let i=0;i<300;i++){
   if(expectedObjects.every(id=>captured.some(c=>c.event.data?.object?.id===id)))break;
   await delay(100);
 }
 assert.ok(expectedObjects.every(id=>captured.some(c=>c.event.data?.object?.id===id)),'Missing genuine CLI webhook receipts');
 for(const c of captured){
   const o=c.event.data?.object;
   if(!expectedObjects.includes(o?.id)||o?.currency!=='usd')continue;
   await accept(c.raw,c.signature);c.accepted=true;
 }
 // Force the adjustment worker before payment replay to verify durable unmatched state.
 assert.equal((await active.processNextAdjustmentDelivery(workspace)).state,'retry');
 while((await active.processNextRevenueDelivery(workspace)).state!=='empty'){}
 await owner.pool.query('UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1',[workspace]);
 while((await active.processNextAdjustmentDelivery(workspace)).state!=='empty'){}
 for(const c of captured.filter(c=>c.accepted))await accept(c.raw,c.signature);
 while((await active.processNextAdjustmentDelivery(workspace)).state!=='empty'){}
 assert.equal((await active.processNextRevenueDelivery(workspace)).state,'empty');
 const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
 await client.track([{id:'qa_usage_'+run,customerId:'stripe:'+customer,model:'unpriced-QA-model',occurredAt:new Date().toISOString(),inputTokens:1,outputTokens:1}]);
 const ledger=await active.financialLedger(workspace,start,end),page=await active.analyticsPage(workspace,start,end,null,100);
 assert.equal(ledger.summary.grossRevenueMicros,'128000000');assert.equal(ledger.summary.refundsMicros,'105250000');
 assert.equal(ledger.summary.creditsMicros,'12000000');assert.equal(ledger.summary.netRevenueMicros,'10750000');
 assert.equal(page.summary.totalRevenueMicros,ledger.summary.netRevenueMicros);
 assert.equal(page.summary.completeContributionMicros,null,'Missing pricing cannot imply complete contribution');
 const response=await fetch('http://127.0.0.1:'+a.port+'/v1/analytics/page?start='+encodeURIComponent(start)+'&end='+encodeURIComponent(end),{headers:{authorization:'Bearer '+key}});
 assert.equal(response.status,200);const analytics=await response.json() as any;
 assert.equal(analytics.summary.totalRevenueMicros,'10750000');
 const adjustmentId=(source:string)=>'adjustment:adj:'+createHash('sha256').update('stripe\n'+account+'\n'+source).digest('hex');
 const bill={scope:{workspaceId:workspace,provider:'stripe',accountId:account,currency:'USD',kind:'revenue' as const,periodStart:start,periodEnd:end},billingExportRef:'stripe-sandbox-api:'+run,
   tolerance:{absoluteMicros:'0',basisPoints:0},billed:[
     ...[p29,p99].map(p=>({id:p.id,sourceRef:'stripe:invoice:'+p.id,currency:'USD',occurredAt:new Date(p.status_transitions.paid_at*1000).toISOString(),amountMicros:(BigInt(p.amount_paid)*10000n).toString(),kind:'charge' as const,recordIds:['payment:stripe:invoice:'+p.id]})),
     ...[partial,full].map(r=>({id:r.id,sourceRef:'stripe:refund:'+r.id,currency:'USD',occurredAt:new Date(r.created*1000).toISOString(),amountMicros:(-BigInt(r.amount)*10000n).toString(),kind:'credit' as const,recordIds:[adjustmentId(r.id)]})),
     {id:credit.id,sourceRef:'stripe:credit_note:'+credit.id,currency:'USD',occurredAt:new Date(credit.created*1000).toISOString(),amountMicros:(-BigInt(credit.post_payment_amount)*10000n).toString(),kind:'credit' as const,recordIds:[adjustmentId(credit.id)]}]};
 const reconciliation=reconcileLedgerRevenue(ledger.inputs,bill);
 // This consistency check is compares separately retrieved Stripe API objects with normalized receipts. An
 // independently imported provider export must additionally corroborate it.
 assert.equal(reconciliation.reconciliation.summary.varianceMicros,'0');
 observations.push({scenario:'USD fixture ledger/API/receipt consistency',status:'pass',expectedMicros:'10750000',actualMicros:ledger.summary.netRevenueMicros,varianceMicros:'0'},
   {scenario:'EUR invoice',status:'unsupported_fx_required'},{scenario:'Independent billing export and dashboard browser',status:'pending'});
 const evidence={run,account,livemode:false,observations,providerEvidence:{p29,p99,unpaid,partial,full,credit,eur},ledger,reconciliation,deliveries:captured.map(c=>({eventId:c.event.id,apiVersion:c.event.api_version,objectId:c.event.data?.object?.id,
   accepted:c.accepted,sha256:createHash('sha256').update(c.raw).digest('hex')})),history:(await owner.pool.query('SELECT * FROM delivery_history WHERE workspace_id=$1 ORDER BY recorded_at,id',[workspace])).rows};
 writeFileSync(resolve(directory,run+'-'+workspace+'.json'),JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify({kind:'stripe_sandbox_qa',observations})+'\n');
}catch{
 process.stderr.write('{"kind":"stripe_sandbox_qa_failed","reason":"Sandbox setup, API schema, signature, delivery or financial assertion failed; no release gate cleared"}\n');process.exitCode=1;
}finally{
 listener?.kill('SIGTERM');
 if(webhook)await new Promise<void>(r=>webhook!.close(()=>r()));
 if(api)await new Promise<void>(r=>api!.close(()=>r()));
 if(active)await active.pool.end();await owner.pool.end();
 // Preserve only run-tagged sandbox objects/evidence for audit; never bulk-delete
 // account data. Dispose the isolated sandbox through an authorized operator.
}

/** Genuine Stripe sandbox QA, explicitly opt-in. Never signs fabricated events.
 * Requires Stripe CLI with a restricted TEST key and an isolated sandbox account.
 * Private evidence stays outside the repository; stdout contains aggregate results.
 */
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {readCheckedFile,requirePrivateDirectory} from './lib/private-files.ts';
import {promisify} from 'node:util';
import {QA_TYPES,QaFailure,qaMode,verifyQaReceipt,isRunEvent,discoverQaEvents,qaStripeTransport,listenerEnvironment,ListenerDiagnostics,deliveryGaps,type QaCategory} from './lib/stripe-qa.ts';
import {resolve,relative} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {serve} from '@hono/node-server';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp,digest} from '../apps/api/src/app.ts';
import {AgentMarginClient,stripeEventToFinancialDelivery,type StripeRefundLink} from '../packages/sdk/src/index.ts';
import {reconcileLedgerRevenue} from '../packages/core/src/financial-ledger.ts';

let stage='configuration';
const diagnostic=(data:Record<string,unknown>)=>process.stdout.write(JSON.stringify({kind:'stripe_sandbox_qa_diagnostic',stage,...data})+'\n');
async function main(){
let interrupted=false;
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,account=process.env.STRIPE_SANDBOX_ACCOUNT_ID,
 apiKey=process.env.STRIPE_API_KEY,output=process.env.AGENTMARGIN_SANDBOX_EVIDENCE;
if(process.env.AGENTMARGIN_STRIPE_SANDBOX_QA!=='test-only'||!url||!account||!/^acct_[A-Za-z0-9]+$/.test(account)||
 !apiKey||! /^(?:rk|sk)_test_/.test(apiKey)||!output){
 process.stderr.write('{"kind":"stripe_sandbox_qa_blocked","reason":"Explicit sandbox account, TEST credential, private evidence directory and disposable database required"}\n');process.exit(2);
}
const target=new URL(url),requestedDirectory=resolve(output),root=resolve('.');
const outside=(path:string)=>relative(root,path)==='..'||relative(root,path).startsWith('../');
if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci'||
 !outside(requestedDirectory))throw new Error('Require isolated loopback CI database and evidence outside repository');
mkdirSync(requestedDirectory,{recursive:true,mode:0o700});
const directory=requirePrivateDirectory(requestedDirectory);
if(!outside(directory))throw new Error('Evidence must be outside checkout');
const runFile=resolve(directory,'qa-run.json');
let existing:Record<string,any>|null=null;
try{existing=JSON.parse(readCheckedFile(runFile,{privateFile:true,maxBytes:100000}).contents);}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const mode=qaMode(process.env.AGENTMARGIN_SANDBOX_MODE,!!existing);
const deliveryTimeout=Number(process.env.AGENTMARGIN_SANDBOX_DELIVERY_TIMEOUT_MS??30000);
if(!Number.isSafeInteger(deliveryTimeout)||deliveryTimeout<1000||deliveryTimeout>120000)throw new Error('Invalid bounded delivery timeout');
const run:string=existing?.run??randomUUID(),workspace=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
if(!/^[a-f0-9-]{36}$/.test(run)||existing&&(existing.account!==account||!Number.isSafeInteger(existing.createdAt)||existing.createdAt>Date.now()||Date.now()-existing.createdAt>30*86400000))throw new Error('Invalid account or run outside event retention');
const createdAt=existing?.createdAt??Date.now();
if(!existing)writeFileSync(runFile,JSON.stringify({run,account,createdAt}),{mode:0o600,flag:'wx'});
const session=randomUUID();
const persist=(name:string,value:unknown)=>{
 const fd=openSync(resolve(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd);}finally{closeSync(fd);}
};
// Secrets stay in the environment. Never expose raw CLI output or child errors.
const cli=qaStripeTransport(async(args,login)=>{
 if(interrupted)throw new Error('QA interrupted');
 try{return JSON.parse((await promisify(execFile)('stripe',args,{env:login?listenerEnvironment(process.env):process.env,encoding:'utf8',timeout:30000,maxBuffer:4_000_000})).stdout);}
 catch{throw new Error('Stripe CLI operation failed');}
},account,run,mode);
const stripe=cli.request;
const owner=new PostgresEventStore(url),links:Record<string,StripeRefundLink>={},allowedInvoices=new Set<string>();
let listener:ChildProcess|undefined,listenerState='not_started',active:PostgresEventStore|undefined;
const listenerInfo=new ListenerDiagnostics();
const interrupt=()=>{interrupted=true;listenerState='interrupted';listener?.kill('SIGTERM');};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
let customer='',api:ReturnType<typeof serve>|undefined,webhook:ReturnType<typeof createServer>|undefined;
const captured:{raw:Buffer;signature:string;event:Record<string,any>;accepted:boolean;category:QaCategory}[]=[];
const attempts:Record<string,number>={},httpStatuses:Record<string,number>={};
const upstreamStatuses:Record<string,number>={};
let expectedEvents:Record<string,any>[]=[];
const observations:{scenario:string;status:string;expectedMicros?:string;actualMicros?:string;varianceMicros?:string}[]=[];
let client:AgentMarginClient|undefined;
const accept=async(raw:Buffer,signature:string,event:Record<string,any>)=>{
 if(!isRunEvent(event,run))throw new QaFailure('fixture_mismatch',422);
 const o=event.data.object;
 if(o.currency!=='usd')throw new QaFailure('unsupported_fx',422);
 if(!allowedInvoices.has(o.id)&&!allowedInvoices.has(o.invoice)&&!links[o.id])throw new QaFailure('fixture_mapping_pending',503);
 let delivery;
 try{delivery=stripeEventToFinancialDelivery(raw,signature,listenerInfo.secret,Math.floor(Date.now()/1000),{platformAccount:account,refundLinks:links});}
 catch{throw new QaFailure('normalization',422);}
 try{
  if(delivery?.kind==='payment')await client!.enqueueRevenueDelivery(delivery,AbortSignal.timeout(10000));
  else if(delivery)await client!.enqueueAdjustmentDelivery(delivery,AbortSignal.timeout(10000));
 }catch{throw new QaFailure('normalized_delivery',503);}
 return delivery?'accepted' as const:'ignored' as const;
};
try{
 stage='account-check';await cli.checkAccount();await cli.checkAccount(true);
 diagnostic({mode,listenerAuthentication:'cli_login_without_STRIPE_API_KEY'});
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
 client=new AgentMarginClient({endpoint:'http://127.0.0.1:'+a.port,apiKey:key,fetchImpl:async(input,init)=>{
  try{const response=await fetch(input,init);upstreamStatuses[response.status]=(upstreamStatuses[response.status]??0)+1;return response;}
  catch{upstreamStatuses.network_or_timeout=(upstreamStatuses.network_or_timeout??0)+1;throw new Error('AgentMargin network or timeout');}
 }});
 webhook=createServer(async(req,res)=>{
   let category:QaCategory='body_invalid',status=400;
   try{
     if(req.method!=='POST'||req.url!=='/stripe/webhook'){res.writeHead(404).end();return;}
     const chunks:Buffer[]=[];let size=0;
     for await(const b of req){size+=b.length;if(size>256000)throw new QaFailure('body_oversize',413);chunks.push(b);}
     const raw=Buffer.concat(chunks),signature=req.headers['stripe-signature'];
     const event=verifyQaReceipt(raw,typeof signature==='string'?signature:undefined,listenerInfo.secret);
     if(!isRunEvent(event,run))throw new QaFailure('fixture_mismatch',422);
     if(captured.length>=200)throw new QaFailure('body_oversize',413);
     const entry={raw,signature:signature as string,event,accepted:false,category:'fixture_mapping_pending' as QaCategory};captured.push(entry);
     // Persist ONLY verified run-scoped raw receipts before enqueue/ACK. Recovery
     // requests fresh Stripe delivery; it never re-signs or relaxes timestamp age.
     try{persist(session+'-receipt-'+captured.length+'.json',{run,account,livemode:false,verifiedAt:Date.now(),rawBase64:raw.toString('base64'),signature,sha256:createHash('sha256').update(raw).digest('hex')});}
     catch{entry.category='evidence_write';throw new QaFailure('evidence_write',503);}
     try{category=await accept(raw,signature as string,event);entry.accepted=true;entry.category=category;status=200;}
     catch(error){if(error instanceof QaFailure){entry.category=error.category;}throw error;}
   }catch(error){if(error instanceof QaFailure){category=error.category;status=error.status;}}
   attempts[category]=(attempts[category]??0)+1;httpStatuses[status]=(httpStatuses[status]??0)+1;
   diagnostic({receiver:{category,httpStatus:status},upstreamStatuses,received:deliveryGaps(expectedEvents,listenerInfo,captured).received});
   res.writeHead(status).end();
 });webhook.requestTimeout=15000;webhook.headersTimeout=10000;
 webhook.listen(0,'127.0.0.1');await once(webhook,'listening');
 const w=webhook.address();if(!w||typeof w==='string')throw new Error('Missing webhook address');
 stage='listener-start';listenerState='starting';
 listener=spawn('stripe',['listen','--events-from','@self','--latest','--skip-update','--color','off','--events',QA_TYPES.join(','),'--forward-to','http://127.0.0.1:'+w.port+'/stripe/webhook'],{env:listenerEnvironment(process.env),stdio:['ignore','pipe','pipe']});
 listener.on('error',()=>{listenerState='spawn_error';diagnostic({listener:listenerState});});
 listener.on('exit',(code,signal)=>{listenerState='exited';diagnostic({listener:listenerState,exitCode:code,signal});});
 listener.stdout!.on('data',(b:Buffer)=>listenerInfo.feed('stdout',b));listener.stderr!.on('data',(b:Buffer)=>listenerInfo.feed('stderr',b));
 for(let i=0;i<200&&!listenerInfo.secret&&listenerState==='starting';i++)await delay(100);
 if(!listenerInfo.secret||listenerState!=='starting')throw new Error('Listener startup failed');
 listenerState='ready';diagnostic({listener:listenerState,timeoutSeconds:20,apiVersionPolicy:'latest_snapshot; actual versions retained privately'});
 let p29!:Record<string,any>,p99!:Record<string,any>,unpaid!:Record<string,any>,partial!:Record<string,any>,full!:Record<string,any>,credit!:Record<string,any>,eur!:Record<string,any>;
 if(mode==='create'){
 stage='create-fixtures';
 customer=(await stripe('post','/v1/customers',{'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run,name:'agentmargin-qa-'+run,description:'Synthetic AgentMargin QA'},'customer')).id;
 const pm=(await stripe('post','/v1/payment_methods/pm_card_visa/attach',{customer},'payment-method')).id;
 await stripe('post','/v1/payment_methods/'+pm,{'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},'payment-method-label');
 const invoice=async(cents:number,currency:string,paid:boolean,label:string)=>{
   const product=await stripe('post','/v1/products',{name:'agentmargin-qa '+label,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-product');
   const price=await stripe('post','/v1/prices',{product:product.id,currency,unit_amount:cents,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-price');
   const inv=await stripe('post','/v1/invoices',{customer,currency,auto_advance:false,default_payment_method:pm,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-invoice');
   allowedInvoices.add(inv.id);
   await stripe('post','/v1/invoiceitems',{customer,invoice:inv.id,'pricing[price]':price.id,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label+'-item');
   await stripe('post','/v1/invoices/'+inv.id+'/finalize',{auto_advance:false},label+'-finalize');
   return paid?await stripe('post','/v1/invoices/'+inv.id+'/pay',{},label+'-pay'):await stripe('get','/v1/invoices/'+inv.id);
 };
 p29=await invoice(2900,'usd',true,'paid29');p99=await invoice(9900,'usd',true,'paid99');unpaid=await invoice(1500,'usd',false,'unpaid15');
 assert.equal(unpaid.amount_paid,0);assert.equal(unpaid.status,'open');
 const refund=async(inv:Record<string,any>,cents:number,label:string)=>{
   const payments=(await stripe('get','/v1/invoice_payments',{invoice:inv.id,status:'paid'})).data;
   assert.equal(payments?.length,1,'Ambiguous original payment mapping');
   const payment=payments[0];assert.equal(payment.invoice,inv.id);assert.equal(payment.currency,'usd');
   assert.equal(payment.payment?.type,'payment_intent');
   const r=await stripe('post','/v1/refunds',{payment_intent:payment.payment.payment_intent,amount:cents,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},label);
   assert.notEqual(r.livemode,true);assert.equal(r.status,'succeeded');
   links[r.id]={originalPaymentId:'stripe:invoice:'+inv.id,customerId:'stripe:'+customer};return r;
 };
 partial=await refund(p29,625,'partial-refund');full=await refund(p99,9900,'full-refund');
 credit=await stripe('post','/v1/credit_notes',{invoice:p29.id,credit_amount:1200,'lines[0][type]':'invoice_line_item',
   'lines[0][invoice_line_item]':p29.lines.data[0].id,'lines[0][amount]':1200,'metadata[agentmargin_qa_run]':'agentmargin-qa-'+run},'balance-credit');
 assert.equal(credit.post_payment_amount,1200);assert.ok(credit.customer_balance_transaction);
 // Actual EUR evidence must remain unsupported; no exchange rate is invented.
 eur=await invoice(1000,'eur',true,'eur-unsupported');
 }
 stage='discover-events';
 // Poll discovery briefly for provider event publication; never create missing objects.
 let pages=0;
 for(let i=0;i<5;i++){
  const found=await discoverQaEvents((path,data)=>stripe('get',path,data),run,createdAt);expectedEvents=found.events;pages=found.pages;
  const objects=new Set(expectedEvents.map(e=>e.data.object.id));
  if(objects.size>=6)break;await delay(1000);
 }
 persist(session+'-discovery.json',{run,account,livemode:false,pages,events:expectedEvents});
 diagnostic({eventPaginationComplete:true,pages,...deliveryGaps(expectedEvents,listenerInfo,captured)});
 const getObject=async(path:string,id:string)=>{
  if(!/^[a-z]+_[A-Za-z0-9_]+$/.test(id))throw new Error('Invalid provider reference');
  const o=await stripe('get',path+'/'+id);
  // Stripe Refund has no livemode field. Its test-only API credential/context,
  // run-scoped false-mode event and exact InvoicePayment link establish mode.
  if(o.id!==id||(path==='/v1/refunds'?o.livemode===true:o.livemode!==false)||o.metadata?.agentmargin_qa_run!=='agentmargin-qa-'+run)throw new Error('Fixture provenance mismatch');return o;
 };
 if(mode==='recover'){
  stage='recover-fixture-mapping';
  const paidIds=[...new Set(expectedEvents.filter(e=>e.type==='invoice.paid').map(e=>e.data.object.id as string))];
  const invoices=await Promise.all(paidIds.map(id=>getObject('/v1/invoices',id)));
  const choose=(items:Record<string,any>[],predicate:(o:Record<string,any>)=>boolean)=>{const matches=items.filter(predicate);assert.equal(matches.length,1,'Ambiguous run fixture');return matches[0]!;};
  p29=choose(invoices,o=>o.currency==='usd'&&o.amount_paid===2900);p99=choose(invoices,o=>o.currency==='usd'&&o.amount_paid===9900);eur=choose(invoices,o=>o.currency==='eur'&&o.amount_paid===1000);
  assert.equal(invoices.length,3);customer=p29.customer;assert.equal(p99.customer,customer);assert.equal(eur.customer,customer);
  for(const p of invoices)allowedInvoices.add(p.id);
  const refunds=await Promise.all([...new Set(expectedEvents.filter(e=>e.type.startsWith('refund.')).map(e=>e.data.object.id as string))].map(id=>getObject('/v1/refunds',id)));
  partial=choose(refunds,r=>r.currency==='usd'&&r.amount===625&&r.status==='succeeded');full=choose(refunds,r=>r.currency==='usd'&&r.amount===9900&&r.status==='succeeded');assert.equal(refunds.length,2);
  for(const [r,inv] of [[partial,p29],[full,p99]]){
   const payments=await stripe('get','/v1/invoice_payments',{invoice:inv!.id,status:'paid',limit:100});
   assert.equal(payments.has_more,false);assert.equal(payments.data?.length,1);
   const payment=payments.data[0];assert.equal(payment.invoice,inv!.id);assert.equal(payment.currency,'usd');assert.equal(payment.payment?.type,'payment_intent');assert.equal(payment.payment.payment_intent,r!.payment_intent);
   links[r!.id]={originalPaymentId:'stripe:invoice:'+inv!.id,customerId:'stripe:'+customer};
  }
  const credits=await Promise.all([...new Set(expectedEvents.filter(e=>e.type==='credit_note.created').map(e=>e.data.object.id as string))].map(id=>getObject('/v1/credit_notes',id)));
  credit=choose(credits,c=>c.currency==='usd'&&c.invoice===p29.id&&c.post_payment_amount===1200);assert.equal(credits.length,1);
  const open=await stripe('get','/v1/invoices',{customer,status:'open',limit:100});assert.equal(open.has_more,false);
  unpaid=choose(open.data.filter((o:Record<string,any>)=>o.metadata?.agentmargin_qa_run==='agentmargin-qa-'+run),o=>o.currency==='usd'&&o.amount_due===1500&&o.amount_paid===0);
 }
 const expectedObjects=[p29.id,p99.id,partial.id,full.id,credit.id,eur.id];
 assert.equal(new Set(expectedEvents.map(e=>e.data.object.id)).size,6,'Incomplete or unexpected run events');
 assert.ok(expectedObjects.every(id=>expectedEvents.some(e=>e.data.object.id===id)),'Missing provider events');
 stage='webhook-delivery';
 // Explicitly request fresh genuine signed deliveries of existing events. The
 // CLI command without --webhook-endpoint routes to its active local listener.
 // At most two resend requests per event, never financial mutations in recover.
 for(let round=0;round<2;round++){
  if(listenerState!=='ready')throw new Error('Listener exited');
  const missing=expectedEvents.filter(e=>!captured.some(c=>c.event.id===e.id&&(c.accepted||c.category==='unsupported_fx')));
  for(const event of missing)await cli.resend(event);
  const deadline=Date.now()+deliveryTimeout;
  while(Date.now()<deadline){
   if(listenerState!=='ready')throw new Error('Listener exited');
   if(expectedEvents.every(e=>captured.some(c=>c.event.id===e.id&&(c.accepted||c.category==='unsupported_fx'))))break;
   await delay(100);
  }
  diagnostic({round:round+1,timeoutSeconds:deliveryTimeout/1000,...deliveryGaps(expectedEvents,listenerInfo,captured)});
  if(expectedEvents.every(e=>captured.some(c=>c.event.id===e.id&&(c.accepted||c.category==='unsupported_fx'))))break;
 }
 assert.ok(expectedEvents.every(e=>captured.some(c=>c.event.id===e.id&&(c.accepted||c.category==='unsupported_fx'))),'Missing or rejected signed delivery; inspect redacted diagnostics');
 stage='financial-processing';
 // Force the adjustment worker before payment replay to verify durable unmatched state.
 assert.equal((await active.processNextAdjustmentDelivery(workspace)).state,'retry');
 while((await active.processNextRevenueDelivery(workspace)).state!=='empty'){}
 await owner.pool.query('UPDATE adjustment_deliveries SET available_at=now() WHERE workspace_id=$1',[workspace]);
 while((await active.processNextAdjustmentDelivery(workspace)).state!=='empty'){}
 // A verified duplicate within the normal window must remain idempotent.
 for(const c of captured.filter(c=>c.accepted)){verifyQaReceipt(c.raw,c.signature,listenerInfo.secret);await accept(c.raw,c.signature,c.event);}
 while((await active.processNextAdjustmentDelivery(workspace)).state!=='empty'){}
 assert.equal((await active.processNextRevenueDelivery(workspace)).state,'empty');
 const start=new Date(createdAt-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
 await client.track([{id:'qa_usage_'+run,customerId:'stripe:'+customer,model:'unpriced-QA-model',occurredAt:new Date().toISOString(),inputTokens:1,outputTokens:1}]);
 stage='financial-assertions';
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
 stage='financial-assertions';
 const evidence={mode,session,run,workspace,account,livemode:false,observations,diagnostics:{...deliveryGaps(expectedEvents,listenerInfo,captured),rejectionCategories:attempts,httpStatuses,upstreamStatuses},providerEvidence:{p29,p99,unpaid,partial,full,credit,eur},ledger,reconciliation,deliveries:captured.map(c=>({eventId:c.event.id,apiVersion:c.event.api_version,objectId:c.event.data?.object?.id,
   accepted:c.accepted,category:c.category,sha256:createHash('sha256').update(c.raw).digest('hex')})),history:(await owner.pool.query('SELECT * FROM delivery_history WHERE workspace_id=$1 ORDER BY recorded_at,id',[workspace])).rows};
 writeFileSync(resolve(directory,run+'-'+workspace+'.json'),JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify({kind:'stripe_sandbox_qa',observations})+'\n');
}catch{
 const failure={kind:'stripe_sandbox_qa_failed',stage,listener:listenerState,...deliveryGaps(expectedEvents,listenerInfo,captured),rejectionCategories:attempts,httpStatuses,upstreamStatuses,noReleaseGateCleared:true};
 process.stderr.write(JSON.stringify(failure)+'\n');
 persist(session+'-failure.json',{...failure,run,account,workspace,livemode:false});process.exitCode=1;
}finally{
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 listener?.kill('SIGTERM');
 if(listener&&listener.exitCode===null)await Promise.race([once(listener,'exit').catch(()=>{}),delay(2000)]);
 if(listener&&listener.exitCode===null)listener.kill('SIGKILL');
 if(webhook)await new Promise<void>(r=>webhook!.close(()=>r()));
 if(api)await new Promise<void>(r=>api!.close(()=>r()));
 if(active)await active.pool.end();await owner.pool.end();
 // Preserve only run-tagged sandbox objects/evidence for audit; never bulk-delete
 // account data. Dispose the isolated sandbox through an authorized operator.
}

}
await main().catch(()=>{process.stderr.write('{"kind":"stripe_sandbox_qa_failed","reason":"Invalid private sandbox configuration"}\n');process.exitCode=1;});

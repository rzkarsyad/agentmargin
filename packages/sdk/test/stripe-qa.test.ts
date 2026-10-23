import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {QA_TYPES,QaFailure,verifyQaReceipt,qaMode,listenerEnvironment,ListenerDiagnostics,discoverQaEvents,qaStripeTransport,deliveryGaps,resendArguments} from '../../../scripts/lib/stripe-qa.ts';
const run='01234567-0123-4567-89ab-0123456789ab';
const fixture=(type='invoice.paid',id='evt_test')=>({id,type,livemode:false,data:{object:{id:'in_test',metadata:{agentmargin_qa_run:'agentmargin-qa-'+run}}}});
test('QA recovery forbids economic mutations and gates resend to run/mode/account',async()=>{
 const calls:{args:string[];login:boolean}[]=[];
 const cli=qaStripeTransport(async(args,login)=>{calls.push({args,login});return args[1]==='/v1/account'?{id:'acct_test'}:{};},'acct_test',run,'recover');
 assert.equal(qaMode(undefined,true),'recover');assert.throws(()=>qaMode('create',true));assert.throws(()=>qaMode('recover',false));
 await assert.rejects(cli.request('post','/v1/invoices'),/forbidden/);assert.equal(calls.length,0);
 await cli.resend(fixture());assert.deepEqual(calls.map(c=>c.args.slice(0,3)),[['get','/v1/account','--stripe-version'],['events','resend','evt_test']]);assert.ok(calls.every(c=>c.login));
 await assert.rejects(cli.resend({...fixture(),livemode:true}));await assert.rejects(cli.resend(fixture('invoice.paid','evt_test\n--live')));
 assert.throws(()=>resendArguments({...fixture(),account:'acct_connected'},run));
 const wrong=qaStripeTransport(async()=>({id:'acct_other'}),'acct_test',run,'create');await assert.rejects(wrong.request('post','/v1/invoices'),/mismatch/);
 const live=qaStripeTransport(async()=>({id:'acct_test',livemode:true}),'acct_test',run,'recover');await assert.rejects(live.checkAccount());
});
test('QA financial writes check selected account before EACH write and retain deterministic keys',async()=>{
 const calls:string[][]=[];const cli=qaStripeTransport(async args=>{calls.push(args);return {id:'acct_test'};},'acct_test',run,'create');
 await cli.request('post','/v1/invoices',{currency:'eur'},'eur-invoice');await cli.request('post','/v1/refunds',{},'refund');
 assert.deepEqual(calls.map(c=>c[1]),['/v1/account','/v1/invoices','/v1/account','/v1/refunds']);
 assert.ok(calls[1]!.includes('currency=eur'));assert.ok(calls[1]!.includes('agentmargin-qa:'+run+':eur-invoice'));
});
test('QA listener auth isolation and split secret output never expose raw CLI content',()=>{
 const env={STRIPE_API_KEY:'rk_test_private',HTTP_PROXY:'http://proxy',PATH:'/bin'};
 assert.deepEqual(listenerEnvironment(env),{HTTP_PROXY:'http://proxy',PATH:'/bin'});assert.equal(env.STRIPE_API_KEY,'rk_test_private');
 const listener=new ListenerDiagnostics();listener.feed('stderr',Buffer.from('Ready! secret whsec_part'));
 assert.equal(listener.secret,'');listener.feed('stderr',Buffer.from('ial123 (^C to quit)\nsecret-error rk_test_never_log\n'));
 assert.equal(listener.secret,'whsec_partial123');
 listener.feed('stdout',Buffer.from('--> invoice.paid [evt_test]\n<-- [503] POST http://localhost/ [evt_test]\n'));
 const gaps=deliveryGaps([fixture()],listener,[]);assert.equal(gaps.seenWithoutHttp,1);assert.deepEqual(gaps.listenerHttpStatuses,{'503':1});assert.doesNotMatch(JSON.stringify(gaps),/whsec|rk_test|secret-error/);
});
test('QA paginates past unrelated pages, rejects loops and never treats GET events as signed receipts',async()=>{
 let requests=0;
 const found=await discoverQaEvents(async(_path,params)=>{
  requests++;if(params?.type!=='invoice.paid')return {data:[],has_more:false};
  return params.starting_after?{data:[fixture()],has_more:false}:{data:[{...fixture('invoice.paid','evt_unrelated'),data:{object:{metadata:{}}}}],has_more:true};
 },run,Date.now());
 assert.equal(requests,5);assert.equal(found.events.length,1);assert.equal(found.pages,5);
 const listener=new ListenerDiagnostics();assert.equal(deliveryGaps(found.events,listener,[]).missingAtListener,1);assert.equal(deliveryGaps(found.events,listener,[]).received['invoice.paid'],0);
 await assert.rejects(discoverQaEvents(async()=>({data:[fixture()],has_more:true}),run,Date.now()),/cursor/);
});
test('QA verifies literal bytes and timestamp before fixture routing; malformed, expired and live requests fail closed',()=>{
 const secret='whsec_synthetictestonly',now=1800000000,raw=Buffer.from(JSON.stringify(fixture()));
 const sign=(b:Buffer,t=now)=>'t='+t+',v1='+createHmac('sha256',secret).update(t+'.').update(b).digest('hex');
 assert.equal(verifyQaReceipt(raw,sign(raw),secret,now).id,'evt_test');
 const fails=(body:Buffer,signature:string|undefined,category:string)=>assert.throws(()=>verifyQaReceipt(body,signature,secret,now),(e:unknown)=>e instanceof QaFailure&&e.category===category);
 fails(raw,undefined,'signature_missing');fails(Buffer.concat([raw,Buffer.from(' ')]),sign(raw),'signature_invalid');fails(raw,sign(raw,now-301),'signature_expired');fails(raw,'t='+now+','+sign(raw),'signature_invalid');
 const live=Buffer.from(JSON.stringify({...fixture(),livemode:true}));fails(live,sign(live),'account_mode');
 const broken=Buffer.from('{');fails(broken,sign(broken),'body_invalid');
 const gaps=deliveryGaps(QA_TYPES.map(t=>fixture(t,'evt_'+t)),new ListenerDiagnostics(),[{event:fixture(),accepted:false,category:'normalization'}]);
 assert.deepEqual(gaps.rejected,{normalization:1});assert.equal(gaps.accepted['invoice.paid'],0);
});

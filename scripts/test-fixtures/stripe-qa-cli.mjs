#!/usr/bin/env node
/** Fictional CLI protocol fixture ONLY. Never invokes Stripe or claims external QA. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {stripeQaData} from './stripe-qa-data.ts';
const run=process.env.QA_CLI_RUN,control=process.env.QA_CLI_CONTROL;
if(!run||!/^[a-f0-9-]{36}$/.test(run)||!control)throw new Error('Synthetic fixture configuration required');
const now=Number(process.env.QA_CLI_NOW);
if(!Number.isSafeInteger(now)||now<=0)throw new Error('Synthetic fixture time required');
const {events,objects}=stripeQaData(run,now);
const args=process.argv.slice(2),secret='whsec_fictionalclitest';
if(args[0]==='listen'){
 if(process.env.STRIPE_API_KEY)throw new Error('Listener inherited API key');
 const target=new URL(args[args.indexOf('--forward-to')+1]);
 if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/stripe/webhook'||target.username||target.password||target.search||target.hash)throw new Error('Loopback fixture receiver only');
 const server=createServer(async(req,res)=>{
  const event=events.find(e=>e.id===req.url.slice(1));
  if(!event){res.writeHead(404).end();return;}
  process.stdout.write('--> '+event.type+' ['+event.id+']\n');
  if(process.env.QA_CLI_DROP==='true'&&event.type==='refund.updated'){res.end('{}');return;}
  const send=async(e,valid=true)=>{
   const raw=JSON.stringify(e),t=Math.floor(Date.now()/1000);
   const signature='t='+t+',v1='+(valid?createHmac('sha256',secret).update(t+'.'+raw).digest('hex'):'0'.repeat(64));
   const r=await fetch(target,{method:'POST',body:raw,headers:{'stripe-signature':signature}});await r.text();
   process.stdout.write('<-- ['+r.status+'] POST '+target+' ['+event.id+']\n');
  };
  // Exercise separate rejection paths; no unsigned request can reach the ledger.
  if(event===events[0]){
   await send(event,false);
   await send({...event,data:{object:{...event.data.object,metadata:{agentmargin_qa_run:'other'}}}});
   await send({...event,data:{object:{...event.data.object,amount_paid:-1}}});
  }
  await send(event);res.end('{}');
 });
 server.listen(0,'127.0.0.1',()=>{
  writeFileSync(control,String(server.address().port),{mode:0o600});
  process.stderr.write('Ready! Your webhook signing secret is whsec_fictional');
  setTimeout(()=>process.stderr.write('clitest (^C to quit)\n'),30);
 });
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}else if(args[0]==='events'&&args[1]==='resend'){
 if(process.env.STRIPE_API_KEY)throw new Error('Resend inherited API key');
 if(args.includes('--webhook-endpoint')||!events.some(e=>e.id===args[2]))throw new Error('Unscoped resend');
 const port=Number(readFileSync(control,'utf8'));
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid loopback control port');
 const r=await fetch('http://127.0.0.1:'+port+'/'+args[2]);if(!r.ok)throw new Error('Failed synthetic resend');
 console.log('{}');
}else if(args[0]==='get'){
 const params=Object.fromEntries(args.flatMap((a,i)=>a==='-d'?[args[i+1].split(/=(.*)/s).slice(0,2)]:[]));
 const path=args[1];
 if(path==='/v1/account')console.log(JSON.stringify({id:'acct_synthetic',livemode:false}));
 else if(path==='/v1/events'){
  const matching=events.filter(e=>e.type===params.type);
  // Force discovery to paginate past a page with no matching run metadata.
  console.log(JSON.stringify(params.starting_after?{data:matching,has_more:false}:{data:[{id:'evt_page_'+params.type.replaceAll('.','_'),type:params.type,livemode:false,data:{object:{metadata:{}}}}],has_more:true}));
 }else if(path==='/v1/invoice_payments'){
  const inv=params.invoice;console.log(JSON.stringify({data:[{invoice:inv,currency:'usd',payment:{type:'payment_intent',payment_intent:'pi_'+inv}}],has_more:false}));
 }else if(path==='/v1/invoices')console.log(JSON.stringify({data:[objects.in_unpaid],has_more:false}));
 else {const object=objects[path.split('/').at(-1)];if(!object)throw new Error('Unexpected synthetic read');console.log(JSON.stringify(object));}
}else throw new Error('Forbidden CLI operation in recovery fixture '+run);

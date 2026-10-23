/** Full QA harness recovery regression: fictional CLI, real PG16/runtime/API.
 * NO Stripe network access; never counted as genuine sandbox acceptance. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!url)throw new Error('Disposable database required');
const db=new URL(url);
if(db.hostname!=='127.0.0.1'||db.pathname!=='/agentmargin_ci'||db.username!=='agentmargin_ci')throw new Error('Disposable DB only');
const pool=new pg.Pool({connectionString:url}),directory=mkdtempSync(join(tmpdir(),'agentmargin-qa-harness-'));
const role='qa_harness_'+randomUUID().replaceAll('-',''),password=randomUUID();
try{
 const sql=(await pool.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',$1::text,$2::text) AS sql",[role,password])).rows[0].sql;
 await pool.query(sql);
 await pool.query(readFileSync('db/runtime_privileges.psql','utf8').replaceAll(':"runtime_role"','"'+role+'"').replaceAll(":'runtime_role'","'"+role+"'").split('\n').filter(l=>!l.startsWith('--')).join('\n'));
 const runtime=new URL(url);runtime.username=role;runtime.password=password;
 const run=randomUUID(),now=Math.floor(Date.now()/1000)-30,metadata={agentmargin_qa_run:'agentmargin-qa-'+run};
 const invoice=(id:string,amount:number,currency='usd')=>({id,created:now,livemode:false,customer:'cus_qa',currency,status:'paid',amount_paid:amount,status_transitions:{paid_at:now},metadata});
 // Matches official Refund schema: no livemode field on the resource itself.
 const refund=(id:string,amount:number,inv:string)=>({id,created:now,status:'succeeded',currency:'usd',amount,payment_intent:'pi_'+inv,metadata});
 const objects:Record<string,any>={in_29:invoice('in_29',2900),in_99:invoice('in_99',9900),in_eur:invoice('in_eur',1000,'eur'),
  re_partial:refund('re_partial',625,'in_29'),re_full:refund('re_full',9900,'in_99'),
  cn_credit:{id:'cn_credit',livemode:false,created:now,status:'issued',type:'post_payment',currency:'usd',invoice:'in_29',customer:'cus_qa',amount:1200,pre_payment_amount:0,post_payment_amount:1200,out_of_band_amount:0,refunds:[],customer_balance_transaction:'cbtxn_qa',metadata},
  in_unpaid:{...invoice('in_unpaid',0),status:'open',amount_due:1500}};
 const events=[['invoice.paid','in_29'],['invoice.paid','in_99'],['invoice.paid','in_eur'],['refund.created','re_partial'],['refund.created','re_full'],['refund.updated','re_partial'],['refund.updated','re_full'],['credit_note.created','cn_credit']].map(([type,id],i)=>({id:'evt_qa_'+i,type,livemode:false,created:now,api_version:i%2?'2026-09-30.endive':'2025-03-31.basil',data:{object:objects[id!]}}));
 const config=join(directory,'fixture.json');writeFileSync(config,JSON.stringify({run,events,objects,control:join(directory,'control')}),{mode:0o600});
 const wrapper=join(directory,'stripe');writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" "'+resolve('scripts/test-fixtures/stripe-qa-cli.mjs')+'" "$@"\n',{mode:0o700});
 for(const drop of [false,true]){
  const evidence=join(directory,drop?'missing':'complete');mkdirSync(evidence,{mode:0o700});
  writeFileSync(join(evidence,'qa-run.json'),JSON.stringify({run,account:'acct_synthetic',createdAt:(now-5)*1000}),{mode:0o600});
  let stdout='',stderr='',code=0;
  try{({stdout,stderr}=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/stripe-sandbox-qa.ts'],{timeout:45000,maxBuffer:2_000_000,env:{...process.env,
   PATH:directory+':'+process.env.PATH,QA_CLI_FIXTURE:config,QA_CLI_DROP:String(drop),AGENTMARGIN_STRIPE_SANDBOX_QA:'test-only',AGENTMARGIN_SANDBOX_MODE:'recover',
   STRIPE_SANDBOX_ACCOUNT_ID:'acct_synthetic',STRIPE_API_KEY:'rk_test_synthetic_private',AGENTMARGIN_SANDBOX_RUNTIME_URL:runtime.toString(),AGENTMARGIN_SANDBOX_EVIDENCE:evidence,AGENTMARGIN_SANDBOX_DELIVERY_TIMEOUT_MS:'1000'}}));}
  catch(error){const e=error as {code:number;stdout:string;stderr:string};code=e.code;stdout=e.stdout;stderr=e.stderr;}
  assert.doesNotMatch(stdout+stderr,/rk_test_synthetic_private|whsec_fictionalclitest|cus_qa|in_29|evt_qa/);
  if(!drop){
   assert.equal(code,0,stderr);const results=readdirSync(evidence).filter(n=>n.startsWith(run+'-'));assert.equal(results.length,1);
   const report=JSON.parse(readFileSync(join(evidence,results[0]!),'utf8'));assert.equal(report.ledger.summary.netRevenueMicros,'10750000');
   assert.equal(report.ledger.summary.grossRevenueMicros,'128000000');assert.equal(report.ledger.summary.refundsMicros,'105250000');assert.equal(report.ledger.summary.creditsMicros,'12000000');
   assert.equal(report.reconciliation.reconciliation.summary.varianceMicros,'0');assert.ok(readdirSync(evidence).some(n=>n.includes('-receipt-')));
   assert.match(stdout,/signature_invalid/);assert.match(stdout,/fixture_mismatch/);assert.match(stdout,/unsupported_fx/);assert.match(stdout,/normalization/);
  }else{
   assert.equal(code,1,stderr);const failure=JSON.parse(stderr.trim().split('\n').find(l=>l.includes('stripe_sandbox_qa_failed'))!);
   assert.equal(failure.stage,'webhook-delivery');assert.equal(failure.seenWithoutHttp,2);assert.equal(failure.expected['refund.updated'],2);assert.equal(failure.received['refund.updated'],0);
   assert.ok(readdirSync(evidence).some(n=>n.endsWith('-failure.json')));
  }
 }
 console.log('Fictional Stripe CLI -> recovery harness -> restricted PostgreSQL: PASSED (not genuine sandbox evidence)');
}finally{
 await pool.query('DROP OWNED BY "'+role+'"');await pool.query('DROP ROLE "'+role+'"');await pool.end();rmSync(directory,{recursive:true,force:true});
}

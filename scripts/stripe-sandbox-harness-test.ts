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
 const run=randomUUID(),now=Math.floor(Date.now()/1000)-30;
 const wrapper=join(directory,'stripe');writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" --experimental-strip-types "'+resolve('scripts/test-fixtures/stripe-qa-cli.mjs')+'" "$@"\n',{mode:0o700});
 for(const drop of [false,true]){
  const evidence=join(directory,drop?'missing':'complete');mkdirSync(evidence,{mode:0o700});
  writeFileSync(join(evidence,'qa-run.json'),JSON.stringify({run,account:'acct_synthetic',createdAt:(now-5)*1000}),{mode:0o600});
  let stdout='',stderr='',code=0;
  try{({stdout,stderr}=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/stripe-sandbox-qa.ts'],{timeout:45000,maxBuffer:2_000_000,env:{...process.env,
   PATH:directory+':'+process.env.PATH,QA_CLI_RUN:run,QA_CLI_NOW:String(now),QA_CLI_CONTROL:join(directory,'control'),QA_CLI_DROP:String(drop),AGENTMARGIN_STRIPE_SANDBOX_QA:'test-only',AGENTMARGIN_SANDBOX_MODE:'recover',
   STRIPE_SANDBOX_ACCOUNT_ID:'acct_synthetic',STRIPE_API_KEY:'rk_test_synthetic_private',AGENTMARGIN_SANDBOX_RUNTIME_URL:runtime.toString(),AGENTMARGIN_SANDBOX_EVIDENCE:evidence,AGENTMARGIN_SANDBOX_DELIVERY_TIMEOUT_MS:'1000'}}));}
  catch(error){const e=error as {code:number;stdout:string;stderr:string};code=e.code;stdout=e.stdout;stderr=e.stderr;}
  assert.doesNotMatch(stdout+stderr,/rk_test_synthetic_private|whsec_fictionalclitest|cus_qa|in_29|evt_qa/);
  if(!drop){
   assert.equal(code,0,stderr);const results=readdirSync(evidence).filter(n=>n.startsWith(run+'-'));assert.equal(results.length,1);
   const report=JSON.parse(readFileSync(join(evidence,results[0]!),'utf8'));assert.equal(report.ledger.summary.netRevenueMicros,'10750000');
   assert.equal(report.ledger.summary.grossRevenueMicros,'128000000');assert.equal(report.ledger.summary.refundsMicros,'105250000');assert.equal(report.ledger.summary.creditsMicros,'12000000');
   assert.equal(report.reconciliation.reconciliation.summary.varianceMicros,'0');
   // Eight real HTTP fixture events plus one signed normalization rejection;
   // the unsigned and wrong-run requests must never create receipt files.
   assert.equal(readdirSync(evidence).filter(n=>n.includes('-receipt-')).length,9);
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

/** Fetches the already published alpha. Never builds or publishes repository SDK. */
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const versionIndex=process.argv.indexOf('--version');
const version=versionIndex<0?'0.4.0-alpha.2':process.argv[versionIndex+1];
if(!version||!/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(version))throw new Error('Explicit published SDK version required');
const directory=mkdtempSync(join(tmpdir(),'agentmargin-registry-consumer-'));
if(resolve(directory).startsWith(resolve(new URL('..',import.meta.url).pathname)))throw new Error('Consumer must live outside repository');
const run=(command,args)=>execFileSync(command,args,{cwd:directory,encoding:'utf8',timeout:120000,env:{...process.env,npm_config_fetch_timeout:'20000'}});
try{
  writeFileSync(join(directory,'package.json'),JSON.stringify({name:'agentmargin-independent-artifact-smoke',private:true,type:'module'}));
  run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--save-exact','@makinohq/agentmargin@'+version,'typescript@5.9.3']);
  const installed=JSON.parse(readFileSync(join(directory,'node_modules/@makinohq/agentmargin/package.json'),'utf8'));
  if(installed.version!==version)throw new Error('Unexpected registry SDK version');
  const consumer=`import {AgentMarginClient,fromAnthropicMessage,stripeInvoicePaidToRevenue,type UsageInput,type RevenueInput} from '@makinohq/agentmargin';
const event:UsageInput={id:'synthetic-usage',customerId:'synthetic-customer',model:'synthetic-model',occurredAt:'2026-10-10T00:00:00Z',inputTokens:100,outputTokens:50};
const revenue:RevenueInput={id:'synthetic-payment',customerId:'synthetic-customer',occurredAt:event.occurredAt,amountMicros:'1000000'};
let calls=0;
const client=new AgentMarginClient({endpoint:'http://127.0.0.1:8787',apiKey:'am_'+'x'.repeat(43),fetchImpl:async(_url,init)=>{
 if(!init?.body||!(init.headers as Record<string,string>).authorization)throw new Error('Missing payload/auth');
 calls++;return new Response(JSON.stringify({inserted:1,duplicate:0,received:1}),{status:202});
}});
await client.track([event]);await client.trackRevenue([revenue]);
await client.trackOpenAIResponse({id:'synthetic-response',model:event.model,created_at:1791590400,usage:{input_tokens:100,output_tokens:50}},event.customerId);
const anthropic=fromAnthropicMessage({id:'synthetic-message',model:event.model,usage:{input_tokens:80,output_tokens:50,cache_read_input_tokens:20}},event.customerId,event.occurredAt);
if(anthropic.inputTokens!==100||typeof stripeInvoicePaidToRevenue!=='function'||calls!==3)throw new Error('Invalid registry exports');
`;
  writeFileSync(join(directory,'consumer.ts'),consumer);
  run(process.execPath,[join(directory,'node_modules/typescript/bin/tsc'),'--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--lib','ES2022,DOM','--strict','consumer.ts']);
  run(process.execPath,['--experimental-strip-types','consumer.ts']);
  const metadata=JSON.parse(run('npm',['view','@makinohq/agentmargin@'+version,'--json']));
  if(!metadata.dist?.integrity||metadata.dist?.attestations?.provenance?.predicateType!=='https://slsa.dev/provenance/v1')throw new Error('Missing registry integrity/provenance metadata');
  console.log('PASS: npm '+version+' installed outside repository; ESM, TypeScript, usage/revenue and provider exports consumed; registry integrity and SLSA provenance metadata present.');
  if(process.argv.includes('--verify-signatures'))console.log(run('npm',['audit','signatures']));
}finally{rmSync(directory,{recursive:true,force:true});}

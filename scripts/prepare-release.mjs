/** Prepare verifiable alpha artifacts; never tags, publishes or deploys. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve('.'),out=resolve(process.argv[2]??'');
if(!process.argv[2]||!relative(root,out).startsWith('..'))throw new Error('Artifact directory must be outside checkout');
const run=(cmd,args,options={})=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,...options});
if(run('git',['status','--porcelain']).trim())throw new Error('Commit reviewed source before preparing artifacts');
const platform=JSON.parse(readFileSync('package.json')).version,sdk=JSON.parse(readFileSync('packages/sdk/package.json')).version;
if(platform!=='0.9.0-alpha.1'||sdk!=='0.5.0-alpha.1')throw new Error('Unexpected alpha versions');
run('git',['merge-base','--is-ancestor','ec812275ce4ba3a030f981942fe15d619a21820d','HEAD']);
mkdirSync(out,{mode:0o700});
const [packed]=JSON.parse(run('npm',['pack','--workspace','@makinohq/agentmargin','--ignore-scripts','--json','--pack-destination',out]));
const tarball=join(out,packed.filename),consumer=mkdtempSync(join(tmpdir(),'agentmargin-candidate-consumer-'));
try{
 writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'agentmargin-candidate-consumer',private:true,type:'module'}));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund',tarball,'typescript@5.9.3'],{cwd:consumer});
 writeFileSync(join(consumer,'consumer.ts'),`
import {AgentMarginClient,stripeEventToFinancialDelivery,type AdjustmentInput,type RevenueDeliveryInput} from '@makinohq/agentmargin';
const client=new AgentMarginClient({endpoint:'http://127.0.0.1:8787',apiKey:'am_'+'x'.repeat(43),fetchImpl:async()=>new Response(JSON.stringify({duplicate:false,state:'pending',inserted:1,duplicateCount:0}),{status:202})});
const record:AdjustmentInput={originalPaymentId:'synthetic',customerId:'synthetic',kind:'refund',amountMicros:'1',currency:'USD',occurredAt:'2026-10-10T00:00:00Z',provider:'import',providerAccount:'synthetic',sourceObjectId:'synthetic',evidenceRef:'synthetic'};
const payment:RevenueDeliveryInput={providerEventId:'evt_synthetic',providerAccount:'synthetic',record:{id:'synthetic',customerId:'synthetic',occurredAt:record.occurredAt,amountMicros:'1'}};
await client.trackAdjustments([record]);await client.enqueueAdjustmentDelivery({...payment,record});await client.enqueueRevenueDelivery(payment);
if(typeof stripeEventToFinancialDelivery!=='function')throw new Error('Missing Stripe export');
`);
 run(process.execPath,[join(consumer,'node_modules/typescript/bin/tsc'),'--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--lib','ES2022,DOM','--strict','consumer.ts'],{cwd:consumer});
 run(process.execPath,['--experimental-strip-types','consumer.ts'],{cwd:consumer});
}finally{rmSync(consumer,{recursive:true,force:true});}
const source='agentmargin-v'+platform+'.tar.gz';
run('git',['archive','--format=tar.gz','--output',join(out,source),'HEAD']);
const sha=(p)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest={preparedOnly:true,published:false,platformVersion:platform,sdkVersion:sdk,
 sourceCommit:run('git',['rev-parse','HEAD']).trim(),sourceTree:run('git',['rev-parse','HEAD^{tree}']).trim(),
 workflowRun:process.env.GITHUB_RUN_ID?'https://github.com/rzkarsyad/agentmargin/actions/runs/'+process.env.GITHUB_RUN_ID:null,
 artifacts:[source,packed.filename].map(name=>({name,sha256:sha(join(out,name))})),npmIntegrity:packed.integrity,
 migrations:readdirSync('db').filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort().map(name=>({name,sha256:sha(join('db',name))})),
 consumer:{outsideRepository:true,esm:true,typescript:true,newAdjustmentDeliveryMethods:true},
 externalEvidence:{openAiExportConsistency:{status:'conditional_organization_level_pass',reportedOn:'2026-10-24',timezone:'Asia/Jakarta',model:'gpt-6-luna',requests:1,inputTokens:25,outputTokens:13,cachedInputTokens:0,calculatedMicros:'9',billedMicros:'9',varianceMicros:'0',projectCostProven:false,apiKeyCostProven:false,historicalEffectiveDateProven:false,originalResponseIngestionProven:false,source:'Private authentic exports validated locally; docs/OPENAI_INTEGRATION.md; no private exports or identifiers included'},genuineOpenAiSecondRequest:{status:'operator_reported_identity_and_local_pipeline_pass',reportedOn:'2026-10-24',timezone:'Asia/Jakarta',usageUtcDate:'2026-10-23',model:'gpt-6-luna',inputTokens:10,outputTokens:5,cachedInputTokens:0,recordedMicros:'4',organizationCostDeltaMicros:'3.5',reportedAggregateLedgerMicros:'13',reportedAggregateProviderMicros:'12.5',varianceMicros:'0.5',responseIdentityPreserved:true,projectCostProven:false,historicalEffectiveDateProven:false,privateFilesInspectedByAgent:false,financialPolicyApproved:false,source:'Founder aggregate attestation; docs/OPENAI_INTEGRATION.md; no private metadata/exports or response IDs included'},genuineSignedStripeQA:{status:'operator_verified_pass',reportedOn:'2026-10-24',timezone:'Asia/Jakarta',testMode:true,signatureVerifiedEvents:8,acceptedFinancialEvents:7,unsupportedFxEvents:1,grossMicros:'128000000',refundsMicros:'105250000',creditsMicros:'12000000',netMicros:'10750000',varianceMicros:'0',source:'Operator aggregate attestation in docs/INTEGRATIONS.md; private receipts not included; no independent agent verification'}},
 externalGates:['independent_security_review','accounting_policy','official_provider_billing','protected_main_integration','release_authorization']};
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(join(out,'SHA256SUMS'),manifest.artifacts.map(a=>a.sha256+'  '+a.name).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('PASS: prepared alpha source/SDK artifacts, hashes and clean ESM/TypeScript consumer; nothing published');

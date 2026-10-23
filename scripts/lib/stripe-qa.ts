/** Sandbox harness internals. Diagnostics are an allowlist, never CLI/error text. */
import {createHmac,timingSafeEqual} from 'node:crypto';
export const QA_TYPES=['invoice.paid','refund.created','refund.updated','credit_note.created'] as const;
export type QaCategory='signature_missing'|'signature_invalid'|'signature_expired'|'body_invalid'|'body_oversize'|'account_mode'|'fixture_mismatch'|'fixture_mapping_pending'|'unsupported_fx'|'normalization'|'normalized_delivery'|'evidence_write'|'accepted'|'ignored';
export class QaFailure extends Error {
 readonly category:QaCategory;readonly status:number;
 constructor(category:QaCategory,status:number){super(category);this.category=category;this.status=status;}
}
export function listenerEnvironment(source:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
 const env={...source};delete env.STRIPE_API_KEY;return env;
}
export function qaMode(value:string|undefined,existing:boolean):'create'|'recover'{
 const mode=value??'recover';
 if(!['create','recover'].includes(mode)||mode==='create'&&existing||mode==='recover'&&!existing)
  throw new Error('Create requires a new directory; recover requires the existing qa-run.json');
 return mode as 'create'|'recover';
}
export function verifyQaReceipt(raw:Buffer,signature:string|undefined,secret:string,now=Math.floor(Date.now()/1000)):Record<string,any>{
 if(!signature||signature.length>3000)throw new QaFailure('signature_missing',400);
 if(!raw.length||raw.length>256000)throw new QaFailure('body_oversize',413);
 const times=signature.split(',').filter(s=>s.startsWith('t=')).map(s=>s.slice(2));
 if(!/^whsec_[A-Za-z0-9]{6,}$/.test(secret)||times.length!==1||! /^[1-9]\d{8,14}$/.test(times[0]??''))throw new QaFailure('signature_invalid',400);
 const t=Number(times[0]);
 if(!Number.isSafeInteger(t)||Math.abs(now-t)>300)throw new QaFailure('signature_expired',400);
 const mac=createHmac('sha256',secret).update(times[0]+'.').update(raw).digest();
 if(!signature.split(',').some(s=>/^v1=[a-f0-9]{64}$/i.test(s)&&timingSafeEqual(Buffer.from(s.slice(3),'hex'),mac)))throw new QaFailure('signature_invalid',400);
 let e:Record<string,any>;
 try{e=JSON.parse(raw.toString('utf8'));}catch{throw new QaFailure('body_invalid',400);}
 if(!e||!/^evt_[A-Za-z0-9_]{1,196}$/.test(e.id)||!e.data?.object||typeof e.data.object!=='object')throw new QaFailure('body_invalid',400);
 if(e.livemode!==false||e.account!=null)throw new QaFailure('account_mode',400);
 return e;
}
export function isRunEvent(event:Record<string,any>,run:string):boolean{
 return event.livemode===false&&event.account==null&&QA_TYPES.includes(event.type)&&
  event.data?.object?.metadata?.agentmargin_qa_run==='agentmargin-qa-'+run;
}
export type QaGet=(path:string,data?:Record<string,string|number|boolean>)=>Promise<Record<string,any>>;
export function qaStripeTransport(execute:(args:string[],login:boolean)=>Promise<Record<string,any>>,account:string,run:string,mode:'create'|'recover'){
 const checked=async(args:string[],login=false)=>{
  const result=await execute(args,login);
  if(result.error||result.livemode===true)throw new Error('Stripe test operation rejected');
  return result;
 };
 const checkAccount=async(login=false)=>{
  if((await checked(['get','/v1/account','--stripe-version','2026-09-30.endive'],login)).id!==account)throw new Error('Stripe account mismatch');
 };
 const request=async(method:string,path:string,data:Record<string,string|number|boolean>={},operation='read')=>{
  if(!['get','post'].includes(method)||!path.startsWith('/v1/')||method==='post'&&mode!=='create')throw new Error('Financial writes forbidden in recovery');
  if(method==='post')await checkAccount();
  const args=[method,path,'--stripe-version','2026-09-30.endive'];
  if(method==='post')args.push('--idempotency','agentmargin-qa:'+run+':'+operation);
  for(const [k,v] of Object.entries(data))args.push('-d',k+'='+String(v));
  return checked(args);
 };
 return {request,checkAccount,resend:async(event:Record<string,any>)=>{
  const args=resendArguments(event,run);await checkAccount(true);await checked(args,true);
 }};
}
/** Full bounded pagination, including pages with no matching run. API data is
 * discovery evidence ONLY: callers still require a fresh signed HTTP receipt. */
export async function discoverQaEvents(get:QaGet,run:string,createdAt:number,now=Date.now()){
 const result:Record<string,any>[]=[];let pages=0;
 for(const type of QA_TYPES){
  let cursor='';const seen=new Set<string>();
  for(let page=0;;page++){
   if(page>=100)throw new Error('Event pagination bound exceeded');
   const response=await get('/v1/events',{type,limit:100,'created[gte]':Math.floor(createdAt/1000)-5,'created[lte]':Math.floor(now/1000),...(cursor?{starting_after:cursor}:{})});pages++;
   if(!Array.isArray(response.data)||typeof response.has_more!=='boolean')throw new Error('Invalid event page');
   for(const event of response.data){if(event.type!==type||event.livemode!==false)throw new Error('Unexpected event page');if(isRunEvent(event,run))result.push(event);}
   if(!response.has_more)break;
   const next=response.data.at(-1)?.id;
   if(typeof next!=='string'||!/^evt_[A-Za-z0-9_]+$/.test(next)||seen.has(next))throw new Error('Invalid event cursor');
   seen.add(next);cursor=next;
  }
 }
 if(result.length>100)throw new Error('Run event bound exceeded');
 return {events:result,pages};
}
export function countQaTypes(events:Record<string,any>[]){return Object.fromEntries(QA_TYPES.map(t=>[t,new Set(events.filter(e=>e.type===t).map(e=>e.id)).size]));}
/** v1.55.1 adds for_stripecli=true ONLY via this command with no endpoint flag.
 * This requests genuine delivery; its exit status does not prove delivery. */
export function resendArguments(event:Record<string,any>,run:string){
 if(!isRunEvent(event,run)||!/^evt_[A-Za-z0-9_]{1,196}$/.test(event.id))throw new Error('Refuse unrelated replay');
 return ['events','resend',event.id,'--color','off'];
}
export class ListenerDiagnostics {
 secret='';seen=new Set<string>();responses:Record<string,number>={};ready=false;
 private pending={stdout:'',stderr:''};
 feed(stream:'stdout'|'stderr',chunk:Buffer){
  const text=this.pending[stream]+chunk.toString('utf8'),lines=text.split(/[\r\n]/);
  this.pending[stream]=lines.pop()!.slice(-8192);
  for(const line of lines){
   const s=line.match(/\bwhsec_[A-Za-z0-9]{6,}\b/);if(s)this.secret=s[0];
   if(line.includes('Ready!'))this.ready=true;
   const id=line.match(/\[(evt_[A-Za-z0-9_]+)\]/)?.[1];
   if(id&&line.includes('-->'))this.seen.add(id);
   const status=line.match(/<--\s*\[(\d{3})\]/)?.[1];
   if(id&&status)this.responses[id]=Number(status);
  }
 }
}
export function deliveryGaps(expected:Record<string,any>[],listener:ListenerDiagnostics,receipts:{event:Record<string,any>;accepted:boolean;category:QaCategory}[]){
 return {expected:countQaTypes(expected),received:countQaTypes(receipts.map(r=>r.event)),
  accepted:countQaTypes(receipts.filter(r=>r.accepted).map(r=>r.event)),
  missingAtListener:expected.filter(e=>!listener.seen.has(e.id)&&!receipts.some(r=>r.event.id===e.id)).length,
  seenWithoutHttp:expected.filter(e=>listener.seen.has(e.id)&&!receipts.some(r=>r.event.id===e.id)).length,
  rejected:receipts.filter(r=>!r.accepted).reduce((a,r)=>{a[r.category]=(a[r.category]??0)+1;return a;},{} as Record<string,number>),
  listenerHttpStatuses:Object.values(listener.responses).reduce((a,s)=>{a[s]=(a[s]??0)+1;return a;},{} as Record<string,number>)};
}

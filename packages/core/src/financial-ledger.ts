/** Persisted ledger evidence -> exact period totals and signed reconciliation. */
import {createHash} from 'node:crypto';
import {parseAdjustment,type StoredAdjustment} from './adjustments.ts';
import {reconcileFinancialRecords,type ReconciliationInput,type UnresolvedFinancialEvidence} from './reconciliation.ts';
export interface LedgerPayment {
 id:string;customerId:string;occurredAt:string;amountMicros:string;currency:'USD';payloadDigest:string|null;
 providerAccount:string|null;providerEventId:string|null;
}
export interface LedgerUsage {
 id:string;customerId:string;occurredAt:string;costMicros:string|null;source:'reported'|'estimated'|'unknown';
 pricingRef:string|null;model:string;
}
export interface FinancialLedgerInput {
 workspaceId:string;currency:'USD';periodStart:string;periodEnd:string;
 /** Includes originals outside the selected period when referenced by adjustments. */
 payments:LedgerPayment[];adjustments:StoredAdjustment[];usage:LedgerUsage[];
 unresolvedEvidence:UnresolvedFinancialEvidence[];
}
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=500;
function time(v:string):number{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v))||
   new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==v.slice(0,10))throw new Error('Invalid ledger time');
 return Date.parse(v);
}
function amount(v:string):bigint{
 if(typeof v!=='string'||!/^(?:0|[1-9]\d{0,18})$/.test(v)||BigInt(v)>9223372036854775807n)throw new Error('Invalid ledger amount');
 return BigInt(v);
}
function unique<T extends {id:string}>(rows:T[]):T[]{
 if(!Array.isArray(rows)||rows.length>10000)throw new Error('Ledger export exceeds bounded report size');
 const map=new Map<string,T>();
 for(const row of rows){
  if(!row||!validId(row.id))throw new Error('Invalid ledger row');
  const old=map.get(row.id);if(old&&canonical(old)!==canonical(row))throw new Error('Conflicting ledger evidence');
  map.set(row.id,row);
 }
 return [...map.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
export function summarizeFinancialLedger(input:FinancialLedgerInput){
 if(!input||!validId(input.workspaceId)||input.currency!=='USD')throw new Error('Invalid ledger scope');
 const start=time(input.periodStart),end=time(input.periodEnd);if(end<=start)throw new Error('Invalid ledger period');
 const payments=unique(input.payments),adjustments=unique(input.adjustments),usage=unique(input.usage);
 if(!Array.isArray(input.unresolvedEvidence)||input.unresolvedEvidence.length>10000)throw new Error('Invalid unresolved evidence');
 const unresolved=unique(input.unresolvedEvidence);
 // Reuse runtime validation for explicit FX/tier/unmatched diagnostics.
 reconcileFinancialRecords({scope:{workspaceId:input.workspaceId,provider:'ledger',accountId:'workspace',currency:'USD',kind:'revenue',
   periodStart:input.periodStart,periodEnd:input.periodEnd},recordedExportRef:'ledger:validation',billingExportRef:'ledger:validation',
   records:[],billed:[],tolerance:{absoluteMicros:'0',basisPoints:0},unresolvedEvidence:unresolved});
 const inPeriod=(at:string)=>{const n=time(at);return n>=start&&n<end;};
 const byId=new Map(payments.map(p=>[p.id,p]));
 let gross=0n,refunds=0n,credits=0n,reversals=0n,cost=0n,unknown=0;
 for(const p of payments){
  if(!validId(p.customerId)||p.currency!=='USD'||(p.payloadDigest!==null&&!validId(p.payloadDigest))||
    (p.providerAccount!==null&&!validId(p.providerAccount))||(p.providerEventId!==null&&!validId(p.providerEventId)))throw new Error('Invalid payment evidence');
  const n=amount(p.amountMicros);if(inPeriod(p.occurredAt))gross+=n;
 }
 const reductions=new Map<string,bigint>();
 for(const a of adjustments){
  const parsed=parseAdjustment(a);
  if(parsed.id!==a.id||parsed.payloadDigest!==a.payloadDigest)throw new Error('Adjustment evidence digest mismatch');
  const original=byId.get(a.originalPaymentId);
  if(!original||original.customerId!==a.customerId||original.currency!==a.currency||time(a.occurredAt)<time(original.occurredAt)||
    (a.provider==='stripe'&&original.providerAccount!==a.providerAccount))throw new Error('Unmatched adjustment original');
  if(!inPeriod(a.occurredAt))throw new Error('Adjustment outside report period');
  const n=amount(a.amountMicros),total=(reductions.get(a.originalPaymentId)??0n)+n;
  if(total>amount(original.amountMicros))throw new Error('Adjustments exceed payment');reductions.set(a.originalPaymentId,total);
  if(a.kind==='refund')refunds+=n;else if(a.kind==='credit')credits+=n;else reversals+=n;
 }
 for(const u of usage){
  if(!validId(u.customerId)||!validId(u.model)||!inPeriod(u.occurredAt)||!['reported','estimated','unknown'].includes(u.source)||
    ((u.costMicros===null)!==(u.source==='unknown'))||(u.source==='estimated'&&!validId(u.pricingRef)))throw new Error('Invalid usage evidence');
  if(u.costMicros===null)unknown++;else cost+=amount(u.costMicros);
 }
 const net=gross-refunds-credits-reversals,complete=unknown===0&&unresolved.length===0;
 const inputs=structuredClone({...input,payments,adjustments,usage,unresolvedEvidence:unresolved});
 return {schemaVersion:1,inputDigest:hash(inputs),inputs,summary:{currency:'USD',grossRevenueMicros:gross.toString(),refundsMicros:refunds.toString(),
   creditsMicros:credits.toString(),paymentReversalsMicros:reversals.toString(),netRevenueMicros:net.toString(),knownInferenceCostMicros:cost.toString(),
   knownContributionMicros:(net-cost).toString(),completeContributionMicros:complete?(net-cost).toString():null,
   unknownCostEvents:unknown,unresolvedEvidenceCount:unresolved.length,complete}};
}
/** Billing allocations use `payment:<stored id>` / `adjustment:<stored id>`.
 * Scope excludes other known accounts; missing account provenance stays unresolved.
 */
export function reconcileLedgerRevenue(input:FinancialLedgerInput,billing:Omit<ReconciliationInput,'records'|'recordedExportRef'>){
 const ledger=summarizeFinancialLedger(input);
 if(billing.scope.workspaceId!==input.workspaceId||billing.scope.currency!==input.currency||billing.scope.kind!=='revenue'||
   time(billing.scope.periodStart)!==time(input.periodStart)||time(billing.scope.periodEnd)!==time(input.periodEnd)||billing.scope.provider!=='stripe')
   throw new Error('Ledger/billing scope mismatch');
 const within=(at:string)=>time(at)>=time(input.periodStart)&&time(at)<time(input.periodEnd);
 const unknownAccount=ledger.inputs.payments.filter(p=>within(p.occurredAt)&&p.providerAccount===null).map(p=>({
   id:'unmapped:'+p.id,sourceRef:'payment:'+p.id,reason:'unmatched_transaction' as const}));
 const records=[...ledger.inputs.payments.filter(p=>within(p.occurredAt)&&p.providerAccount===billing.scope.accountId).map(p=>({
   id:'payment:'+p.id,sourceRef:p.providerEventId??p.id,currency:'USD',occurredAt:p.occurredAt,amountMicros:p.amountMicros,source:'reported' as const})),
 ...ledger.inputs.adjustments.filter(a=>a.provider==='stripe'&&a.providerAccount===billing.scope.accountId).map(a=>({
   id:'adjustment:'+a.id,sourceRef:a.evidenceRef,currency:'USD',occurredAt:a.occurredAt,amountMicros:(-BigInt(a.amountMicros)).toString(),source:'reported' as const}))];
 const reconciliation=reconcileFinancialRecords({...billing,records,recordedExportRef:'ledger:sha256:'+ledger.inputDigest,
   unresolvedEvidence:[...ledger.inputs.unresolvedEvidence,...unknownAccount,...(billing.unresolvedEvidence??[])]});
 return {ledger,reconciliation};
}

export const serializeLedgerReconciliation=(report:ReturnType<typeof reconcileLedgerRevenue>):string=>canonical(report)+'\n';

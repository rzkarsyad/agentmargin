/** Offline reconciliation. No network requests, ledger mutations or FX guesses. */
import {createHash} from 'node:crypto';
export interface ReconciliationScope {
  workspaceId:string; provider:string; accountId:string; currency:string;
  periodStart:string; periodEnd:string; kind:'cost'|'revenue';
}
export interface TokenEvidence {input:number;output:number;cachedInput:number}
export interface RecordedFinancialEntry {
  id:string; sourceRef:string; currency:string; occurredAt:string;
  amountMicros:string|null; source:'reported'|'estimated'|'unknown';
  pricingRef?:string; unknownReason?:string; tokens?:TokenEvidence;
}
export interface BilledFinancialEntry {
  id:string; sourceRef:string; currency:string; occurredAt:string;
  amountMicros:string; kind:'charge'|'credit'|'adjustment';
  /** Explicit attribution supplied by an audited importer; never fuzzy matched. */
  recordIds:string[]; tokens?:TokenEvidence;
}
export interface ReconciliationInput {
  scope:ReconciliationScope;
  /** Immutable export/invoice evidence references; do not put credentials here. */
  recordedExportRef:string; billingExportRef:string;
  records:RecordedFinancialEntry[]; billed:BilledFinancialEntry[];
  tolerance:{absoluteMicros:string;basisPoints:number};
}
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=500;
const amount=(value:unknown):bigint=>{
  if(typeof value!=='string'||! /^(?:0|-?[1-9]\d{0,18})$/.test(value))throw new Error('Invalid signed micro amount');
  const n=BigInt(value);
  if(n < -9223372036854775807n||n>9223372036854775807n)throw new Error('Amount exceeds ledger bounds');
  return n;
};
const time=(value:string):number=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Explicit timestamp required');
  if(new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new Error('Invalid calendar date');
  return Date.parse(value);
};
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined)
    .sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
function tokens(value:TokenEvidence|undefined):void {
  if(value===undefined)return;
  if(!value||![value.input,value.output,value.cachedInput].every(n=>Number.isSafeInteger(n)&&n>=0)||value.cachedInput>value.input)throw new Error('Invalid cached token evidence');
}
function unique<T extends {id:string}>(entries:T[]):T[]{
  const map=new Map<string,T>();
  for(const entry of entries){
    if(!id(entry.id))throw new Error('Invalid evidence identifier');
    const old=map.get(entry.id);
    if(old&&canonical(old)!==canonical(entry))throw new Error('Conflicting duplicate evidence identifier');
    map.set(entry.id,entry);
  }
  return [...map.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
const abs=(n:bigint)=>n<0n?-n:n;
export function reconcileFinancialRecords(input:ReconciliationInput){
  // Runtime validation matters: this interface is also consumed from JSON files.
  if(!input||!input.scope||!input.tolerance||!Array.isArray(input.records)||!Array.isArray(input.billed))throw new Error('Invalid reconciliation input');
  if(input.records.length>10000||input.billed.length>10000)throw new Error('Invalid reconciliation bounds');
  let allocations=0;
  for(const row of input.records)if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid recorded evidence');
  for(const line of input.billed){
    // Validate the original JSON shape before copying/sorting: strings are iterable.
    if(!line||typeof line!=='object'||Array.isArray(line)||!Array.isArray(line.recordIds)||
      line.recordIds.length>10000||!line.recordIds.every(id))throw new Error('Invalid billing allocation');
    allocations+=line.recordIds.length;
    if(allocations>20000)throw new Error('Too many billing allocations');
  }
  input=structuredClone(input);
  const {scope}=input;
  if(![scope.workspaceId,scope.provider,scope.accountId,input.recordedExportRef,input.billingExportRef].every(id)||
    !['cost','revenue'].includes(scope.kind)||! /^[A-Z]{3}$/.test(scope.currency))throw new Error('Invalid reconciliation scope');
  const start=time(scope.periodStart),end=time(scope.periodEnd);
  if(end<=start||input.records.length>10000||input.billed.length>10000)throw new Error('Invalid reconciliation bounds');
  const absolute=amount(input.tolerance.absoluteMicros),bps=input.tolerance.basisPoints;
  if(absolute<0n||!Number.isInteger(bps)||bps<0||bps>10000)throw new Error('Invalid tolerance');
  const records=unique(input.records),billed=unique(input.billed.map(line=>({...line,recordIds:[...line.recordIds].sort()})));
  const within=(entry:{sourceRef:string;currency:string;occurredAt:string;tokens?:TokenEvidence})=>{
    if(!id(entry.sourceRef)||entry.currency!==scope.currency)throw new Error('Currency/source mismatch: explicit audited conversion required');
    const at=time(entry.occurredAt);
    if(at<start||at>=end)throw new Error('Evidence falls outside reconciliation period');
    tokens(entry.tokens);
  };
  for(const record of records){
    within(record);
    if(!['reported','estimated','unknown'].includes(record.source)||((record.amountMicros===null)!==(record.source==='unknown')))throw new Error('Unknown cost must remain explicit');
    if(record.amountMicros!==null){
      const value=amount(record.amountMicros);
      if(scope.kind==='cost'&&record.source==='estimated'&&value<0n)throw new Error('Estimated inference cost cannot be negative');
    }
    if(record.source==='estimated'&&!id(record.pricingRef))throw new Error('Estimated cost requires pricing provenance');
  }
  const byId=new Map(records.map(r=>[r.id,r])),allocated=new Set<string>();
  let externalNet=0n,recordedKnown=0n;
  for(const record of records)if(record.amountMicros!==null)recordedKnown+=amount(record.amountMicros);
  const lines=billed.map(line=>{
    within(line);
    if(!['charge','credit','adjustment'].includes(line.kind)||!Array.isArray(line.recordIds)||line.recordIds.length>10000)throw new Error('Invalid billing line');
    const external=amount(line.amountMicros);
    if((line.kind==='charge'&&external<0n)||(line.kind==='credit'&&external>0n))throw new Error('Billing sign does not match line kind');
    externalNet+=external;
    const missing:string[]=[],unknown:string[]=[],matched:RecordedFinancialEntry[]=[];
    let known=0n;
    for(const recordId of line.recordIds){
      if(!id(recordId)||allocated.has(recordId))throw new Error('Ambiguous or duplicate billing allocation');
      if(allocated.size>=20000)throw new Error('Too many billing allocations');
      allocated.add(recordId);
      const record=byId.get(recordId);
      if(!record){missing.push(recordId);continue;}
      matched.push(record);
      if(record.amountMicros===null)unknown.push(recordId);else known+=amount(record.amountMicros);
    }
    const relative=(abs(external)*BigInt(bps)+9999n)/10000n;
    const tolerance=absolute>relative?absolute:relative;
    const variance=unknown.length?null:external-known;
    let tokenVariance:Record<string,string>|null=null;
    let incompleteTokens=false;
    if(line.tokens){
      if(!matched.length||matched.some(r=>!r.tokens))incompleteTokens=true;
      else tokenVariance=Object.fromEntries((['input','output','cachedInput'] as const).map(field=>[
        field,(BigInt(line.tokens![field])-matched.reduce((n,r)=>n+BigInt(r.tokens![field]),0n)).toString(),
      ]));
    }
    const status=!line.recordIds.length?'unmatched':missing.length?'missing_records':unknown.length?'unknown_cost':incompleteTokens?'missing_token_evidence':
      tokenVariance&&Object.values(tokenVariance).some(n=>n!=='0')?'token_variance':variance!==null&&abs(variance)>tolerance?'variance':'within_tolerance';
    return {id:line.id,sourceRef:line.sourceRef,recordIds:line.recordIds,externalMicros:external.toString(),
      recordedKnownMicros:known.toString(),varianceMicros:variance?.toString()??null,toleranceMicros:tolerance.toString(),
      status,missingRecordIds:missing,unknownRecordIds:unknown,tokenVariance};
  });
  const unmatchedRecordIds=records.filter(r=>!allocated.has(r.id)).map(r=>r.id);
  const unknownRecordIds=records.filter(r=>r.amountMicros===null).map(r=>r.id);
  const inputs={...input,records,billed};
  const inputDigest=createHash('sha256').update(canonical(inputs)).digest('hex');
  const complete=billed.length>0&&unknownRecordIds.length===0&&unmatchedRecordIds.length===0&&lines.every(line=>line.status==='within_tolerance');
  return {schemaVersion:1,inputDigest,scope,inputs,lines,unmatchedRecordIds,unknownRecordIds,
    summary:{complete,recordedKnownMicros:recordedKnown.toString(),externalNetMicros:externalNet.toString(),
      varianceMicros:unknownRecordIds.length?null:(externalNet-recordedKnown).toString()}};
}

/** Stable bytes for immutable report storage and retry comparison. */
export function serializeReconciliationReport(report:ReturnType<typeof reconcileFinancialRecords>):string {
  return canonical(report)+'\n';
}

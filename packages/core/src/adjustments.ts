import {createHash} from 'node:crypto';

/** Positive USD reduction; never overwrite the original positive payment. */
export interface AdjustmentInput {
 originalPaymentId:string;customerId:string;kind:'refund'|'credit'|'payment_reversal';
 amountMicros:string;currency:'USD';occurredAt:string;
 provider:string;providerAccount:string;sourceObjectId:string;evidenceRef:string;
}
export interface StoredAdjustment extends AdjustmentInput {id:string;payloadDigest:string}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function parseAdjustment(value:unknown):StoredAdjustment{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid adjustment');
 const r=value as Record<string,unknown>;
 const id=(v:unknown):v is string=>typeof v==='string'&&v.length>=1&&v.length<=200;
 if(!id(r.originalPaymentId)||!id(r.customerId)||!['refund','credit','payment_reversal'].includes(String(r.kind))||
    typeof r.amountMicros!=='string'||!/^[1-9]\d{0,18}$/.test(r.amountMicros)||BigInt(r.amountMicros)>9223372036854775807n||r.currency!=='USD'||
    typeof r.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(r.occurredAt)||
    !Number.isFinite(Date.parse(r.occurredAt))||new Date(r.occurredAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==r.occurredAt.slice(0,10)||
    typeof r.provider!=='string'||!/^[a-z0-9_]{1,32}$/.test(r.provider)||
    typeof r.providerAccount!=='string'||!/^[A-Za-z0-9:_-]{1,200}$/.test(r.providerAccount)||
    typeof r.sourceObjectId!=='string'||!/^[A-Za-z0-9:_-]{1,200}$/.test(r.sourceObjectId)||
    typeof r.evidenceRef!=='string'||r.evidenceRef.length<1||r.evidenceRef.length>500)throw new Error('Invalid adjustment');
 const canonical:AdjustmentInput={originalPaymentId:r.originalPaymentId,customerId:r.customerId,
   kind:r.kind as AdjustmentInput['kind'],amountMicros:r.amountMicros,currency:'USD',occurredAt:new Date(r.occurredAt).toISOString(),
   provider:r.provider,providerAccount:r.providerAccount,sourceObjectId:r.sourceObjectId,evidenceRef:r.evidenceRef};
 return {...canonical,id:'adj:'+hash(canonical.provider+'\n'+canonical.providerAccount+'\n'+canonical.sourceObjectId),
   payloadDigest:hash(JSON.stringify(canonical))};
}

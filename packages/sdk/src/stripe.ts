import {createHmac,timingSafeEqual} from 'node:crypto';
import type {RevenueInput,AdjustmentInput} from './index.ts';

/** Verify the literal, unmodified Stripe raw JSON body. Do not JSON.parse then stringify before verification. */
function verifiedStripeEvent(
 rawBody:string|Uint8Array,signatureHeader:string,webhookSecret:string,
 nowSeconds=Math.floor(Date.now()/1000),expectedAccount?:string
):Record<string,unknown>{
 if(!webhookSecret?.startsWith('whsec_')||webhookSecret.length<12)throw new Error('Invalid Stripe signing secret');
 if(typeof signatureHeader!=='string'||signatureHeader.length>3000)throw new Error('Missing or invalid Stripe-Signature header');
 if(!Number.isSafeInteger(nowSeconds))throw new Error('Invalid verification time');
 const raw=typeof rawBody==='string'?Buffer.from(rawBody,'utf8'):Buffer.from(rawBody);
 if(raw.byteLength===0||raw.byteLength>256000)throw new Error('Invalid Stripe webhook body size');
 const components=signatureHeader.split(',');
 const times=components.filter(s=>s.startsWith('t=')).map(s=>s.slice(2));
 const signatures=components.filter(s=>s.startsWith('v1=')).map(s=>s.slice(3));
 if(times.length!==1||!/^[1-9]\d{8,14}$/.test(times[0]??'')||!signatures.length)throw new Error('Malformed Stripe-Signature header');
 const timestamp=Number(times[0]);
 if(!Number.isSafeInteger(timestamp)||Math.abs(nowSeconds-timestamp)>300)throw new Error('Stripe webhook outside 5-minute tolerance');
 const mac=createHmac('sha256',webhookSecret).update(String(timestamp)).update('.').update(raw).digest();
 let valid=false;
 for(const hex of signatures){
  if(!/^[0-9a-f]{64}$/i.test(hex))continue;
  const candidate=Buffer.from(hex,'hex');
  if(candidate.length===mac.length&&timingSafeEqual(candidate,mac))valid=true;
 }
 if(!valid)throw new Error('Invalid Stripe webhook signature');
 const event=JSON.parse(raw.toString('utf8')) as unknown;
 if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('Invalid Stripe event');
 const e=event as Record<string,unknown>;
 if(typeof e.id!=='string'||!e.id.startsWith('evt_'))throw new Error('Invalid Stripe event identifier');
 if(expectedAccount&&e.account!==expectedAccount)throw new Error('Stripe account does not match this workspace');
 return e;
}
/** Verify the raw body before inspecting any invoice evidence. */
export function stripeInvoicePaidToRevenue(
 rawBody:string|Uint8Array,signatureHeader:string,webhookSecret:string,
 nowSeconds=Math.floor(Date.now()/1000),expectedAccount?:string
):RevenueInput|null{
 const e=verifiedStripeEvent(rawBody,signatureHeader,webhookSecret,nowSeconds,expectedAccount);
 if(e.type!=='invoice.paid')return null;
 if(!Number.isSafeInteger(e.created)||Number(e.created)<=0)throw new Error('Invalid Stripe event time');
 const data=e.data;
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid Stripe event data');
 const obj=(data as Record<string,unknown>).object;
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Invalid Stripe invoice object');
 const inv=obj as Record<string,unknown>;
 if(typeof inv.id!=='string'||!/^in_[A-Za-z0-9_]+$/.test(inv.id)||inv.id.length>150)
  throw new Error('Invalid Stripe invoice ID');
 const customer=typeof inv.customer==='string'?inv.customer: null;
 if(!customer||!/^cus_[A-Za-z0-9_]+$/.test(customer)||customer.length>150)
  throw new Error('Unsupported Stripe customer shape');
 if(inv.currency!=='usd')throw new Error('Non-USD invoice requires explicit currency conversion and reconciliation');
 if(inv.status!=='paid')throw new Error('Invoice not marked paid');
 if(typeof inv.amount_paid!=='number'||!Number.isSafeInteger(inv.amount_paid)||inv.amount_paid<0)
  throw new Error('Invalid USD invoice amount');
 const micros=BigInt(inv.amount_paid)*10000n; // USD cents -> USD micros
 if(micros>9223372036854775807n)throw new Error('Stripe invoice amount exceeds bounds');
 // Invoice payment time is stable across separately delivered invoice events.
 // Preserve legacy fixtures lacking status_transitions with event-time fallback.
 const transitions=inv.status_transitions;
 if(transitions!=null&&(typeof transitions!=='object'||Array.isArray(transitions)))throw new Error('Invalid invoice payment time');
 const paidAt=(transitions as Record<string,unknown>|null|undefined)?.paid_at;
 if(paidAt!=null&&(!Number.isSafeInteger(paidAt)||Number(paidAt)<=0||Number(paidAt)>Number(e.created)))throw new Error('Invalid invoice payment time');
 const at=new Date(Number(paidAt??e.created)*1000);
 if(!Number.isFinite(at.getTime()))throw new Error('Invalid event date');
 return {id:'stripe:invoice:'+inv.id,customerId:'stripe:'+customer,
  occurredAt:at.toISOString(),amountMicros:micros.toString()};
}

export interface StripeRefundLink {originalPaymentId:string;customerId:string}
export interface StripeFinancialOptions {
 expectedAccount?:string;
 /** Account owning a dedicated platform webhook secret; platform events omit event.account. */
 platformAccount?:string;
 /** Trusted, account-scoped mapping maintained by the integrator, never webhook metadata. */
 refundLinks?:Readonly<Record<string,StripeRefundLink>>;
}
export type StripeFinancialDelivery =
 |{kind:'payment';providerEventId:string;providerAccount:string;record:RevenueInput}
 |{kind:'adjustment';providerEventId:string;providerAccount:string;record:AdjustmentInput};
/** Narrow synthetic-tested support: succeeded refunds and pure post-payment balance credits.
 * Missing linkage and unsupported currency/allocation require operator reconciliation.
 */
export function stripeEventToFinancialDelivery(rawBody:string|Uint8Array,signatureHeader:string,webhookSecret:string,
 nowSeconds=Math.floor(Date.now()/1000),options:StripeFinancialOptions={}):StripeFinancialDelivery|null{
 if(options.platformAccount&&(!/^acct_[A-Za-z0-9_]{1,190}$/.test(options.platformAccount)||options.expectedAccount))throw new Error('Invalid Stripe account routing');
 const e=verifiedStripeEvent(rawBody,signatureHeader,webhookSecret,nowSeconds,options.expectedAccount);
 if(options.platformAccount&&e.account!=null)throw new Error('Stripe platform endpoint cannot accept connected-account events');
 if(!/^evt_[A-Za-z0-9_]{1,196}$/.test(String(e.id)))throw new Error('Invalid Stripe event identifier');
 if(e.account&&!options.expectedAccount)throw new Error('Stripe connected account requires trusted mapping');
 const providerAccount=options.expectedAccount??options.platformAccount??'platform';
 const envelope={providerEventId:e.id as string,providerAccount};
 if(e.type==='invoice.paid')return {kind:'payment',...envelope,
   record:stripeInvoicePaidToRevenue(rawBody,signatureHeader,webhookSecret,nowSeconds,options.expectedAccount)!};
 if(e.type==='credit_note.voided'||e.type==='charge.dispute.funds_reinstated')
   throw new Error('Unsupported positive reinstatement requires accounting review');
 if(!['refund.created','refund.updated','credit_note.created'].includes(String(e.type)))return null;
 const obj=(e.data as {object?:unknown}|null)?.object;
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Invalid Stripe financial object');
 const r=obj as Record<string,unknown>;
 if(!Number.isSafeInteger(e.created)||Number(e.created)<=0||!Number.isSafeInteger(r.created)||Number(r.created)<=0||Number(r.created)>Number(e.created))
   throw new Error('Invalid Stripe financial time');
 const at=new Date(Number(r.created)*1000);if(!Number.isFinite(at.getTime()))throw new Error('Invalid Stripe financial time');
 if(r.currency!=='usd')throw new Error('Unsupported Stripe currency requires explicit FX evidence');
 const micros=(value:unknown):string=>{
   if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||BigInt(value)*10000n>9223372036854775807n)throw new Error('Invalid Stripe adjustment amount');
   return (BigInt(value)*10000n).toString();
 };
 const stripeId=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]{1,145}$').test(v);
 if(e.type==='refund.created'||e.type==='refund.updated'){
   if(!stripeId(r.id,'re'))throw new Error('Invalid Stripe refund ID');
   if(['pending','requires_action','failed','canceled'].includes(String(r.status)))return null;
   if(r.status!=='succeeded')throw new Error('Unsupported Stripe refund status');
   const link=options.refundLinks?.[r.id];
   if(!link||!/^stripe:invoice:in_[A-Za-z0-9_]+$/.test(link.originalPaymentId)||!/^stripe:cus_[A-Za-z0-9_]+$/.test(link.customerId))
     throw new Error('Stripe refund requires trusted payment mapping');
   return {kind:'adjustment',...envelope,record:{...link,kind:'refund',currency:'USD',amountMicros:micros(r.amount),
     occurredAt:at.toISOString(),provider:'stripe',providerAccount,sourceObjectId:r.id,evidenceRef:'stripe:refund:'+r.id}};
 }
 // Current Stripe schema (2026-09-30.endive): credit_amount is a CREATE
 // parameter, not a returned object field. Only a pure, evidenced balance credit
 // or a wholly refund-backed note is supported; never infer mixed allocations.
 // Stripe returns null for an unused optional out-of-band allocation. Normalize
 // only that explicit null; missing/malformed values and required amounts still
 // fail validation. Keep the signed source object unchanged for provenance.
 const outOfBandAmount=r.out_of_band_amount===null?0:r.out_of_band_amount;
 if(r.refunds!==undefined){
   const cents=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
   if(!stripeId(r.id,'cn')||!stripeId(r.invoice,'in')||!stripeId(r.customer,'cus')||r.status!=='issued'||r.type!=='post_payment')throw new Error('Invalid Stripe credit note');
   if(![r.amount,r.pre_payment_amount,r.post_payment_amount,outOfBandAmount].every(cents)||r.pre_payment_amount!==0||outOfBandAmount!==0||r.amount!==r.post_payment_amount||!Array.isArray(r.refunds)||r.refunds.length>100)
     throw new Error('Unsupported Stripe credit allocation requires reconciliation');
   let refunded=0n;
   const seen=new Set<string>();
   for(const item of r.refunds){
     if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Unsupported Stripe refund allocation');
     const a=item as Record<string,unknown>;
     if(!stripeId(a.refund,'re')||!cents(a.amount_refunded)||a.amount_refunded===0||seen.has(a.refund))throw new Error('Unsupported Stripe refund allocation');
     seen.add(a.refund);refunded+=BigInt(a.amount_refunded);
   }
   // Reject contradictory legacy fields if an integrator provides both schemas.
   if(r.credit_amount!==undefined||r.refund_amount!==undefined||r.refund!==undefined)throw new Error('Unsupported Stripe ambiguous credit schema');
   if(refunded>0n){
     if(refunded!==BigInt(r.post_payment_amount as number)||r.customer_balance_transaction!=null)throw new Error('Unsupported Stripe mixed credit allocation');
     return null; // Succeeded refund events record the economic effect once.
   }
   if(!stripeId(r.customer_balance_transaction,'cbtxn'))throw new Error('Unsupported Stripe credit allocation requires reconciliation');
   return {kind:'adjustment',...envelope,record:{originalPaymentId:'stripe:invoice:'+r.invoice,customerId:'stripe:'+r.customer,
     kind:'credit',currency:'USD',amountMicros:micros(r.post_payment_amount),occurredAt:at.toISOString(),provider:'stripe',providerAccount,
     sourceObjectId:r.id,evidenceRef:'stripe:credit_note:'+r.id}};
 }
 // Legacy fixture/API shape remains compatible but is not evidence of validation
 // against a particular provider API version.
 if(!stripeId(r.id,'cn')||!stripeId(r.invoice,'in')||!stripeId(r.customer,'cus')||r.status!=='issued'||r.type!=='post_payment')throw new Error('Invalid Stripe credit note');
 // Restrict to an explicitly allocated post-payment reduction. Mixed, pre-payment,
 // out-of-band and newer array allocation shapes are not silently interpreted.
 const values=[r.pre_payment_amount,r.post_payment_amount,r.credit_amount,r.refund_amount,outOfBandAmount];
 if(values.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<0)||r.pre_payment_amount!==0||outOfBandAmount!==0)
   throw new Error('Unsupported Stripe credit allocation requires reconciliation');
 if(Number(r.refund_amount)>0){
   if(r.credit_amount!==0||r.post_payment_amount!==r.refund_amount||!stripeId(r.refund,'re'))throw new Error('Unsupported Stripe mixed credit allocation');
   // The refund object's succeeded event is authoritative for this same economic
   // reduction. Counting the credit note as well would duplicate refunded revenue.
   return null;
 }
 if(r.post_payment_amount!==r.credit_amount||r.refund_amount!==0||r.refund!=null||!stripeId(r.customer_balance_transaction,'cbtxn'))
   throw new Error('Unsupported Stripe credit allocation requires reconciliation');
 return {kind:'adjustment',...envelope,record:{originalPaymentId:'stripe:invoice:'+r.invoice,customerId:'stripe:'+r.customer,
   kind:'credit',currency:'USD',amountMicros:micros(r.credit_amount),occurredAt:at.toISOString(),provider:'stripe',providerAccount,
   sourceObjectId:r.id,evidenceRef:'stripe:credit_note:'+r.id}};
}

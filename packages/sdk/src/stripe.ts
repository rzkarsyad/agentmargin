import {createHmac,timingSafeEqual} from 'node:crypto';
import type {RevenueInput} from './index.ts';

/** Verify the literal, unmodified Stripe raw JSON body. Do not JSON.parse then stringify before verification. */
export function stripeInvoicePaidToRevenue(
 rawBody:string|Uint8Array,signatureHeader:string,webhookSecret:string,
 nowSeconds=Math.floor(Date.now()/1000),expectedAccount?:string
):RevenueInput|null{
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
 const at=new Date(Number(e.created)*1000);
 if(!Number.isFinite(at.getTime()))throw new Error('Invalid event date');
 return {id:'stripe:invoice:'+inv.id,customerId:'stripe:'+customer,
  occurredAt:at.toISOString(),amountMicros:micros.toString()};
}

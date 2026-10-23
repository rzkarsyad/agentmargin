import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {stripeEventToFinancialDelivery,type StripeFinancialOptions} from '../src/stripe.ts';
const now=1800000000,secret='whsec_synthetic_adjustments',account='acct_synthetic';
const refund={id:'re_partial',created:now-10,status:'succeeded',currency:'usd',amount:11,charge:'ch_synthetic'};
const options={expectedAccount:account,refundLinks:{re_partial:{originalPaymentId:'stripe:invoice:in_synthetic',customerId:'stripe:cus_synthetic'}}};
function convert(type:string,object:unknown,opts:StripeFinancialOptions=options){
 const raw=JSON.stringify({id:'evt_synthetic',account,type,created:now,data:{object}});
 const signature='t='+now+',v1='+createHmac('sha256',secret).update(now+'.'+raw).digest('hex');
 return stripeEventToFinancialDelivery(raw,signature,secret,now,opts);
}
test('signed Stripe refunds use stable object time and trusted linkage across delivery types',()=>{
 const a=convert('refund.created',refund),b=convert('refund.updated',refund);
 assert.deepEqual(a,b);assert.equal(a?.record.amountMicros,'110000');
 assert.equal(a?.record.occurredAt,new Date((now-10)*1000).toISOString());
 assert.equal(convert('refund.updated',{...refund,status:'pending'}),null);
 assert.throws(()=>convert('refund.created',refund,{expectedAccount:account,refundLinks:{}}),/trusted payment mapping/);
 assert.throws(()=>convert('refund.created',{...refund,currency:'eur'}),/FX evidence/);
 assert.throws(()=>stripeEventToFinancialDelivery('{}','t='+now+',v1='+'0'.repeat(64),secret,now),/signature/);
});
const credit={id:'cn_credit',created:now-5,status:'issued',type:'post_payment',currency:'usd',invoice:'in_synthetic',customer:'cus_synthetic',
 pre_payment_amount:0,post_payment_amount:7,credit_amount:7,refund_amount:0,out_of_band_amount:0,refund:null,customer_balance_transaction:'cbtxn_synthetic'};
test('pure balance credits are distinct; refund-linked credit notes do not double count',()=>{
 const result=convert('credit_note.created',credit);assert.equal(result?.kind,'adjustment');
 if(result?.kind==='adjustment'){assert.equal(result.record.kind,'credit');assert.equal(result.record.amountMicros,'70000');}
 assert.equal(convert('credit_note.created',{...credit,credit_amount:0,refund_amount:7,refund:'re_partial'}),null);
 for(const patch of [{pre_payment_amount:1},{refund_amount:1},{out_of_band_amount:1},{customer_balance_transaction:null},{type:'pre_payment'}])
   assert.throws(()=>convert('credit_note.created',{...credit,...patch}),/Unsupported|Invalid/);
 assert.throws(()=>convert('credit_note.voided',credit),/reinstatement/);
});

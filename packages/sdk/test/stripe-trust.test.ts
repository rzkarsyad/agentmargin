import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {stripeInvoicePaidToRevenue,stripeEventToFinancialDelivery,StripeAccountingReviewRequired} from '../src/stripe.ts';
const secret='whsec_synthetic_mode_boundary',now=1800000000;
const invoice={id:'in_trust',customer:'cus_trust',currency:'usd',status:'paid',amount_paid:100};
function signed(patch:Record<string,unknown>={}){
 const raw=JSON.stringify({id:'evt_trust',created:now,type:'invoice.paid',livemode:false,data:{object:invoice},...patch});
 return [raw,'t='+now+',v1='+createHmac('sha256',secret).update(now+'.'+raw).digest('hex')] as const;
}
test('signed platform/connected events require explicit trusted mode in both adapters',()=>{
 for(const mode of [true,false])for(const account of [undefined,'acct_trust']){
   const [raw,sig]=signed({livemode:mode,account});
   assert.equal(stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:mode,expectedAccount:account})?.kind,'payment');
   assert.equal(stripeInvoicePaidToRevenue(raw,sig,secret,now,account,mode)?.amountMicros,'1000000');
   assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:!mode,expectedAccount:account}),/mode/);
   assert.throws(()=>stripeInvoicePaidToRevenue(raw,sig,secret,now,account,!mode),/mode/);
   assert.throws(()=>stripeInvoicePaidToRevenue(raw,sig,secret,now,account),/expectedLivemode/);
   if(account){
     assert.throws(()=>stripeInvoicePaidToRevenue(raw,sig,secret,now,undefined,mode),/trusted mapping/);
     assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:mode,platformAccount:'acct_platform'}),/platform endpoint/);
     for(const expectedAccount of ['', 'wrong', 'acct_other']){
       assert.throws(()=>stripeInvoicePaidToRevenue(raw,sig,secret,now,expectedAccount,mode),/account/);
       assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:mode,expectedAccount}),/account/);
     }
   }
 }
 for(const livemode of [undefined,null,0,'false']){
   const [raw,sig]=signed({livemode});
   assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:false}),/mode/);
 }
});
test('unsupported financial states are visible non-retryable accounting review',()=>{
 for(const type of ['refund.failed','charge.refunded','charge.dispute.created','charge.dispute.funds_withdrawn','credit_note.updated','invoice.voided']){
   const [raw,sig]=signed({type});
   assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:false}),e=>e instanceof StripeAccountingReviewRequired&&!e.retryable);
   assert.throws(()=>stripeInvoicePaidToRevenue(raw,sig,secret,now,undefined,false),StripeAccountingReviewRequired);
 }
 for(const status of ['failed','canceled']){
   const [raw,sig]=signed({type:'refund.updated',data:{object:{id:'re_trust',created:now,currency:'usd',amount:100,status}}});
   assert.throws(()=>stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:false}),StripeAccountingReviewRequired);
 }
 const [raw,sig]=signed({type:'customer.updated'});
 assert.equal(stripeEventToFinancialDelivery(raw,sig,secret,now,{expectedLivemode:false}),null);
});

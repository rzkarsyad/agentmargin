import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac} from 'node:crypto';
import {stripeEventToFinancialDelivery} from '../src/stripe.ts';
const now=1790000000,secret='whsec_synthetic_schema_test';
const note={id:'cn_current',created:now,status:'issued',type:'post_payment',currency:'usd',invoice:'in_current',customer:'cus_current',
 amount:1200,pre_payment_amount:0,post_payment_amount:1200,out_of_band_amount:0,refunds:[],customer_balance_transaction:'cbtxn_current'};
function parse(object:unknown,account?:string){
 const body=JSON.stringify({id:'evt_current',created:now,account,type:'credit_note.created',api_version:'2026-09-30.endive',livemode:false,data:{object}});
 const header='t='+now+',v1='+createHmac('sha256',secret).update(now+'.'+body).digest('hex');
 return stripeEventToFinancialDelivery(body,header,secret,now,{platformAccount:'acct_fixture'});
}
test('current credit-note object maps pure balance credit with explicit platform routing',()=>{
 const result=parse(note);
 assert.equal(result?.kind,'adjustment');assert.equal(result?.providerAccount,'acct_fixture');
 assert.equal(result?.record.amountMicros,'12000000');
 assert.throws(()=>parse(note,'acct_other'),/platform endpoint/);
});
test('current refund-backed notes are ignored once; mixed and conflicting allocations stay unresolved',()=>{
 assert.equal(parse({...note,customer_balance_transaction:null,refunds:[{refund:'re_current',amount_refunded:1200}]}),null);
 for(const value of [
   {...note,refunds:[{refund:'re_current',amount_refunded:100}]},
   {...note,amount:1201}, {...note,customer_balance_transaction:null},
   {...note,refunds:null}, {...note,credit_amount:1200},
   {...note,refunds:[{refund:'re_current',amount_refunded:600},{refund:'re_current',amount_refunded:600}],customer_balance_transaction:null},
 ])assert.throws(()=>parse(value),/Unsupported Stripe/);
});
test('operator-observed Stripe nullable out-of-band allocation preserves exact balance credit and source shape',()=>{
 // Provider-shaped synthetic regression, not a copy of private financial data.
 const object={...note,object:'credit_note',out_of_band_amount:null};
 const before=JSON.stringify(object),result=parse(object);
 assert.deepEqual(result,parse({...object,out_of_band_amount:0}),'Null/zero must normalize to the same idempotent financial record');
 assert.equal(result?.record.amountMicros,'12000000');
 assert.equal(JSON.stringify(object),before,'Never rewrite the signed evidence');
 assert.throws(()=>parse(object,'acct_other'),/platform endpoint/);
});
test('nullable optional allocation never permits mixed refunds, positive out-of-band or incomplete money',()=>{
 const object={...note,out_of_band_amount:null};
 assert.equal(parse({...object,customer_balance_transaction:null,refunds:[{refund:'re_current',amount_refunded:1200}]}),null,'Wholly refund-backed note must not double count');
 for(const patch of [
  {out_of_band_amount:1},{out_of_band_amount:-1},{out_of_band_amount:0.5},{out_of_band_amount:'0'},
  {out_of_band_amount:false},{out_of_band_amount:undefined},
  {amount:null},{pre_payment_amount:null},{post_payment_amount:null},{refunds:null},
  {customer_balance_transaction:null},{pre_payment_amount:1},{amount:1201},
  {refunds:[{refund:'re_current',amount_refunded:100}]},
  {customer_balance_transaction:null,refunds:[{refund:'re_current',amount_refunded:100}]},
  {refunds:[{refund:'re_current',amount_refunded:1200}]},
  {customer_balance_transaction:null,refunds:[{refund:'re_current',amount_refunded:null}]},
  {credit_amount:1200},
 ])assert.throws(()=>parse({...object,...patch}),/Unsupported Stripe/);
});

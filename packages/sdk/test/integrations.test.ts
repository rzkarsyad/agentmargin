import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fromAnthropicMessage} from '../src/anthropic.ts';
import {stripeInvoicePaidToRevenue} from '../src/stripe.ts';

test('Anthropic usage has correct cached-read token semantics',()=>{
 const u=fromAnthropicMessage({id:'msg_123',model:'claude-example',
   usage:{input_tokens:80,output_tokens:30,cache_read_input_tokens:20}},'customer-1','2026-10-22T10:00:00Z');
 assert.equal(u.inputTokens,100);
 assert.equal(u.cachedInputTokens,20);
 assert.equal(u.outputTokens,30);
 assert.equal(u.customerId,'customer-1');
 assert.throws(()=>fromAnthropicMessage({id:'msg_123',model:'claude-example',
   usage:{input_tokens:80,output_tokens:30,cache_creation_input_tokens:1}},'customer-1','2026-10-22T10:00:00Z'),/unsupported/);
 assert.throws(()=>fromAnthropicMessage({id:'msg',model:'claude',usage:{input_tokens:-1,output_tokens:0}},'c','2026-10-22T10:00:00Z'),/Invalid/);
});
test('Stripe signature, timestamp, USD cents, invoice ID and provider customer mapping',()=>{
 const secret='whsec_testing_key_123',now=1792663200;
 const data={id:'evt_abc',type:'invoice.paid',created:now,account:'acct_expected',
  data:{object:{id:'in_123',customer:'cus_test123',amount_paid:1299,currency:'usd',status:'paid'}}};
 const body=JSON.stringify(data);
 const sign=(txt:string,t=now)=>'t='+t+',v1='+createHmac('sha256',secret).update(t+'.'+txt).digest('hex');
 const record=stripeInvoicePaidToRevenue(body,sign(body),secret,now,'acct_expected');
 assert.equal(record?.amountMicros,'12990000');
 assert.equal(record?.customerId,'stripe:cus_test123');
 assert.equal(record?.id,'stripe:invoice:in_123');
 assert.equal(record?.occurredAt,new Date(now*1000).toISOString());
 assert.throws(()=>stripeInvoicePaidToRevenue(body+' ',sign(body),secret,now),/signature/);
 assert.throws(()=>stripeInvoicePaidToRevenue(body,sign(body,now-301),secret,now),/tolerance/);
 assert.throws(()=>stripeInvoicePaidToRevenue(body,sign(body),secret,now,'acct_other'),/account/);
 assert.throws(()=>stripeInvoicePaidToRevenue(JSON.stringify({...data,data:{object:{...data.data.object,currency:'eur'}}}),
   sign(JSON.stringify({...data,data:{object:{...data.data.object,currency:'eur'}}})),secret,now),/Non-USD/);
 const other=JSON.stringify({...data,type:'customer.created'});
 assert.equal(stripeInvoicePaidToRevenue(other,sign(other),secret,now),null);
});

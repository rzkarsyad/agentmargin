import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAdjustment} from '../src/adjustments.ts';
const input={originalPaymentId:'stripe:invoice:in_test',customerId:'stripe:cus_test',kind:'refund',
 amountMicros:'250001',currency:'USD',occurredAt:'2026-10-12T12:00:00Z',provider:'stripe',providerAccount:'acct_test',
 sourceObjectId:'re_test',evidenceRef:'stripe:refund:re_test'};
test('adjustment identity follows economic source and detects changed financial evidence',()=>{
 const a=parseAdjustment(input),b=parseAdjustment({...input,amountMicros:'250002'});
 assert.equal(a.id,b.id);assert.notEqual(a.payloadDigest,b.payloadDigest);
 assert.notEqual(a.id,parseAdjustment({...input,providerAccount:'acct_other'}).id);
 assert.deepEqual(a,parseAdjustment({...input,occurredAt:'2026-10-12T14:00:00+02:00'}));
 assert.equal(a.amountMicros,'250001');
});
test('adjustments reject ambiguous dates, rounded numbers, missing provenance and unsupported currencies',()=>{
 for(const patch of [{amountMicros:1},{amountMicros:'0'},{amountMicros:'-1'},{amountMicros:'01'},
  {amountMicros:'9223372036854775808'},{currency:'EUR'},{evidenceRef:''},{sourceObjectId:'a\nb'},
  {occurredAt:'2026-02-31T00:00:00Z'},{occurredAt:'2026-10-12'}, {kind:'unknown'}])
  assert.throws(()=>parseAdjustment({...input,...patch}),/Invalid adjustment/);
 assert.equal(parseAdjustment({...input,amountMicros:'9223372036854775807'}).amountMicros,'9223372036854775807');
});

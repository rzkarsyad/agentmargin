import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAdjustment} from '../src/adjustments.ts';
import {summarizeFinancialLedger,reconcileLedgerRevenue,type FinancialLedgerInput} from '../src/financial-ledger.ts';
const fixture=():FinancialLedgerInput=>({workspaceId:'synthetic',currency:'USD',periodStart:'2026-10-01T00:00:00Z',periodEnd:'2026-11-01T00:00:00Z',
 payments:[{id:'in_paid',customerId:'cus_synthetic',currency:'USD',amountMicros:'1000000',occurredAt:'2026-10-10T00:00:00Z',payloadDigest:null,providerAccount:'acct_synthetic',providerEventId:'evt_payment'}],
 adjustments:[parseAdjustment({originalPaymentId:'in_paid',customerId:'cus_synthetic',currency:'USD',amountMicros:'200001',kind:'refund',
  occurredAt:'2026-10-11T00:00:00Z',provider:'stripe',providerAccount:'acct_synthetic',sourceObjectId:'re_partial',evidenceRef:'stripe:refund:re_partial'})],
 usage:[{id:'usage-1',customerId:'cus_synthetic',occurredAt:'2026-10-10T00:00:00Z',costMicros:'123456',source:'estimated',pricingRef:'price:effective:1',model:'synthetic'}],unresolvedEvidence:[]});
test('period gross, reductions, net and contribution remain exact and traceable',()=>{
 const input=fixture(),a=summarizeFinancialLedger(input);
 assert.equal(a.summary.grossRevenueMicros,'1000000');assert.equal(a.summary.refundsMicros,'200001');
 assert.equal(a.summary.netRevenueMicros,'799999');assert.equal(a.summary.completeContributionMicros,'676543');
 input.adjustments.push({...input.adjustments[0]!});assert.deepEqual(summarizeFinancialLedger(input),a);
 input.payments[0]!.occurredAt='2026-09-10T00:00:00Z';
 const later=summarizeFinancialLedger(input);assert.equal(later.summary.grossRevenueMicros,'0');assert.equal(later.summary.netRevenueMicros,'-200001');
 assert.equal(later.summary.completeContributionMicros,'-323457');
 assert.equal(a.inputs.payments[0]?.occurredAt,'2026-10-10T00:00:00Z');
});
test('unknown cost, FX and billing tiers stay explicit; missing originals never become zero',()=>{
 const input=fixture();input.usage[0]!.source='unknown';input.usage[0]!.costMicros=null;
 input.unresolvedEvidence=[{id:'fx-1',sourceRef:'invoice:eur:1',reason:'unknown_fx',currency:'EUR',amountMicros:'1000000'},
  {id:'tier-1',sourceRef:'provider:invoice:cache-write',reason:'unsupported_billing_tier',billingTier:'cache_write_1h'}];
 const report=summarizeFinancialLedger(input);
 assert.equal(report.summary.complete,false);assert.equal(report.summary.completeContributionMicros,null);
 assert.equal(report.summary.knownInferenceCostMicros,'0');assert.equal(report.inputs.unresolvedEvidence.length,2);
 input.payments=[];assert.throws(()=>summarizeFinancialLedger(input),/Unmatched adjustment/);
});
test('persisted adjustments reconcile signed billing lines with evidence hashes',()=>{
 const input=fixture(),adjustment=input.adjustments[0]!;
 const billing={scope:{workspaceId:input.workspaceId,provider:'stripe',accountId:'acct_synthetic',currency:'USD',kind:'revenue' as const,
  periodStart:input.periodStart,periodEnd:input.periodEnd},billingExportRef:'sha256:synthetic-provider-export',tolerance:{absoluteMicros:'0',basisPoints:0},
  billed:[{id:'line-paid',sourceRef:'invoice:1',currency:'USD',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'1000000',kind:'charge' as const,recordIds:['payment:in_paid']},
   {id:'line-refund',sourceRef:'refund:1',currency:'USD',occurredAt:'2026-10-11T00:00:00Z',amountMicros:'-200001',kind:'credit' as const,recordIds:['adjustment:'+adjustment.id]}]};
 const report=reconcileLedgerRevenue(input,billing);
 assert.equal(report.reconciliation.summary.complete,true);assert.equal(report.reconciliation.summary.varianceMicros,'0');
 assert.equal(report.reconciliation.summary.recordedKnownMicros,report.ledger.summary.netRevenueMicros);
 assert.equal(report.reconciliation.inputs.recordedExportRef,'ledger:sha256:'+report.ledger.inputDigest);
 const unknown=reconcileLedgerRevenue(input,{...billing,unresolvedEvidence:[{id:'fx',sourceRef:'invoice:missing-rate',reason:'unknown_fx',currency:'JPY',amountMicros:'1000000'}]});
 assert.equal(unknown.reconciliation.summary.complete,false);assert.equal(unknown.reconciliation.summary.varianceMicros,null);
 input.adjustments[0]={...adjustment,amountMicros:'1'};assert.throws(()=>reconcileLedgerRevenue(input,billing),/digest mismatch/);
});

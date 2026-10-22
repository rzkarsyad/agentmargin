import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCatalogPrice,dollarsPerTokenToMicrosPerMillion,scanCatalogPrices} from '../../../scripts/lib/pricing-catalog.ts';
test('exact USD microdollar conversion, including scientific notation',()=>{
 assert.equal(dollarsPerTokenToMicrosPerMillion(3e-7),'300000');
 assert.equal(dollarsPerTokenToMicrosPerMillion(0),'0');
 assert.equal(dollarsPerTokenToMicrosPerMillion(1.25e-6),'1250000');
 assert.throws(()=>dollarsPerTokenToMicrosPerMillion(1e-14),/precision/);
 for(const bad of [-1,Infinity,NaN,'0.00001',null])assert.throws(()=>dollarsPerTokenToMicrosPerMillion(bad));
});
test('provider and source must match exact model and explicit per-token prices',()=>{
 const data={demo:{litellm_provider:'openai',input_cost_per_token:1e-6,output_cost_per_token:3e-6,
  cache_read_input_token_cost:2e-7,output_cost_per_token_batches:1e-6}};
 const p=chooseCatalogPrice(data,'demo','openai');
 assert.equal(p.inputMicrosPerMillion,'1000000');
 assert.equal(p.outputMicrosPerMillion,'3000000');
 assert.equal(p.cachedInputMicrosPerMillion,'200000');
 assert.ok(p.warnings.some(w=>w.includes('tiers')));
 assert.throws(()=>chooseCatalogPrice(data,'demo','anthropic'),/mismatch/);
 assert.throws(()=>chooseCatalogPrice(data,'unknown','openai'),/not found/);
 assert.throws(()=>chooseCatalogPrice({demo:{litellm_provider:'openai',input_cost_per_token:0}},'demo','openai'));
});
test('missing cached price is null, never free',()=>{
 const p=chooseCatalogPrice({m:{litellm_provider:'openai',input_cost_per_token:0,output_cost_per_token:0}},'m','openai');
 assert.equal(p.cachedInputMicrosPerMillion,null);
 assert.equal(p.inputMicrosPerMillion,'0');
});

test('scheduled candidate scan is deterministic, provider-scoped and never invents unsupported prices',()=>{
 const catalog={
  z:{litellm_provider:'openai',input_cost_per_token:1e-6,output_cost_per_token:2e-6},
  bad:{litellm_provider:'anthropic',input_cost_per_token:1e-14,output_cost_per_token:2e-6},
  another:{litellm_provider:'unsupported',input_cost_per_token:1e-6,output_cost_per_token:2e-6},
  a:{litellm_provider:'anthropic',input_cost_per_token:2e-6,output_cost_per_token:3e-6}
 };
 const scan=scanCatalogPrices(catalog);
 assert.deepEqual(scan.entries.map(x=>x.model),['a','z']);
 assert.equal(scan.scanned,3);
 assert.equal(scan.skipped,1);
 assert.equal(scan.entries[1]?.cachedInputMicrosPerMillion,null);
 assert.throws(()=>scanCatalogPrices([]),/Invalid pricing catalog/);
});

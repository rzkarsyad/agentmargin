#!/usr/bin/env node
/**
 * Unattended *review artifact* for provider pricing candidates.
 * Never writes to a workspace, API, database, or application pricing history.
 */
import {CATALOG_URL,fetchCatalog,scanCatalogPrices} from './lib/pricing-catalog.ts';
const {catalog,digest}=await fetchCatalog();
const scan=scanCatalogPrices(catalog);
if(scan.entries.length===0)throw new Error('Catalog scan produced no usable pricing candidates; investigate upstream schema');
const report={
 schemaVersion:1,
 kind:'unapproved-pricing-candidates',
 source:CATALOG_URL,
 sourceSha256:digest,
 retrievedAt:new Date().toISOString(),
 providers:['openai','anthropic'],
 disclaimer:'LiteLLM community estimates, not official provider billing. Human verification required before workspace apply.',
 scanned:scan.scanned,
 skipped:scan.skipped,
 candidates:scan.entries,
};
console.log(JSON.stringify(report,null,2));

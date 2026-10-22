#!/usr/bin/env node
/** Explicit opt-in catalog import. Preview is default, --apply writes via authenticated local API.
 * No backdating by default; historical stored event amounts remain immutable.
 */
import {chooseCatalogPrice,fetchCatalog,CATALOG_URL} from './lib/pricing-catalog.ts';
const args=process.argv.slice(2);
function option(name:string){const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];}
const model=option('model'),provider=option('provider'),apply=args.includes('--apply');
if(!model||!provider||args.includes('--help')){
 console.log('Usage: npm run pricing:import -- --provider openai --model EXACT_CATALOG_MODEL [--apply]');
 console.log('Default: preview only. --apply creates a workspace price version using AGENTMARGIN_API_KEY.');
 process.exit(model&&provider?0:1);
}
if(args.some(x=>x.startsWith('--')&&!['--model','--provider','--apply'].includes(x)))
 throw new Error('Unexpected flag. Arbitrary source URLs are prohibited.');
const {catalog,digest}=await fetchCatalog();
const found=chooseCatalogPrice(catalog,model,provider);
const effectiveFrom=new Date().toISOString();
const sourceNote=`LiteLLM community map retrieved ${effectiveFrom}; sha256:${digest.slice(0,32)}; confirm against provider pricing`;
const record={
 model:found.model,effectiveFrom,effectiveTo:null,
 inputMicrosPerMillion:found.inputMicrosPerMillion,
 outputMicrosPerMillion:found.outputMicrosPerMillion,
 cachedInputMicrosPerMillion:found.cachedInputMicrosPerMillion,
 sourceNote,
};
console.log(JSON.stringify({source:CATALOG_URL,sha256:digest,preview:record,warnings:found.warnings},null,2));
if(!apply){
 console.log('Preview only. No pricing data was written. Re-run with --apply after checking provider rates.');
}else{
 const apiKey=process.env.AGENTMARGIN_API_KEY;
 if(!apiKey||!/^am_[A-Za-z0-9_-]{32,}$/.test(apiKey))throw new Error('Set a valid AGENTMARGIN_API_KEY');
 const endpoint=process.env.AGENTMARGIN_ENDPOINT??'http://127.0.0.1:8787';
 const url=new URL(endpoint);
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname))
  throw new Error('Only HTTPS or localhost endpoints are allowed');
 const res=await fetch(new URL('/v1/prices',url),{method:'POST',headers:{
  authorization:'Bearer '+apiKey,'content-type':'application/json'},body:JSON.stringify(record),signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw new Error('Pricing import rejected (HTTP '+res.status+'). Check local API and version conflicts.');
 const saved=await res.json() as {id:string};
 console.log('Imported one workspace-scoped, append-only price version: '+saved.id);
 console.log('Snapshot timestamp is the import time, NOT a claim about the provider historical effective date.');
}

/** A conservative import adapter for LiteLLM's community-maintained cost map.
 * A catalog estimate is not an official provider invoice or verified effective date.
 * Support is intentionally limited to standard per-token input/output rates.
 */
export const CATALOG_URL='https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const MAX_RATE_MICROS=9223372036854775807n;
const decimal=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
export function dollarsPerTokenToMicrosPerMillion(value:unknown):string{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Invalid finite nonnegative token rate');
 const raw=value.toString(),m=raw.match(decimal);
 if(!m)throw new Error('Invalid price notation');
 const digits=BigInt((m[1]??'0')+(m[2]??''));
 const scale=12+Number(m[3]??'0')-(m[2]??'').length;
 if(Math.abs(scale)>40)throw new Error('Unsupported token rate scale');
 let cost:bigint;
 if(scale>=0)cost=digits*10n**BigInt(scale);
 else{
  const divisor=10n**BigInt(-scale);
  if(digits%divisor!==0n)throw new Error('Price exceeds exact USD micro precision');
  cost=digits/divisor;
 }
 if(cost>MAX_RATE_MICROS)throw new Error('Token price outside PostgreSQL bigint range');
 return cost.toString();
}
export interface CatalogPrice{
 model:string;provider:string;inputMicrosPerMillion:string;outputMicrosPerMillion:string;
 cachedInputMicrosPerMillion:string|null;
 warnings:string[];
}
export function chooseCatalogPrice(catalog:unknown,model:string,provider:string):CatalogPrice{
 if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))throw new Error('Invalid pricing catalog JSON');
 if(typeof model!=='string'||model.length<1||model.length>200||typeof provider!=='string'||provider.length<1||provider.length>80)
  throw new Error('Specify an exact model and provider');
 const row=(catalog as Record<string,unknown>)[model];
 if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Model not found in catalog; exact key required');
 const item=row as Record<string,unknown>;
 if(item.litellm_provider!==provider)throw new Error('Catalog provider mismatch — refusing ambiguous model mapping');
 const input=dollarsPerTokenToMicrosPerMillion(item.input_cost_per_token);
 const output=dollarsPerTokenToMicrosPerMillion(item.output_cost_per_token);
 // Cached cost is a separate provider-specific billable rate. Missing != 0.
 const cache=item.cache_read_input_token_cost??item.input_cost_per_token_cache_hit;
 const cached=cache==null?null:dollarsPerTokenToMicrosPerMillion(cache);
 const variants=Object.keys(item).filter(k=>/(?:above_\d|_batches$|_priority$|_flex$|_per_second$|_per_image$|_per_query$)/.test(k));
 const warnings=variants.length?['Additional tiers or non-token charges are excluded: '+variants.slice(0,12).join(', ')]:[];
 if(cached==null)warnings.push('No verified cached-input rate in this catalog entry; cached usage stays unknown');
 warnings.push('LiteLLM is community-maintained. Check the provider invoice/pricing page before relying on this estimate.');
 return {model,provider,inputMicrosPerMillion:input,outputMicrosPerMillion:output,cachedInputMicrosPerMillion:cached,warnings};
}
export async function fetchCatalog(fetchImpl:typeof fetch=fetch):Promise<{catalog:unknown;digest:string}>{
 const res=await fetchImpl(CATALOG_URL,{signal:AbortSignal.timeout(20000),headers:{accept:'application/json'},redirect:'error'});
 if(!res.ok)throw new Error('Catalog fetch failed HTTP '+res.status);
 const length=Number(res.headers.get('content-length')||'0');
 if(length>16*1024*1024)throw new Error('Catalog too large');
 const reader=res.body?.getReader();if(!reader)throw new Error('Catalog response missing body');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(!value)continue;size+=value.byteLength;
   if(size>16*1024*1024)throw new Error('Catalog exceeds 16 MB');
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.byteLength;}
 const {createHash}=await import('node:crypto');
 const digest=createHash('sha256').update(bytes).digest('hex');
 const catalog=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)) as unknown;
 return {catalog,digest};
}

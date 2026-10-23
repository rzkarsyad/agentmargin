import type {UsageInput} from './index.ts';

export interface AnthropicMessageUsage{
 id:string; model:string;
 usage?:{
   input_tokens:number;output_tokens:number;
   cache_read_input_tokens?:number;cache_creation_input_tokens?:number;
 }|null;
}
const safeCount=(x:unknown,name:string)=>{
 if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0)throw new Error('Invalid Anthropic '+name);
 return x;
};
/** Completed Anthropic Messages usage, without prompt or output content.
 * Cache creation uses a separate billable tier not represented in AgentMargin v0.6.
 * Reject those messages rather than underestimating their cost.
 */
export function fromAnthropicMessage(message:AnthropicMessageUsage,customerId:string,occurredAt:string):UsageInput{
 if(!message||!message.usage)throw new Error('Anthropic message usage is required');
 if(typeof message.id!=='string'||message.id.length<1||message.id.length>200||
    typeof message.model!=='string'||message.model.length<1||message.model.length>200||
    typeof customerId!=='string'||customerId.length<1||customerId.length>200)
    throw new Error('Invalid message/model/customer ID');
 const time=new Date(occurredAt);
 if(!Number.isFinite(time.getTime())||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(occurredAt)||
   new Date(occurredAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==occurredAt.slice(0,10))
   throw new Error('Explicit timezone timestamp required');
 const u=message.usage;
 const input=safeCount(u.input_tokens,'input_tokens');
 const output=safeCount(u.output_tokens,'output_tokens');
 const read=safeCount(u.cache_read_input_tokens??0,'cache_read_input_tokens');
 const creation=safeCount(u.cache_creation_input_tokens??0,'cache_creation_input_tokens');
 if(creation>0)throw new Error('Anthropic cache creation pricing tier is unsupported; refusing misleading estimate');
 if(input+read>Number.MAX_SAFE_INTEGER)throw new Error('Anthropic token count exceeds safe integer limit');
 return {id:message.id,model:message.model,customerId,occurredAt:time.toISOString(),
  inputTokens:input+read,outputTokens:output,cachedInputTokens:read};
}

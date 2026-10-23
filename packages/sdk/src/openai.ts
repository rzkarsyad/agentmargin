import type { UsageInput } from './index.ts';

/** Minimal structural types; no OpenAI SDK dependency is required. */
export interface ResponsesUsage {
  id:string;model:string;created_at:number;
  usage?:{input_tokens:number;output_tokens:number;input_tokens_details?:{cached_tokens?:number}}|null;
}
export interface ChatCompletionsUsage {
  id:string;model:string;created:number;
  usage?:{prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens?:number}}|null;
}
function checked(n:number|undefined,label:string):number {
  if(!Number.isSafeInteger(n)||n==null||n<0)throw new Error(`Invalid ${label}`);
  return n;
}
function fromUsage(id:string,model:string,created:number,input:number,output:number,cached:number,customerId:string):UsageInput {
  if(![id,model,customerId].every(value=>typeof value==='string'&&value.length>0&&value.length<=200))throw new Error('Response ID, model and customer ID are required');
  const at=new Date(checked(created,'timestamp')*1000);
  if(!Number.isFinite(at.getTime())||!/^\d{4}-/.test(at.toISOString()))throw new Error('Invalid timestamp');
  input=checked(input,'input tokens');output=checked(output,'output tokens');cached=checked(cached,'cached tokens');
  if(cached>input)throw new Error('Cached tokens exceed input tokens');
  return {id,customerId,model,occurredAt:at.toISOString(),inputTokens:input,outputTokens:output,cachedInputTokens:cached};
}
/** Call after an OpenAI Responses API request completes; no prompts or output text are recorded. */
export function fromOpenAIResponse(response:ResponsesUsage,customerId:string):UsageInput {
  if(!response?.usage)throw new Error('OpenAI response has no usage; cannot record a zero-cost event');
  const u=response.usage;
  return fromUsage(response.id,response.model,response.created_at,u.input_tokens,u.output_tokens,u.input_tokens_details?.cached_tokens??0,customerId);
}
/** Call after an OpenAI Chat Completions API request completes. */
export function fromOpenAIChatCompletion(response:ChatCompletionsUsage,customerId:string):UsageInput {
  if(!response?.usage)throw new Error('Chat completion has no usage');
  const u=response.usage;
  return fromUsage(response.id,response.model,response.created,u.prompt_tokens,u.completion_tokens,u.prompt_tokens_details?.cached_tokens??0,customerId);
}

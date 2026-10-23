import { fromOpenAIResponse, fromOpenAIChatCompletion, type ResponsesUsage, type ChatCompletionsUsage } from './openai.ts';
import {fromAnthropicMessage,type AnthropicMessageUsage} from './anthropic.ts';
export interface UsageInput {
  id:string; customerId:string; model:string; occurredAt:string;
  inputTokens:number; outputTokens:number; cachedInputTokens?:number;
  /** USD microdollars, serialized as decimal string. */
  reportedCostMicros?:string;
}
export interface RevenueInput {
  id:string; customerId:string; occurredAt:string;
  /** USD microdollars, serialized as a nonnegative decimal integer string. */
  amountMicros:string;
}
export interface RevenueDeliveryInput {
  providerEventId:string;providerAccount:string;record:RevenueInput;
}
export interface AgentMarginOptions {
  endpoint:string; apiKey:string; fetchImpl?:typeof fetch;
}
export class AgentMarginClient {
  readonly endpoint:URL;
  readonly apiKey:string;
  readonly fetchImpl:typeof fetch;
  constructor(options:AgentMarginOptions) {
    this.endpoint=new URL(options.endpoint);
    if(!['https:','http:'].includes(this.endpoint.protocol)||this.endpoint.username||this.endpoint.password)
      throw new Error('HTTP(S) endpoint without embedded credentials required');
    if (this.endpoint.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(this.endpoint.hostname))
      throw new Error('HTTPS required outside localhost');
    if (!/^am_[A-Za-z0-9_-]{32,}$/.test(options.apiKey)) throw new Error('Invalid AgentMargin API key format');
    this.apiKey=options.apiKey;
    this.fetchImpl=options.fetchImpl??fetch;
  }
  async track(events:UsageInput[], signal?:AbortSignal):Promise<{inserted:number;duplicate:number;received:number}> {
    if (events.length < 1 || events.length > 100) throw new Error('Batch must contain 1-100 events');
    const url=new URL('/v1/events',this.endpoint);
    const response=await this.fetchImpl(url,{method:'POST',headers:{
      'authorization':`Bearer ${this.apiKey}`,'content-type':'application/json'
    },body:JSON.stringify({events}),signal});
    if (!response.ok) {
      const body=await response.text();
      throw new Error(`AgentMargin HTTP ${response.status}: ${body.slice(0,300)}`);
    }
    return await response.json() as {inserted:number;duplicate:number;received:number};
  }
  /** Send only usage metadata, never the OpenAI prompt or generated output.
   * Retries are idempotent because the OpenAI response ID becomes the event ID.
   * Missing usage rejects before any AgentMargin network request.
   */
  async trackOpenAIResponse(
    response: ResponsesUsage, customerId: string, signal?: AbortSignal,
  ): Promise<{ inserted: number; duplicate: number; received: number }> {
    return this.track([fromOpenAIResponse(response, customerId)], signal);
  }
  /** Chat Completions equivalent of trackOpenAIResponse. */
  async trackOpenAIChatCompletion(
    completion: ChatCompletionsUsage, customerId: string, signal?: AbortSignal,
  ): Promise<{ inserted: number; duplicate: number; received: number }> {
    return this.track([fromOpenAIChatCompletion(completion, customerId)], signal);
  }
  /** Track a completed Anthropic Messages result. Cache writes are rejected until their distinct pricing tier is modeled. */
  async trackAnthropicMessage(message:AnthropicMessageUsage,customerId:string,occurredAt:string,
    signal?:AbortSignal):Promise<{inserted:number;duplicate:number;received:number}>{
    return this.track([fromAnthropicMessage(message,customerId,occurredAt)],signal);
  }
  /** Persist verified, normalized Stripe invoice evidence before acknowledging delivery.
   * Completion is asynchronous; the deployment must run a scoped replay worker.
   */
  async enqueueRevenueDelivery(delivery:RevenueDeliveryInput,signal?:AbortSignal):Promise<{duplicate:boolean;state:string}>{
    const response=await this.fetchImpl(new URL('/v1/revenue/deliveries',this.endpoint),{method:'POST',headers:{
      authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'
    },body:JSON.stringify(delivery),signal});
    if(!response.ok)throw new Error(`AgentMargin HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
    return await response.json() as {duplicate:boolean;state:string};
  }
  async trackRevenue(records:RevenueInput[],signal?:AbortSignal):Promise<{inserted:number;duplicate:number;received:number}>{
    if(records.length<1||records.length>100)throw new Error('Batch must contain 1-100 records');
    const response=await this.fetchImpl(new URL('/v1/revenue',this.endpoint),{method:'POST',headers:{
      authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'
    },body:JSON.stringify({records}),signal});
    if(!response.ok)throw new Error(`AgentMargin HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
    return await response.json() as {inserted:number;duplicate:number;received:number};
  }
}
export type { ResponsesUsage, ChatCompletionsUsage } from './openai.ts';

export {fromAnthropicMessage} from './anthropic.ts';
export type {AnthropicMessageUsage} from './anthropic.ts';
export {stripeInvoicePaidToRevenue} from './stripe.ts';

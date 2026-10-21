import test from 'node:test';
import assert from 'node:assert/strict';
import {fromOpenAIResponse,fromOpenAIChatCompletion} from '../src/openai.ts';

test('Responses usage maps tokens including cached input',()=>{
  const event=fromOpenAIResponse({id:'resp_1',model:'sample-model',created_at:1790000000,
    usage:{input_tokens:100,output_tokens:25,input_tokens_details:{cached_tokens:20}}},'customer-1');
  assert.equal(event.id,'resp_1');assert.equal(event.inputTokens,100);assert.equal(event.cachedInputTokens,20);
  assert.equal(event.customerId,'customer-1');
});
test('Chat completions usage mapping',()=>{
  const event=fromOpenAIChatCompletion({id:'chatcmpl_1',model:'sample',created:1790000000,
    usage:{prompt_tokens:80,completion_tokens:20,prompt_tokens_details:{cached_tokens:10}}},'c1');
  assert.equal(event.outputTokens,20);assert.equal(event.cachedInputTokens,10);
});
test('missing usage is not interpreted as free usage',()=>{
  assert.throws(()=>fromOpenAIResponse({id:'resp',model:'m',created_at:1790000000,usage:null},'c1'),/no usage/);
});

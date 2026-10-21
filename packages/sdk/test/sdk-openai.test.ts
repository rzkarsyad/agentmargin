import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMarginClient } from '../src/index.ts';

const apiKey = 'am_' + 'k'.repeat(43);
const completedResponse = {
  id: 'resp_test_101', model: 'test-model', created_at: 1790000000,
  usage: { input_tokens: 120, output_tokens: 25, input_tokens_details: { cached_tokens: 20 } },
  input: 'SECRET USER PROMPT NEVER SEND', output_text: 'SECRET RESPONSE NEVER SEND',
};

test('one-call OpenAI Responses tracking sends usage-only metadata, never prompts or output', async () => {
  let calls = 0;
  const client = new AgentMarginClient({
    endpoint: 'http://127.0.0.1:8787', apiKey,
    fetchImpl: async (_url, init) => {
      calls++;
      assert.equal((init?.headers as Record<string,string>).authorization, `Bearer ${apiKey}`);
      const sent = JSON.parse(String(init?.body)) as Record<string,unknown>;
      assert.deepEqual(Object.keys(sent), ['events']);
      const events = sent.events as Record<string,unknown>[];
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        id: 'resp_test_101', customerId: 'customer-42', model: 'test-model',
        occurredAt: new Date(1790000000 * 1000).toISOString(),
        inputTokens: 120, outputTokens: 25, cachedInputTokens: 20,
      });
      const payload = JSON.stringify(sent);
      assert.equal(payload.includes('SECRET USER PROMPT'), false);
      assert.equal(payload.includes('SECRET RESPONSE'), false);
      return Response.json({ inserted: calls === 1 ? 1 : 0, duplicate: calls === 1 ? 0 : 1, received: 1 }, { status: 202 });
    },
  });
  assert.equal((await client.trackOpenAIResponse(completedResponse, 'customer-42')).inserted, 1);
  assert.equal((await client.trackOpenAIResponse(completedResponse, 'customer-42')).duplicate, 1);
  assert.equal(calls, 2);
});

test('OpenAI response without usage throws before contacting AgentMargin', async () => {
  let calls = 0;
  const client = new AgentMarginClient({ endpoint: 'http://localhost:8787', apiKey,
    fetchImpl: async () => { calls++; return Response.json({inserted:1,duplicate:0,received:1}); },
  });
  await assert.rejects(client.trackOpenAIResponse({ ...completedResponse, usage: null }, 'c1'), /no usage/);
  assert.equal(calls, 0);
});

test('Chat Completions one-call tracking maps usage and cache fields', async () => {
  let event: Record<string,unknown> | undefined;
  const client = new AgentMarginClient({ endpoint: 'http://localhost:8787', apiKey,
    fetchImpl: async (_url, init) => {
      event = (JSON.parse(String(init?.body)) as { events: Record<string,unknown>[] }).events[0];
      return Response.json({inserted:1,duplicate:0,received:1});
    },
  });
  const outcome = await client.trackOpenAIChatCompletion({
    id: 'chatcmpl_example', model: 'example-model', created: 1790000001,
    usage: { prompt_tokens: 80, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 6 } },
  }, 'cust-1');
  assert.equal(outcome.inserted, 1);
  assert.equal(event?.inputTokens, 80);
  assert.equal(event?.outputTokens, 10);
  assert.equal(event?.cachedInputTokens, 6);
});
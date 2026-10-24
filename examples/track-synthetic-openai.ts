/**
 * Run only after `npm run demo` starts the loopback API and prints a demo key.
 * Demonstrates the post-call OpenAI usage workflow WITHOUT calling OpenAI.
 * Use fictional data and the demo workspace only.
 */
import { randomUUID } from 'node:crypto';
import { AgentMarginClient } from '../packages/sdk/src/index.ts';

const apiKey = process.env.AGENTMARGIN_API_KEY;
if (!apiKey) {
  throw new Error('Set AGENTMARGIN_API_KEY to the localhost demo key printed by npm run demo');
}
const endpoint = process.env.AGENTMARGIN_ENDPOINT ?? 'http://127.0.0.1:8787';
const ciPort=process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'?process.env.AGENTMARGIN_SYNTHETIC_DEMO_PORT:undefined;
if(ciPort!==undefined&&(!/^[0-9]{4,5}$/.test(ciPort)||Number(ciPort)<1024||Number(ciPort)>65535))throw new Error('Invalid disposable demo port');
const demoPort=ciPort??'8787';
if (!['http://127.0.0.1:'+demoPort, 'http://localhost:'+demoPort].includes(endpoint)) {
  throw new Error('Synthetic tracking example requires the exact configured loopback demo endpoint');
}

const client = new AgentMarginClient({ endpoint, apiKey });
const id = `resp_synthetic_${randomUUID()}`;
const createdAt = Math.floor(Date.now() / 1000);
const response = {
  id,
  model: 'example-model',
  created_at: createdAt,
  usage: {input_tokens: 2_000, output_tokens: 500, input_tokens_details: {cached_tokens: 0}},
  // The SDK does not send these fields to AgentMargin.
  output_text: 'Synthetic answer that must never be sent to the metering API',
};

const tracked = await client.trackOpenAIResponse(response, 'openai-synthetic-demo');
const revenue = await client.trackRevenue([{
  id: `invoice_${id}`,
  customerId: 'openai-synthetic-demo',
  occurredAt: new Date(createdAt * 1000).toISOString(),
  amountMicros: '29000000', // fictional $29 customer revenue
}]);
console.log(`Recorded synthetic usage: ${tracked.inserted} inserted, ${tracked.duplicate} duplicate`);
console.log(`Recorded synthetic revenue: ${revenue.inserted} inserted, ${revenue.duplicate} duplicate`);
console.log('Model pricing was not configured; the synthetic event cost is UNKNOWN, not $0.');
console.log('Open http://127.0.0.1:8787/dashboard and choose a date range containing today.');
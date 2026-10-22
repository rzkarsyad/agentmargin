import {AgentMarginClient} from '@agentmargin/sdk';
export const DEMO_CUSTOMER_ID='nextjs-demo-customer';

/** Server-only. This is not a production auth solution. */
export function margin(){
 const apiKey=process.env.AGENTMARGIN_API_KEY;
 if(!apiKey)throw new Error('Set AGENTMARGIN_API_KEY in .env.local');
 return new AgentMarginClient({
  endpoint:process.env.AGENTMARGIN_ENDPOINT??'http://127.0.0.1:8787',apiKey
 });
}

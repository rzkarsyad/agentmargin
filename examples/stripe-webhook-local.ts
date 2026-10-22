/** Local-only Stripe CLI receiver for verified invoice.paid revenue tracking.
 * Never deploy this example as a public production webhook service.
 */
import * as http from 'node:http';
import {AgentMarginClient,stripeInvoicePaidToRevenue} from '../packages/sdk/src/index.ts';
const secret=process.env.STRIPE_WEBHOOK_SECRET;
const key=process.env.AGENTMARGIN_API_KEY;
if(!secret||!key)throw new Error('Set STRIPE_WEBHOOK_SECRET and AGENTMARGIN_API_KEY in the local shell');
const client=new AgentMarginClient({endpoint:process.env.AGENTMARGIN_ENDPOINT??'http://127.0.0.1:8787',apiKey:key});
const expectedAccount=process.env.STRIPE_ACCOUNT_ID;
http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/stripe/webhook'){res.writeHead(404).end();return;}
 const header=req.headers['stripe-signature'];
 if(typeof header!=='string'){res.writeHead(400).end();return;}
 const chunks:Buffer[]=[];let size=0;
 try{
  for await(const chunk of req){
   const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
   size+=b.byteLength;if(size>256000){res.writeHead(413).end();return;}
   chunks.push(b);
  }
  const data=Buffer.concat(chunks);
  let record;
  try{record=stripeInvoicePaidToRevenue(data,header,secret!,Math.floor(Date.now()/1000),expectedAccount);}
  catch{res.writeHead(400).end();return;}
  if(!record){res.writeHead(200,{'content-type':'application/json'}).end('{"ignored":true}');return;}
  await client.trackRevenue([record]);
  res.writeHead(200,{'content-type':'application/json'}).end('{"accepted":true}');
 }catch{
  // A 5xx allows Stripe to retry; AgentMargin uses stable invoice IDs for idempotency.
  res.writeHead(503).end();
 }
}).listen(8788,'127.0.0.1',()=>console.log('Stripe LOCAL test receiver on 127.0.0.1:8788'));

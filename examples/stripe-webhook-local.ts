/** Local-only Stripe CLI receiver for verified invoice.paid revenue tracking.
 * Never deploy this example as a public production webhook service.
 */
import {readFileSync} from 'node:fs';
import * as http from 'node:http';
import {AgentMarginClient,stripeInvoicePaidToRevenue,stripeEventToFinancialDelivery,StripeAccountingReviewRequired,type StripeRefundLink} from '../packages/sdk/src/index.ts';
const secret=process.env.STRIPE_WEBHOOK_SECRET;
const key=process.env.AGENTMARGIN_API_KEY;
if(!secret||!key)throw new Error('Set STRIPE_WEBHOOK_SECRET and AGENTMARGIN_API_KEY in the local shell');
// This loopback example accepts test-mode events only, with a trusted constant.
const expectedLivemode=false;
const client=new AgentMarginClient({endpoint:process.env.AGENTMARGIN_ENDPOINT??'http://127.0.0.1:8787',apiKey:key});
const refundLinks:Record<string,StripeRefundLink>=process.env.AGENTMARGIN_STRIPE_REFUND_LINKS_FILE?
 JSON.parse(readFileSync(process.env.AGENTMARGIN_STRIPE_REFUND_LINKS_FILE,'utf8')):{};
const expectedAccount=process.env.STRIPE_ACCOUNT_ID;
const platformAccount=process.env.STRIPE_PLATFORM_ACCOUNT_ID;
if(process.env.AGENTMARGIN_DURABLE_REVENUE==='true'&&(!expectedAccount&&!platformAccount||expectedAccount&&platformAccount))
 throw new Error('Bind exactly one connected or platform account to this signing secret');
const port=Number(process.env.STRIPE_LOCAL_PORT??8788);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid local Stripe port');
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
  if(process.env.AGENTMARGIN_DURABLE_REVENUE==='true'){
    let delivery;
    try{delivery=stripeEventToFinancialDelivery(data,header,secret!,Math.floor(Date.now()/1000),{expectedLivemode,expectedAccount,platformAccount,refundLinks});}
    catch(error){
      if(error instanceof StripeAccountingReviewRequired){
        console.error(JSON.stringify({kind:error.code,retryable:false}));
        res.writeHead(422).end('{"error":"accounting_review_required"}');return;
      }
      // Valid but unsupported/unmapped financial evidence must not be acknowledged
      // as successfully recorded. Integrators must alert on these repeated errors.
      const unresolved=error instanceof Error&&/^(Unsupported|Stripe .*requires)/.test(error.message);
      res.writeHead(unresolved?503:400).end();return;
    }
    if(!delivery){res.writeHead(200).end('{"ignored":true}');return;}
    if(delivery.kind==='payment')await client.enqueueRevenueDelivery(delivery,AbortSignal.timeout(5000));
    else await client.enqueueAdjustmentDelivery(delivery,AbortSignal.timeout(5000));
  }else{
    let record;
    try{record=stripeInvoicePaidToRevenue(data,header,secret!,Math.floor(Date.now()/1000),expectedAccount,expectedLivemode);}
    catch(error){
      if(error instanceof StripeAccountingReviewRequired){
        console.error(JSON.stringify({kind:error.code,retryable:false}));
        res.writeHead(422).end('{"error":"accounting_review_required"}');return;
      }
      res.writeHead(400).end();return;
    }
    if(!record){res.writeHead(200).end('{"ignored":true}');return;}
    await client.trackRevenue([record]);
  }
  res.writeHead(200,{'content-type':'application/json'}).end('{"accepted":true}');
 }catch{
  // A 5xx allows Stripe to retry; AgentMargin uses stable invoice IDs for idempotency.
  res.writeHead(503).end();
 }
}).listen(port,'127.0.0.1',()=>console.log('Stripe LOCAL test receiver listening on loopback'));

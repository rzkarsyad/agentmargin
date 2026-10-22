import {NextResponse} from 'next/server';
import {margin,DEMO_CUSTOMER_ID} from '../../../lib/margin';
import type {ResponsesUsage} from '@makinohq/agentmargin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(){
 const key=process.env.OPENAI_API_KEY;
 if(!key)return NextResponse.json({ok:false,message:'OPENAI_API_KEY not configured; use the synthetic demo.'},{status:400});
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},
   body:JSON.stringify({model:'gpt-4.1-mini',input:'Reply with a single greeting word.'}),
   signal:AbortSignal.timeout(30000),cache:'no-store'
  });
  if(!response.ok)return NextResponse.json({ok:false,message:'OpenAI request failed; provider body is not logged.'},{status:502});
  const completed=await response.json() as ResponsesUsage;
  const tracked=await margin().trackOpenAIResponse(completed,DEMO_CUSTOMER_ID);
  return NextResponse.json({ok:true,kind:'live',customerId:DEMO_CUSTOMER_ID,eventId:completed.id,tracked,notes:'Only response ID, model, token usage and customer ID were sent to AgentMargin.'});
 }catch{return NextResponse.json({ok:false,message:'Live provider or tracking request failed; inspect server configuration.'},{status:502});}
}

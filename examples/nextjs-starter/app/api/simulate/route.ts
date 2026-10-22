import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {margin,DEMO_CUSTOMER_ID} from '../../../lib/margin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(){
 try{
  const at=new Date().toISOString(),eventId='synthetic-'+randomUUID();
  const tracked=await margin().track([{id:eventId,customerId:DEMO_CUSTOMER_ID,model:'synthetic-unpriced-model',occurredAt:at,inputTokens:500,outputTokens:100}]);
  // Revenue is illustrative: $0.29 for each synthetic request, not actual billing.
  const revenue=await margin().trackRevenue([{id:'rev-'+eventId,customerId:DEMO_CUSTOMER_ID,occurredAt:at,amountMicros:'290000'}]);
  return NextResponse.json({ok:true,kind:'synthetic',customerId:DEMO_CUSTOMER_ID,eventId,tracked,revenue,notes:'Missing synthetic model pricing means cost is UNKNOWN, not $0.'});
 }catch{return NextResponse.json({ok:false,message:'Local AgentMargin recording failed. Check demo API and server environment.'},{status:502});}
}

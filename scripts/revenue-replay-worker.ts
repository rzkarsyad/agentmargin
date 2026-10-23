/** One bounded pass over one authenticated workspace. Schedule externally. */
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {digest} from '../apps/api/src/app.ts';
const url=process.env.DATABASE_URL,key=process.env.AGENTMARGIN_API_KEY;
const limit=Number(process.env.AGENTMARGIN_REPLAY_LIMIT??25);
if(!url||!key||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Database URL, workspace key and replay limit 1-100 required');
const store=new PostgresEventStore(url).forCredential(key);
store.pool.on('error',()=>{process.stderr.write('{"kind":"revenue_worker_pool_error"}\n');});
try{
  const principal=await store.authenticate(digest(key));
  if(!principal||!['admin','ingest'].includes(principal.accessRole))throw new Error('Workspace ingest capability required');
  const counts={delivered:0,retry:0,failed:0};
  for(let n=0;n<limit;n++){
    const result=await store.processNextRevenueDelivery(principal.workspaceId);
    if(result.state==='empty')break;
    counts[result.state]++;
  }
  const adjustments={delivered:0,retry:0,failed:0};
  for(let n=0;n<limit;n++){
    const result=await store.processNextAdjustmentDelivery(principal.workspaceId);
    if(result.state==='empty')break;adjustments[result.state]++;
  }
  const adjustmentBacklog=await store.adjustmentDeliveryStatus(principal.workspaceId);
  const backlog=await store.revenueDeliveryStatus(principal.workspaceId);
  process.stdout.write(JSON.stringify({kind:'revenue_replay',...counts,backlog,adjustments,adjustmentBacklog})+'\n');
  if(counts.failed||BigInt(backlog.failed)>0n||adjustments.failed||BigInt(adjustmentBacklog.failed)>0n)process.exitCode=1;
}catch{
  // SQL/connection errors can contain customer IDs or credentials.
  process.stderr.write('{"kind":"revenue_replay_failed"}\n');process.exitCode=1;
}finally{await store.pool.end();}

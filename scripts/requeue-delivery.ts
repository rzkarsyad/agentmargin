/** Local disposable operator tool. The private JSON file contains review evidence,
 * never a key. Authentication stays in the environment and is never printed. */
import {readCheckedFile} from './lib/private-files.ts';
import pg from 'pg';
const url=process.env.DATABASE_URL,key=process.env.AGENTMARGIN_API_KEY,path=process.argv[2];
if(!url||!key||!path||process.env.AGENTMARGIN_RECOVERY_ENV!=='disposable')throw new Error('Disposable recovery configuration required');
const target=new URL(url);
if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/agentmargin_ci')throw new Error('Disposable loopback database required');
const input=JSON.parse(readCheckedFile(path,{privateFile:true,maxBytes:100000}).contents) as Record<string,unknown>;
const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
pool.on('error',()=>{process.stderr.write('{"kind":"delivery_recovery_pool_error"}\n');});
try{
 const c=await pool.connect();
 try{
   await c.query('BEGIN');await c.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
   const q=await c.query('SELECT agentmargin_auth.requeue_delivery($1,$2,$3,$4,$5,$6) AS cycle',
     [input.workspaceId,input.kind,input.providerEventId,input.payloadDigest,input.reviewRef,input.requestId]);
   await c.query('COMMIT');process.stdout.write(JSON.stringify({kind:'delivery_recovery',cycle:q.rows[0].cycle})+'\n');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}catch{process.stderr.write('{"kind":"delivery_recovery_failed"}\n');process.exitCode=1;}
finally{await pool.end();}

/** Disposable privacy-lifecycle rehearsal, NOT a production erasure tool.
 * Original financial rows are removed only by explicit, export-verified teardown
 * of one fictional workspace in an isolated CI database under the trusted owner.
 */
import pg from 'pg';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {readCheckedFile,requirePrivateDirectory} from './lib/private-files.ts';
import {dirname,join,basename} from 'node:path';
const tables=['customers','usage_events','revenue_records','workspace_price_versions','revenue_deliveries',
 'revenue_adjustments','revenue_payment_sources','adjustment_deliveries','delivery_history','delivery_requeues'] as const;
const url=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL,workspace=process.argv[2],output=process.argv[3],action=process.argv[4]??'export';
if(!url||!workspace||! /^[a-f0-9-]{36}$/i.test(workspace)||!output||!['export','delete-after-export'].includes(action))throw new Error('Disposable workspace, private export path and action required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')throw new Error('Refusing non-disposable privacy rehearsal');
const outputFile=join(requirePrivateDirectory(dirname(output)),basename(output));
const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function snapshot(c:pg.PoolClient){
 const name=await c.query('SELECT name FROM workspaces WHERE id=$1',[workspace]);
 if(!name.rows[0]?.name.startsWith('agentmargin-qa '))throw new Error('Fictional QA workspace required');
 const result=await c.query('SELECT '+tables.map((table,i)=>`(SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM (SELECT * FROM public.${table} WHERE workspace_id=$1 ORDER BY to_jsonb(${table})::text LIMIT 10001) t) AS data_${i}`).join(','),[workspace]);
 const data=Object.fromEntries(tables.map((table,i)=>[table,result.rows[0]['data_'+i]]));
 if(Object.values(data).some(rows=>rows.length>10000))throw new Error('Export bound exceeded; do not truncate');
 return JSON.stringify({format:'agentmargin-disposable-workspace-v1',workspaceId:workspace,data})+'\n';
}
try{
 const c=await pool.connect();
 try{
   await c.query('BEGIN');await c.query("SET LOCAL timezone='UTC'");
   if(action==='delete-after-export'){
     if(process.env.AGENTMARGIN_PRIVACY_REHEARSAL!=='delete-fictional-workspace')throw new Error('Explicit fictional deletion guard required');
     // Locks and trigger toggles are transactional and affect this disposable DB
     // only. Every DELETE remains explicitly scoped; foreign keys stay enabled.
     await c.query('LOCK TABLE '+[...tables,'workspace_api_keys','workspaces'].map(t=>'public.'+t).join(',')+' IN ACCESS EXCLUSIVE MODE');
     const original=readCheckedFile(outputFile,{privateFile:true}).contents,current=await snapshot(c);
     if(hash(original)!==hash(current))throw new Error('Export no longer matches workspace; export again for review');
     for(const t of ['delivery_history','delivery_requeues','revenue_adjustments','revenue_payment_sources','revenue_records'])await c.query('ALTER TABLE public.'+t+' DISABLE TRIGGER USER');
     for(const t of ['delivery_requeues','delivery_history','adjustment_deliveries','revenue_adjustments','revenue_payment_sources','revenue_deliveries','usage_events','revenue_records','workspace_price_versions','customers','workspace_api_keys'])await c.query('DELETE FROM public.'+t+' WHERE workspace_id=$1',[workspace]);
     await c.query('DELETE FROM workspaces WHERE id=$1',[workspace]);
     for(const t of ['delivery_history','delivery_requeues','revenue_adjustments','revenue_payment_sources','revenue_records'])await c.query('ALTER TABLE public.'+t+' ENABLE TRIGGER USER');
   }else{
     const data=await snapshot(c);writeFileSync(outputFile,data,{mode:0o600,flag:'wx'});
   }
   await c.query('COMMIT');process.stdout.write(JSON.stringify({kind:'disposable_workspace_'+action})+'\n');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}catch{process.stderr.write('{"kind":"disposable_workspace_lifecycle_failed"}\n');process.exitCode=1;}
finally{await pool.end();}

/** Sensitive, bounded read-only export. No live provider calls or mutations. */
import {writeFileSync} from 'node:fs';
import {readCheckedFile,requirePrivateDirectory} from './lib/private-files.ts';
import {dirname,join,basename} from 'node:path';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {digest} from '../apps/api/src/app.ts';
async function main(){
const [start,end,path]=process.argv.slice(2),url=process.env.DATABASE_URL,key=process.env.AGENTMARGIN_API_KEY;
if(!start||!end||!path||!url||!key)throw new Error('Usage: DATABASE_URL=... AGENTMARGIN_API_KEY=... node --experimental-strip-types scripts/export-financial-ledger.ts start end private-file.json');
const store=new PostgresEventStore(url).forCredential(key);
try{
 const principal=await store.authenticate(digest(key));
 if(!principal||!['admin','read'].includes(principal.accessRole))throw new Error('Read capability required');
 const target=join(requirePrivateDirectory(dirname(path)),basename(path));
 const report=await store.financialLedger(principal.workspaceId,start,end),bytes=JSON.stringify(report)+'\n';
 if(Buffer.byteLength(bytes)>10_000_000)throw new Error('Export exceeds 10 MB; partition the period');
 try{writeFileSync(target,bytes,{flag:'wx',mode:0o600});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||readCheckedFile(target,{privateFile:true}).contents!==bytes)throw error;}

 process.stdout.write(JSON.stringify({kind:'financial_ledger_export',inputDigest:report.inputDigest,complete:report.summary.complete})+'\n');
}catch{
 // pg errors may contain customer identifiers, payloads or credentials.
 process.stderr.write('{"kind":"financial_ledger_export_failed"}\n');process.exitCode=1;
}finally{await store.pool.end();}

}
await main().catch(()=>{process.stderr.write('{"kind":"financial_ledger_export_failed"}\n');process.exitCode=1;});

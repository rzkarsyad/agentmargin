/** Read-only private success-marker check. Operators route failures to monitoring. */
import {resolve} from 'node:path';
import {readCheckedFile} from './lib/private-files.ts';
import {backupStatus} from './lib/backup-status.ts';
try{
 const directory=process.env.AGENTMARGIN_BACKUP_DIR;
 if(!directory)throw new Error('Backup directory required');
 const maxAge=Number(process.env.AGENTMARGIN_BACKUP_MAX_AGE_SECONDS??7200);
 const {contents}=readCheckedFile(resolve(directory,'last-success.json'),{privateFile:true,maxBytes:16384});
 const result=backupStatus(JSON.parse(contents),Date.now(),maxAge);
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=result.status==='fresh'?0:1;
}catch{
 // Missing, malformed, unsafe permissions and unreadable all fail closed. Never
 // expose parser snippets, local paths, libpq config or upstream hook diagnostics.
 process.stdout.write('{"kind":"backup_status","status":"unavailable"}\n');
 process.exitCode=2;
}

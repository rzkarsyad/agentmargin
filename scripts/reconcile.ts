/** Offline input -> immutable, replay-safe report. Reports contain sensitive data. */
import {mkdirSync,writeFileSync,linkSync,unlinkSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {readCheckedFile,requirePrivateDirectory} from './lib/private-files.ts';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {reconcileLedgerRevenue,serializeLedgerReconciliation,type FinancialLedgerInput} from '../packages/core/src/financial-ledger.ts';
import type {ReconciliationInput} from '../packages/core/src/reconciliation.ts';
import {reconcileFinancialRecords,serializeReconciliationReport} from '../packages/core/src/reconciliation.ts';
const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath)throw new Error('Usage: node --experimental-strip-types scripts/reconcile.ts input.json private-report-directory');
const input=JSON.parse(readCheckedFile(inputPath).contents) as ReconciliationInput&{ledger?:FinancialLedgerInput;billing?:Omit<ReconciliationInput,'records'|'recordedExportRef'>};
const result=input.ledger&&input.billing?reconcileLedgerRevenue(input.ledger,input.billing):null;
const report=result?.reconciliation??reconcileFinancialRecords(input);
const requestedDirectory=resolve(outputPath);
mkdirSync(requestedDirectory,{recursive:true,mode:0o700});
const directory=requirePrivateDirectory(requestedDirectory);
const target=join(directory,report.inputDigest+'.json'),contents=result?serializeLedgerReconciliation(result):serializeReconciliationReport(report);
const temporary=join(directory,'.report-'+randomUUID());
const descriptor=openSync(temporary,'wx',0o600);
try{writeFileSync(descriptor,contents);fsyncSync(descriptor);}finally{closeSync(descriptor);}
try{
  try{linkSync(temporary,target);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||readCheckedFile(target,{privateFile:true}).contents!==contents)throw error;}
  const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}finally{unlinkSync(temporary);}
// Never print financial rows, customer IDs or source references.
process.stdout.write(JSON.stringify({kind:'reconciliation_report',inputDigest:report.inputDigest,complete:report.summary.complete})+'\n');

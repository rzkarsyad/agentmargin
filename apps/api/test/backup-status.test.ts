import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupStatus} from '../../../scripts/lib/backup-status.ts';
const marker={kind:'backup_succeeded',completedAt:'2026-10-23T12:00:00Z',durationSeconds:1,retentionDays:7};
const now=Date.parse('2026-10-23T14:00:00Z');
test('backup freshness bounds, old markers and transport metadata stay explicit',()=>{
 assert.equal(backupStatus(marker,now,7200).status,'fresh');
 assert.equal(backupStatus(marker,now+1000,7200).status,'stale');
 const detailed={...marker,startedAt:'2026-10-23T11:59:59Z',archive:'agentmargin-20261023T120000Z-fixture.dump.enc',archiveSha256:'a'.repeat(64),archiveBytes:100,secret:'DO-NOT-LOG'};
 assert.deepEqual(backupStatus(detailed,now,7200),backupStatus(marker,now,7200));
 for(const patch of [{completedAt:'2026-10-24T12:00:00Z'},{completedAt:'2026-02-30T00:00:00Z'},
   {startedAt:'2026-10-24T00:00:00Z'},{durationSeconds:-1},{retentionDays:0},
   {archive:'../../private'},{archiveBytes:0},{archiveSha256:'not-a-digest'}])
   assert.throws(()=>backupStatus({...detailed,...patch},now,7200));
 for(const max of [NaN,0,-1,Infinity,31*86400+1])assert.throws(()=>backupStatus(marker,now,max));
});
test('private backup freshness CLI fails closed and never prints marker secrets or paths',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'agentmargin-backup-status-'));
 chmodSync(fixture,0o700);const dir=join(fixture,'private');mkdirSync(dir,{mode:0o700});
 const run=()=>spawnSync(process.execPath,['--experimental-strip-types','scripts/backup-status.ts'],{
   env:{...process.env,AGENTMARGIN_BACKUP_DIR:dir,AGENTMARGIN_BACKUP_MAX_AGE_SECONDS:'7200'},encoding:'utf8'});
 const clean=(r:ReturnType<typeof run>)=>{assert.equal(r.stderr,'');assert.ok(!r.stdout.includes(fixture));assert.ok(!r.stdout.includes('DO-NOT-LOG'));};
 try{
   let r=run();assert.equal(r.status,2);clean(r);
   writeFileSync(join(dir,'last-success.json'),'{"secret":"DO-NOT-LOG",',{mode:0o600});
   r=run();assert.equal(r.status,2);clean(r);
   writeFileSync(join(dir,'last-success.json'),JSON.stringify({...marker,completedAt:new Date(Math.floor(Date.now()/1000)*1000-10800000).toISOString().replace('.000Z','Z')}));
   r=run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).status,'stale');clean(r);
   writeFileSync(join(dir,'last-success.json'),JSON.stringify({...marker,completedAt:new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z')}));
   r=run();assert.equal(r.status,0);clean(r);
   chmodSync(join(dir,'last-success.json'),0o644);r=run();assert.equal(r.status,2);clean(r);
 }finally{rmSync(fixture,{recursive:true,force:true});}
});

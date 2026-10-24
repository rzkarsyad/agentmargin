/** Pure freshness classification. A success marker is not external recovery proof. */
export function backupStatus(value:unknown,now:number,maxAgeSeconds:number){
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>31*86400)
   throw new Error('Invalid monitoring configuration');
 const r=value as Record<string,unknown>;
 if(!r||typeof r!=='object'||Array.isArray(r)||r.kind!=='backup_succeeded')throw new Error('Invalid backup marker');
 const timestamp=(v:unknown)=>{
   if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v))throw new Error('Invalid backup timestamp');
   const ms=Date.parse(v);
   if(!Number.isFinite(ms)||new Date(ms).toISOString().replace('.000Z','Z')!==v)throw new Error('Invalid backup timestamp');
   return ms;
 };
 const completed=timestamp(r.completedAt);
 // Legacy markers remain monitorable; new markers carry transport references.
 if(r.startedAt!==undefined&&timestamp(r.startedAt)>completed)throw new Error('Invalid backup ordering');
 if(!Number.isSafeInteger(r.durationSeconds)||(r.durationSeconds as number)<0||
    !Number.isSafeInteger(r.retentionDays)||(r.retentionDays as number)<1||(r.retentionDays as number)>9999||completed>now)
   throw new Error('Invalid backup marker');
 if(r.archive!==undefined||r.archiveSha256!==undefined||r.archiveBytes!==undefined){
   if(typeof r.archive!=='string'||!/^agentmargin-\d{8}T\d{6}Z-[A-Za-z0-9]+\.dump\.enc$/.test(r.archive)||
      typeof r.archiveSha256!=='string'||! /^[a-f0-9]{64}$/.test(r.archiveSha256)||
      !Number.isSafeInteger(r.archiveBytes)||(r.archiveBytes as number)<1)throw new Error('Invalid archive reference');
 }
 const ageSeconds=Math.floor((now-completed)/1000);
 // No path, object name, hash, arbitrary marker field or credentials are emitted.
 return {kind:'backup_status' as const,status:ageSeconds>maxAgeSeconds?'stale' as const:'fresh' as const,
   ageSeconds,maxAgeSeconds,durationSeconds:r.durationSeconds as number};
}

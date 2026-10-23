import { randomBytes, randomUUID } from 'node:crypto';
import { PostgresEventStore } from './postgres.ts';
import {digest} from './app.ts';

const workspaceId=process.argv[2];
const name=process.argv[3] ?? 'development';
const role=process.argv[4] ?? 'admin';
const ttlDaysRaw=process.argv[5] ?? '90';
const ttlDays=Number(ttlDaysRaw);
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(workspaceId) || !process.env.DATABASE_URL ||
    !['admin','ingest','read'].includes(role) || !/^[1-9][0-9]*$/.test(ttlDaysRaw) ||
    !Number.isSafeInteger(ttlDays) || ttlDays > 365) {
  throw new Error('Usage: configure DATABASE_URL and run node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID [name] [admin|ingest|read] [ttl_days_1_to_365]');
}
const store=new PostgresEventStore(process.env.DATABASE_URL);
const key=`am_${randomBytes(32).toString('base64url')}`;
const keyId=randomUUID();
try {
  const inserted=await store.pool.query<{expires_at:Date}>(`INSERT INTO workspace_api_keys
    (id,workspace_id,key_digest,name,access_role,expires_at)
    VALUES($1,$2,$3,$4,$5,now() + ($6::integer * interval '1 day')) RETURNING expires_at`,
    [keyId,workspaceId,digest(key),name,role,ttlDays]);
  process.stdout.write(`Key ID (for later revocation): ${keyId}\nRole: ${role}\nExpires at: ${inserted.rows[0]!.expires_at.toISOString()}\nStore this key securely. It will not be shown again:\n${key}\n`);
} finally {await store.pool.end();}

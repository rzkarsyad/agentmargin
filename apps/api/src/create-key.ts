import { randomBytes, randomUUID } from 'node:crypto';
import { PostgresEventStore } from './postgres.ts';
import {digest} from './app.ts';

const workspaceId=process.argv[2];
const name=process.argv[3] ?? 'development';
const role=process.argv[4] ?? 'admin';
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(workspaceId) || !process.env.DATABASE_URL ||
    !['admin','ingest','read'].includes(role)) {
  throw new Error('Usage: DATABASE_URL=... node --experimental-strip-types apps/api/src/create-key.ts WORKSPACE_UUID [name] [admin|ingest|read]');
}
const store=new PostgresEventStore(process.env.DATABASE_URL);
const key=`am_${randomBytes(32).toString('base64url')}`;
const keyId=randomUUID();
try {
  await store.pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role) VALUES($1,$2,$3,$4,$5)',
    [keyId,workspaceId,digest(key),name,role]);
  process.stdout.write(`Key ID (for later revocation): ${keyId}\nRole: ${role}\nStore this key securely. It will not be shown again:\n${key}\n`);
} finally {await store.pool.end();}

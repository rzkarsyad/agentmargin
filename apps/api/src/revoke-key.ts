import {PostgresEventStore} from './postgres.ts';

const keyId=process.argv[2];
if(!keyId||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(keyId)||!process.env.DATABASE_URL)
  throw new Error('Usage: DATABASE_URL=... node --experimental-strip-types apps/api/src/revoke-key.ts KEY_UUID');
const store=new PostgresEventStore(process.env.DATABASE_URL);
try {
  const result=await store.pool.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL',[keyId]);
  if(result.rowCount!==1)throw new Error('Key not found or already revoked');
  process.stdout.write('API key revoked.\n');
}finally{await store.pool.end();}

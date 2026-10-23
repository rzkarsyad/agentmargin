/** CI-only credential rotation drill. Never run against a real deployment. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { PostgresEventStore } from '../apps/api/src/postgres.ts';
import { createApp } from '../apps/api/src/app.ts';

const connectionString=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AGENTMARGIN_KEY_ROTATION_DRILL!=='ci-only'||!connectionString)
  throw new Error('Refusing key rotation drill outside explicitly opted-in GitHub CI');
const target=new URL(connectionString);
if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname!=='127.0.0.1'||
  target.port!=='5432'||target.pathname!=='/agentmargin_ci'||target.username!=='agentmargin_ci')
  throw new Error('Refusing key rotation drill: not the disposable CI PostgreSQL service');

const pool=new pg.Pool({connectionString,max:2});
const store=new PostgresEventStore(connectionString);
const temporaryIds:string[]=[];
const createSecret=()=> 'am_'+randomBytes(32).toString('base64url');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

try{
  const fixture=await pool.query<{id:string}>('SELECT id FROM workspaces ORDER BY id LIMIT 2');
  const usage=await pool.query<{count:string}>('SELECT count(*)::text AS count FROM usage_events');
  assert.equal(fixture.rows.length,2,'CI workspace fixtures must exist');
  assert.ok(Number(usage.rows[0]?.count)>0,'Only a populated synthetic CI database is allowed');
  const workspaceId=fixture.rows[0]!.id;
  const otherWorkspaceId=fixture.rows[1]!.id;
  const oldKey=createSecret(),newKey=createSecret(),expiredKey=createSecret();

  async function insert(key:string,name:string,expired=false){
    const id=randomUUID();
    await pool.query(`INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role,expires_at)
      VALUES ($1,$2,$3,$4,'ingest',CURRENT_TIMESTAMP + ($5::integer * interval '1 day'))`,
      [id,workspaceId,hash(key),name,expired?-1:7]);
    temporaryIds.push(id);
    return id;
  }

  const oldId=await insert(oldKey,'synthetic rotation old');
  await insert(newKey,'synthetic rotation new');
  await insert(expiredKey,'synthetic rotation expired',true);

  // Overlap phase: both old and replacement credentials are valid.
  assert.deepEqual(await store.authenticate(hash(oldKey)),{workspaceId,accessRole:'ingest'});
  assert.deepEqual(await store.authenticate(hash(newKey)),{workspaceId,accessRole:'ingest'});
  assert.equal(await store.authenticate(hash(expiredKey)),null);

  // An incorrectly scoped revoke must not affect a key in another workspace.
  const wrong=await pool.query(`UPDATE workspace_api_keys SET revoked_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND workspace_id=$2 AND revoked_at IS NULL`,[oldId,otherWorkspaceId]);
  assert.equal(wrong.rowCount,0);
  assert.ok(await store.authenticate(hash(oldKey)));

  // Cutover: revoke old only after replacement is verifiably usable.
  const revoked=await pool.query(`UPDATE workspace_api_keys SET revoked_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND workspace_id=$2 AND revoked_at IS NULL RETURNING id`,[oldId,workspaceId]);
  assert.equal(revoked.rowCount,1);
  assert.equal(await store.authenticate(hash(oldKey)),null);
  assert.deepEqual(await store.authenticate(hash(newKey)),{workspaceId,accessRole:'ingest'});

  // Verify the HTTP authorization boundary also observes immediate revocation.
  const app=createApp(store);
  const send=(key:string)=>app.request('/v1/events',{method:'POST',
    headers:{authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify({events:[]})});
  assert.equal((await send(oldKey)).status,401);
  assert.equal((await send(expiredKey)).status,401);
  assert.equal((await send(newKey)).status,400); // Auth/role accepted; invalid empty batch rejected.
  assert.equal((await app.request('/v1/analytics',{headers:{authorization:'Bearer '+newKey}})).status,403);

  process.stdout.write('Synthetic API key overlap, expiration and revocation drill: PASSED.\n');
} finally {
  if(temporaryIds.length){
    await pool.query('DELETE FROM workspace_api_keys WHERE id=ANY($1::uuid[])',[temporaryIds]);
  }
  await store.pool.end();
  await pool.end();
}

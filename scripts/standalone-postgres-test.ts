/** Opt-in test. Requires a dedicated, empty database literally named agentmargin_ci. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {PostgresEventStore} from '../apps/api/src/postgres.ts';
import {createApp, type StoredEvent, type StoredRevenue, type AnalyticsSnapshot} from '../apps/api/src/app.ts';

const connectionString=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!connectionString)throw new Error('AGENTMARGIN_STANDALONE_DATABASE_URL is required');
const url=new URL(connectionString);
if(!['postgresql:','postgres:'].includes(url.protocol)||url.pathname!=='/agentmargin_ci'||!['127.0.0.1','localhost'].includes(url.hostname))
  throw new Error('Refusing to test: database URL must target /agentmargin_ci exactly');
const pool=new pg.Pool({connectionString,max:2});
let store:PostgresEventStore|undefined;
try {
  const tables=await pool.query<{count:string}>(`SELECT count(*)::text AS count FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'`);
  if(Number(tables.rows[0]?.count)!==0)throw new Error('Refusing to test: agentmargin_ci must be empty');
  await pool.query(readFileSync(new URL('../db/001_initial.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/002_ingestion.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/003_revenue_ingestion.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/004_workspace_pricing.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/005_api_key_roles.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../db/006_api_key_expiry.sql',import.meta.url),'utf8'));
  // Upgrade fixture: preserve existing financial rows and keys; a failed additive
  // migration must roll back every schema change before a successful retry.
  const upgradeWorkspace=randomUUID(),upgradeKey='am_'+randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[upgradeWorkspace,'Upgrade fixture']);
  await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',
    [randomUUID(),upgradeWorkspace,createHash('sha256').update(upgradeKey).digest('hex'),'legacy-upgrade']);
  await pool.query("INSERT INTO customers(workspace_id,id) VALUES($1,'upgrade')",[upgradeWorkspace]);
  await pool.query("INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros) VALUES($1,'legacy','upgrade','2026-10-10Z',1234567)",[upgradeWorkspace]);
  const migration=readFileSync(new URL('../db/007_credential_tenant_isolation.sql',import.meta.url),'utf8');
  const upgrade=await pool.connect();
  try{
    await assert.rejects(upgrade.query(migration.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await upgrade.query('ROLLBACK');
    assert.equal((await upgrade.query("SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname='agentmargin_auth'")).rows[0].n,0);
    assert.equal((await upgrade.query("SELECT relrowsecurity FROM pg_class WHERE oid='customers'::regclass")).rows[0].relrowsecurity,false);
    const blocker=await pool.connect();
    try{
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE customers IN ACCESS EXCLUSIVE MODE');
      await assert.rejects(upgrade.query(migration.replace("lock_timeout = '5s'","lock_timeout = '100ms'")),
        (e:unknown)=>(e as {code?:string}).code==='55P03');
      await upgrade.query('ROLLBACK');
      assert.equal((await upgrade.query("SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname='agentmargin_auth'")).rows[0].n,0);
    }finally{await blocker.query('ROLLBACK');blocker.release();}
    await upgrade.query(migration);
    assert.equal((await upgrade.query('SELECT amount_micros::text FROM revenue_records WHERE workspace_id=$1',[upgradeWorkspace])).rows[0].amount_micros,'1234567');
  }finally{upgrade.release();}
  const workspace=randomUUID(),other=randomUUID(),key='am_'+randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO workspaces(id,name) VALUES ($1,$2),($3,$4)',[workspace,'A',other,'B']);
  await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES ($1,$2,$3,$4)',
    [randomUUID(),workspace,createHash('sha256').update(key).digest('hex'),'test']);
  store=new PostgresEventStore(connectionString);
  const event={id:'race-1',workspaceId:workspace,customerId:'customer-1',model:'m',occurredAt:'2026-10-10T00:00:00Z',inputTokens:1,outputTokens:1};
  const stored:StoredEvent={event,payloadDigest:'same-payload',costMicros:100n,source:'reported',priceId:null};
  const concurrent=await Promise.all(Array.from({length:20},()=>store!.ingest(workspace,[stored])));
  assert.equal(concurrent.reduce((sum,r)=>sum+r.inserted,0),1);
  assert.equal(concurrent.reduce((sum,r)=>sum+r.duplicate,0),19);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE workspace_id=$1',[workspace])).rows[0]?.n,1);
  await assert.rejects(store.ingest(workspace,[{...stored,payloadDigest:'changed'}]),/Idempotency conflict/);
  // Conflicting lock acquisition order used to cause deadlock risks in batches.
  const first:StoredEvent={...stored,event:{...event,id:'ordered-a'},payloadDigest:'ordered-a'};
  const second:StoredEvent={...stored,event:{...event,id:'ordered-b'},payloadDigest:'ordered-b'};
  const swapped=await Promise.all([
    store.ingest(workspace,[first,second]),
    store.ingest(workspace,[second,first]),
  ]);
  assert.equal(swapped.reduce((sum,result)=>sum+result.inserted,0),2);
  assert.equal(swapped.reduce((sum,result)=>sum+result.duplicate,0),2);
  // A separate workspace must not observe any of the first workspace's events or revenue.
  assert.equal((await store.analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')).customers.length,0);
  const rev:StoredRevenue={id:'invoice-concurrent',customerId:'customer-1',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'29000000',payloadDigest:'revenue-payload-v1'};
  const revenueRuns=await Promise.all(Array.from({length:20},()=>store!.ingestRevenue(workspace,[rev])));
  assert.equal(revenueRuns.reduce((n,result)=>n+result.inserted,0),1);
  assert.equal(revenueRuns.reduce((n,result)=>n+result.duplicate,0),19);
  await assert.rejects(store.ingestRevenue(workspace,[{...rev,amountMicros:'30000000',payloadDigest:'changed'}]),/Idempotency conflict/);
  const a=await store.analytics(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
  assert.equal(a.customers.find(c=>c.customerId==='customer-1')?.revenueMicros,'29000000');
  const b=await store.analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
  assert.equal(b.customers.length,0);
  // Authorization must always derive scope from the bearer key, never query strings.
  const otherKey='am_'+randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES($1,$2,$3,$4)',[
    randomUUID(),other,createHash('sha256').update(otherKey).digest('hex'),'other-workspace']);
  const otherEvent:StoredEvent={...stored,event:{...event,id:'private-other-workspace',workspaceId:other,customerId:'other-customer'},payloadDigest:'other-workspace-event'};
  await store.ingest(other,[otherEvent]);
  const api=createApp(store);
  const path='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&workspaceId='+other;
  const visibleA=await api.request(path,{headers:{authorization:'Bearer '+key}});
  const visibleB=await api.request(path,{headers:{authorization:'Bearer '+otherKey}});
  assert.equal(visibleA.status,200);assert.equal(visibleB.status,200);
  const responseA=await visibleA.json() as {customers:{customerId:string}[]};
  const responseB=await visibleB.json() as {customers:{customerId:string}[]};
  assert.ok(!responseA.customers.some(c=>c.customerId==='other-customer'),'Cross-tenant data leaked into workspace A');
  assert.deepEqual(responseB.customers.map(c=>c.customerId),['other-customer']);
  // v0.3: workspace A prices must never bleed into B, even for identical models.
  const sourceNote='CI synthetic source for isolated pricing';
  const firstPrice={id:randomUUID(),model:'workspace-only-model',
    effectiveFrom:'2026-01-01T00:00:00.000Z',effectiveTo:null,
    inputMicrosPerMillion:'1000000',outputMicrosPerMillion:'2000000',
    cachedInputMicrosPerMillion:null,sourceNote};
  const createdPrice=await store.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),firstPrice);
  assert.equal(createdPrice.model,'workspace-only-model');
  assert.equal((await store.listPriceVersions(other)).items.length,0,'Other workspace must not list pricing data');
  assert.equal((await store.prices(other,'workspace-only-model','2026-10-01T00:00:00Z')).length,0,
    'Other workspace must not reuse workspace A pricing');
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-10-01T00:00:00Z'))[0]?.id,createdPrice.id);
  const later={...firstPrice,id:randomUUID(),effectiveFrom:'2026-11-01T00:00:00.000Z',inputMicrosPerMillion:'3000000'};
  await store.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),later);
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-10-01T00:00:00Z'))[0]?.id,createdPrice.id);
  assert.equal((await store.prices(workspace,'workspace-only-model','2026-11-02T00:00:00Z'))[0]?.id,later.id);
  await assert.rejects(pool.query('UPDATE workspace_price_versions SET input_micros_per_million=0 WHERE id=$1',[createdPrice.id]),
    /append-only/);
  await assert.rejects(pool.query('DELETE FROM workspace_price_versions WHERE id=$1',[createdPrice.id]),/append-only/);
  // API must scope price listings from auth, not client-supplied workspaceId.
  const priceListA=await api.request('/v1/prices?workspaceId='+other,{headers:{authorization:'Bearer '+key}});
  const priceListB=await api.request('/v1/prices?workspaceId='+workspace,{headers:{authorization:'Bearer '+otherKey}});
  assert.equal(priceListA.status,200);assert.equal(priceListB.status,200);
  assert.equal((await priceListA.json() as {items:{id:string}[]}).items.length,2);
  assert.equal((await priceListB.json() as {items:{id:string}[]}).items.length,0);
  // v0.5: full-workspace totals must include customers beyond a single page.
  await pool.query(`INSERT INTO customers(workspace_id,id)
    SELECT $1,'bulk-'||lpad(n::text,4,'0') FROM generate_series(1,125) AS n
    ON CONFLICT DO NOTHING`,[workspace]);
  await pool.query(`INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros)
    SELECT $1,'bulk-rev-'||n::text,'bulk-'||lpad(n::text,4,'0'),
      '2026-10-10T00:00:00Z'::timestamptz,1000000
    FROM generate_series(1,125) AS n`,[workspace]);
  const pageFirst=await store.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',null,20);
  assert.equal(pageFirst.customers.length,20);
  assert.equal(pageFirst.summary.customerCount,'126');
  assert.equal(pageFirst.summary.totalRevenueMicros,'154000000');
  assert.equal(pageFirst.summary.unknownCustomerCount,'0');
  assert.equal(pageFirst.summary.completeContributionMicros,
    (BigInt(pageFirst.summary.totalRevenueMicros)-BigInt(pageFirst.summary.totalKnownAiCostMicros)).toString());
  assert.ok(pageFirst.nextCursor,'More customers must be accessible');
  const pageSecond=await store.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',
    Buffer.from(pageFirst.nextCursor,'base64url').toString('utf8'),20);
  assert.equal(pageSecond.customers.length,20);
  assert.equal(pageSecond.summary.totalRevenueMicros,pageFirst.summary.totalRevenueMicros);
  assert.equal(new Set([...pageFirst.customers,...pageSecond.customers].map(c=>c.customerId)).size,40);
  const pageA=await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=20&workspaceId='+other,
    {headers:{authorization:'Bearer '+key}});
  assert.equal(pageA.status,200);
  const pageResult=await pageA.json() as {summary:{customerCount:string};nextCursor:string};
  assert.equal(pageResult.summary.customerCount,'126','Query workspaceId must not change scope');
  const pageB=await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=20',
    {headers:{authorization:'Bearer '+otherKey}});
  assert.equal((await pageB.json() as {summary:{customerCount:string}}).summary.customerCount,'1',
    'Other tenant must not inherit aggregate totals');
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&limit=0',
    {headers:{authorization:'Bearer '+key}})).status,400);
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&cursor=!',
    {headers:{authorization:'Bearer '+key}})).status,400);
  assert.equal((await api.request('/v1/analytics/page?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z')).status,401);
  // v0.8: real database key roles restrict API operations without changing
  // existing pre-migration keys (which migrate to admin for compatibility).
  assert.deepEqual(await store.authenticate(createHash('sha256').update(key).digest('hex')),
    {workspaceId:workspace,accessRole:'admin'});
  const readKey='am_'+randomBytes(32).toString('base64url');
  const ingestKey='am_'+randomBytes(32).toString('base64url');
  for(const [newKey,accessRole] of [[readKey,'read'],[ingestKey,'ingest']] as const){
    await pool.query(`INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name,access_role)
      VALUES($1,$2,$3,$4,$5)`,[randomUUID(),workspace,createHash('sha256').update(newKey).digest('hex'),accessRole+'-key',accessRole]);
  }
  const period='/v1/analytics?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z';
  assert.equal((await api.request(period,{headers:{authorization:'Bearer '+readKey}})).status,200);
  assert.equal((await api.request('/v1/events',{method:'POST',headers:{authorization:'Bearer '+readKey}})).status,403);
  assert.equal((await api.request('/v1/prices',{method:'POST',headers:{authorization:'Bearer '+readKey}})).status,403);
  assert.equal((await api.request(period,{headers:{authorization:'Bearer '+ingestKey}})).status,403);
  assert.equal((await api.request('/v1/prices',{headers:{authorization:'Bearer '+ingestKey}})).status,403);
  const ingestByRole=await api.request('/v1/events',{method:'POST',headers:{
    authorization:'Bearer '+ingestKey,'content-type':'application/json'},
    body:JSON.stringify({events:[{...event,id:'role-restricted-event',reportedCostMicros:'100'}]})});
  assert.equal(ingestByRole.status,202);
  // Expiry is enforced at authentication time, independent of API key role.
  await pool.query(`UPDATE workspace_api_keys SET expires_at = now() - interval '1 second'
    WHERE key_digest=$1`,[createHash('sha256').update(readKey).digest('hex')]);
  assert.equal(await store.authenticate(createHash('sha256').update(readKey).digest('hex')),null);
  assert.equal((await api.request(period,{headers:{authorization:'Bearer '+readKey}})).status,401);
  assert.equal((await api.request(period,{headers:{authorization:'Bearer '+key}})).status,200,
    'Legacy no-expiry key remains valid');
  // v0.7: prove the documented runtime grants support API queries while blocking
  // schema/accounting mutations. The role exists only for this isolated CI run.
  const runtimeRole='agentmargin_ci_runtime_'+randomBytes(6).toString('hex');
  const runtimePassword=randomBytes(24).toString('base64url');
  const roleDDL=await pool.query<{sql:string}>(
    `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS sql`,
    [runtimeRole,runtimePassword]);
  await pool.query(roleDDL.rows[0]!.sql);
  let runtimeStore:PostgresEventStore|undefined;
  try{
    const grants=readFileSync(new URL('../db/runtime_privileges.psql',import.meta.url),'utf8')
      .replaceAll(':"runtime_role"','"'+runtimeRole+'"')
      .replaceAll(":'runtime_role'","'"+runtimeRole+"'")
      .split('\n').filter(line=>!line.startsWith('--')).join('\n');
    const refused=async()=>{
      const setup=await pool.connect();
      try{await assert.rejects(setup.query(grants),/Unsafe runtime/);}finally{await setup.query('ROLLBACK');setup.release();}
    };
    await pool.query('ALTER ROLE "'+runtimeRole+'" BYPASSRLS');
    await refused();await pool.query('ALTER ROLE "'+runtimeRole+'" NOBYPASSRLS');
    await pool.query('GRANT agentmargin_ci TO "'+runtimeRole+'"');
    await refused();await pool.query('REVOKE agentmargin_ci FROM "'+runtimeRole+'"');
    // PUBLIC privilege drift is effective even for NOINHERIT roles.
    await pool.query('GRANT UPDATE(key_digest) ON workspace_api_keys TO PUBLIC');
    // The template actively revokes PUBLIC auth-table grants, including columns.
    await pool.query(grants);
    assert.equal((await pool.query("SELECT has_column_privilege($1,'workspace_api_keys','key_digest','UPDATE') AS unsafe",[runtimeRole])).rows[0].unsafe,false);
    await pool.query('ALTER TABLE customers OWNER TO "'+runtimeRole+'"');
    await refused();await pool.query('ALTER TABLE customers OWNER TO agentmargin_ci');
    await pool.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
    await refused();await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await pool.query(grants);
    const runtimeURL=new URL(connectionString);
    runtimeURL.username=runtimeRole;
    runtimeURL.password=runtimePassword;
    runtimeStore=new PostgresEventStore('',{pool:new pg.Pool({connectionString:runtimeURL.toString(),max:1,
      connectionTimeoutMillis:5000,statement_timeout:15000})}).forCredential(key);
    assert.deepEqual(await runtimeStore.authenticate(createHash('sha256').update(key).digest('hex')),
      {workspaceId:workspace,accessRole:'admin'});
    const runtimeEvent:StoredEvent={...stored,event:{...event,id:'runtime-role-usage',customerId:'runtime-customer'},
      payloadDigest:'runtime-role-usage'};
    assert.equal((await runtimeStore.ingest(workspace,[runtimeEvent])).inserted,1);
    const runtimeRevenue:StoredRevenue={...rev,id:'runtime-role-revenue',customerId:'runtime-customer',
      payloadDigest:'runtime-role-revenue'};
    assert.equal((await runtimeStore.ingestRevenue(workspace,[runtimeRevenue])).inserted,1);
    const runtimePrice={...firstPrice,id:randomUUID(),model:'runtime-priced',
      effectiveFrom:'2026-12-01T00:00:00Z'};
    assert.equal((await runtimeStore.createPriceVersion(workspace,createHash('sha256').update(key).digest('hex'),runtimePrice)).id,
      runtimePrice.id);
    assert.equal((await runtimeStore.prices(workspace,'runtime-priced','2026-12-02T00:00:00Z'))[0]?.id,runtimePrice.id);
    assert.ok((await runtimeStore.analyticsPage(workspace,'2026-10-01T00:00:00Z',
      '2026-11-01T00:00:00Z',null,20)).summary.customerCount);
    // The stolen DB password alone cannot discover key digests or tenant data.
    for(const table of ['customers','usage_events','revenue_records','workspace_price_versions']){
      assert.equal((await runtimeStore.pool.query('SELECT * FROM '+table)).rowCount,0,table+' must default deny');
    }
    const direct=await runtimeStore.pool.connect();
    const selectTenants=async()=> (await direct.query<{workspace_id:string}>('SELECT DISTINCT workspace_id FROM usage_events')).rows.map(r=>r.workspace_id);
    try{
      for(const forged of ['',other,createHash('sha256').update(key).digest('hex'),'am_'+'x'.repeat(43)]){
        await direct.query('BEGIN');
        await direct.query("SELECT set_config('agentmargin.workspace_id',$1,true),set_config('agentmargin.api_key',$2,true)",[other,forged]);
        assert.deepEqual(await selectTenants(),[],'Forged context granted read access');
        await assert.rejects(direct.query('INSERT INTO customers(workspace_id,id) VALUES($1,$2)',[other,'forged']),
          (e:unknown)=>(e as {code?:string}).code==='42501');
        await direct.query('ROLLBACK');
      }
      await direct.query('BEGIN');
      await direct.query("SET LOCAL search_path=pg_temp,public,pg_catalog");
      await direct.query('CREATE TEMP TABLE workspace_api_keys(key_digest text,workspace_id uuid,access_role text)');
      await direct.query('INSERT INTO workspace_api_keys VALUES($1,$2,$3)',[createHash('sha256').update(key).digest('hex'),other,'admin']);
      await direct.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
      assert.equal((await direct.query('SELECT workspace_id FROM agentmargin_auth.principal($1)',[key])).rows[0].workspace_id,workspace,
        'SECURITY DEFINER resolved a shadow key table');
      assert.equal((await direct.query('SELECT * FROM agentmargin_auth.principal($1)',["am_'; SET ROLE agentmargin_ci; --"])).rowCount,0);
      assert.deepEqual(await selectTenants(),[workspace]);
      await assert.rejects(direct.query('INSERT INTO customers(workspace_id,id) VALUES($1,$2)',[other,'cross-tenant']),
        (e:unknown)=>(e as {code?:string}).code==='42501');
      await direct.query('ROLLBACK');
      assert.deepEqual(await selectTenants(),[],'Rollback leaked tenant context');
      await direct.query('BEGIN');
      await direct.query("SELECT set_config('agentmargin.api_key',$1,true)",[otherKey]);
      assert.deepEqual(await selectTenants(),[other]);
      await direct.query('COMMIT');
      assert.deepEqual(await selectTenants(),[],'Commit leaked tenant context');
    }finally{await direct.query('ROLLBACK');direct.release();}
    // Pooled adapter queries cannot assert another workspace even with a valid A key.
    assert.equal((await runtimeStore.analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')).customers.length,0);
    await assert.rejects(runtimeStore.ingest(other,[otherEvent]),(e:unknown)=>(e as {code?:string}).code==='42501');
    await assert.rejects(runtimeStore.ingestRevenue(other,[rev]),(e:unknown)=>(e as {code?:string}).code==='42501');
    await assert.rejects(runtimeStore.createPriceVersion(other,createHash('sha256').update(key).digest('hex'),
      {...firstPrice,id:randomUUID()}),(e:unknown)=>(e as {code?:string}).code==='42501');
    assert.equal((await runtimeStore.forCredential(upgradeKey).analytics(upgradeWorkspace,
      '2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')).customers[0]?.revenueMicros,'1234567');
    // DB writes enforce key capabilities as well as tenant identity.
    await pool.query('UPDATE workspace_api_keys SET expires_at=NULL WHERE key_digest=$1',
      [createHash('sha256').update(readKey).digest('hex')]);
    assert.equal((await runtimeStore.forCredential(readKey).authenticate('ignored'))?.accessRole,'read');
    await assert.rejects(runtimeStore.forCredential(readKey).ingest(workspace,[{...runtimeEvent,event:{...runtimeEvent.event,id:'read-write-denied'}}]),
      (e:unknown)=>(e as {code?:string}).code==='42501');
    await assert.rejects(runtimeStore.forCredential(ingestKey).createPriceVersion(workspace,
      createHash('sha256').update(ingestKey).digest('hex'),{...firstPrice,id:randomUUID(),model:'forbidden'}),
      (e:unknown)=>(e as {code?:string}).code==='42501');
    await pool.query("UPDATE workspace_api_keys SET expires_at=now()-interval '1 second' WHERE key_digest=$1",
      [createHash('sha256').update(readKey).digest('hex')]);
    const restrictedApi=createApp(runtimeStore);
    assert.equal((await restrictedApi.request(period)).status,401);
    assert.equal((await restrictedApi.request(period,{headers:{authorization:'Bearer '+readKey}})).status,401);
    const totalsBefore=await store.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',null,20);
    const totalsAfter=await runtimeStore.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',null,20);
    assert.deepEqual(totalsAfter,totalsBefore,'RLS changed financial results');
    for(let n=0;n<10;n++){
      const [tenantA,tenantB]:[AnalyticsSnapshot,AnalyticsSnapshot]=await Promise.all([runtimeStore.analytics(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z'),
        runtimeStore.forCredential(otherKey).analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')]);
      assert.ok(!tenantA.customers.some(c=>c.customerId==='other-customer'));
      assert.deepEqual(tenantB.customers.map(c=>c.customerId),['other-customer']);
    }
    // Revocation affects the already-created credential view on its next statement.
    await pool.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE key_digest=$1',
      [createHash('sha256').update(otherKey).digest('hex')]);
    assert.equal(await runtimeStore.forCredential(otherKey).authenticate('ignored'),null);
    assert.equal((await runtimeStore.forCredential(otherKey).analytics(other,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')).customers.length,0);
    assert.equal((await restrictedApi.request(period,{headers:{authorization:'Bearer '+otherKey}})).status,401);
    const denied=[
      'SELECT * FROM workspaces',
      'SELECT * FROM workspace_api_keys',
      'ALTER FUNCTION agentmargin_auth.principal(text) OWNER TO CURRENT_USER',
      'CREATE OR REPLACE FUNCTION agentmargin_auth.workspace(text) RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$',
      'ALTER TABLE usage_events DISABLE ROW LEVEL SECURITY',
      'SET ROLE agentmargin_ci',
      'INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name) VALUES (gen_random_uuid(),gen_random_uuid(),repeat(\'a\',64),\'forbidden\')',
      'UPDATE revenue_records SET amount_micros=0',
      'DELETE FROM revenue_records',
      'TRUNCATE TABLE usage_events',
      'ALTER TABLE customers ADD COLUMN forbidden text',
      'CREATE TABLE public.forbidden_table(id integer)',
    ];
    for(const sql of denied){
      await assert.rejects(runtimeStore.pool.query(sql),
        (err:unknown)=>(err as {code?:string}).code==='42501',
        'Runtime role unexpectedly allowed: '+sql);
    }
  }finally{
    await runtimeStore?.pool.end();
    // Drop only the randomly named role created by this test, never an existing role.
    await pool.query('DROP OWNED BY "'+runtimeRole+'"');
    await pool.query('DROP ROLE "'+runtimeRole+'"');
  }
  process.stdout.write('Standalone PostgreSQL concurrency: PASSED (usage/revenue idempotency, reversed batch order, tenant isolation).\n');
} finally {
  await store?.pool.end();
  await pool.end();
}

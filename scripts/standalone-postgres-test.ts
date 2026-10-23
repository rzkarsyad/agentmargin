/** Opt-in test. Requires a dedicated, empty database literally named agentmargin_ci. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {testV09FinancialFixture} from './v09-financial-fixture.ts';
import {testFinancialReports} from './financial-report-tests.ts';
import {testDefinerCatalogShadow} from './definer-shadow-tests.ts';
import {testDeliveryRecovery} from './delivery-recovery-tests.ts';
import {testAdjustmentDeliveries} from './adjustment-delivery-tests.ts';
import {parseAdjustment} from '../packages/core/src/adjustments.ts';
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
  const readinessStore=new PostgresEventStore(connectionString);
  try{assert.equal(await readinessStore.ready(),false,'Pre-007 schema must not be ready');}finally{await readinessStore.pool.end();}
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
  const inboxMigration=readFileSync(new URL('../db/008_revenue_deliveries.sql',import.meta.url),'utf8');
  const inboxUpgrade=await pool.connect();
  try{
    await assert.rejects(inboxUpgrade.query(inboxMigration.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await inboxUpgrade.query('ROLLBACK');
    assert.equal((await inboxUpgrade.query("SELECT to_regclass('public.revenue_deliveries') AS name")).rows[0].name,null);
    await inboxUpgrade.query(inboxMigration);
    assert.equal((await inboxUpgrade.query('SELECT amount_micros::text FROM revenue_records WHERE workspace_id=$1',[upgradeWorkspace])).rows[0].amount_micros,'1234567');
  }finally{inboxUpgrade.release();}
  // Reproduce 007's pre-revocation snapshot risk before applying containment.
  const stale=await pool.connect();
  try{
    await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    assert.equal((await stale.query('SELECT * FROM agentmargin_auth.principal($1)',[upgradeKey])).rowCount,1);
    await pool.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE workspace_id=$1',[upgradeWorkspace]);
    assert.equal((await stale.query('SELECT * FROM agentmargin_auth.principal($1)',[upgradeKey])).rowCount,1,
      'Baseline must demonstrate stale authorization rather than assume immediate revocation');
  }finally{await stale.query('ROLLBACK');stale.release();}
  await pool.query('UPDATE workspace_api_keys SET revoked_at=NULL WHERE workspace_id=$1',[upgradeWorkspace]);
  const containment=readFileSync(new URL('../db/009_credential_containment.sql',import.meta.url),'utf8');
  const containmentUpgrade=await pool.connect();
  try{
    await assert.rejects(containmentUpgrade.query(containment.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await containmentUpgrade.query('ROLLBACK');
    assert.equal((await containmentUpgrade.query("SELECT to_regprocedure('agentmargin_auth.event_digest(uuid,text,text)') AS name")).rows[0].name,null);
    await containmentUpgrade.query(containment);
  }finally{containmentUpgrade.release();}
  const ledgerMigration=readFileSync(new URL('../db/010_revenue_adjustments.sql',import.meta.url),'utf8');
  const ledgerUpgrade=await pool.connect();
  try{
    await assert.rejects(ledgerUpgrade.query(ledgerMigration.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await ledgerUpgrade.query('ROLLBACK');
    assert.equal((await ledgerUpgrade.query("SELECT to_regclass('public.revenue_adjustments') AS name")).rows[0].name,null);
    await ledgerUpgrade.query(ledgerMigration);
    assert.equal((await ledgerUpgrade.query('SELECT amount_micros::text,currency FROM revenue_records WHERE workspace_id=$1',[upgradeWorkspace])).rows[0].currency,'USD');
  }finally{ledgerUpgrade.release();}
  const deliveryUpgrade=await pool.connect();
  try{
    const sql=readFileSync(new URL('../db/011_adjustment_deliveries.sql',import.meta.url),'utf8');
    await assert.rejects(deliveryUpgrade.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await deliveryUpgrade.query('ROLLBACK');
    assert.equal((await deliveryUpgrade.query("SELECT to_regclass('public.adjustment_deliveries') AS name")).rows[0].name,null);
    await deliveryUpgrade.query(sql);
  }finally{deliveryUpgrade.release();}
  await pool.query("INSERT INTO revenue_deliveries(workspace_id,provider_event_id,provider_account,record_id,customer_id,occurred_at,amount_micros,payload_digest) VALUES($1,'evt_upgrade_checkpoint','acct_upgrade','checkpoint','upgrade','2026-10-10Z',1,$2)",[upgradeWorkspace,'c'.repeat(64)]);
  const auditUpgrade=await pool.connect();
  try{
    const sql=readFileSync(new URL('../db/012_delivery_audit.sql',import.meta.url),'utf8');
    await assert.rejects(auditUpgrade.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await auditUpgrade.query('ROLLBACK');
    assert.equal((await auditUpgrade.query("SELECT to_regclass('public.delivery_history') AS name")).rows[0].name,null);
    await auditUpgrade.query(sql);
    assert.equal((await auditUpgrade.query("SELECT operation FROM delivery_history WHERE provider_event_id='evt_upgrade_checkpoint'")).rows[0].operation,'checkpoint');
  }finally{auditUpgrade.release();}
  await testDefinerCatalogShadow(pool,connectionString);
  const transitionUpgrade=await pool.connect();
  try{
    const sql=readFileSync(new URL('../db/014_delivery_transition_guard.sql',import.meta.url),'utf8');
    await assert.rejects(transitionUpgrade.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')),/division by zero/);
    await transitionUpgrade.query('ROLLBACK');
    assert.equal((await transitionUpgrade.query("SELECT to_regprocedure('agentmargin_auth.enforce_delivery_transition()') AS name")).rows[0].name,null);
    await transitionUpgrade.query(sql);
  }finally{transitionUpgrade.release();}
  const incidentRole='agentmargin_ci_incident_'+randomBytes(6).toString('hex');
  const incidentPassword=randomBytes(24).toString('hex');
  await pool.query(`CREATE ROLE "${incidentRole}" LOGIN NOINHERIT PASSWORD '${incidentPassword}'`);
  const incidentUrl=new URL(connectionString);incidentUrl.username=incidentRole;incidentUrl.password=incidentPassword;
  const incidentClient=new pg.Client(incidentUrl.toString());incidentClient.on('error',()=>{});
  try{
    await incidentClient.connect();
    const stopped=assert.rejects(incidentClient.query('SELECT pg_sleep(10)'),(e:unknown)=>(e as {code?:string}).code==='57P01');
    const sql=readFileSync(new URL('../db/contain_runtime_sessions.psql',import.meta.url),'utf8')
      .replaceAll(":'runtime_role'","'"+incidentRole+"'");
    await pool.query(sql);await stopped;
    const reconnect=new pg.Client(incidentUrl.toString());
    try{await assert.rejects(reconnect.connect(),(e:unknown)=>(e as {code?:string}).code==='28000');}
    finally{await reconnect.end();}
  }finally{await incidentClient.end();await pool.query('DROP ROLE "'+incidentRole+'"');}
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
    assert.equal(await runtimeStore.ready(),true);
    assert.equal((await pool.query("SELECT has_function_privilege($1,'agentmargin_auth.validate_adjustment()','EXECUTE') AS allowed",[runtimeRole])).rows[0].allowed,false,'Runtime must not directly execute definer triggers');
    await pool.query('ALTER TABLE usage_events DISABLE ROW LEVEL SECURITY');
    try{assert.equal(await runtimeStore.ready(),false,'Disabled RLS must fail readiness');}
    finally{await pool.query('ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY');}
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
    // A client cannot disguise a reusable snapshot by changing default isolation.
    const adversary=await runtimeStore.pool.connect();
    try{
      for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){
        await adversary.query('BEGIN ISOLATION LEVEL '+isolation);
        await adversary.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
        await adversary.query("SET LOCAL default_transaction_isolation='read committed'");
        assert.equal((await adversary.query('SELECT * FROM agentmargin_auth.principal($1)',[key])).rowCount,0);
        assert.equal((await adversary.query('SELECT * FROM revenue_records')).rowCount,0);
        await assert.rejects(adversary.query("SELECT set_config('transaction_isolation','read committed',true)"),
          (e:unknown)=>(e as {code?:string}).code==='25001');
        await adversary.query('ROLLBACK');
      }
      // Residual risk: a cursor's already-started statement retains its snapshot
      // even under READ COMMITTED. Do not claim the gate is fully cleared.
      await adversary.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await adversary.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
      await adversary.query('DECLARE retained CURSOR FOR SELECT id FROM revenue_records ORDER BY id');
      assert.equal((await adversary.query('FETCH 1 FROM retained')).rowCount,1);
      await pool.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE key_digest=$1',[createHash('sha256').update(key).digest('hex')]);
      assert.equal((await adversary.query('FETCH 1 FROM retained')).rowCount,1,'Document the residual cursor snapshot');
      assert.equal((await adversary.query('SELECT * FROM agentmargin_auth.principal($1)',[key])).rowCount,0);
      await adversary.query('ROLLBACK');
      await pool.query('UPDATE workspace_api_keys SET revoked_at=NULL WHERE key_digest=$1',[createHash('sha256').update(key).digest('hex')]);
      await adversary.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await adversary.query("SELECT set_config('agentmargin.api_key',$1,true)",[ingestKey]);
      for(const table of ['customers','usage_events','revenue_records'])
        assert.equal((await adversary.query('SELECT * FROM '+table)).rowCount,0,'Ingest key exposed bulk '+table);
      assert.equal((await adversary.query("SELECT * FROM agentmargin_auth.event_digest($1,'revenue',$2)",[workspace,runtimeRevenue.id])).rows[0].payload_digest,runtimeRevenue.payloadDigest);
      assert.equal((await adversary.query("SELECT * FROM agentmargin_auth.event_digest($1,'revenue',$2)",[other,runtimeRevenue.id])).rowCount,0);
      await pool.query('UPDATE workspace_api_keys SET revoked_at=now() WHERE key_digest=$1',[createHash('sha256').update(ingestKey).digest('hex')]);
      assert.equal((await adversary.query('SELECT * FROM agentmargin_auth.principal($1)',[ingestKey])).rowCount,0,
        'Next READ COMMITTED statement retained revoked authentication');
      await adversary.query('COMMIT');
    }finally{await adversary.query('ROLLBACK');adversary.release();}
    await pool.query('UPDATE workspace_api_keys SET revoked_at=NULL WHERE key_digest=$1',[createHash('sha256').update(ingestKey).digest('hex')]);
    assert.equal((await runtimeStore.forCredential(ingestKey).ingest(workspace,[runtimeEvent])).duplicate,1);
    assert.equal((await runtimeStore.forCredential(ingestKey).ingestRevenue(workspace,[runtimeRevenue])).duplicate,1);
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
    // Append-only reductions: economic source identity, payment linkage, bounded
    // cumulative amounts and concurrent retries, enforced by PostgreSQL itself.
    const adjustmentPayment={...runtimeRevenue,id:'adjustment-payment',amountMicros:'1000000'};
    await runtimeStore.ingestRevenue(workspace,[adjustmentPayment]);
    const adjustment=parseAdjustment({originalPaymentId:adjustmentPayment.id,customerId:adjustmentPayment.customerId,
      kind:'refund',amountMicros:'100000',currency:'USD',occurredAt:'2026-10-11T00:00:00Z',
      provider:'import',providerAccount:'acct_synthetic',sourceObjectId:'re_ledger_partial',evidenceRef:'stripe:refund:re_ledger_partial'});
    const adjustmentStore=runtimeStore.forCredential(ingestKey);
    const replayed=await Promise.all(Array.from({length:12},()=>adjustmentStore.ingestAdjustments(workspace,[adjustment])));
    assert.equal(replayed.reduce((n,r)=>n+r.inserted,0),1);assert.equal(replayed.reduce((n,r)=>n+r.duplicate,0),11);
    await assert.rejects(adjustmentStore.ingestAdjustments(workspace,[parseAdjustment({...adjustment,amountMicros:'99999'})]),/Idempotency conflict/);
    await assert.rejects(adjustmentStore.ingestAdjustments(other,[adjustment]),(e:unknown)=>(e as {code?:string}).code==='42501');
    await assert.rejects(runtimeStore.forCredential(readKey).ingestAdjustments(workspace,[adjustment]),(e:unknown)=>(e as {code?:string}).code==='42501');
    for(const patch of [{customerId:'wrong-customer'},{originalPaymentId:'missing-payment'},
      {occurredAt:'2026-01-01T00:00:00Z'},{amountMicros:'1000001'}]){
      await assert.rejects(adjustmentStore.ingestAdjustments(workspace,[parseAdjustment({...adjustment,...patch,sourceObjectId:'re_invalid'})]),
        (e:unknown)=>['23503','23514'].includes((e as {code?:string}).code??''));
    }
    const parallel=new PostgresEventStore(runtimeURL.toString()).forCredential(ingestKey);
    try{
      const results=await Promise.allSettled([
        adjustmentStore.ingestAdjustments(workspace,[parseAdjustment({...adjustment,sourceObjectId:'re_race_a',amountMicros:'600000',kind:'credit'})]),
        parallel.ingestAdjustments(workspace,[parseAdjustment({...adjustment,sourceObjectId:'re_race_b',amountMicros:'600000',kind:'payment_reversal'})]),
      ]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Concurrent reductions exceeded payment');
      assert.equal(results.filter(r=>r.status==='rejected'&&(r.reason as {code?:string}).code==='23514').length,1);
    }finally{await parallel.pool.end();}
    assert.equal((await pool.query('SELECT sum(amount_micros)::text AS amount FROM revenue_adjustments WHERE workspace_id=$1 AND original_payment_id=$2',
      [workspace,adjustmentPayment.id])).rows[0].amount,'700000');
    const beforeCount=(await pool.query('SELECT count(*)::text AS n FROM revenue_adjustments')).rows[0].n;
    await assert.rejects(adjustmentStore.ingestAdjustments(workspace,[
      parseAdjustment({...adjustment,sourceObjectId:'re_atomic_a',amountMicros:'10000'}),
      parseAdjustment({...adjustment,sourceObjectId:'re_atomic_z',amountMicros:'400000'}),
    ]),(e:unknown)=>(e as {code?:string}).code==='23514');
    assert.equal((await pool.query('SELECT count(*)::text AS n FROM revenue_adjustments')).rows[0].n,beforeCount,'Adjustment batch partially committed');
    for(const statement of ['UPDATE revenue_adjustments SET evidence_ref=evidence_ref','DELETE FROM revenue_adjustments',
      'TRUNCATE revenue_adjustments','UPDATE revenue_records SET amount_micros=0','DELETE FROM revenue_records','TRUNCATE revenue_records CASCADE'])
      await assert.rejects(pool.query(statement),/append-only/);
    await pool.query('UPDATE workspace_api_keys SET expires_at=NULL WHERE key_digest=$1',[createHash('sha256').update(readKey).digest('hex')]);
    const adjustmentApi=createApp(runtimeStore);
    const postAdjustment=(record:unknown,rawKey=ingestKey)=>adjustmentApi.request('/v1/revenue/adjustments',{
      method:'POST',headers:{authorization:'Bearer '+rawKey,'content-type':'application/json'},body:JSON.stringify({records:[record]})});
    assert.equal((await postAdjustment(adjustment)).status,202);
    assert.equal((await postAdjustment({...adjustment,amountMicros:'9'})).status,409);
    assert.equal((await postAdjustment({...adjustment,currency:'EUR'})).status,400);
    assert.equal((await postAdjustment(adjustment,readKey)).status,403);
    // Financial batch failure rolls back every prior insert and customer row.
    const atomic:StoredEvent={...runtimeEvent,event:{...runtimeEvent.event,id:'atomic-a',customerId:'atomic-customer'},payloadDigest:'atomic'};
    await assert.rejects(runtimeStore.ingest(workspace,[atomic,{...atomic,event:{...atomic.event,id:'atomic-z'},costMicros:-1n}]),
      (e:unknown)=>(e as {code?:string}).code==='23514');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM usage_events WHERE workspace_id=$1 AND event_id LIKE 'atomic-%'",[workspace])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM customers WHERE workspace_id=$1 AND id='atomic-customer'",[workspace])).rows[0].n,0);
    // Terminate only a connection belonging to this disposable test role.
    const interrupted=await runtimeStore.pool.connect();
    interrupted.on('error',()=>{});
    const pid=(await interrupted.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const rejected=assert.rejects(interrupted.query('SELECT pg_sleep(5)'),(e:unknown)=>(e as {code?:string}).code==='57P01');
    await pool.query('SELECT pg_terminate_backend($1)',[pid]);
    await rejected;interrupted.release(true);
    assert.ok((await runtimeStore.analyticsPage(workspace,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',null,20)).summary.customerCount);
    // Bounded synthetic concurrency smoke; not a production throughput benchmark.
    const loadStore=new PostgresEventStore('',{pool:new pg.Pool({connectionString:runtimeURL.toString(),max:4,
      connectionTimeoutMillis:5000,statement_timeout:15000})}).forCredential(key);
    const loadEvent={...runtimeEvent,event:{...runtimeEvent.event,id:'load-replay'},payloadDigest:'load-replay'};
    const loadStarted=performance.now();
    try{
      const results=await Promise.all(Array.from({length:80},(_,n)=>loadStore.ingest(workspace,[n<40?loadEvent:
        {...loadEvent,event:{...loadEvent.event,id:'load-unique-'+n},payloadDigest:'load-unique-'+n}])));
      assert.equal(results.reduce((n,r)=>n+r.inserted,0),41);
      assert.equal(results.reduce((n,r)=>n+r.duplicate,0),39);
      process.stdout.write('Synthetic restricted-role concurrency: 80 requests, 41 unique rows, '+Math.round(performance.now()-loadStarted)+' ms.\n');
    }finally{await loadStore.pool.end();}
    // Durable deliveries: committed enqueue, exact-payload duplicate handling,
    // concurrent consumers, crash-released claims and atomic financial replay.
    const queuedRecord:StoredRevenue={id:'stripe:invoice:queue',customerId:'queue-customer',
      occurredAt:'2026-10-10T00:00:00.000Z',amountMicros:'1000000',payloadDigest:'a'.repeat(64)};
    const delivery={providerEventId:'evt_queue_first',providerAccount:'acct_synthetic',record:queuedRecord};
    assert.deepEqual(await runtimeStore.enqueueRevenueDelivery(workspace,delivery),{duplicate:false,state:'pending'});
    assert.equal((await runtimeStore.pool.query('SELECT * FROM revenue_deliveries')).rowCount,0,'Inbox default deny failed');
    await pool.query('UPDATE workspace_api_keys SET expires_at=NULL WHERE key_digest=$1',[createHash('sha256').update(readKey).digest('hex')]);
    await assert.rejects(runtimeStore.forCredential(readKey).enqueueRevenueDelivery(workspace,{...delivery,providerEventId:'evt_read_forbidden'}),
      (e:unknown)=>(e as {code?:string}).code==='42501');
    const readSession=await runtimeStore.pool.connect();
    try{
      await readSession.query('BEGIN');await readSession.query("SELECT set_config('agentmargin.api_key',$1,true)",[readKey]);
      assert.equal((await readSession.query("UPDATE revenue_deliveries SET state='delivered',delivered_at=now() WHERE workspace_id=$1",[workspace])).rowCount,0);
      await readSession.query('COMMIT');
    }finally{readSession.release();}
    assert.deepEqual(await runtimeStore.enqueueRevenueDelivery(workspace,delivery),{duplicate:true,state:'pending'});
    await assert.rejects(runtimeStore.enqueueRevenueDelivery(workspace,{...delivery,record:{...queuedRecord,payloadDigest:'b'.repeat(64)}}),/Idempotency conflict/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM revenue_records WHERE id='stripe:invoice:queue'")).rows[0].n,0,'Enqueue must not prematurely count revenue');
    await assert.rejects(runtimeStore.enqueueRevenueDelivery(other,delivery),(e:unknown)=>(e as {code?:string}).code==='42501');
    await assert.rejects(runtimeStore.pool.query("UPDATE revenue_deliveries SET amount_micros=0"),(e:unknown)=>(e as {code?:string}).code==='42501');
    const claim=await runtimeStore.pool.connect();
    try{
      await claim.query('BEGIN');await claim.query("SELECT set_config('agentmargin.api_key',$1,true)",[key]);
      await claim.query('SELECT * FROM revenue_deliveries WHERE workspace_id=$1 FOR UPDATE',[workspace]);
      // Independent connection sees no claimable work, then rollback simulates a crash.
      const consumer=new PostgresEventStore(runtimeURL.toString()).forCredential(key);
      try{assert.equal((await consumer.processNextRevenueDelivery(workspace)).state,'empty');}
      finally{await consumer.pool.end();}
      await claim.query('ROLLBACK');
    }finally{claim.release();}
    await runtimeStore.enqueueRevenueDelivery(workspace,{...delivery,providerEventId:'evt_queue_second'});
    const worker=new PostgresEventStore(runtimeURL.toString()).forCredential(key);
    try{
      const results=await Promise.all([runtimeStore.processNextRevenueDelivery(workspace),worker.processNextRevenueDelivery(workspace)]);
      assert.equal(results.filter(r=>r.state==='delivered').length,2);
      assert.equal(results.reduce((n,r)=>n+(r.inserted??0),0),1);
      assert.equal(results.reduce((n,r)=>n+(r.duplicate??0),0),1);
    }finally{await worker.pool.end();}
    assert.deepEqual(await runtimeStore.enqueueRevenueDelivery(workspace,delivery),{duplicate:true,state:'delivered'});
    await runtimeStore.enqueueRevenueDelivery(workspace,{...delivery,providerEventId:'evt_queue_conflict',record:{...queuedRecord,amountMicros:'9',payloadDigest:'c'.repeat(64)}});
    assert.equal((await runtimeStore.processNextRevenueDelivery(workspace)).state,'failed');
    assert.equal((await pool.query("SELECT amount_micros::text FROM revenue_records WHERE id='stripe:invoice:queue'")).rows[0].amount_micros,'1000000');
    await pool.query(`CREATE FUNCTION queue_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.id='queue-retry' THEN RAISE EXCEPTION 'synthetic retry' USING ERRCODE='40001'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER queue_test_failure BEFORE INSERT ON revenue_records FOR EACH ROW EXECUTE FUNCTION queue_test_failure()`);
    try{
      await runtimeStore.enqueueRevenueDelivery(workspace,{...delivery,providerEventId:'evt_queue_retry',record:{...queuedRecord,id:'queue-retry',customerId:'queue-retry-customer'}});
      for(let attempt=1;attempt<=8;attempt++){
        const result:{state:string}=await runtimeStore.processNextRevenueDelivery(workspace);
        assert.equal(result.state,attempt===8?'failed':'retry');
        const row=(await pool.query("SELECT attempts,state,error_class FROM revenue_deliveries WHERE provider_event_id='evt_queue_retry'")).rows[0];
        assert.equal(row.attempts,attempt);assert.equal(row.error_class,'database_retry');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM customers WHERE id='queue-retry-customer'")).rows[0].n,0,'Failed replay leaked a partial customer');
        if(attempt<8){
          assert.equal((await runtimeStore.processNextRevenueDelivery(workspace)).state,'empty','Backoff must delay retry');
          await pool.query("UPDATE revenue_deliveries SET available_at=now() WHERE provider_event_id='evt_queue_retry'");
        }
      }
    }finally{await pool.query('DROP TRIGGER queue_test_failure ON revenue_records; DROP FUNCTION queue_test_failure()');}
    assert.equal((await runtimeStore.revenueDeliveryStatus(workspace)).failed,'2');
    assert.equal((await runtimeStore.forCredential(otherKey).revenueDeliveryStatus(workspace)).failed,'0');
    await runtimeStore.enqueueRevenueDelivery(workspace,{...delivery,providerEventId:'evt_queue_scope_change',record:{...queuedRecord,id:'queue-scope-change'}});
    await pool.query(`CREATE FUNCTION queue_scope_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
      IF NEW.id='queue-scope-change' THEN
        UPDATE public.workspace_api_keys SET access_role='read'
          WHERE key_digest=encode(sha256(convert_to(current_setting('agentmargin.api_key'),'UTF8')),'hex');
      END IF; RETURN NEW; END$$;
      CREATE TRIGGER queue_scope_change AFTER INSERT ON revenue_records FOR EACH ROW EXECUTE FUNCTION queue_scope_change()`);
    try{
      await assert.rejects(runtimeStore.processNextRevenueDelivery(workspace),/Delivery authorization changed/);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM revenue_records WHERE id='queue-scope-change'")).rows[0].n,0);
      const pending=(await pool.query("SELECT state,attempts FROM revenue_deliveries WHERE provider_event_id='evt_queue_scope_change'")).rows[0];
      assert.equal(pending.state,'pending');assert.equal(pending.attempts,0);
      assert.equal((await runtimeStore.authenticate('ignored'))?.accessRole,'admin','Authorization mutation did not roll back');
    }finally{await pool.query('DROP TRIGGER queue_scope_change ON revenue_records; DROP FUNCTION queue_scope_change()');}
    assert.equal((await runtimeStore.processNextRevenueDelivery(workspace)).state,'delivered');
    await testAdjustmentDeliveries(pool,runtimeStore,runtimeURL.toString(),workspace,other,ingestKey,readKey);
    await testDeliveryRecovery(pool,runtimeStore,workspace,other,key,ingestKey,readKey);
    await testFinancialReports(pool,runtimeURL.toString());
    await testV09FinancialFixture(pool,runtimeURL.toString());
    const queuedApi=createApp(runtimeStore);
    const wire={providerEventId:'evt_api_delivery',providerAccount:'acct_synthetic',record:{id:'api-queued',customerId:'api-queue-customer',occurredAt:'2026-10-10T00:00:00Z',amountMicros:'123'}};
    const submit=(token:string,payload:unknown=wire)=>queuedApi.request('/v1/revenue/deliveries',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});
    assert.equal((await submit(ingestKey)).status,202);
    assert.equal((await submit(ingestKey)).status,202);
    assert.equal((await submit(ingestKey,{...wire,record:{...wire.record,amountMicros:'124'}})).status,409);
    assert.equal((await submit(ingestKey,{...wire,record:{...wire.record,amountMicros:'-1'}})).status,400);
    assert.equal((await queuedApi.request('/v1/revenue/deliveries',{method:'POST'})).status,401);
    await pool.query('UPDATE workspace_api_keys SET expires_at=NULL WHERE key_digest=$1',[createHash('sha256').update(readKey).digest('hex')]);
    assert.equal((await submit(readKey)).status,403);
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

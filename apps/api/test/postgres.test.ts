import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { ANALYTICS_SQL, UNKNOWN_MODELS_SQL } from '../src/postgres.ts';

const one='11111111-1111-4111-8111-111111111111';
const two='22222222-2222-4222-8222-222222222222';
const priceId='33333333-3333-4333-8333-333333333333';
test('real embedded Postgres migrations and tenant-scoped analytics SQL',async()=>{
  const db=new PGlite();
  try {
    await db.exec(readFileSync(new URL('../../../db/001_initial.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/002_ingestion.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../../db/003_revenue_ingestion.sql',import.meta.url),'utf8'));
    await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2),($3,$4)',[one,'One',two,'Two']);
    await db.query(`INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name)
      VALUES ($1,$2,$3,$4)`,['44444444-4444-4444-8444-444444444444',one,'a'.repeat(64),'test']);
    await db.query(`UPDATE workspace_api_keys SET revoked_at=now() WHERE workspace_id=$1`,[one]);
    assert.equal((await db.query<{n:number}>('SELECT count(*)::integer AS n FROM workspace_api_keys WHERE workspace_id=$1 AND revoked_at IS NULL',[one])).rows[0]?.n,0);
    await db.query('INSERT INTO customers(workspace_id,id) VALUES ($1,$2),($3,$4)',[one,'same',two,'same']);
    await db.query(`INSERT INTO price_versions(id,model,effective_from,input_micros_per_million,output_micros_per_million)
      VALUES ($1,'m','2026-01-01T00:00:00Z',1000000,2000000)`,[priceId]);
    await db.query(`INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros)
      VALUES ($1,'r1','same','2026-10-02T00:00:00Z',10000000),($1,'r2','same','2026-10-03T00:00:00Z',5000000),
      ($2,'r3','same','2026-10-02T00:00:00Z',999999000)`,[one,two]);
    await db.query(`INSERT INTO usage_events(workspace_id,event_id,customer_id,model,occurred_at,input_tokens,output_tokens,
      calculated_cost_micros,cost_source,price_version_id,payload_digest)
      VALUES ($1,'e1','same','m','2026-10-02T00:00:00Z',10,10,3000000,'estimated',$3,'abc'),
      ($1,'e2','same','m','2026-10-03T00:00:00Z',10,10,2000000,'estimated',$3,'xyz'),
      ($2,'e3','same','m','2026-10-02T00:00:00Z',10,10,8000000,'reported',null,'other')`,[one,two,priceId]);
    const rows=await db.query<{
      customer_id:string;revenue_micros:string;known_cost_micros:string;usage_events:string;unknown_events:string
    }>(ANALYTICS_SQL,[one,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z']);
    assert.equal(rows.rows.length,1);
    assert.equal(rows.rows[0]?.revenue_micros,'15000000');
    assert.equal(rows.rows[0]?.known_cost_micros,'5000000');
    assert.equal(rows.rows[0]?.usage_events,'2');
    // Diagnostic counts include only unknown events in the authenticated workspace and period.
    // An untrusted model identifier must remain ordinary text; the SQL is parameterized.
    const untrustedModel='<svg/onload=alert(1)>';
    await db.query(`INSERT INTO usage_events(workspace_id,event_id,customer_id,model,occurred_at,
       input_tokens,output_tokens,calculated_cost_micros,cost_source,payload_digest)
       VALUES ($1,'u1','same',$3,'2026-10-04T00:00:00Z',0,0,null,'unknown','d1'),
              ($1,'u2','same',$3,'2026-10-05T00:00:00Z',0,0,null,'unknown','d2'),
              ($2,'u3','same','secret-other-workspace','2026-10-05T00:00:00Z',0,0,null,'unknown','d3')`,[one,two,untrustedModel]);
    const unknown=await db.query<{model:string;event_count:string}>(UNKNOWN_MODELS_SQL,
      [one,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z']);
    assert.deepEqual(unknown.rows.map(r=>[r.model,r.event_count]),[[untrustedModel,'2']]);
    const wrongPeriod=await db.query(UNKNOWN_MODELS_SQL,
      [one,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z']);
    assert.equal(wrongPeriod.rows.length,0);
    await assert.rejects(db.query(`INSERT INTO usage_events(workspace_id,event_id,customer_id,model,occurred_at,
      input_tokens,output_tokens,calculated_cost_micros,cost_source) VALUES($1,'e1','same','m',now(),0,0,0,'reported')`,[one]),/duplicate key/);
  } finally {await db.close();}
});

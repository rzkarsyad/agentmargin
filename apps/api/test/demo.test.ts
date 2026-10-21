import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { provisionDemo, requireSafeDemoDatabase, DEMO_WORKSPACE } from '../../../scripts/demo-seed.ts';

test('demo mode rejects remote and non-demo database targets', () => {
  assert.doesNotThrow(() => requireSafeDemoDatabase('postgresql://agentmargin_demo:x@127.0.0.1:55432/agentmargin_demo'));
  assert.throws(() => requireSafeDemoDatabase('postgresql://agentmargin_demo:x@example.com/agentmargin_demo'),/Refusing/);
  assert.throws(() => requireSafeDemoDatabase('postgresql://agentmargin_demo:x@127.0.0.1/production'),/Refusing/);
  assert.throws(() => requireSafeDemoDatabase('postgresql://postgres:x@127.0.0.1/agentmargin_demo'),/Refusing/);
});

test('seeded demo has known profitable, negative and unknown-cost customers and rotates local key', async () => {
  const pg = new PGlite();
  // PGlite's in-memory database is named postgres; production CLI independently
  // checks the actual PostgreSQL database name and connection hostname.
  const db = {
    async query(sql:string, params?:unknown[]):Promise<{rows:Record<string,unknown>[]}> {
      if (/^SELECT current_database\(\)/.test(sql)) return {rows:[{name:'agentmargin_demo'}]};
      if (params?.length) return pg.query(sql,params as (string|number|null)[]) as Promise<{rows:Record<string,unknown>[]}>;
      const responses = await pg.exec(sql);
      return {rows:(responses.at(-1)?.rows??[]) as Record<string,unknown>[]};
    },
  };
  try {
    const first = 'am_'+ 'A'.repeat(43);
    const second = 'am_'+ 'B'.repeat(43);
    await provisionDemo(db,first,new Date('2026-10-21T09:00:00Z'));
    const numbers = await db.query(`SELECT count(*)::integer AS n FROM usage_events WHERE workspace_id=$1`,[DEMO_WORKSPACE]);
    assert.equal(numbers.rows[0]?.n,3);
    const summaries = await db.query(`SELECT r.customer_id,r.amount_micros AS revenue,u.calculated_cost_micros AS cost,
       u.cost_source AS source FROM revenue_records r JOIN usage_events u ON
       r.workspace_id=u.workspace_id AND r.customer_id=u.customer_id WHERE r.workspace_id=$1 ORDER BY r.customer_id`,[DEMO_WORKSPACE]);
    assert.deepEqual(summaries.rows.map(x=>[x.customer_id,String(x.revenue),x.cost==null?null:String(x.cost),x.source]),[
      ['acme-demo','29000000','3000000','reported'],
      ['heavy-demo','19000000','32000000','reported'],
      ['unknown-demo','49000000',null,'unknown'],
    ]);
    await provisionDemo(db,second,new Date('2026-10-22T09:00:00Z'));
    const keys = await db.query(`SELECT key_digest,revoked_at FROM workspace_api_keys WHERE workspace_id=$1
      ORDER BY created_at`,[DEMO_WORKSPACE]);
    assert.equal(keys.rows.length,2);
    assert.equal(keys.rows.filter(k=>k.revoked_at==null).length,1);
    const total = await db.query(`SELECT count(*)::integer AS n FROM revenue_records WHERE workspace_id=$1`,[DEMO_WORKSPACE]);
    assert.equal(total.rows[0]?.n,3);
    const moved = await db.query(`SELECT count(*)::integer AS n FROM usage_events WHERE workspace_id=$1 AND occurred_at=$2::timestamptz`,[DEMO_WORKSPACE,'2026-10-22T09:00:00Z']);
    assert.equal(moved.rows[0]?.n,3);
  } finally {await pg.close();}
});
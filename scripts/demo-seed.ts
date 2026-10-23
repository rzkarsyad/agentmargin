/** Only seeds a dedicated loopback-only PostgreSQL database with fictional data. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const DEMO_WORKSPACE = '11111111-2222-4333-8444-555555555555';
const migrations = ['001_initial.sql', '002_ingestion.sql', '003_revenue_ingestion.sql', '004_workspace_pricing.sql', '005_api_key_roles.sql', '006_api_key_expiry.sql', '007_credential_tenant_isolation.sql', '008_revenue_deliveries.sql','009_credential_containment.sql','010_revenue_adjustments.sql','011_adjustment_deliveries.sql','012_delivery_audit.sql','013_definer_catalog_path.sql'] as const;
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{rows: Record<string, unknown>[]}>;
}

export function requireSafeDemoDatabase(value: string): void {
  const url = new URL(value);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/agentmargin_demo' || url.username !== 'agentmargin_demo') {
    throw new Error('Refusing to seed anything except loopback /agentmargin_demo with user agentmargin_demo');
  }
}

export async function provisionDemo(db: Queryable, apiKey: string, now = new Date()): Promise<void> {
  if (!/^am_[A-Za-z0-9_-]{32,}$/.test(apiKey)) throw new Error('Invalid generated demo key');
  const database = await db.query('SELECT current_database() AS name');
  if (database.rows[0]?.name !== 'agentmargin_demo') throw new Error('Not the agentmargin_demo database');
  await db.query(`CREATE TABLE IF NOT EXISTS agentmargin_demo_migrations
    (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const filename of migrations) {
    const source = readFileSync(new URL(`../db/${filename}`, import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    const recorded = await db.query('SELECT checksum FROM agentmargin_demo_migrations WHERE filename=$1', [filename]);
    if (recorded.rows[0]) {
      if (recorded.rows[0].checksum !== checksum) throw new Error(`Migration changed after applying: ${filename}`);
      continue;
    }
    // All existing migration files use BEGIN/COMMIT around their SQL statements.
    // Remove those wrappers to atomically include the tracking row in our transaction.
    const contents = source.replace(/^\s*--[^\n]*\n/gm, '').trim();
    if (!/^BEGIN;\s/i.test(contents) || !/\sCOMMIT;$/.test(contents)) {
      throw new Error(`Expected transaction-wrapped migration: ${filename}`);
    }
    const sql = contents.replace(/^BEGIN;\s*/, '').replace(/\sCOMMIT;$/, '');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO agentmargin_demo_migrations(filename,checksum) VALUES($1,$2)', [filename,checksum]);
      await db.query('COMMIT');
    } catch (err) { await db.query('ROLLBACK'); throw err; }
  }
  const time = now.toISOString();
  const dig = createHash('sha256').update(apiKey).digest('hex');
  await db.query('BEGIN');
  try {
    await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [DEMO_WORKSPACE, 'AgentMargin synthetic demo']);
    for (const [id,name] of [
      ['acme-demo','Acme (demo)'],['heavy-demo','Heavy User (demo)'],['unknown-demo','Unknown Cost (demo)'],
    ]) {
      await db.query('INSERT INTO customers(workspace_id,id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [DEMO_WORKSPACE,id,name]);
    }
    const entries = [
      ['acme-demo','29000000','3000000','reported'],
      ['heavy-demo','19000000','32000000','reported'],
      ['unknown-demo','49000000',null,'unknown'],
    ] as const;
    for (const [customer,revenue,cost,source] of entries) {
      await db.query(`INSERT INTO revenue_records
          (workspace_id,id,customer_id,occurred_at,amount_micros)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,id) DO NOTHING`,
        [DEMO_WORKSPACE,`demo-revenue-${customer}`,customer,time,revenue]);
      await db.query(`INSERT INTO usage_events
          (workspace_id,event_id,customer_id,model,occurred_at,input_tokens,output_tokens,
           cached_input_tokens,reported_cost_micros,calculated_cost_micros,cost_source)
          VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$8,$9)
          ON CONFLICT (workspace_id,event_id) DO NOTHING`,
        [DEMO_WORKSPACE,`demo-usage-${customer}`,customer,'example-model',time,20000,15000,cost,source]);
    }
    // Rotate the demo key on every start. Keys remain scoped to the demo workspace.
    await db.query(`UPDATE workspace_api_keys SET revoked_at=now()
      WHERE workspace_id=$1 AND name='local-demo' AND revoked_at IS NULL`, [DEMO_WORKSPACE]);
    await db.query(`INSERT INTO workspace_api_keys(id,workspace_id,key_digest,name)
      VALUES($1,$2,$3,'local-demo')`, [randomUUID(),DEMO_WORKSPACE,dig]);
    await db.query('COMMIT');
  } catch(err) { await db.query('ROLLBACK'); throw err; }
}

// Entrypoint only when explicitly invoked; importing in tests has no DB side effects.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  requireSafeDemoDatabase(url);
  const pool = new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
  const apiKey = `am_${randomBytes(32).toString('base64url')}`;
  try {
    await provisionDemo(pool,apiKey);
    process.stdout.write('\nSynthetic demo workspace created. Never use with real customer records.\n');
    process.stdout.write(`Demo API key (visible once; keep local): ${apiKey}\n`);
    process.stdout.write('Paste this key into the local dashboard and select a period containing today.\n\n');
  } finally {await pool.end();}
}

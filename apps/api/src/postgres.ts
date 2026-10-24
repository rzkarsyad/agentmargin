import pg from 'pg';
import {validateDatabaseUrl,databaseSessionSafe} from './database-safety.ts';
import {summarizeFinancialLedger,type FinancialLedgerInput} from '../../../packages/core/src/financial-ledger.ts';
import {parseAdjustment,type StoredAdjustment} from '../../../packages/core/src/adjustments.ts';
import type { PriceVersion } from '../../../packages/core/src/index.ts';
import type { EventStore, StoredEvent, StoredRevenue, AnalyticsSnapshot, AnalyticsPage, AnalyticsCustomer, PriceInput, WorkspacePrice, ScopedPriceVersion, AuthenticatedWorkspace, WorkspaceKeyRole, RevenueDelivery } from './app.ts';

const { Pool } = pg;
export const ANALYTICS_SQL = `WITH revenue AS (
       SELECT customer_id, SUM(amount_micros)::text AS amount
       FROM (SELECT workspace_id,customer_id,occurred_at,amount_micros FROM revenue_records UNION ALL SELECT workspace_id,customer_id,occurred_at,-amount_micros FROM revenue_adjustments) ledger WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz
         AND occurred_at < $3::timestamptz GROUP BY customer_id
     ), usage AS (
       SELECT customer_id, COALESCE(SUM(calculated_cost_micros),0)::text AS cost,
       COUNT(*)::text AS events, COUNT(*) FILTER (WHERE cost_source='unknown')::text AS unknown
       FROM usage_events WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz
         AND occurred_at < $3::timestamptz GROUP BY customer_id
     )
     SELECT COALESCE(r.customer_id,u.customer_id) AS customer_id,
       COALESCE(r.amount,'0') AS revenue_micros,COALESCE(u.cost,'0') AS known_cost_micros,
       COALESCE(u.events,'0') AS usage_events,COALESCE(u.unknown,'0') AS unknown_events
     FROM revenue r FULL OUTER JOIN usage u ON r.customer_id=u.customer_id
     ORDER BY customer_id LIMIT 2001`;
/** At most 20 models, with one extra row to signal truncation. No customer IDs are exposed. */
export const UNKNOWN_MODELS_SQL = `SELECT model, COUNT(*)::text AS event_count
  FROM usage_events
  WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz
    AND occurred_at < $3::timestamptz AND cost_source='unknown'
  GROUP BY model ORDER BY COUNT(*) DESC, model ASC LIMIT 21`;

/**
 * Full-workspace totals and a keyset page share one READ COMMITTED statement snapshot.
 * Never SUM the first N displayed customers to present organization totals.
 */
const CUSTOMER_ROWS_CTE=`WITH revenue AS (
  SELECT customer_id, SUM(amount_micros) AS revenue
  FROM (SELECT workspace_id,customer_id,occurred_at,amount_micros FROM revenue_records UNION ALL SELECT workspace_id,customer_id,occurred_at,-amount_micros FROM revenue_adjustments) ledger
  WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz
  GROUP BY customer_id
), usage AS (
  SELECT customer_id, COALESCE(SUM(calculated_cost_micros),0) AS cost,
    COUNT(*) AS usage_events, COUNT(*) FILTER (WHERE cost_source='unknown') AS unknown_events
  FROM usage_events
  WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz
  GROUP BY customer_id
), customer_data AS (
 SELECT COALESCE(r.customer_id,u.customer_id) AS customer_id,
  COALESCE(r.revenue,0)::numeric AS revenue,
  COALESCE(u.cost,0)::numeric AS known_cost,
  COALESCE(u.usage_events,0)::bigint AS usage_events,
  COALESCE(u.unknown_events,0)::bigint AS unknown_events
 FROM revenue r FULL OUTER JOIN usage u ON r.customer_id=u.customer_id
)`;
export const ANALYTICS_FULL_SUMMARY_SQL=CUSTOMER_ROWS_CTE+`
 SELECT COUNT(*)::text AS customer_count,
  COUNT(*) FILTER (WHERE unknown_events=0)::text AS verified_customer_count,
  COUNT(*) FILTER (WHERE unknown_events=0 AND revenue>known_cost)::text AS profitable_customer_count,
  COUNT(*) FILTER (WHERE unknown_events=0 AND revenue<=known_cost)::text AS loss_making_customer_count,
  COUNT(*) FILTER (WHERE unknown_events>0)::text AS unknown_customer_count,
  COALESCE(SUM(usage_events),0)::text AS usage_event_count,
  COALESCE(SUM(unknown_events),0)::text AS unknown_usage_event_count,
  COALESCE(SUM(revenue),0)::text AS total_revenue_micros,
  COALESCE(SUM(known_cost),0)::text AS total_known_ai_cost_micros,
  COALESCE(SUM(CASE WHEN unknown_events=0 THEN revenue-known_cost ELSE 0 END),0)::text
    AS verified_customer_contribution_micros,
  (SELECT coalesce(sum(amount_micros),0)::text FROM revenue_records WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz) AS gross_revenue_micros,
  (SELECT coalesce(sum(amount_micros),0)::text FROM revenue_adjustments WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz AND kind='refund') AS refunds_micros,
  (SELECT coalesce(sum(amount_micros),0)::text FROM revenue_adjustments WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz AND kind='credit') AS credits_micros,
  (SELECT coalesce(sum(amount_micros),0)::text FROM revenue_adjustments WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz AND kind='payment_reversal') AS payment_reversals_micros,
  ((SELECT count(*) FROM revenue_deliveries WHERE workspace_id=$1 AND state<>'delivered')+
   (SELECT count(*) FROM adjustment_deliveries WHERE workspace_id=$1 AND state<>'delivered'))::text AS unresolved_revenue_deliveries
 FROM customer_data`;
export const ANALYTICS_CUSTOMER_PAGE_SQL=CUSTOMER_ROWS_CTE+`
 SELECT customer_id,revenue::text AS revenue_micros,known_cost::text AS known_cost_micros,
  usage_events::text AS usage_events,unknown_events::text AS unknown_events
 FROM customer_data
 WHERE ($4::text IS NULL OR customer_id>$4::text)
 ORDER BY customer_id ASC LIMIT $5::integer`;

function mapAnalyticsCustomer(r:{
  customer_id:string;revenue_micros:string;known_cost_micros:string;
  usage_events:string;unknown_events:string;
}):AnalyticsCustomer{
 const revenue=BigInt(r.revenue_micros),cost=BigInt(r.known_cost_micros),unknown=BigInt(r.unknown_events);
 const contribution=unknown>0n?null:revenue-cost;
 const margin=contribution===null||revenue<=0n?null:(contribution<0n
  ? -((-contribution*10000n+revenue/2n)/revenue)
  : (contribution*10000n+revenue/2n)/revenue);
 return {customerId:r.customer_id,revenueMicros:revenue.toString(),
  knownAiCostMicros:cost.toString(),contributionMicros:contribution?.toString()??null,
  marginBasisPoints:margin?.toString()??null,
  usageEvents:Number(r.usage_events),unknownEvents:Number(r.unknown_events)};
}

export class PostgresEventStore implements EventStore {
  readonly pool: pg.Pool;
  private readonly credential?:string;
  private readonly brokenClients=new WeakSet<pg.PoolClient>();
  private readonly requireTls:boolean;
  constructor(connectionString: string, options:{pool?:pg.Pool;credential?:string}={}) {
    this.credential=options.credential;
    if(!options.pool)validateDatabaseUrl(connectionString);
    const target=connectionString||options.pool?.options.connectionString;
    this.requireTls=!!target&&!['localhost','127.0.0.1','[::1]'].includes(new URL(target).hostname);
    this.pool = options.pool??new Pool({ connectionString, max:10, connectionTimeoutMillis:5000,
      statement_timeout:15000, idle_in_transaction_session_timeout:15000 });
  }
  async ready():Promise<boolean>{
    // Connectivity alone can be healthy while every authenticated request fails.
    // Check the migration contract without reading tenant or authentication rows.
    const client=await this.pool.connect();
    try{
    if(!await databaseSessionSafe(client,this.requireTls))return false;
    if(!(await client.query("SELECT to_regclass('agentmargin_auth.security_contract') AS contract")).rows[0]?.contract)return false;
    const result=await client.query<{ready:boolean}>(`
      SELECT (
        (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN
            ('customers','usage_events','revenue_records','workspace_price_versions','revenue_deliveries','revenue_adjustments','revenue_payment_sources','adjustment_deliveries','delivery_history','delivery_requeues')
            AND c.relrowsecurity
            AND (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid
              AND p.polname IN ('tenant_read','tenant_insert','tenant_update'))=CASE WHEN c.relname IN ('revenue_deliveries','adjustment_deliveries') THEN 3 WHEN c.relname IN ('delivery_history','delivery_requeues') THEN 1 ELSE 2 END
            AND (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)=CASE WHEN c.relname IN ('revenue_deliveries','adjustment_deliveries') THEN 3 WHEN c.relname IN ('delivery_history','delivery_requeues') THEN 1 ELSE 2 END)=10
        AND (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='enforce_delivery_transition'
          AND tgrelid IN (to_regclass('public.revenue_deliveries'),to_regclass('public.adjustment_deliveries'))
          AND tgfoid=to_regprocedure('agentmargin_auth.enforce_delivery_transition()') AND tgenabled='O')=2
        AND NOT EXISTS (
          SELECT 1 FROM (VALUES
            ('workspace_price_versions','workspace_prices_immutable','public.reject_workspace_price_mutation()'),
            ('revenue_records','immutable_payment','agentmargin_auth.immutable_financial_record()'),
            ('revenue_adjustments','immutable_adjustment','agentmargin_auth.immutable_financial_record()'),
            ('revenue_adjustments','validate_adjustment','agentmargin_auth.validate_adjustment()'),
            ('revenue_adjustments','validate_stripe_adjustment_source','agentmargin_auth.validate_stripe_adjustment_source()'),
            ('revenue_payment_sources','immutable_payment_source','agentmargin_auth.immutable_financial_record()'),
            ('delivery_history','immutable_delivery_history','agentmargin_auth.immutable_financial_record()'),
            ('delivery_requeues','immutable_delivery_requeue','agentmargin_auth.immutable_financial_record()'),
            ('revenue_deliveries','delivery_history','agentmargin_auth.record_delivery_transition()'),
            ('adjustment_deliveries','delivery_history','agentmargin_auth.record_delivery_transition()')
          ) AS expected(table_name,trigger_name,function_name)
          WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid=to_regclass('public.'||expected.table_name)
              AND t.tgname=expected.trigger_name AND t.tgfoid=to_regprocedure(expected.function_name)
              AND t.tgenabled='O' AND NOT t.tgisinternal)
        )
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid=to_regprocedure('agentmargin_auth.requeue_delivery(uuid,text,text,text,text,uuid)')
            AND p.prosecdef AND p.provolatile='v' AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
            AND has_function_privilege(current_user,p.oid,'EXECUTE'))
        AND (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN
          (to_regprocedure('agentmargin_auth.validate_adjustment()'),to_regprocedure('agentmargin_auth.validate_stripe_adjustment_source()'),to_regprocedure('agentmargin_auth.record_delivery_transition()'))
          AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'])=3
        AND (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN
          (to_regprocedure('agentmargin_auth.principal(text)'),to_regprocedure('agentmargin_auth.workspace(text)'),to_regprocedure('agentmargin_auth.event_digest(uuid,text,text)'))
          AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
          AND has_function_privilege(current_user,p.oid,'EXECUTE'))=3
        AND NOT EXISTS ((SELECT * FROM agentmargin_auth.installed_contract() EXCEPT SELECT * FROM agentmargin_auth.security_contract)
          UNION ALL (SELECT * FROM agentmargin_auth.security_contract EXCEPT SELECT * FROM agentmargin_auth.installed_contract()))
        -- Anchor the installation baseline to a clean 001–016 source contract.
        -- A pre-existing weak policy must not be blessed by capturing its hash.
        AND (SELECT encode(sha256(convert_to(string_agg(kind||chr(10)||identity||chr(10)||digest,chr(10)
          ORDER BY kind COLLATE "C",identity COLLATE "C"),'UTF8')),'hex') FROM agentmargin_auth.security_contract)
          ='b85b4896a7c818c4956b065b337f262618b62af3910c088af21e3db7837ad95c'
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace='agentmargin_auth'::regnamespace
          AND p.proowner<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.workspaces'::regclass))
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE p.pronamespace='agentmargin_auth'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE')
        AND (current_user=(SELECT pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid='public.workspaces'::regclass)
          OR (NOT has_database_privilege(current_user,current_database(),'CREATE,TEMP')
            AND NOT has_any_column_privilege(current_user,'public.workspace_api_keys','SELECT,INSERT,UPDATE,REFERENCES')
            AND NOT has_any_column_privilege(current_user,'public.workspaces','SELECT,INSERT,UPDATE,REFERENCES')
            AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
              AND relname IN ('usage_events','revenue_records','revenue_adjustments','revenue_payment_sources','workspace_price_versions','price_versions','customers','delivery_history','delivery_requeues')
              AND (has_table_privilege(current_user,oid,'UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR has_any_column_privilege(current_user,oid,'UPDATE,REFERENCES')))
            AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid IN ('public.revenue_deliveries'::regclass,'public.adjustment_deliveries'::regclass)
              AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN ('state','attempts','retry_cycle','error_class','delivered_at','received_at','available_at')
              AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT'))
            AND NOT has_any_column_privilege(current_user,'agentmargin_auth.security_contract','INSERT,UPDATE,REFERENCES')
            AND NOT has_table_privilege(current_user,'agentmargin_auth.security_contract','DELETE,TRUNCATE,TRIGGER')))
      ) AS ready`);
    return result.rows[0]?.ready===true;
    }finally{client.release();}
  }
  forCredential(credential:string):PostgresEventStore {
    return new PostgresEventStore('',{pool:this.pool,credential});
  }
  private async begin(sql='BEGIN'):Promise<pg.PoolClient> {
    const client=await this.pool.connect();
    try {
      if(this.credential!==undefined&&!await databaseSessionSafe(client,this.requireTls))
        throw new Error('Unsafe database session configuration');
      await client.query(sql);
      // Always overwrite context, including unauthenticated calls, before SQL.
      await client.query("SELECT set_config('agentmargin.api_key',$1,true)",[this.credential??'']);
      return client;
    } catch(error) {try{await client.query('ROLLBACK');client.release();}catch{client.release(true);}throw error;}
  }
  private async rollback(client:pg.PoolClient):Promise<void> {
    try {await client.query('ROLLBACK');} catch {
      // Mark broken sockets for destruction by the single finally release.
      this.brokenClients.add(client);
    }
  }
  private async query<R extends pg.QueryResultRow>(sql:string,params?:unknown[]):Promise<pg.QueryResult<R>> {
    const client=await this.begin();
    try {const result=await client.query<R>(sql,params);await client.query('COMMIT');return result;}
    catch(error){await this.rollback(client);throw error;}
    finally {client.release(this.brokenClients.has(client));}
  }
  async authenticate(keyDigest: string): Promise<AuthenticatedWorkspace | null> {
    if(this.credential!==undefined){
      const q=await this.query<{workspace_id:string;access_role:WorkspaceKeyRole}>(
        "SELECT * FROM agentmargin_auth.principal(current_setting('agentmargin.api_key',true))");
      const row=q.rows[0];
      return row?{workspaceId:row.workspace_id,accessRole:row.access_role}:null;
    }
    // Trusted owner tooling compatibility only. Restricted runtime cannot read keys.
    const q = await this.query<{workspace_id:string;access_role:WorkspaceKeyRole}>(
      `SELECT workspace_id,access_role FROM workspace_api_keys
       WHERE key_digest=$1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,[keyDigest]);
    const row=q.rows[0];
    return row?{workspaceId:row.workspace_id,accessRole:row.access_role}:null;
  }
  async prices(workspaceId:string,model:string,timestamp:string):Promise<ScopedPriceVersion[]> {
    const scoped=await this.query<{
      id:string;model:string;effective_from:Date;effective_to:Date|null;
      input_micros_per_million:string;output_micros_per_million:string;cached_input_micros_per_million:string|null;
    }>(`SELECT * FROM workspace_price_versions WHERE workspace_id=$1 AND model=$2
         AND effective_from <= $3::timestamptz ORDER BY effective_from DESC LIMIT 1`,
      [workspaceId,model,timestamp]);
    const row=scoped.rows[0];
    if(row) {
      if(row.effective_to&&row.effective_to.getTime()<=Date.parse(timestamp))return [];
      return [{id:row.id,model:row.model,effectiveFrom:row.effective_from.toISOString(),
        effectiveTo:row.effective_to?.toISOString()??null,
        inputMicrosPerMillion:BigInt(row.input_micros_per_million),
        outputMicrosPerMillion:BigInt(row.output_micros_per_million),
        cachedInputMicrosPerMillion:row.cached_input_micros_per_million==null?null:BigInt(row.cached_input_micros_per_million),
        scope:'workspace'}];
    }
    // Legacy prices remain read-only fallback only before workspace-specific versions exist.
    const old=await this.query<{
      id:string;model:string;effective_from:Date;effective_to:Date|null;
      input_micros_per_million:string;output_micros_per_million:string;cached_input_micros_per_million:string|null;
    }>('SELECT * FROM price_versions WHERE model=$1 AND effective_from <= $2::timestamptz AND (effective_to IS NULL OR effective_to > $2::timestamptz)',[model,timestamp]);
    return old.rows.map(r=>({id:r.id,model:r.model,effectiveFrom:r.effective_from.toISOString(),
      effectiveTo:r.effective_to?.toISOString()??null,inputMicrosPerMillion:BigInt(r.input_micros_per_million),
      outputMicrosPerMillion:BigInt(r.output_micros_per_million),
      cachedInputMicrosPerMillion:r.cached_input_micros_per_million==null?null:BigInt(r.cached_input_micros_per_million),
      scope:'legacy'}));
  }
  async createPriceVersion(workspaceId:string,actor:string,input:PriceInput):Promise<WorkspacePrice> {
    const q=await this.query<{created_at:Date}>(`INSERT INTO workspace_price_versions
      (id,workspace_id,model,effective_from,effective_to,input_micros_per_million,
       output_micros_per_million,cached_input_micros_per_million,source_note,created_by_key_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (workspace_id,model,effective_from)
      DO NOTHING RETURNING created_at`,
      [input.id,workspaceId,input.model,input.effectiveFrom,input.effectiveTo,
        input.inputMicrosPerMillion,input.outputMicrosPerMillion,input.cachedInputMicrosPerMillion,
        input.sourceNote,actor]);
    if(!q.rows.length)throw new Error('Pricing version exists');
    return {...input,createdAt:q.rows[0]!.created_at.toISOString()};
  }
  async listPriceVersions(workspaceId:string):Promise<{items:WorkspacePrice[];truncated:boolean}> {
    const q=await this.query<{
      id:string;model:string;effective_from:Date;effective_to:Date|null;
      input_micros_per_million:string;output_micros_per_million:string;cached_input_micros_per_million:string|null;
      source_note:string;created_at:Date;
    }>(`SELECT id,model,effective_from,effective_to,input_micros_per_million,
       output_micros_per_million,cached_input_micros_per_million,source_note,created_at
       FROM workspace_price_versions WHERE workspace_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 101`,[workspaceId]);
    return {items:q.rows.slice(0,100).map(r=>({
      id:r.id,model:r.model,effectiveFrom:r.effective_from.toISOString(),
      effectiveTo:r.effective_to?.toISOString()??null,
      inputMicrosPerMillion:r.input_micros_per_million,outputMicrosPerMillion:r.output_micros_per_million,
      cachedInputMicrosPerMillion:r.cached_input_micros_per_million,sourceNote:r.source_note,
      createdAt:r.created_at.toISOString()
    })),truncated:q.rows.length>100};
  }
  async ingest(workspaceId: string, events: readonly StoredEvent[]): Promise<{inserted:number;duplicate:number}> {
    const client = await this.begin();
    let inserted=0,duplicate=0;
    try {
      // Acquire advisory locks in deterministic order across batches. Opposing
      // event order (A,B vs B,A) would otherwise risk a PostgreSQL deadlock.
      for (const {event:e,payloadDigest,costMicros,source,priceId,workspacePriceId} of [...events].sort((a,b)=>
        a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0)) {
        // Serialize identical event IDs even when the customer row has not been created yet.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`${workspaceId}:${e.id}`]);
        const existing=await client.query<{payload_digest:string|null}>(
          this.credential===undefined?'SELECT payload_digest FROM usage_events WHERE workspace_id=$1 AND event_id=$2':
            "SELECT * FROM agentmargin_auth.event_digest($1,'usage',$2)",[workspaceId,e.id]);
        if (existing.rowCount) {
          if (existing.rows[0]?.payload_digest !== payloadDigest) throw new Error('Idempotency conflict');
          duplicate++; continue;
        }
        await client.query('INSERT INTO customers(workspace_id,id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[workspaceId,e.customerId]);
        await client.query(`INSERT INTO usage_events
          (workspace_id,event_id,customer_id,model,occurred_at,input_tokens,output_tokens,cached_input_tokens,
           reported_cost_micros,calculated_cost_micros,cost_source,price_version_id,payload_digest,workspace_price_version_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[
          workspaceId,e.id,e.customerId,e.model,e.occurredAt,e.inputTokens,e.outputTokens,e.cachedInputTokens??0,
          e.reportedCostMicros?.toString()??null,costMicros?.toString()??null,source,priceId,payloadDigest,workspacePriceId??null]);
        inserted++;
      }
      await client.query('COMMIT');
      return {inserted,duplicate};
    } catch(err) {
      await this.rollback(client); throw err;
    } finally {client.release(this.brokenClients.has(client));}
  }
  private async writeRevenue(client:pg.PoolClient,workspaceId:string,records:readonly StoredRevenue[]):Promise<{inserted:number;duplicate:number}>{
    let inserted=0,duplicate=0;
      for(const record of [...records].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`${workspaceId}:revenue:${record.id}`]);
        const old=await client.query<{payload_digest:string|null}>(
          this.credential===undefined?'SELECT payload_digest FROM revenue_records WHERE workspace_id=$1 AND id=$2':
            "SELECT * FROM agentmargin_auth.event_digest($1,'revenue',$2)",[workspaceId,record.id]);
        if(old.rowCount){
          if(old.rows[0]?.payload_digest!==record.payloadDigest)throw new Error('Idempotency conflict');
          duplicate++;continue;
        }
        await client.query('INSERT INTO customers(workspace_id,id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [workspaceId,record.customerId]);
        await client.query(`INSERT INTO revenue_records(workspace_id,id,customer_id,occurred_at,amount_micros,payload_digest)
          VALUES($1,$2,$3,$4,$5,$6)`,[workspaceId,record.id,record.customerId,record.occurredAt,
          record.amountMicros,record.payloadDigest]);
        inserted++;
      }
    return {inserted,duplicate};
  }
  async ingestRevenue(workspaceId:string,records:readonly StoredRevenue[]):Promise<{inserted:number;duplicate:number}>{
    const client=await this.begin();
    try{
      const result=await this.writeRevenue(client,workspaceId,records);
      await client.query('COMMIT');return result;
    }catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  private async writeAdjustments(client:pg.PoolClient,workspaceId:string,records:readonly StoredAdjustment[]):Promise<{inserted:number;duplicate:number}>{
    let inserted=0,duplicate=0;
    // Sort payment locks as well as IDs to avoid A/B versus B/A batch deadlocks.
    for(const r of [...records].sort((a,b)=>a.originalPaymentId<b.originalPaymentId?-1:a.originalPaymentId>b.originalPaymentId?1:a.id<b.id?-1:a.id>b.id?1:0)){
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[workspaceId+':adjustment:'+r.id]);
      const old=await client.query<{payload_digest:string}>(this.credential===undefined?
        'SELECT payload_digest FROM revenue_adjustments WHERE workspace_id=$1 AND id=$2':
        "SELECT * FROM agentmargin_auth.event_digest($1,'adjustment',$2)",[workspaceId,r.id]);
      if(old.rowCount){if(old.rows[0]?.payload_digest!==r.payloadDigest)throw new Error('Idempotency conflict');duplicate++;continue;}
      await client.query(`INSERT INTO revenue_adjustments(workspace_id,id,original_payment_id,customer_id,kind,amount_micros,
        currency,occurred_at,provider,provider_account,source_object_id,evidence_ref,payload_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[workspaceId,r.id,r.originalPaymentId,r.customerId,r.kind,
          r.amountMicros,r.currency,r.occurredAt,r.provider,r.providerAccount,r.sourceObjectId,r.evidenceRef,r.payloadDigest]);
      inserted++;
    }
    return {inserted,duplicate};
  }
  async ingestAdjustments(workspaceId:string,records:readonly StoredAdjustment[]):Promise<{inserted:number;duplicate:number}>{
    const client=await this.begin();
    try{const result=await this.writeAdjustments(client,workspaceId,records);await client.query('COMMIT');return result;}
    catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  async enqueueRevenueDelivery(workspaceId:string,delivery:RevenueDelivery):Promise<{duplicate:boolean;state:string}>{
    const client=await this.begin();
    try{
      const r=delivery.record;
      const inserted=await client.query(`INSERT INTO revenue_deliveries
        (workspace_id,provider_event_id,provider_account,record_id,customer_id,occurred_at,amount_micros,payload_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,provider_event_id) DO NOTHING`,
        [workspaceId,delivery.providerEventId,delivery.providerAccount,r.id,r.customerId,r.occurredAt,r.amountMicros,r.payloadDigest]);
      const result=await client.query<{payload_digest:string;provider_account:string;state:string}>(
        'SELECT payload_digest,provider_account,state FROM revenue_deliveries WHERE workspace_id=$1 AND provider_event_id=$2',
        [workspaceId,delivery.providerEventId]);
      const row=result.rows[0];
      if(!row||row.payload_digest!==r.payloadDigest||row.provider_account!==delivery.providerAccount)throw new Error('Idempotency conflict');
      await client.query('COMMIT');return {duplicate:inserted.rowCount===0,state:row.state};
    }catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  async revenueDeliveryStatus(workspaceId:string):Promise<{pending:string;failed:string;delivered:string;oldestPendingSeconds:string|null}>{
    const result=await this.query<{pending:string;failed:string;delivered:string;oldest_pending_seconds:string|null}>(`
      SELECT count(*) FILTER (WHERE state='pending')::text AS pending,
        count(*) FILTER (WHERE state='failed')::text AS failed,
        count(*) FILTER (WHERE state='delivered')::text AS delivered,
        extract(epoch FROM statement_timestamp()-min(received_at) FILTER (WHERE state='pending'))::text AS oldest_pending_seconds
      FROM revenue_deliveries WHERE workspace_id=$1`,[workspaceId]);
    const row=result.rows[0]!;
    return {pending:row.pending,failed:row.failed,delivered:row.delivered,oldestPendingSeconds:row.oldest_pending_seconds};
  }
  async processNextRevenueDelivery(workspaceId:string):Promise<{state:'empty'|'delivered'|'retry'|'failed';inserted?:number;duplicate?:number}>{
    const client=await this.begin();
    try{
      const job=await client.query<{provider_event_id:string;provider_account:string;record_id:string;customer_id:string;occurred_at:Date;amount_micros:string;payload_digest:string;attempts:number}>(`
        SELECT provider_event_id,provider_account,record_id,customer_id,occurred_at,amount_micros::text,payload_digest,attempts
        FROM revenue_deliveries WHERE workspace_id=$1 AND state='pending' AND available_at<=statement_timestamp()
        ORDER BY available_at,received_at,provider_event_id FOR UPDATE SKIP LOCKED LIMIT 1`,[workspaceId]);
      const row=job.rows[0];
      if(!row){await client.query('COMMIT');return {state:'empty'};}
      const attempts=row.attempts+1;
      await client.query('SAVEPOINT delivery_write');
      let result:{inserted:number;duplicate:number}|undefined;
      let errorClass:string|null=null;
      try{
        result=await this.writeRevenue(client,workspaceId,[{id:row.record_id,customerId:row.customer_id,
          occurredAt:row.occurred_at.toISOString(),amountMicros:row.amount_micros,payloadDigest:row.payload_digest}]);
        const source=await client.query<{provider_account:string}>('SELECT provider_account FROM revenue_payment_sources WHERE workspace_id=$1 AND record_id=$2',[workspaceId,row.record_id]);
        if(source.rowCount){
          if(source.rows[0]?.provider_account!==row.provider_account)throw new Error('Idempotency conflict');
        }else{
          if(!result.inserted)throw new Error('Payment provenance missing');
          await client.query(`INSERT INTO revenue_payment_sources(workspace_id,record_id,provider_account,provider_event_id)
            VALUES($1,$2,$3,$4)`,[workspaceId,row.record_id,row.provider_account,row.provider_event_id]);
        }
      }catch(error){
        result=undefined;
        await client.query('ROLLBACK TO SAVEPOINT delivery_write');
        const code=(error as {code?:string}).code;
        if(code==='42501')throw new Error('Delivery authorization changed');
        errorClass=error instanceof Error&&error.message==='Idempotency conflict'?'idempotency_conflict':
          code==='23514'||code==='23503'||(error instanceof Error&&error.message==='Payment provenance missing')?'invalid_record':'database_retry';
      }
      await client.query('RELEASE SAVEPOINT delivery_write');
      const state=result?'delivered':errorClass!=='database_retry'||attempts>=8?'failed':'pending';
      const updated=await client.query(`UPDATE revenue_deliveries SET state=$3,attempts=$4,error_class=$5,
        delivered_at=CASE WHEN $3='delivered' THEN statement_timestamp() ELSE NULL END,
        available_at=statement_timestamp()+make_interval(secs=>$6)
        WHERE workspace_id=$1 AND provider_event_id=$2`,
        [workspaceId,row.provider_event_id,state,attempts,errorClass,Math.min(300,2**attempts)]);
      if(updated.rowCount!==1)throw new Error('Delivery authorization changed');
      // Ledger insertion and completion share the same commit. A crash releases
      // the row claim and rolls back both, so no processing lease can get stuck.
      await client.query('COMMIT');
      return {state:state==='pending'?'retry':state,...result};
    }catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  async enqueueAdjustmentDelivery(workspaceId:string,delivery:{providerEventId:string;providerAccount:string;record:StoredAdjustment}):Promise<{duplicate:boolean;state:string}>{
    const client=await this.begin();
    try{
      const r=delivery.record;
      const inserted=await client.query(`INSERT INTO adjustment_deliveries(workspace_id,provider_event_id,provider_account,record,payload_digest)
        VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(workspace_id,provider_event_id) DO NOTHING`,
        [workspaceId,delivery.providerEventId,delivery.providerAccount,JSON.stringify(r),r.payloadDigest]);
      const q=await client.query<{provider_account:string;payload_digest:string;state:string}>(
        'SELECT provider_account,payload_digest,state FROM adjustment_deliveries WHERE workspace_id=$1 AND provider_event_id=$2',[workspaceId,delivery.providerEventId]);
      const row=q.rows[0];
      if(!row||row.provider_account!==delivery.providerAccount||row.payload_digest!==r.payloadDigest)throw new Error('Idempotency conflict');
      await client.query('COMMIT');return {duplicate:inserted.rowCount===0,state:row.state};
    }catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  async adjustmentDeliveryStatus(workspaceId:string){
    const result=await this.query(`SELECT count(*) FILTER(WHERE state='pending')::text AS pending,
      count(*) FILTER(WHERE state='failed')::text AS failed,count(*) FILTER(WHERE state='delivered')::text AS delivered,
      count(*) FILTER(WHERE state<>'delivered' AND error_class='unmatched_payment')::text AS unmatched,
      extract(epoch FROM statement_timestamp()-min(received_at) FILTER(WHERE state='pending'))::text AS oldest_pending_seconds
      FROM adjustment_deliveries WHERE workspace_id=$1`,[workspaceId]);
    return result.rows[0]!;
  }
  async processNextAdjustmentDelivery(workspaceId:string):Promise<{state:'empty'|'delivered'|'retry'|'failed';inserted?:number;duplicate?:number}>{
    const client=await this.begin();
    try{
      const job=await client.query<{provider_event_id:string;record:unknown;payload_digest:string;attempts:number}>(`
        SELECT provider_event_id,record,payload_digest,attempts FROM adjustment_deliveries
        WHERE workspace_id=$1 AND state='pending' AND available_at<=statement_timestamp()
        ORDER BY available_at,received_at,provider_event_id FOR UPDATE SKIP LOCKED LIMIT 1`,[workspaceId]);
      const row=job.rows[0];if(!row){await client.query('COMMIT');return {state:'empty'};}
      await client.query('SAVEPOINT adjustment_write');
      let result:{inserted:number;duplicate:number}|undefined,errorClass:string|null=null;
      try{
        const record=parseAdjustment(row.record);
        if(record.payloadDigest!==row.payload_digest)throw new Error('Invalid adjustment');
        result=await this.writeAdjustments(client,workspaceId,[record]);
      }catch(error){
        result=undefined;await client.query('ROLLBACK TO SAVEPOINT adjustment_write');
        const code=(error as {code?:string}).code;
        if(code==='42501')throw new Error('Delivery authorization changed');
        errorClass=error instanceof Error&&error.message==='Idempotency conflict'?'idempotency_conflict':
          code==='23503'?'unmatched_payment':code==='23514'||(error instanceof Error&&error.message==='Invalid adjustment')?'invalid_record':'database_retry';
      }
      await client.query('RELEASE SAVEPOINT adjustment_write');
      const attempts=row.attempts+1;
      const retryable=errorClass==='database_retry'||errorClass==='unmatched_payment';
      const state=result?'delivered':retryable&&attempts<8?'pending':'failed';
      const update=await client.query(`UPDATE adjustment_deliveries SET state=$3,attempts=$4,error_class=$5,
        delivered_at=CASE WHEN $3='delivered' THEN statement_timestamp() ELSE NULL END,
        available_at=statement_timestamp()+make_interval(secs=>$6) WHERE workspace_id=$1 AND provider_event_id=$2`,
        [workspaceId,row.provider_event_id,state,attempts,errorClass,Math.min(300,2**attempts)]);
      if(update.rowCount!==1)throw new Error('Delivery authorization changed');
      await client.query('COMMIT');return {state:state==='pending'?'retry':state,...result};
    }catch(error){await this.rollback(client);throw error;}
    finally{client.release(this.brokenClients.has(client));}
  }
  /** Bounded sensitive export, one READ COMMITTED snapshot; never log the result. */
  async financialLedger(workspaceId:string,start:string,end:string){
    const snapshot=await this.query(`SELECT
      (SELECT coalesce(jsonb_agg(p),'[]'::jsonb) FROM (
        SELECT r.id,r.customer_id AS "customerId",to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
          r.amount_micros::text AS "amountMicros",r.currency,r.payload_digest AS "payloadDigest",
          s.provider_account AS "providerAccount",s.provider_event_id AS "providerEventId"
        FROM revenue_records r LEFT JOIN revenue_payment_sources s ON r.workspace_id=s.workspace_id AND r.id=s.record_id
        WHERE r.workspace_id=$1 AND ((r.occurred_at >= $2::timestamptz AND r.occurred_at < $3::timestamptz)
          OR r.id IN (SELECT original_payment_id FROM revenue_adjustments WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz))
        ORDER BY r.id LIMIT 10001) p) AS payments,
      (SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (
        SELECT id,original_payment_id AS "originalPaymentId",customer_id AS "customerId",kind,amount_micros::text AS "amountMicros",currency,
          to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",provider,provider_account AS "providerAccount",
          source_object_id AS "sourceObjectId",evidence_ref AS "evidenceRef",payload_digest AS "payloadDigest"
        FROM revenue_adjustments WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz ORDER BY id LIMIT 10001) a) AS adjustments,
      (SELECT coalesce(jsonb_agg(u),'[]'::jsonb) FROM (
        SELECT event_id AS id,customer_id AS "customerId",model,
          to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
          calculated_cost_micros::text AS "costMicros",cost_source AS source,coalesce(workspace_price_version_id::text,price_version_id::text) AS "pricingRef"
        FROM usage_events WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz ORDER BY event_id LIMIT 10001) u) AS usage,
      (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM (
        SELECT 'payment_delivery:'||provider_event_id AS id,provider_event_id AS "sourceRef",'unmatched_transaction' AS reason
          FROM revenue_deliveries WHERE workspace_id=$1 AND state<>'delivered'
        UNION ALL
        SELECT 'adjustment_delivery:'||provider_event_id AS id,provider_event_id AS "sourceRef",'unmatched_transaction' AS reason
          FROM adjustment_deliveries WHERE workspace_id=$1 AND state<>'delivered'
        ORDER BY id LIMIT 10001) d) AS unresolved`,[workspaceId,start,end]);
    const row=snapshot.rows[0]!;
    return summarizeFinancialLedger({workspaceId,currency:'USD',periodStart:start,periodEnd:end,
      payments:row.payments,adjustments:row.adjustments,usage:row.usage,unresolvedEvidence:row.unresolved} as FinancialLedgerInput);
  }
  async analyticsPage(workspaceId:string,start:string,end:string,after:string|null,limit:number):Promise<AnalyticsPage>{
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid pagination limit');
    const client=await this.begin('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    try{
      const params=[workspaceId,start,end];
      // One statement preserves totals/page/diagnostics consistency without a
      // reusable snapshot that can retain revoked authentication rows.
      const snapshot=await client.query(`SELECT
        (SELECT to_jsonb(s) FROM (${ANALYTICS_FULL_SUMMARY_SQL}) s) AS summary,
        (SELECT coalesce(jsonb_agg(p),'[]'::jsonb) FROM (${ANALYTICS_CUSTOMER_PAGE_SQL}) p) AS page,
        (SELECT coalesce(jsonb_agg(m),'[]'::jsonb) FROM (${UNKNOWN_MODELS_SQL}) m) AS missing`,
        [...params,after,limit+1]);
      const summary={rows:[snapshot.rows[0].summary]};
      const page={rows:snapshot.rows[0].page as {customer_id:string;revenue_micros:string;known_cost_micros:string;usage_events:string;unknown_events:string}[]};
      const missing={rows:snapshot.rows[0].missing as {model:string;event_count:string}[]};
      await client.query('COMMIT');
      const row=summary.rows[0];
      if(!row)throw new Error('Analytics summary unexpectedly empty');
      const hasMore=page.rows.length>limit;
      const selected=page.rows.slice(0,limit);
      const totalRevenue=BigInt(row.total_revenue_micros),totalCost=BigInt(row.total_known_ai_cost_micros);
      const complete=row.unknown_customer_count==='0'&&row.unresolved_revenue_deliveries==='0';
      const last=selected[selected.length-1]?.customer_id;
      return {periodStart:start,periodEnd:end,pageSize:limit,
        customers:selected.map(mapAnalyticsCustomer),
        nextCursor:hasMore&&last?Buffer.from(last,'utf8').toString('base64url'):null,
        summary:{
          customerCount:row.customer_count,
          verifiedCustomerCount:row.verified_customer_count,
          profitableCustomerCount:row.profitable_customer_count,
          lossMakingCustomerCount:row.loss_making_customer_count,
          unknownCustomerCount:row.unknown_customer_count,
          usageEventCount:row.usage_event_count,
          unknownUsageEventCount:row.unknown_usage_event_count,
          totalRevenueMicros:row.total_revenue_micros,
          unresolvedRevenueDeliveries:row.unresolved_revenue_deliveries,revenueProcessingComplete:row.unresolved_revenue_deliveries==='0',
          revenueBasis:'net_adjusted',grossRevenueMicros:row.gross_revenue_micros,
          refundsMicros:row.refunds_micros,creditsMicros:row.credits_micros,paymentReversalsMicros:row.payment_reversals_micros,
          netRevenueMicros:row.total_revenue_micros,
          totalKnownAiCostMicros:row.total_known_ai_cost_micros,
          verifiedCustomerContributionMicros:row.verified_customer_contribution_micros,
          completeContributionMicros:complete?(totalRevenue-totalCost).toString():null,
        },
        unknownModels:missing.rows.slice(0,20).map(m=>({model:m.model,eventCount:Number(m.event_count)})),
        unknownModelsTruncated:missing.rows.length>20,
      };
    }catch(err){
      await this.rollback(client);throw err;
    }finally{client.release(this.brokenClients.has(client));}
  }

  async analytics(workspaceId:string,start:string,end:string):Promise<AnalyticsSnapshot>{
    // Independent aggregates prevent revenue * usage-event join multiplication.
    // Read both aggregates from one consistent snapshot. Running queries concurrently
    // breaks PGlite's pg-wire test adapter and can return mismatched financial views.
    const client=await this.begin('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    let q:{rows:{
      customer_id:string;revenue_micros:string;known_cost_micros:string;usage_events:string;unknown_events:string;
    }[]};
    let missing:{rows:{model:string;event_count:string}[]};
    try {
      const snapshot=await client.query(`SELECT
        (SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (${ANALYTICS_SQL}) a) AS customers,
        (SELECT coalesce(jsonb_agg(m),'[]'::jsonb) FROM (${UNKNOWN_MODELS_SQL}) m) AS missing`,[workspaceId,start,end]);
      q={rows:snapshot.rows[0].customers};missing={rows:snapshot.rows[0].missing};
      await client.query('COMMIT');
    } catch(err) {
      await this.rollback(client);
      throw err;
    } finally {client.release(this.brokenClients.has(client));}
    const truncated=q.rows.length>2000;
    const customers=q.rows.slice(0,2000).map(r=>{
      const revenue=BigInt(r.revenue_micros),cost=BigInt(r.known_cost_micros),unknown=Number(r.unknown_events);
      const contribution=unknown>0?null:revenue-cost;
      const margin=contribution===null||revenue<=0n?null:(contribution<0n
        ? -((-contribution*10000n+revenue/2n)/revenue) : (contribution*10000n+revenue/2n)/revenue);
      return {customerId:r.customer_id,revenueMicros:revenue.toString(),knownAiCostMicros:cost.toString(),
        contributionMicros:contribution?.toString()??null,marginBasisPoints:margin?.toString()??null,
        usageEvents:Number(r.usage_events),unknownEvents:unknown};
    });
    return {periodStart:start,periodEnd:end,customers,truncated,
      unknownModels:missing.rows.slice(0,20).map(r=>({model:r.model,eventCount:Number(r.event_count)})),
      unknownModelsTruncated:missing.rows.length>20};
  }
}

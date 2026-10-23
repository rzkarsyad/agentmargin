import pg from 'pg';
import type { PriceVersion } from '../../../packages/core/src/index.ts';
import type { EventStore, StoredEvent, StoredRevenue, AnalyticsSnapshot, AnalyticsPage, AnalyticsCustomer, PriceInput, WorkspacePrice, ScopedPriceVersion, AuthenticatedWorkspace, WorkspaceKeyRole } from './app.ts';

const { Pool } = pg;
export const ANALYTICS_SQL = `WITH revenue AS (
       SELECT customer_id, SUM(amount_micros)::text AS amount
       FROM revenue_records WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz
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
 * Full-workspace totals and a keyset page share one REPEATABLE READ snapshot.
 * Never SUM the first N displayed customers to present organization totals.
 */
const CUSTOMER_ROWS_CTE=`WITH revenue AS (
  SELECT customer_id, SUM(amount_micros) AS revenue
  FROM revenue_records
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
    AS verified_customer_contribution_micros
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
 const margin=contribution===null||revenue===0n?null:(contribution<0n
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
  constructor(connectionString: string, options:{pool?:pg.Pool;credential?:string}={}) {
    this.credential=options.credential;
    this.pool = options.pool??new Pool({ connectionString, max:10, connectionTimeoutMillis:5000,
      statement_timeout:15000, idle_in_transaction_session_timeout:15000,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized:true } : undefined });
  }
  forCredential(credential:string):PostgresEventStore {
    return new PostgresEventStore('',{pool:this.pool,credential});
  }
  private async begin(sql='BEGIN'):Promise<pg.PoolClient> {
    const client=await this.pool.connect();
    try {
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
        'SELECT * FROM agentmargin_auth.principal($1)',[this.credential]);
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
          'SELECT payload_digest FROM usage_events WHERE workspace_id=$1 AND event_id=$2',[workspaceId,e.id]);
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
  async ingestRevenue(workspaceId:string,records:readonly StoredRevenue[]):Promise<{inserted:number;duplicate:number}>{
    const client=await this.begin();
    let inserted=0,duplicate=0;
    try{
      for(const record of [...records].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`${workspaceId}:revenue:${record.id}`]);
        const old=await client.query<{payload_digest:string|null}>(
          'SELECT payload_digest FROM revenue_records WHERE workspace_id=$1 AND id=$2',[workspaceId,record.id]);
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
      await client.query('COMMIT');
      return {inserted,duplicate};
    }catch(err){await this.rollback(client);throw err;}
    finally{client.release(this.brokenClients.has(client));}
  }
  async analyticsPage(workspaceId:string,start:string,end:string,after:string|null,limit:number):Promise<AnalyticsPage>{
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid pagination limit');
    const client=await this.begin('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const params=[workspaceId,start,end];
      const summary=await client.query<{
        customer_count:string;verified_customer_count:string;profitable_customer_count:string;
        loss_making_customer_count:string;unknown_customer_count:string;
        usage_event_count:string;unknown_usage_event_count:string;
        total_revenue_micros:string;total_known_ai_cost_micros:string;
        verified_customer_contribution_micros:string;
      }>(ANALYTICS_FULL_SUMMARY_SQL,params);
      const page=await client.query<{
        customer_id:string;revenue_micros:string;known_cost_micros:string;
        usage_events:string;unknown_events:string;
      }>(ANALYTICS_CUSTOMER_PAGE_SQL,[...params,after,limit+1]);
      const missing=await client.query<{model:string;event_count:string}>(UNKNOWN_MODELS_SQL,params);
      await client.query('COMMIT');
      const row=summary.rows[0];
      if(!row)throw new Error('Analytics summary unexpectedly empty');
      const hasMore=page.rows.length>limit;
      const selected=page.rows.slice(0,limit);
      const totalRevenue=BigInt(row.total_revenue_micros),totalCost=BigInt(row.total_known_ai_cost_micros);
      const complete=row.unknown_customer_count==='0';
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
    const client=await this.begin('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let q:pg.QueryResult<{
      customer_id:string;revenue_micros:string;known_cost_micros:string;usage_events:string;unknown_events:string;
    }>;
    let missing:pg.QueryResult<{model:string;event_count:string}>;
    try {
      q=await client.query(ANALYTICS_SQL,[workspaceId,start,end]);
      missing=await client.query(UNKNOWN_MODELS_SQL,[workspaceId,start,end]);
      await client.query('COMMIT');
    } catch(err) {
      await this.rollback(client);
      throw err;
    } finally {client.release(this.brokenClients.has(client));}
    const truncated=q.rows.length>2000;
    const customers=q.rows.slice(0,2000).map(r=>{
      const revenue=BigInt(r.revenue_micros),cost=BigInt(r.known_cost_micros),unknown=Number(r.unknown_events);
      const contribution=unknown>0?null:revenue-cost;
      const margin=contribution===null||revenue===0n?null:(contribution<0n
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

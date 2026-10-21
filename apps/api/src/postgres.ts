import pg from 'pg';
import type { PriceVersion } from '../../../packages/core/src/index.ts';
import type { EventStore, StoredEvent, StoredRevenue, AnalyticsSnapshot } from './app.ts';

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
export class PostgresEventStore implements EventStore {
  readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max:10, connectionTimeoutMillis:5000,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized:true } : undefined });
  }
  async authenticate(keyDigest: string): Promise<string | null> {
    const q = await this.pool.query<{workspace_id:string}>(
      'SELECT workspace_id FROM workspace_api_keys WHERE key_digest=$1 AND revoked_at IS NULL',[keyDigest]);
    return q.rows[0]?.workspace_id ?? null;
  }
  async prices(model: string, timestamp: string): Promise<PriceVersion[]> {
    const q=await this.pool.query<{
      id:string;model:string;effective_from:Date;effective_to:Date|null;
      input_micros_per_million:string;output_micros_per_million:string;cached_input_micros_per_million:string|null;
    }>('SELECT * FROM price_versions WHERE model=$1 AND effective_from <= $2::timestamptz AND (effective_to IS NULL OR effective_to > $2::timestamptz)',[model,timestamp]);
    return q.rows.map(r=>({id:r.id,model:r.model,effectiveFrom:r.effective_from.toISOString(),
      effectiveTo:r.effective_to?.toISOString()??null,inputMicrosPerMillion:BigInt(r.input_micros_per_million),
      outputMicrosPerMillion:BigInt(r.output_micros_per_million),
      cachedInputMicrosPerMillion:r.cached_input_micros_per_million == null ? null : BigInt(r.cached_input_micros_per_million)}));
  }
  async ingest(workspaceId: string, events: readonly StoredEvent[]): Promise<{inserted:number;duplicate:number}> {
    const client = await this.pool.connect();
    let inserted=0,duplicate=0;
    try {
      await client.query('BEGIN');
      // Acquire advisory locks in deterministic order across batches. Opposing
      // event order (A,B vs B,A) would otherwise risk a PostgreSQL deadlock.
      for (const {event:e,payloadDigest,costMicros,source,priceId} of [...events].sort((a,b)=>
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
           reported_cost_micros,calculated_cost_micros,cost_source,price_version_id,payload_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[
          workspaceId,e.id,e.customerId,e.model,e.occurredAt,e.inputTokens,e.outputTokens,e.cachedInputTokens??0,
          e.reportedCostMicros?.toString()??null,costMicros?.toString()??null,source,priceId,payloadDigest]);
        inserted++;
      }
      await client.query('COMMIT');
      return {inserted,duplicate};
    } catch(err) {
      await client.query('ROLLBACK'); throw err;
    } finally {client.release();}
  }
  async ingestRevenue(workspaceId:string,records:readonly StoredRevenue[]):Promise<{inserted:number;duplicate:number}>{
    const client=await this.pool.connect();
    let inserted=0,duplicate=0;
    try{
      await client.query('BEGIN');
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
    }catch(err){await client.query('ROLLBACK');throw err;}
    finally{client.release();}
  }
  async analytics(workspaceId:string,start:string,end:string):Promise<AnalyticsSnapshot>{
    // Independent aggregates prevent revenue * usage-event join multiplication.
    const q=await this.pool.query<{
      customer_id:string;revenue_micros:string;known_cost_micros:string;usage_events:string;unknown_events:string;
    }>(ANALYTICS_SQL,[workspaceId,start,end]);
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
    return {periodStart:start,periodEnd:end,customers,truncated};
  }
}

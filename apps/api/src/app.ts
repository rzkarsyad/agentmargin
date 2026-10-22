import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { calculateEventCost, type UsageEvent, type PriceVersion } from '../../../packages/core/src/index.ts';
import { WorkspaceRateLimiter } from './rate-limit.ts';

export interface IncomingEvent {
  id: string; customerId: string; model: string; occurredAt: string;
  inputTokens: number; outputTokens: number; cachedInputTokens?: number;
  reportedCostMicros?: string | null;
}
export interface StoredEvent { event: UsageEvent; payloadDigest: string; costMicros: bigint | null; source: string; priceId: string | null }
export interface StoredRevenue { id:string; customerId:string; occurredAt:string; amountMicros:string; payloadDigest:string }
export interface EventStore {
  authenticate(keyDigest: string): Promise<string | null>;
  prices(model: string, timestamp: string): Promise<PriceVersion[]>;
  ingest(workspaceId: string, events: readonly StoredEvent[]): Promise<{ inserted: number; duplicate: number }>;
  ingestRevenue?(workspaceId:string, records: readonly StoredRevenue[]): Promise<{inserted:number;duplicate:number}>;
  analytics?(workspaceId:string,start:string,end:string):Promise<AnalyticsSnapshot>;
}
export interface AnalyticsCustomer {
  customerId:string; revenueMicros:string; knownAiCostMicros:string;
  contributionMicros:string|null; marginBasisPoints:string|null;
  usageEvents:number; unknownEvents:number;
}
export interface AnalyticsSnapshot {
  periodStart:string; periodEnd:string; customers:AnalyticsCustomer[]; truncated:boolean;
  /** Unknown-cost counts across the authenticated workspace's selected period (not only the first 2,000 customers). */
  unknownModels?: {model:string; eventCount:number}[];
  unknownModelsTruncated?: boolean;
}
const hex64 = /^[a-f0-9]{64}$/;
const validId = (s: unknown): s is string => typeof s === 'string' && s.length >= 1 && s.length <= 200;
const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
// Require explicit timezone and complete timestamp; ambiguous local dates are unsafe for billing windows.
const validTime = (s: unknown): s is string => typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  // Date.parse normalizes impossible dates (e.g. February 31), so reject them explicitly.
  new Date(`${s.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10) === s.slice(0,10);
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function parseEvent(x: unknown, workspaceId: string): {event: UsageEvent; payloadDigest: string} {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Event must be an object');
  const raw = x as Record<string, unknown>;
  if (!validId(raw.id) || !validId(raw.customerId) || !validId(raw.model) || !validTime(raw.occurredAt)) throw new Error('Invalid id, customerId, model or occurredAt');
  if (!validCount(raw.inputTokens) || !validCount(raw.outputTokens)) throw new Error('Invalid token count');
  const cached = raw.cachedInputTokens ?? 0;
  if (!validCount(cached) || cached > raw.inputTokens) throw new Error('Invalid cached token count');
  const amount = raw.reportedCostMicros;
  if (amount != null && (typeof amount !== 'string' || !/^\d{1,18}$/.test(amount))) throw new Error('reportedCostMicros must be a nonnegative decimal integer string (max 18 digits)');
  // Normalize canonical event fields (including insignificant omission vs zero).
  const canon = { id:raw.id, customerId:raw.customerId, model:raw.model,
    occurredAt:new Date(raw.occurredAt).toISOString(), inputTokens:raw.inputTokens,
    outputTokens:raw.outputTokens, cachedInputTokens:cached,
    reportedCostMicros:amount == null ? null : BigInt(amount).toString() };
  const event: UsageEvent = { ...canon, workspaceId,
    reportedCostMicros:canon.reportedCostMicros == null ? null : BigInt(canon.reportedCostMicros) };
  return { event, payloadDigest:digest(JSON.stringify(canon)) };
}
function parseRevenue(x:unknown):StoredRevenue{
  if(!x || typeof x!=='object' || Array.isArray(x))throw new Error('Invalid revenue record');
  const r=x as Record<string,unknown>;
  if(!validId(r.id)||!validId(r.customerId)||!validTime(r.occurredAt)||
    typeof r.amountMicros!=='string'||!/^(?:0|[1-9]\d{0,18})$/.test(r.amountMicros)||
    BigInt(r.amountMicros)>9_223_372_036_854_775_807n)throw new Error('Invalid revenue record');
  const canonical={id:r.id,customerId:r.customerId,occurredAt:new Date(r.occurredAt).toISOString(),amountMicros:BigInt(r.amountMicros).toString()};
  return {...canonical,payloadDigest:digest(JSON.stringify(canonical))};
}

export function createApp(store: EventStore, limiter=new WorkspaceRateLimiter()) {
  const app = new Hono();
  const dashboard=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
  const inlineScript=dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!inlineScript)throw new Error('Dashboard script missing');
  const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
  app.use('*',async(c,next)=>{
    await next();
    c.header('Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','DENY');
  });
  app.use('/dashboard',async(c,next)=>{
    await next();
    c.header('Content-Security-Policy',`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  });
  app.get('/dashboard',c=>c.html(dashboard));
  app.get('/health', c => c.json({ status:'ok', phase:2 }));
  app.use('/v1/*', bodyLimit({maxSize:256_000,onError:c=>c.json({error:'Payload too large'},413)}));
  app.get('/v1/analytics', async c=>{
    const auth=c.req.header('authorization')??'';
    if (!/^Bearer am_[A-Za-z0-9_-]{32,}$/.test(auth)) return c.json({error:'Unauthorized'},401);
    const workspaceId=await store.authenticate(digest(auth.slice(7)));
    if(!workspaceId)return c.json({error:'Unauthorized'},401);
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    const start=c.req.query('start'),end=c.req.query('end');
    if(!validTime(start)||!validTime(end)||Date.parse(start)>=Date.parse(end)) return c.json({error:'Invalid period'},400);
    if(Date.parse(end)-Date.parse(start)>366*86400000) return c.json({error:'Maximum period is 366 days'},400);
    if(!store.analytics)return c.json({error:'Analytics unavailable'},503);
    return c.json(await store.analytics(workspaceId,start,end));
  });
  app.post('/v1/revenue',async c=>{
    const auth=c.req.header('authorization')??'';
    if(!/^Bearer am_[A-Za-z0-9_-]{32,}$/.test(auth))return c.json({error:'Unauthorized'},401);
    const workspaceId=await store.authenticate(digest(auth.slice(7)));
    if(!workspaceId)return c.json({error:'Unauthorized'},401);
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.ingestRevenue)return c.json({error:'Revenue ingestion unavailable'},503);
    let payload:unknown;
    try {payload=await c.req.json();}catch{return c.json({error:'Invalid JSON'},400);}
    if(!payload||typeof payload!=='object'||!('records' in payload)||
      !Array.isArray(payload.records)||payload.records.length<1||payload.records.length>100)
      return c.json({error:'records must contain 1-100 items'},400);
    try{
      const records=payload.records.map(parseRevenue);
      if(new Set(records.map(r=>r.id)).size!==records.length)return c.json({error:'Duplicate ID in request'},400);
      return c.json({...await store.ingestRevenue(workspaceId,records),received:records.length},202);
    }catch(err){
      if(err instanceof Error&&err.message==='Idempotency conflict')return c.json({error:'Revenue ID reused with different payload'},409);
      if(err instanceof Error&&err.message==='Invalid revenue record')return c.json({error:err.message},400);
      throw err;
    }
  });
  app.post('/v1/events', async c => {
    const auth = c.req.header('authorization') ?? '';
    if (!/^Bearer am_[A-Za-z0-9_-]{32,}$/.test(auth)) return c.json({ error:'Unauthorized' },401);
    const keyDigest = digest(auth.slice(7));
    if (!hex64.test(keyDigest)) return c.json({error:'Unauthorized'},401);
    const workspaceId = await store.authenticate(keyDigest);
    if (!workspaceId) return c.json({ error:'Unauthorized' },401);
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > 256_000) return c.json({error:'Payload too large'},413);
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({error:'Invalid JSON'},400); }
    const body = payload as {events?:unknown};
    if (!body || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100)
      return c.json({error:'events must contain 1-100 items'},400);
    try {
      const entries = body.events.map((e:unknown)=>parseEvent(e,workspaceId));
      if (new Set(entries.map(e=>e.event.id)).size !== entries.length) return c.json({error:'Duplicate ID in request'},400);
      const stored: StoredEvent[] = [];
      for (const entry of entries) {
        const cost = calculateEventCost(entry.event,await store.prices(entry.event.model,entry.event.occurredAt));
        stored.push({event:entry.event,payloadDigest:entry.payloadDigest,costMicros:cost.amountMicros,source:cost.source,priceId:cost.priceVersionId});
      }
      const result=await store.ingest(workspaceId,stored);
      return c.json({ ...result, received:entries.length },202);
    } catch (error) {
      if (error instanceof Error && error.message === 'Idempotency conflict') return c.json({error:'Event ID reused with different payload'},409);
      if (error instanceof Error && /^(Invalid|Overlapping|Missing|Cost exceeds|reportedCost|cachedInput|inputTokens|outputTokens)/.test(error.message)) return c.json({error:error.message},400);
      throw error;
    }
  });
  app.onError((_err,c)=>c.json({error:'Internal server error'},500));
  return app;
}

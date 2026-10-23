import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { calculateEventCost, MAX_DATABASE_MICROS, type UsageEvent, type PriceVersion, parseAdjustment, type StoredAdjustment } from '../../../packages/core/src/index.ts';
import type {OperationalMetrics} from './metrics.ts';
import { WorkspaceRateLimiter, InvalidCredentialLimiter } from './rate-limit.ts';

export interface IncomingEvent {
  id: string; customerId: string; model: string; occurredAt: string;
  inputTokens: number; outputTokens: number; cachedInputTokens?: number;
  reportedCostMicros?: string | null;
}
export interface StoredEvent { event: UsageEvent; payloadDigest: string; costMicros: bigint | null; source: string; priceId: string | null; workspacePriceId?: string | null }
export interface StoredRevenue { id:string; customerId:string; occurredAt:string; amountMicros:string; payloadDigest:string }
export interface RevenueDelivery {providerEventId:string;providerAccount:string;record:StoredRevenue}
export type ScopedPriceVersion = PriceVersion & { scope?: 'workspace' | 'legacy' };
export interface PriceInput {
  id:string; model:string; effectiveFrom:string; effectiveTo:string|null;
  inputMicrosPerMillion:string; outputMicrosPerMillion:string;
  cachedInputMicrosPerMillion:string|null; sourceNote:string;
}
export interface WorkspacePrice extends PriceInput {createdAt:string}
export type WorkspaceKeyRole='admin'|'ingest'|'read';
export interface AuthenticatedWorkspace {workspaceId:string; accessRole:WorkspaceKeyRole}
export interface EventStore {
  /** Request-local credential view; never mutate shared pool authentication state. */
  forCredential?(credential:string):EventStore;
  authenticate(keyDigest: string): Promise<AuthenticatedWorkspace | null>;
  prices(workspaceId: string, model: string, timestamp: string): Promise<ScopedPriceVersion[]>;
  createPriceVersion?(workspaceId:string, creatorDigest:string, input:PriceInput):Promise<WorkspacePrice>;
  listPriceVersions?(workspaceId:string):Promise<{items:WorkspacePrice[]; truncated:boolean}>;
  ingest(workspaceId: string, events: readonly StoredEvent[]): Promise<{ inserted: number; duplicate: number }>;
  enqueueRevenueDelivery?(workspaceId:string,delivery:RevenueDelivery):Promise<{duplicate:boolean;state:string}>;
  enqueueAdjustmentDelivery?(workspaceId:string,delivery:{providerEventId:string;providerAccount:string;record:StoredAdjustment}):Promise<{duplicate:boolean;state:string}>;
  ingestAdjustments?(workspaceId:string,records:readonly StoredAdjustment[]):Promise<{inserted:number;duplicate:number}>;
  ingestRevenue?(workspaceId:string, records: readonly StoredRevenue[]): Promise<{inserted:number;duplicate:number}>;
  analytics?(workspaceId:string,start:string,end:string):Promise<AnalyticsSnapshot>;
  analyticsPage?(workspaceId:string,start:string,end:string,after:string|null,limit:number):Promise<AnalyticsPage>;
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
export interface WorkspaceAnalyticsSummary{
  customerCount:string;
  verifiedCustomerCount:string;
  profitableCustomerCount:string;
  lossMakingCustomerCount:string;
  unknownCustomerCount:string;
  usageEventCount:string;
  unknownUsageEventCount:string;
  /** Net of persisted period adjustments after migration 010. */
  totalRevenueMicros:string;
  unresolvedRevenueDeliveries?:string;revenueProcessingComplete?:boolean;
  revenueBasis?:'net_adjusted';grossRevenueMicros?:string;refundsMicros?:string;creditsMicros?:string;
  paymentReversalsMicros?:string;netRevenueMicros?:string;
  totalKnownAiCostMicros:string;
  /** Sum of contribution for customers whose inference cost is fully known. This is NOT an entire-workspace margin when unknown customers exist. */
  verifiedCustomerContributionMicros:string;
  /** Null until every customer in the selected period has a verified inference cost. */
  completeContributionMicros:string|null;
}
export interface AnalyticsPage{
  periodStart:string;periodEnd:string;
  customers:AnalyticsCustomer[];
  summary:WorkspaceAnalyticsSummary;
  nextCursor:string|null;
  pageSize:number;
  unknownModels?:{model:string;eventCount:number}[];
  unknownModelsTruncated?:boolean;
}

/** An allowlisted operational event. Raw paths, queries, headers, payloads and tenant identifiers are intentionally absent. */
export interface SafeRequestLog {
  kind:'http_request'; requestId:string; timestamp:string;
  route:'readiness'|'metrics'|'health'|'dashboard'|'dashboard_asset'|'events'|'revenue'|'revenue_deliveries'|'adjustments'|'prices'|'analytics'|'analytics_page'|'other';
  method:'GET'|'POST'|'HEAD'|'OPTIONS'|'OTHER';
  status:number; durationMs:number;
  errorClass:'none'|'authentication'|'authorization'|'rate_limit'|'client'|'dependency'|'internal';
}
export type RequestLogSink=(entry:SafeRequestLog)=>void;

function safeRoute(path:string):SafeRequestLog['route']{
  switch(path){
    case '/health':return 'health';
    case '/ready':return 'readiness';
    case '/metrics':return 'metrics';
    case '/dashboard':return 'dashboard';
    case '/v1/events':return 'events';
    case '/v1/revenue':return 'revenue';
    case '/v1/revenue/deliveries':return 'revenue_deliveries';
    case '/v1/revenue/adjustments':case '/v1/revenue/adjustments/deliveries':return 'adjustments';
    case '/v1/prices':return 'prices';
    case '/v1/analytics':return 'analytics';
    case '/v1/analytics/page':return 'analytics_page';
    default:return path.startsWith('/dashboard/assets/')?'dashboard_asset':'other';
  }
}
function safeMethod(value:string):SafeRequestLog['method']{
  return value==='GET'||value==='POST'||value==='HEAD'||value==='OPTIONS'?value:'OTHER';
}
function requiredKeyRole(method:string,path:string):WorkspaceKeyRole{
  if(method==='GET'&&['/v1/prices','/v1/analytics','/v1/analytics/page'].includes(path))return 'read';
  if(method==='POST'&&['/v1/events','/v1/revenue','/v1/revenue/deliveries','/v1/revenue/adjustments','/v1/revenue/adjustments/deliveries'].includes(path))return 'ingest';
  // Price changes, unknown future endpoints and other methods are admin-only by default.
  return 'admin';
}
function keyRoleAllowed(actual:WorkspaceKeyRole,required:WorkspaceKeyRole):boolean{
  return actual==='admin'||actual===required;
}

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

function parsePriceInput(x:unknown):PriceInput {
  if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('Invalid price payload');
  const raw=x as Record<string,unknown>;
  const allowed=new Set(['model','effectiveFrom','effectiveTo','inputMicrosPerMillion','outputMicrosPerMillion','cachedInputMicrosPerMillion','sourceNote']);
  if(Object.keys(raw).some(k=>!allowed.has(k)))throw new Error('Unexpected pricing field');
  if(!validId(raw.model)||!validTime(raw.effectiveFrom))throw new Error('Invalid pricing model or effectiveFrom');
  if(raw.effectiveTo!=null&&(!validTime(raw.effectiveTo)||Date.parse(raw.effectiveTo)<=Date.parse(raw.effectiveFrom)))
    throw new Error('Invalid effectiveTo');
  const rate=(v:unknown,nullable=false):string|null=>{
    if(nullable&&v==null)return null;
    if(typeof v!=='string'||!/^(?:0|[1-9]\d{0,18})$/.test(v)||BigInt(v)>MAX_DATABASE_MICROS)
      throw new Error('Rates must be nonnegative integer USD-micro strings');
    return BigInt(v).toString();
  };
  if(typeof raw.sourceNote!=='string'||raw.sourceNote.trim().length<3||raw.sourceNote.trim().length>500)
    throw new Error('A sourceNote of 3-500 characters is required');
  return {id:randomUUID(),model:raw.model,effectiveFrom:new Date(raw.effectiveFrom).toISOString(),
    effectiveTo:raw.effectiveTo==null?null:new Date(raw.effectiveTo).toISOString(),
    inputMicrosPerMillion:rate(raw.inputMicrosPerMillion)!,outputMicrosPerMillion:rate(raw.outputMicrosPerMillion)!,
    cachedInputMicrosPerMillion:rate(raw.cachedInputMicrosPerMillion,true),sourceNote:raw.sourceNote.trim()};
}

export interface OperationsOptions {
  ready?:()=>Promise<boolean>; isDraining?:()=>boolean;
  metrics?:OperationalMetrics; metricsToken?:string;
}
export function createApp(store: EventStore, limiter=new WorkspaceRateLimiter(), invalidLimiter=new InvalidCredentialLimiter(), logSink?:RequestLogSink, operations:OperationsOptions={}) {
  const app = new Hono<{ Variables: { workspaceId: string; keyDigest: string; keyRole:WorkspaceKeyRole; store:EventStore } }>();
  const builtDashboard=new URL('../../web/dist/index.html',import.meta.url);
  const hasReactBuild=existsSync(builtDashboard);
  const dashboard=readFileSync(hasReactBuild?builtDashboard:new URL('./dashboard.html',import.meta.url),'utf8');
  const inlineScript=hasReactBuild?null:dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!hasReactBuild&&!inlineScript)throw new Error('Legacy dashboard script missing');
  const scriptHash=inlineScript?createHash('sha256').update(inlineScript).digest('base64'):null;
  app.use('*',async(c,next)=>{
    const requestId=randomUUID();
    const started=performance.now();
    try{await next();}finally{
      c.header('X-Request-ID',requestId);
      if(logSink||operations.metrics){
        const event:SafeRequestLog={kind:'http_request',requestId,timestamp:new Date().toISOString(),
          route:safeRoute(c.req.path),method:safeMethod(c.req.method),status:c.res.status,
          errorClass:c.res.status===401?'authentication':c.res.status===403?'authorization':c.res.status===429?'rate_limit':c.res.status===503?'dependency':c.res.status>=500?'internal':c.res.status>=400?'client':'none',
          durationMs:Math.max(0,Math.round((performance.now()-started)*10)/10)};
        // Telemetry sink failure must never change API billing/ingestion responses.
        operations.metrics?.observe(event);
        try{logSink?.(event);}catch{/* Operator should monitor its external logging pipeline. */}
      }
    }
  });
  app.use('*',async(c,next)=>{
    await next();
    c.header('Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','DENY');
  });
  app.use('/dashboard',async(c,next)=>{
    await next();
    c.header('Content-Security-Policy',hasReactBuild
      ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      : `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  });
  app.get('/dashboard',c=>c.html(dashboard));
  // Serve only the build's hashed JS/CSS assets from localhost; no arbitrary paths.
  app.get('/dashboard/assets/:file',c=>{
    if(!hasReactBuild)return c.notFound();
    const file=c.req.param('file');
    if(!/^[A-Za-z0-9_.-]+\.(?:js|css)$/.test(file))return c.notFound();
    const resource=new URL('../../web/dist/assets/'+file,import.meta.url);
    if(!existsSync(resource))return c.notFound();
    return new Response(new Uint8Array(readFileSync(resource)),{
      status:200,headers:{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
    });
  });
  app.get('/health', c => c.json({ status:'ok', phase:3 }));
  app.get('/ready',async c=>{
    let ready=false;
    try{ready=!operations.isDraining?.()&&await (operations.ready?.()??Promise.resolve(false));}catch{/* No dependency details in public responses. */}
    return c.json({status:ready?'ready':'unavailable'},ready?200:503);
  });
  app.get('/metrics',c=>{
    if(!operations.metrics||!operations.metricsToken)return c.notFound();
    const actual=createHash('sha256').update(c.req.header('authorization')??'').digest();
    const expected=createHash('sha256').update('Bearer '+operations.metricsToken).digest();
    if(!timingSafeEqual(actual,expected))return c.json({error:'Unauthorized'},401);
    return c.text(operations.metrics.render(),200,{'Content-Type':'text/plain; version=0.0.4; charset=utf-8'});
  });
  app.use('/v1/*',async(c,next)=>{
    if(operations.isDraining?.())return c.json({error:'Service unavailable'},503);
    await next();
  });
  // Limit all invalid/missing workspace credential attempts BEFORE parsing any body.
  // This process-local global bucket is intentionally not client-IP-based: arbitrary
  // forwarded headers are untrusted and trivial to spoof on an unconfigured proxy.
  app.use('/v1/*',async(c,next)=>{
    const auth=c.req.header('authorization')??'';
    const validFormat=/^Bearer am_[A-Za-z0-9_-]{32,}$/.test(auth);
    if(!validFormat){
      if(!invalidLimiter.allowInvalidAttempt())return c.json({error:'Too many invalid authorization attempts'},429);
      return c.json({error:'Unauthorized'},401);
    }
    const keyDigest=digest(auth.slice(7));
    const requestStore=store.forCredential?.(auth.slice(7))??store;
    const principal=await requestStore.authenticate(keyDigest);
    if(!principal){
      if(!invalidLimiter.allowInvalidAttempt())return c.json({error:'Too many invalid authorization attempts'},429);
      return c.json({error:'Unauthorized'},401);
    }
    if(!keyRoleAllowed(principal.accessRole,requiredKeyRole(c.req.method,c.req.path)))
      return c.json({error:'Forbidden for this API key role'},403);
    c.set('store',requestStore);
    c.set('workspaceId',principal.workspaceId);
    c.set('keyRole',principal.accessRole);
    c.set('keyDigest',keyDigest);
    await next();
  });
  app.use('/v1/*', bodyLimit({maxSize:256_000,onError:c=>c.json({error:'Payload too large'},413)}));
  app.get('/v1/prices',async c=>{
    const store=c.get('store');
    const workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.listPriceVersions)return c.json({error:'Pricing unavailable'},503);
    return c.json(await store.listPriceVersions(workspaceId));
  });
  app.post('/v1/prices',async c=>{
    const store=c.get('store');
    const creatorDigest=c.get('keyDigest');
    const workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.createPriceVersion)return c.json({error:'Pricing unavailable'},503);
    let payload:unknown;
    try{payload=await c.req.json();}catch{return c.json({error:'Invalid JSON'},400);}
    try {
      const row=parsePriceInput(payload);
      return c.json(await store.createPriceVersion(workspaceId,creatorDigest,row),201);
    } catch(err){
      if(err instanceof Error && err.message==='Pricing version exists')return c.json({error:err.message},409);
      if(err instanceof Error && /^(Invalid |Unexpected pricing|Rates must|A sourceNote)/.test(err.message))return c.json({error:err.message},400);
      throw err;
    }
  });
  app.get('/v1/analytics', async c=>{
    const store=c.get('store');
    const workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    const start=c.req.query('start'),end=c.req.query('end');
    if(!validTime(start)||!validTime(end)||Date.parse(start)>=Date.parse(end)) return c.json({error:'Invalid period'},400);
    if(Date.parse(end)-Date.parse(start)>366*86400000) return c.json({error:'Maximum period is 366 days'},400);
    if(!store.analytics)return c.json({error:'Analytics unavailable'},503);
    return c.json(await store.analytics(workspaceId,start,end));
  });
  // Paginated, full-workspace analytics. The summary is calculated on the server,
  // never inferred from a partial table page.
  app.get('/v1/analytics/page',async c=>{
    const store=c.get('store');
    const workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    const start=c.req.query('start'),end=c.req.query('end');
    if(!validTime(start)||!validTime(end)||Date.parse(start)>=Date.parse(end)||
      Date.parse(end)-Date.parse(start)>366*86400000)return c.json({error:'Invalid period'},400);
    const rawLimit=c.req.query('limit')??'50';
    if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(rawLimit))return c.json({error:'limit must be an integer from 1 to 100'},400);
    const rawCursor=c.req.query('cursor');
    let after:string|null=null;
    if(rawCursor!==undefined){
      if(!/^[A-Za-z0-9_-]{1,400}$/.test(rawCursor))
        return c.json({error:'Invalid pagination cursor'},400);
      const decoded=Buffer.from(rawCursor,'base64url');
      after=decoded.toString('utf8');
      if(decoded.toString('base64url')!==rawCursor||!validId(after))
        return c.json({error:'Invalid pagination cursor'},400);
    }
    if(!store.analyticsPage)return c.json({error:'Paginated analytics unavailable'},503);
    return c.json(await store.analyticsPage(workspaceId,start,end,after,Number(rawLimit)));
  });

  app.post('/v1/revenue/deliveries',async c=>{
    const store=c.get('store'),workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.enqueueRevenueDelivery)return c.json({error:'Durable revenue unavailable'},503);
    let payload:unknown;
    try{payload=await c.req.json();}catch{return c.json({error:'Invalid JSON'},400);}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return c.json({error:'Invalid delivery'},400);
    const raw=payload as Record<string,unknown>;
    if(typeof raw.providerEventId!=='string'||!/^evt_[A-Za-z0-9_]{1,196}$/.test(raw.providerEventId)||!validId(raw.providerAccount))
      return c.json({error:'Invalid delivery'},400);
    try{
      const record=parseRevenue(raw.record);
      return c.json(await store.enqueueRevenueDelivery(workspaceId,{providerEventId:raw.providerEventId,providerAccount:raw.providerAccount,record}),202);
    }catch(error){
      if(error instanceof Error&&error.message==='Idempotency conflict')return c.json({error:'Delivery ID reused with different payload'},409);
      if(error instanceof Error&&error.message==='Invalid revenue record')return c.json({error:error.message},400);
      throw error;
    }
  });
  app.post('/v1/revenue/adjustments/deliveries',async c=>{
    const store=c.get('store'),workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.enqueueAdjustmentDelivery)return c.json({error:'Adjustment delivery unavailable'},503);
    let payload:unknown;
    try{payload=await c.req.json();}catch{return c.json({error:'Invalid JSON'},400);}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return c.json({error:'Invalid delivery'},400);
    const raw=payload as Record<string,unknown>;
    if(typeof raw.providerEventId!=='string'||!/^evt_[A-Za-z0-9_]{1,196}$/.test(raw.providerEventId)||!validId(raw.providerAccount))
      return c.json({error:'Invalid delivery'},400);
    try{
      const record=parseAdjustment(raw.record);
      if(record.provider!=='stripe'||record.providerAccount!==raw.providerAccount)return c.json({error:'Invalid delivery account'},400);
      return c.json(await store.enqueueAdjustmentDelivery(workspaceId,{providerEventId:raw.providerEventId,providerAccount:raw.providerAccount,record}),202);
    }catch(error){
      if(error instanceof Error&&error.message==='Invalid adjustment')return c.json({error:error.message},400);
      if(error instanceof Error&&error.message==='Idempotency conflict')return c.json({error:'Delivery ID reused with different payload'},409);
      throw error;
    }
  });
  app.post('/v1/revenue/adjustments',async c=>{
    const store=c.get('store'),workspaceId=c.get('workspaceId');
    if(!limiter.allow(workspaceId))return c.json({error:'Rate limit exceeded'},429);
    if(!store.ingestAdjustments)return c.json({error:'Adjustments unavailable'},503);
    let payload:unknown;
    try{payload=await c.req.json();}catch{return c.json({error:'Invalid JSON'},400);}
    const records=(payload as {records?:unknown[]}|null)?.records;
    if(!Array.isArray(records)||records.length<1||records.length>100)return c.json({error:'records must contain 1-100 items'},400);
    try{
      const parsed=records.map(parseAdjustment);
      if(new Set(parsed.map(r=>r.id)).size!==parsed.length)return c.json({error:'Duplicate adjustment in request'},400);
      return c.json({...await store.ingestAdjustments(workspaceId,parsed),received:parsed.length},202);
    }catch(error){
      if(error instanceof Error&&error.message==='Invalid adjustment')return c.json({error:error.message},400);
      if(error instanceof Error&&error.message==='Idempotency conflict')return c.json({error:'Adjustment source reused with different payload'},409);
      const code=(error as {code?:string}).code;
      if(code==='23503')return c.json({error:'Original payment not found; retain and retry after payment ingestion'},409);
      if(code==='23514')return c.json({error:'Adjustment violates payment attribution or remaining amount'},409);
      throw error;
    }
  });
  app.post('/v1/revenue',async c=>{
    const store=c.get('store');
    const workspaceId=c.get('workspaceId');
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
    const store=c.get('store');
    const workspaceId = c.get('workspaceId');
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
        const available=await store.prices(workspaceId,entry.event.model,entry.event.occurredAt);
        const cost=calculateEventCost(entry.event,available);
        const chosen=available.find(p=>p.id===cost.priceVersionId);
        stored.push({event:entry.event,payloadDigest:entry.payloadDigest,costMicros:cost.amountMicros,source:cost.source,
          priceId:chosen?.scope==='workspace'?null:cost.priceVersionId,
          workspacePriceId:chosen?.scope==='workspace'?chosen.id:null});
      }
      const result=await store.ingest(workspaceId,stored);
      return c.json({ ...result, received:entries.length },202);
    } catch (error) {
      if (error instanceof Error && error.message === 'Idempotency conflict') return c.json({error:'Event ID reused with different payload'},409);
      if (error instanceof Error && /^(Invalid|Overlapping|Missing|Cost exceeds|reportedCost|cachedInput|inputTokens|outputTokens)/.test(error.message)) return c.json({error:error.message},400);
      throw error;
    }
  });
  app.onError((err,c)=>{
    const code=(err as Error&{code?:string}).code??'';
    if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','53300','57P01','57P02','57P03','57014'].includes(code))
      return c.json({error:'Service unavailable'},503);
    return c.json({error:'Internal server error'},500);
  });
  return app;
}

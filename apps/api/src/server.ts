import { serve } from '@hono/node-server';
import { createApp, type SafeRequestLog } from './app.ts';
import {OperationalMetrics} from './metrics.ts';
import { PostgresEventStore } from './postgres.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const port=Number(process.env.PORT ?? '8787');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const store=new PostgresEventStore(url);
// Explicit opt-in: only a fixed allowlist of request metadata reaches stdout.
const logSink=process.env.AGENTMARGIN_HTTP_LOGS==='json'
  ? (event:SafeRequestLog)=>{process.stdout.write(JSON.stringify(event)+'\n');}
  : undefined;
let draining=false;
const metrics=new OperationalMetrics();
// Idle socket errors must not become unhandled EventEmitter exceptions.
store.pool.on('error',()=>{process.stderr.write('{"kind":"database_pool_error"}\n');});
const app=createApp(store,undefined,undefined,logSink,{
  metrics,metricsToken:process.env.AGENTMARGIN_METRICS_TOKEN,isDraining:()=>draining,
  ready:()=>store.ready(),
});
const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'},()=>{
  process.stdout.write(`AgentMargin API listening on 127.0.0.1:${port}\n`);
});

async function shutdown():Promise<void>{
  if(draining)return;
  draining=true;
  // Fail readiness, stop accepting connections, then drain HTTP before DB sockets.
  const deadline=setTimeout(()=>{process.stderr.write('{"kind":"shutdown_timeout"}\n');process.exit(1);},30_000);
  deadline.unref();
  try{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await store.pool.end();
    clearTimeout(deadline);
  }catch{process.stderr.write('{"kind":"shutdown_failed"}\n');process.exitCode=1;}
}
process.once('SIGTERM',()=>{void shutdown();});
process.once('SIGINT',()=>{void shutdown();});

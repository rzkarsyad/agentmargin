import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { PostgresEventStore } from './postgres.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const port=Number(process.env.PORT ?? '8787');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const store=new PostgresEventStore(url);
serve({fetch:createApp(store).fetch,port,hostname:'127.0.0.1'},()=>{
  process.stdout.write(`AgentMargin API listening on 127.0.0.1:${port}\n`);
});

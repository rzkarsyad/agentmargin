import type pg from 'pg';

/** URL parsing must not silently downgrade certificate or hostname validation. */
export function validateDatabaseUrl(connectionString:string):void{
 let url:URL;
 try{url=new URL(connectionString);}catch{throw new Error('Invalid PostgreSQL connection configuration');}
 const parameters=[...url.searchParams.keys()];
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||new Set(parameters).size!==parameters.length||url.searchParams.has('host')||url.searchParams.has('hostaddr'))
   throw new Error('Invalid PostgreSQL connection configuration');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!local&&process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('PostgreSQL TLS verification must remain enabled');
 const mode=url.searchParams.get('sslmode');
 if((!local&&mode!=='verify-full')||(mode!==null&&!['verify-full','disable'].includes(mode))||(!local&&mode==='disable'))
   throw new Error('Non-loopback PostgreSQL requires sslmode=verify-full');
}

/** Check before any bearer bind, on EVERY checkout (including pooled reuse).
 * A trusted DBA/extension can still inspect process memory or change controls.
 */
export async function databaseSessionSafe(client:pg.PoolClient,requireTls=false):Promise<boolean>{
 const r=await client.query<{safe:boolean}>(`SELECT
   current_setting('log_parameter_max_length')='0'
   AND current_setting('log_parameter_max_length_on_error')='0'
   AND coalesce(current_setting('auto_explain.log_parameter_max_length',true),'0')='0'
   -- EXPLAIN VERBOSE can reveal literals in plans independently of bind logging.
   AND coalesce(current_setting('auto_explain.log_min_duration',true),'-1')='-1'
   AND coalesce(current_setting('pgaudit.log_parameter',true),'off')='off'
   AND (NOT $1::boolean OR coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false))
   AS safe`,[requireTls]);
 return r.rows[0]?.safe===true;
}

/** Read-only check against the same guarded disposable PG16 fixture as the suite. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {digest} from '../apps/api/src/app.ts';
const connectionString=process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
if(!connectionString)throw new Error('Synthetic database URL required');
const url=new URL(connectionString);
if(!['postgresql:','postgres:'].includes(url.protocol)||url.pathname!=='/agentmargin_ci'||!['127.0.0.1','localhost'].includes(url.hostname))
 throw new Error('Refusing non-synthetic database');
const pool=new pg.Pool({connectionString,max:1});
try{
 const key='am_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
 const sql=(await pool.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[key])).rows[0].hash;
 assert.equal(digest(key),sql,'API/PostgreSQL key digest compatibility changed');
 assert.equal(sql,'6504edf63ae19aeaf10b5cc6c1d074e3fb7e5c07717dea4cd46ca943e8eda703');
 process.stdout.write('PASS: existing API key SHA-256 UTF-8/hex format matches PostgreSQL 16.\n');
}finally{await pool.end();}

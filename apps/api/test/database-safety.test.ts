import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDatabaseUrl} from '../src/database-safety.ts';
test('remote PostgreSQL requires verified TLS without URL host overrides',()=>{
 for(const value of ['postgres://u:p@remote/db','postgres://u:p@remote/db?sslmode=require','postgres://u:p@remote/db?sslmode=verify-ca','postgres://u:p@127.0.0.1/db?host=remote',
   'postgres://u:p@remote/db?sslmode=verify-full&sslmode=no-verify','postgres://u:p@remote/db?sslmode=verify-full&sslmode=disable',
   'postgres://u:p@remote/db?sslmode=verify-full&sslmode=verify-ca&uselibpqcompat=true'])
   assert.throws(()=>validateDatabaseUrl(value));
 validateDatabaseUrl('postgres://u:p@db.example/db?sslmode=verify-full&sslrootcert=/private/ca.pem');
 validateDatabaseUrl('postgres://u:p@127.0.0.1/db');
});
test('malformed connection URLs cannot expose embedded credentials in errors',()=>{
 const secret='synthetic-not-a-real-secret';
 try{validateDatabaseUrl('postgres://user:'+secret+'@[broken/db');assert.fail('Malformed URL accepted');}
 catch(error){assert.ok(error instanceof Error);assert.ok(!error.message.includes(secret));assert.ok(!JSON.stringify(error).includes(secret));}
});

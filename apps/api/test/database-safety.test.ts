import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDatabaseUrl} from '../src/database-safety.ts';
test('remote PostgreSQL requires verified TLS without URL host overrides',()=>{
 for(const value of ['postgres://u:p@remote/db','postgres://u:p@remote/db?sslmode=require','postgres://u:p@remote/db?sslmode=verify-ca','postgres://u:p@127.0.0.1/db?host=remote'])
   assert.throws(()=>validateDatabaseUrl(value));
 validateDatabaseUrl('postgres://u:p@db.example/db?sslmode=verify-full&sslrootcert=/private/ca.pem');
 validateDatabaseUrl('postgres://u:p@127.0.0.1/db');
});

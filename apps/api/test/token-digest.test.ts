import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {digest} from '../src/app.ts';

test('256-bit bearer token digests preserve existing SHA-256 UTF-8/hex representation',()=>{
 const fixed='am_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
 assert.equal(digest(fixed),'6504edf63ae19aeaf10b5cc6c1d074e3fb7e5c07717dea4cd46ca943e8eda703');
 // The issuer contract is 32 random bytes, not a human-selected password.
 const raw=randomBytes(32),key='am_'+raw.toString('base64url');
 assert.equal(Buffer.from(key.slice(3),'base64url').length,32);
 assert.match(digest(key),/^[a-f0-9]{64}$/);
 assert.notEqual(digest(key),digest(key+'x'));
});

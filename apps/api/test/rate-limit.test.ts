import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceRateLimiter} from '../src/rate-limit.ts';

test('limits per workspace and resets at window boundary',()=>{
  let now=0;
  const limit=new WorkspaceRateLimiter(2,60_000,()=>now);
  assert.equal(limit.allow('a'),true);assert.equal(limit.allow('a'),true);
  assert.equal(limit.allow('a'),false);assert.equal(limit.allow('b'),true);
  now=60_000;assert.equal(limit.allow('a'),true);
});

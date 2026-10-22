// Verify the actual emitted ESM surface, not just TypeScript source imports.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdk=resolve(root,'packages/sdk');
for(const file of ['dist/index.js','dist/index.d.ts','dist/openai.js','dist/openai.d.ts','dist/anthropic.js','dist/anthropic.d.ts','dist/stripe.js','dist/stripe.d.ts']){
  assert.ok(existsSync(resolve(sdk,file)), 'SDK build missing '+file);
}
const packageJson=JSON.parse(readFileSync(resolve(sdk,'package.json'),'utf8'));
assert.equal(packageJson.exports['.'].import,'./dist/index.js');
const exported=await import(resolve(sdk,'dist/index.js'));
assert.equal(typeof exported.AgentMarginClient,'function');
assert.equal(typeof exported.stripeInvoicePaidToRevenue,'function');
assert.equal(typeof exported.fromAnthropicMessage,'function');
const client=new exported.AgentMarginClient({endpoint:'http://127.0.0.1:8787',apiKey:'am_'+'a'.repeat(40)});
assert.ok(client);
const json=JSON.parse(execFileSync('npm',['pack','--workspace','@makinohq/agentmargin','--dry-run','--json'],{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40_000,
}));
const packaged=new Set(json[0].files.map(f=>f.path));
for(const p of ['dist/index.js','dist/index.d.ts','dist/openai.js','dist/openai.d.ts','dist/anthropic.js','dist/anthropic.d.ts','dist/stripe.js','dist/stripe.d.ts','README.md','LICENSE']){
  assert.ok(packaged.has(p),'Published tarball lacks '+p);
}
assert.ok(![...packaged].some(x=>x.startsWith('src/')||x.startsWith('test/')),'Publish only compiled files');
console.log('PASS: SDK ESM import, declaration files and distributable package contents');

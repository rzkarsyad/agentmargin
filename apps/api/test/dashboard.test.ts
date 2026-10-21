import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

test('dashboard renders incomplete/truncated data without HTML injection or persisting keys',async()=>{
  const html=readFileSync(new URL('../src/dashboard.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'http://localhost:8787/dashboard',runScripts:'outside-only'});
  const {window}=dom;
  const script=dom.window.document.querySelector('script')?.textContent;
  assert.ok(script);
  const requested:string[]=[];
  window.fetch=async(input:RequestInfo|URL, init?:RequestInit)=>{
    requested.push(String(input));
    assert.match(String((init?.headers as Record<string,string>).authorization),/^Bearer am_/);
    return new Response(JSON.stringify({truncated:true,customers:[
      {customerId:'<img src=x onerror=alert(1)>',revenueMicros:'9007199254740993000000',knownAiCostMicros:'1000000',contributionMicros:null,marginBasisPoints:null,unknownEvents:1,usageEvents:1}
    ]}),{status:200});
  };
  window.eval(script);
  const key=window.document.getElementById('key') as HTMLInputElement;
  key.value='am_'+'q'.repeat(40);
  (window.document.getElementById('load') as HTMLButtonElement).click();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(requested.length,1);
  assert.match(window.document.getElementById('status')?.textContent??'',/Partial results/);
  assert.match(window.document.getElementById('revenue')?.textContent??'',/9,007,199,254,740,993/);
  assert.equal(window.document.querySelector('#rows img'),null);
  assert.match(window.document.getElementById('rows')?.textContent??'',/<img src=x/);
  assert.equal(window.localStorage.length,0);
  assert.equal(window.sessionStorage.length,0);
  dom.window.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {hasButtonLabelText,buttonLabelKey} from '../src/components/arc/button/label-content.ts';
test('literal markup-like labels remain visible text, distinct from icons',()=>{
 const icon=createElement('svg',null,createElement('title',null,'Save'),createElement('path',{d:'M0 0'}));
 assert.equal(hasButtonLabelText(icon),false);
 for(const label of ['<svg>','<<script>alert(1)</script>','<img src=x onerror=alert(1)>','<>','Save']){
  assert.equal(hasButtonLabelText(label),true);
  assert.notEqual(buttonLabelKey(label),buttonLabelKey(icon));
  const html=renderToStaticMarkup(createElement('button',null,label));
  assert.ok(!html.includes('<script>')&&!html.includes('<img '));
 }
});
test('nested React children, fragments, numeric labels and whitespace classify structurally',()=>{
 for(const child of [null,undefined,false,' \t\n',createElement(Fragment,null,' ',createElement('svg')),createElement('span',{'aria-hidden':true},'decorative')])
  assert.equal(hasButtonLabelText(child),false);
 for(const child of [0,0n,[' ',createElement('span',null,'Save')],createElement(Fragment,null,createElement('svg'),'Delete'),new Set([' ',0])])
  assert.equal(hasButtonLabelText(child),true);
 assert.notEqual(buttonLabelKey('0'),buttonLabelKey(0));
});
test('child inspection never executes custom components',()=>{
 let called=0;
 function Custom():never{called++;throw new Error('Inspection must not invoke a component');}
 const child=createElement(Custom,null,'Save');
 assert.equal(hasButtonLabelText(child),true);assert.ok(buttonLabelKey(child));assert.equal(called,0);
});

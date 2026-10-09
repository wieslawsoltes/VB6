import test from 'node:test';
import assert from 'node:assert/strict';
import {guardLinkedEditingCancellation} from '../src/editor/advanced/monaco-compat.js';

test('linked-editing adapter observes only its two owned promises and preserves real errors',async()=>{
  const contribution={_rangeUpdateTriggerPromise:null,_rangeSyncTriggerPromise:null},errors=[],editor={getContribution:id=>{assert.equal(id,'editor.contrib.linkedEditing');return contribution;}};
  guardLinkedEditingCancellation(editor,error=>errors.push(error));guardLinkedEditingCancellation(editor,error=>errors.push(error));
  const cancelled=Object.assign(new Error('Canceled'),{name:'Canceled'}),promise=Promise.reject(cancelled);
  contribution._rangeUpdateTriggerPromise=promise;assert.equal(contribution._rangeUpdateTriggerPromise,promise);
  const failure=new Error('Actual failure');contribution._rangeSyncTriggerPromise=Promise.reject(failure);
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(errors,[failure]);
});
test('a changed pinned contribution contract fails explicitly rather than silently disabling linked editing',()=>{
  assert.throws(()=>guardLinkedEditingCancellation({getContribution:()=>null},()=>{}),/unavailable/);
  assert.throws(()=>guardLinkedEditingCancellation({getContribution:()=>({})},()=>{}),/lifecycle changed/);
});

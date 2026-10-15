import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {capturePaintedFrame} = createRequire(import.meta.url)('../desktop/smoke.cjs');
const good = [{name:'body',expected:[32,32,32,255],actual:[32,32,32,255]}];
const old = [{name:'body',expected:[32,32,32,255],actual:[243,243,243,255]}];
const options = extra => ({label:'Fluent dark',settle:async()=>{},capture:async()=>Buffer.from('retained PNG'),inspect:async()=>good,...extra});

test('native paint capture retains the exact matching PNG, never a stale frame',async()=>{
  const order=[],attempts=[];let count=0;
  const result=await capturePaintedFrame(options({settle:async()=>{order.push('settle');},capture:async()=>{order.push('capture');return Buffer.from(String(++count));},inspect:async png=>{order.push('inspect');return png.toString()==='1'?old:good;},onAttempt:r=>attempts.push(r)}));
  assert.equal(result.png.toString(),'2');assert.equal(result.attempts,2);
  assert.deepEqual(order,['settle','capture','inspect','settle','capture','inspect']);
  assert.deepEqual(attempts.map(r=>r.matches),[false,true]);
});
test('native paint capture fails closed on persistent occlusion and retains observations',async()=>{
  let calls=0;
  await assert.rejects(capturePaintedFrame(options({inspect:async()=>{calls++;return old;},maxAttempts:3})),/Painted frame does not match Fluent dark:.*243/);
  assert.equal(calls,3);
});
test('native paint capture compares every channel of every probe exactly',async()=>{
  await assert.rejects(capturePaintedFrame(options({inspect:async()=>[...good,{name:'input',expected:[255,255,255,255],actual:[255,255,254,255]}],maxAttempts:1})),/Painted frame does not match/);
});
test('native paint capture bounds a stalled settle and cannot capture after late completion',{timeout:2000},async()=>{
  let complete,captures=0;
  await assert.rejects(capturePaintedFrame(options({settle:()=>new Promise(r=>{complete=r;}),capture:async()=>{captures++;},timeout:10})),/Timed out: Fluent dark/);
  complete();await new Promise(setImmediate);assert.equal(captures,0);
});
test('native paint capture bounds capture and inspection independently',{timeout:2000},async()=>{
  for(const method of ['capture','inspect'])await assert.rejects(capturePaintedFrame(options({[method]:()=>new Promise(()=>{}),timeout:10})),/Timed out: Fluent dark/);
});
test('native paint capture preserves original errors without retrying',async()=>{
  for(const method of ['settle','capture','inspect']){
    const failure=new Error(method);let calls=0;
    await assert.rejects(capturePaintedFrame(options({[method]:()=>{calls++;throw failure;}})),e=>e===failure);assert.equal(calls,1);
  }
});
test('native paint capture rejects invalid budgets, callbacks and empty pixel proofs',async()=>{
  for(const timeout of [0,-1,1.5,30001,NaN,Infinity])await assert.rejects(capturePaintedFrame(options({timeout})),TypeError);
  for(const maxAttempts of [0,-1,1.5,17,NaN])await assert.rejects(capturePaintedFrame(options({maxAttempts})),TypeError);
  for(const key of ['capture','settle','inspect','onAttempt'])await assert.rejects(capturePaintedFrame(options({[key]:null})),TypeError);
  for(const samples of [null,[],[{}],[{expected:[0,0,0,256],actual:[0,0,0,0]}]])await assert.rejects(capturePaintedFrame(options({inspect:()=>samples})),/Invalid painted-frame samples/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
const child=(id,extra={})=>({id,bounds:{width:20,height:20},...extra});

test('automatic grid children respect later explicit cell reservations',()=>{
  const e=new LayoutEngine([child('auto'),child('reserved',{gridRow:0,gridColumn:0})],{width:200,height:100,layout:'Grid',columns:2});
  e.arrange();
  assert.equal(e.getBounds('reserved').x,0);
  assert.equal(e.getBounds('auto').x,100);
});

test('automatic placement respects the full span of later explicit children',()=>{
  const e=new LayoutEngine([child('auto'),child('reserved',{gridRow:0,gridColumn:0,columnSpan:2,rowSpan:2})],{width:300,height:100,layout:'Grid',columns:3,rows:'20 20'});
  e.arrange();
  assert.equal(e.getBounds('auto').x,200);
  assert.equal(e.getBounds('auto').y,0);
});

test('fully explicit overlapping cells retain deliberate layering',()=>{
  const e=new LayoutEngine([child('a',{gridRow:0,gridColumn:0}),child('b',{gridRow:0,gridColumn:0}),child('auto')],{width:200,height:100,layout:'Grid',columns:2});
  e.arrange();
  assert.deepEqual(e.getBounds('a'),e.getBounds('b'));
  assert.equal(e.getBounds('auto').x,100);
});

test('hidden and ignored explicit children do not reserve cells',()=>{
  const e=new LayoutEngine([child('auto'),child('hidden',{gridRow:0,gridColumn:0,visible:false}),child('ignored',{gridRow:0,gridColumn:1,ignoreLayout:true})],{width:200,height:100,layout:'Grid',columns:2});
  e.arrange();assert.equal(e.getBounds('auto').x,0);
  e.update('hidden',{visible:true}).arrange();assert.equal(e.getBounds('auto').x,100);
  e.update('hidden',{visible:false}).arrange();assert.equal(e.getBounds('auto').x,0);
});

test('a failed oversized reservation rolls back the last valid rectangles',()=>{
  const e=new LayoutEngine([child('auto'),child('reserved',{gridRow:0,gridColumn:0})],{width:200,height:100,layout:'Grid',columns:2});
  e.arrange();const before=Array.from(e.rects);
  e.update('reserved',{gridRow:262143,rowSpan:2});
  assert.throws(()=>e.arrange(),/budget/);assert.deepEqual(Array.from(e.rects),before);
  e.update('reserved',{gridRow:1,rowSpan:1}).arrange();assert.equal(e.getBounds('auto').x,0);
});

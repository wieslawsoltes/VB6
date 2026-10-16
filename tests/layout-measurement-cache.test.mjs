import test from 'node:test';import assert from 'node:assert/strict';
let calls=0;globalThis.OffscreenCanvas=class{getContext(){return {font:'',measureText(text){calls++;return {width:text.length*5,fontBoundingBoxAscent:8,fontBoundingBoxDescent:2};}};}};
const {measureLayoutControl,clearLayoutMeasurements,layoutMeasurementCacheStats}=await import('../src/layout/measurement.js');
const label=(text,extra={})=>({type:'Label',properties:{Width:900,Height:450,Caption:text,LayoutWidthMode:1,...extra}});
test('fixed controls provide a real baseline when inherited alignment is used',()=>{
  clearLayoutMeasurements();const m=measureLayoutControl(label('fixed',{LayoutWidthMode:0}));assert.equal(m.preferredWidth,900);assert.equal(m.preferredHeight,450);assert.equal(m.baseline,120);
});
test('cached text metrics are immutable and reused',()=>{
  clearLayoutMeasurements();const m=measureLayoutControl(label('cached')),before=calls;assert.equal(measureLayoutControl(label('cached')),m);assert.equal(calls,before);assert.throws(()=>m.preferredWidth=0,TypeError);
});
test('measurement cache is bounded by both entries and estimated byte cost',()=>{
  clearLayoutMeasurements();for(let i=0;i<2000;i++)measureLayoutControl(label('word '+i+'x'.repeat(600)));
  let stats=layoutMeasurementCacheStats();assert.ok(stats.entries<=stats.maxEntries);assert.ok(stats.estimatedBytes<=stats.maxEstimatedBytes);
  const before=stats.estimatedBytes;measureLayoutControl(label('x'.repeat(600000)));stats=layoutMeasurementCacheStats();assert.ok(stats.estimatedBytes<=before);
  clearLayoutMeasurements();assert.equal(layoutMeasurementCacheStats().estimatedBytes,0);
});

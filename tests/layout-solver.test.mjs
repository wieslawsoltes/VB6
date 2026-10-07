import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutEngine,solveAnchor,parseAnchor,formatAnchor} from '../packages/auto-layout/src/index.js';
const bounds={x:20,y:30,width:40,height:25},base={width:100,height:100};
for(let mask=0;mask<16;mask++)test('anchor mask '+mask+' preserves baseline without drift',()=>{
  const e=new LayoutEngine([{id:'c',bounds,anchor:mask}],base);
  for(let i=0;i<1000;i++){
    const width=100+(i%11)*7,height=100+(i%13)*5;
    e.arrange(width,height);
    assert.deepEqual(e.getBounds('c'),solveAnchor(bounds,base,{width,height},mask));
  }
  e.arrange(100,100);assert.deepEqual(e.getBounds('c'),bounds);
});
test('none preserves center offset rather than centering the control',()=>{
  assert.deepEqual(solveAnchor(bounds,base,{width:201,height:153},0),{x:70.5,y:56.5,width:40,height:25});
});
test('clamping and zero size do not destroy remembered edge distances',()=>{
  const e=new LayoutEngine([{id:1,bounds,anchor:15,minWidth:10,minHeight:12,maxWidth:70}],base);
  e.arrange(0,0);assert.deepEqual(e.getBounds(1),{x:20,y:30,width:10,height:12});
  e.arrange(200,150);assert.deepEqual(e.getBounds(1),{x:20,y:30,width:70,height:75});
  e.arrange(100,100);assert.deepEqual(e.getBounds(1),bounds);
});
test('nested unsorted nodes solve relative to immediate parents',()=>{
  const e=new LayoutEngine([{id:'child',parent:'parent',bounds:{x:10,y:15,width:20,height:20},anchor:10},{id:'parent',bounds:{x:5,y:5,width:60,height:60},anchor:15}],base);
  e.arrange(160,130);assert.deepEqual(e.getBounds('parent'),{x:5,y:5,width:120,height:90});assert.deepEqual(e.getBounds('child'),{x:70,y:45,width:20,height:20});
});
test('explicit rebase changes only the edited node baseline',()=>{
  const e=new LayoutEngine([{id:1,bounds,anchor:10}],base);e.arrange(200,200);
  e.rebase(1,{x:50,y:60,width:50,height:50},{width:200,height:200}).arrange(240,220);
  assert.deepEqual(e.getBounds(1),{x:90,y:80,width:50,height:50});
});
test('stable no-op pass and reusable result buffers',()=>{
  const e=new LayoutEngine([{id:1,bounds}],base),result=e.arrange();assert.equal(result.changedCount,1);
  assert.equal(e.arrange(),result);assert.equal(result.changedCount,0);assert.equal(result.visited,0);
  e.arrange(101,100);assert.equal(result.visited,1);assert.equal(result.changedCount,0);
});
test('invalid graph updates are atomic',()=>{
  const e=new LayoutEngine([{id:1,bounds}],base);e.arrange();
  for(const nodes of [[{id:1,parent:1}], [{id:1,parent:2},{id:2,parent:1}], [{id:1,parent:'missing'}], [{id:1},{id:1}], [{id:1,bounds:{width:NaN}}]])assert.throws(()=>e.setNodes(nodes));
  e.arrange();assert.deepEqual(e.getBounds(1),bounds);
});
test('10,000-deep tree uses iterative traversal',()=>{
  const e=new LayoutEngine(Array.from({length:10000},(_,i)=>({id:i,parent:i?i-1:null,bounds:{width:100,height:100},anchor:15})),base);assert.equal(e.arrange(110,120).visited,10000);assert.deepEqual(e.getBounds(9999),{x:0,y:0,width:110,height:120});
});
test('docking, visibility and padding',()=>{
  const e=new LayoutEngine([{id:1,dock:'Top',bounds:{height:10}},{id:2,dock:'Left',bounds:{width:20}},{id:3,dock:'Fill'},{id:4,dock:'Bottom',visible:false,bounds:{height:60}}],{width:100,height:100,padding:5});e.arrange();
  assert.deepEqual(e.getBounds(1),{x:5,y:5,width:90,height:10});assert.deepEqual(e.getBounds(2),{x:5,y:15,width:20,height:80});assert.deepEqual(e.getBounds(3),{x:25,y:15,width:70,height:80});
});
test('flex grows, freezes at a maximum and redistributes',()=>{
  const e=new LayoutEngine([{id:1,bounds:{width:20,height:10},grow:1,maxWidth:30},{id:2,bounds:{width:20,height:10},grow:1}],{width:100,height:30,layout:'Horizontal',gap:10});e.arrange();
  assert.deepEqual(e.getBounds(1),{x:0,y:0,width:30,height:10});assert.deepEqual(e.getBounds(2),{x:40,y:0,width:60,height:10});
});
test('flex shrinks with minimums, margins and stretch',()=>{
  const e=new LayoutEngine([{id:1,bounds:{width:80,height:10},minWidth:60,align:'stretch',margin:5},{id:2,bounds:{width:80,height:10}}],{width:120,height:50,layout:'Horizontal'});e.arrange();
  assert.deepEqual(e.getBounds(1),{x:5,y:5,width:60,height:40});assert.deepEqual(e.getBounds(2),{x:70,y:0,width:50,height:10});
});
test('vertical layout and end justification',()=>{
  const e=new LayoutEngine([{id:1,bounds:{width:20,height:10},shrink:0,align:'center'},{id:2,bounds:{width:20,height:20},shrink:0,align:'end'}],{width:100,height:100,layout:'Vertical',gap:5,justify:'end'});e.arrange();
  assert.deepEqual(e.getBounds(1),{x:40,y:65,width:20,height:10});assert.deepEqual(e.getBounds(2),{x:80,y:80,width:20,height:20});
});
test('wrapping lays out successive lines without overlap',()=>{
  const e=new LayoutEngine(Array.from({length:4},(_,id)=>({id,bounds:{width:40,height:10}})),{width:90,height:100,layout:'Wrap',gap:5});e.arrange();
  assert.deepEqual(e.getBounds(0),{x:0,y:0,width:40,height:10});assert.deepEqual(e.getBounds(3),{x:45,y:15,width:40,height:10});
});
test('input records are detached from caller mutation',()=>{
  const n={id:1,bounds:{...bounds}},e=new LayoutEngine([n],base);n.bounds.width=900;e.update(1,{anchor:15}).arrange();assert.equal(e.getBounds(1).width,40);
});
test('anchor parser rejects invalid flags and accepts named combinations',()=>{
  assert.equal(parseAnchor('vbAnchorLeft Or vbAnchorRight Or vbAnchorTop'),13);assert.equal(parseAnchor('AnchorStyles.All'),15);assert.equal(parseAnchor('0'),0);
  for(let a=0;a<16;a++)assert.equal(parseAnchor(formatAnchor(a)),a);
  for(const a of [-1,16,1.5,NaN,'Nope','Left,',true])assert.throws(()=>parseAnchor(a));
});
test('property updates preserve graph buffers and child baselines; failures are atomic',()=>{
 const e=new LayoutEngine([{id:1,bounds:{x:0,y:0,width:100,height:100}},{id:2,parent:1,bounds:{x:10,y:10,width:20,height:20},anchor:10}],{width:200,height:200}),result=e.arrange(),rects=result.rects,graph=e.children;
 e.update(1,{bounds:{width:150}}).arrange();assert.equal(e.arrange(),result);assert.equal(e.rects,rects);assert.equal(e.children,graph);assert.equal(e.getBounds(2).x,60);assert.equal(result.changedCount,0);
 assert.throws(()=>e.update(1,{minWidth:900,maxWidth:800}));e.arrange();assert.equal(e.getBounds(1).width,150);
 e.configure({layout:'Horizontal',gap:5}).arrange();assert.equal(e.rects,rects);assert.throws(()=>e.configure({gap:NaN}));assert.equal(e.options.gap,5);
});

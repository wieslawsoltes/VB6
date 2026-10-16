import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
import {normalizeTracks} from '../packages/auto-layout/src/advanced.js';
const child=(id,extra={})=>({id,bounds:{width:20,height:20},...extra});
const grid=(nodes,options={})=>{const e=new LayoutEngine(nodes,{width:300,height:120,layout:'Grid',columns:3,rows:'20 20 20',...options});e.arrange();return e;};

test('column flow transposes automatic placement and preserves authored child order',()=>{
  const e=grid(Array.from({length:4},(_,i)=>child(i)),{gridAutoFlow:'column',rows:'20 20'});
  assert.deepEqual(e.getGridLayout().cells.map(c=>[c.row,c.column]),[[0,0],[1,0],[0,1],[1,1]]);
  assert.deepEqual(e.nodes.map(n=>n.id),[0,1,2,3]);
});
for(const flow of ['row','column'])test(flow+' dense fills holes without reordering records',()=>{
  const vertical=flow==='column',span=vertical?'rowSpan':'columnSpan';
  const nodes=[child('a',{[span]:2}),child('b',{[span]:2}),child('c')];
  const sparse=grid(nodes,{gridAutoFlow:flow}),dense=grid(nodes,{gridAutoFlow:flow+' dense'});
  const a=sparse.getGridLayout().cells[2],b=dense.getGridLayout().cells[2];
  assert.deepEqual([a.row,a.column],vertical?[2,1]:[1,2]);
  assert.deepEqual([b.row,b.column],vertical?[2,0]:[0,2]);
});
test('explicit coordinates and spans create implicit fractional columns, not clamping',()=>{
  const e=grid([child('far',{gridRow:0,gridColumn:3,widthMode:'fill'})],{columns:2});
  assert.equal(e.getGridLayout().columns.length,4);assert.equal(e.getBounds('far').x,225);assert.equal(e.getBounds('far').width,75);
  assert.equal(e.getGridLayout().columns[3].implicit,true);
});
test('row-locked automatic column never silently changes the requested row',()=>{
  const e=grid([child('a',{gridRow:0,columnSpan:3}),child('b',{gridRow:0,columnSpan:2})]);
  assert.deepEqual(e.getGridLayout().cells.map(c=>[c.row,c.column]),[[0,0],[0,3]]);assert.equal(e.getGridLayout().columns.length,5);
});
test('empty root and nested grids expose every authored track',()=>{
  const e=grid([child('nested',{layout:'Grid',columns:'10 20',rows:'5 15',gridColumn:0,gridRow:0})]);
  assert.deepEqual(e.getGridLayout('nested').columns.map(t=>t.size),[10,20]);
  assert.equal(e.getGridLayout('nested').cells.length,0);
  const empty=grid([],{columns:'30 40',rows:'10 15'});assert.equal(empty.getGridLayout().columns.length,2);assert.equal(empty.getGridLayout().rows.length,2);
});
test('empty Hug grids measure fixed track sizes, gaps and padding',()=>{
  const e=grid([],{columns:'30 40',rows:'10 15',gap:5,crossGap:7,padding:3,widthMode:'hug',heightMode:'hug'});
  assert.equal(e.getRootBounds().width,81);assert.equal(e.getRootBounds().height,38);
});
test('grid snapshot ownership and rollback include empty tracks',()=>{
  const e=grid([child('a')]),original=e.getGridLayout(),copy=e.getGridLayout();copy.columns[0].size=999;copy.cells[0].column=99;
  assert.deepEqual(e.getGridLayout(),original);
  e.update('a',{gridColumn:1023,columnSpan:2});assert.throws(()=>e.arrange(),/budget/);assert.deepEqual(e.getGridLayout(),original);
  e.update('a',{gridColumn:0,columnSpan:1}).arrange();assert.equal(e.getGridLayout().cells[0].column,0);
});
test('grid distributes tracks rather than treating space-between as cell end alignment',()=>{
  const e=grid([child('a'),child('b')],{columns:'30 40',rows:'20',justify:'space-between'});
  assert.deepEqual(e.getGridLayout().columns.map(t=>t.start),[0,260]);assert.equal(e.getBounds('a').x,0);assert.equal(e.getBounds('b').x,260);
});
test('capped spanning Hug tracks redistribute unused growth',()=>{
  const e=grid([child('wide',{bounds:{width:100,height:20},columnSpan:2})],{columns:[{size:'hug',max:10},'hug'],rows:'20'});
  assert.deepEqual(e.getGridLayout().columns.map(t=>t.size),[10,90]);
});
test('grid baseline rows reserve ascent plus descent',()=>{
  const e=grid([child('a',{baseline:18}),child('b',{bounds:{width:20,height:30},baseline:8})],{columns:2,rows:'hug',alignItems:'baseline'});
  assert.equal(e.getGridLayout().rows[0].size,40);assert.equal(e.getBounds('a').y+18,e.getBounds('b').y+8);
});
test('repeat/minmax syntax is nested, whitespace aware, and bounded',()=>{
  const tracks=normalizeTracks('repeat(2, 10 minmax(20, 2fr)) hug');
  assert.equal(tracks.length,5);assert.equal(tracks[1].min,20);assert.equal(tracks[1].value,2);
  assert.equal(normalizeTracks('repeat(2, repeat(2, 1fr))').length,4);
  for(const value of ['repeat(0,1fr)','repeat(1024,repeat(2,1fr))','repeat(2,1fr','minmax(40,20)','repeat(2,process.exit())'])assert.throws(()=>normalizeTracks(value));
  const cyclic={};cyclic.size=cyclic;assert.throws(()=>normalizeTracks([cyclic]),/size/);
});
test('dense repeated one-cell placement is bounded and unique at 10,000 children',()=>{
  const e=grid(Array.from({length:10000},(_,i)=>child(i)),{columns:100,rows:'',gridAutoFlow:'row dense'}),cells=e.getGridLayout().cells;
  assert.equal(new Set(cells.map(c=>c.row*1024+c.column)).size,10000);assert.equal(e.gridCache.get(e.count).probes<50000,true);
});

test('grid cross-axis Stretch grows only Hug tracks and respects caps',()=>{
  const e=grid([child('a'),child('b',{gridRow:1,gridColumn:0})],{columns:1,rows:[{size:'hug',max:30},'hug',10],height:120,alignContent:'stretch'});
  assert.deepEqual(e.getGridLayout().rows.map(t=>t.size),[30,80,10]);
  assert.equal(e.getGridLayout().rows[0].max,30);
  e.configure({height:25}).arrange();assert.deepEqual(e.getGridLayout().rows.map(t=>t.size),[20,20,10]);
});

test('ordinary anchor passes reuse empty metadata and remove obsolete grids',()=>{
  const e=new LayoutEngine([child('a')],{width:100,height:100});const map=e.gridLayouts;
  e.arrange();assert.equal(e.gridLayouts,map);e.arrange(120,120);assert.equal(e.gridLayouts,map);
  e.configure({layout:'Grid',columns:2}).arrange();assert.equal(e.getGridLayout().columns.length,2);
  e.configure({layout:'Absolute'}).arrange();assert.equal(e.getGridLayout(),null);
});

test('column packing with no authored rows adds implicit columns for remaining children',()=>{
  const e=grid([child('a'),child('b'),child('c')],{columns:'repeat(2, minmax(30, 1fr))',rows:'',gridAutoFlow:'column dense'});
  assert.deepEqual(e.getGridLayout().cells.map(c=>[c.row,c.column]),[[0,0],[0,1],[0,2]]);
  assert.deepEqual(e.getGridLayout().columns.map(c=>c.implicit),[false,false,true]);
});

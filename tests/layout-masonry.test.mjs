import test from 'node:test';import assert from 'node:assert/strict';
import {LayoutEngine,LayoutMode} from '../packages/auto-layout/src/index.js';
const card=(id,height,extra={})=>({id,bounds:{width:30,height},widthMode:'fill',...extra});
test('masonry chooses the shortest lane while preserving declaration order',()=>{
 const e=new LayoutEngine([card('a',40),card('b',20),card('c',30),card('d',10)],{layout:'Masonry',columns:2,width:210,height:100,gap:10});e.arrange();
 assert.deepEqual(e.nodes.map(n=>n.id),['a','b','c','d']);assert.deepEqual(e.nodes.map(n=>{const b=e.getBounds(n.id);return [b.x,b.y,b.width,b.height];}),[[0,0,100,40],[110,0,100,20],[110,30,100,30],[0,50,100,10]]);
 assert.equal(e.getMasonryLayout().contentHeight,60);assert.equal(e.getGridLayout(),null);
});
test('masonry spans use the highest occupied lane and never overlap earlier cards',()=>{
 const e=new LayoutEngine([card('a',40,{columnSpan:2}),card('b',20),card('c',10,{columnSpan:2})],{layout:'Masonry',columns:3,width:320,height:100,gap:10});e.arrange();
 assert.deepEqual(e.getMasonryLayout().cells.map(c=>[c.lane,c.laneSpan,c.y]),[[0,2,0],[2,1,0],[0,2,50]]);assert.equal(e.getBounds('a').width,210);
});
test('masonry responsive lanes, named placement and RTL are resolved at each size',()=>{
 const e=new LayoutEngine([card('a',40,{gridColumnStart:'lane 2'}),card('b',20)],{layout:'Masonry',columns:'repeat(auto-fill,[lane] minmax(100,1fr))',width:440,height:100,gap:10,direction:'rtl'});e.arrange();
 assert.equal(e.getMasonryLayout().lanes.length,4);assert.equal(e.getMasonryLayout().cells[0].lane,1);
 e.arrange(220,100);assert.equal(e.getMasonryLayout().lanes.length,2);assert.equal(e.getBounds('a').x,0);
});
test('horizontal masonry uses row tracks and intrinsic width on the stacking axis',()=>{
 const e=new LayoutEngine([card('a',20,{widthMode:'fixed',heightMode:'fill',bounds:{width:40,height:20}}),card('b',20,{widthMode:'fixed',heightMode:'fill',bounds:{width:20,height:20}}),card('c',20,{widthMode:'fixed',heightMode:'fill',bounds:{width:30,height:20}})],{layout:'HorizontalMasonry',rows:2,width:200,height:110,gap:10});e.arrange();
 assert.deepEqual(e.getMasonryLayout().cells.map(c=>[c.lane,c.x,c.y]),[[0,0,0],[1,0,60],[1,30,60]]);assert.equal(e.getMasonryLayout().contentWidth,60);
});
test('empty masonry and Hug content report actual lane and content extents',()=>{
 const e=new LayoutEngine([card('a',40),card('b',20)],{layout:'Masonry',columns:'100 100',width:210,height:0,heightMode:'hug',gap:10,padding:[5,0]});e.arrange();assert.equal(e.getRootBounds().height,50);
 e.setNodes([]).arrange();assert.equal(e.getMasonryLayout().cells.length,0);assert.equal(e.getRootBounds().height,10);
});
test('invalid stacking-axis constraints roll back geometry and both snapshot APIs',()=>{
 const e=new LayoutEngine([card('a',40)],{layout:'Masonry',width:210,height:100,columns:2});e.arrange();const before=e.getMasonryLayout(),r=Array.from(e.rects);
 e.update('a',{gridRow:1});assert.throws(()=>e.arrange(),/stacking axis/);assert.deepEqual(e.getMasonryLayout(),before);assert.deepEqual(Array.from(e.rects),r);
 e.update('a',{gridRow:undefined}).arrange();const g=e.getMasonryLayout();g.lanes[0].size=999;assert.notEqual(e.getMasonryLayout().lanes[0].size,999);
});
test('masonry lane assignments do not reserve space for hidden, docked or ignored cards',()=>{
 const e=new LayoutEngine([card('a',40,{visible:false}),card('b',20,{ignoreLayout:true}),card('c',20)],{layout:'Masonry',columns:2,width:220,height:100});e.arrange();assert.equal(e.getMasonryLayout().cells.length,1);assert.equal(e.getBounds('c').y,0);
});
test('masonry has stable public mode constants and bounded dense packing',()=>{
 assert.equal(LayoutMode.Masonry,6);assert.equal(LayoutMode.HorizontalMasonry,7);
 const e=new LayoutEngine(Array.from({length:10000},(_,i)=>card(i,10+i%4)),{layout:'Masonry',columns:20,width:2000,height:600});e.arrange();assert.equal(e.getMasonryLayout().cells.length,10000);assert.equal(e.arrange().passes,0);
});
test('empty masonry Hug dimensions include explicit lanes and padding',()=>{
 const e=new LayoutEngine([],{layout:'Masonry',widthMode:'hug',heightMode:'hug',width:0,height:0,columns:'40 50',gap:10,padding:5});e.arrange();assert.deepEqual(e.getRootBounds(),{x:0,y:0,width:110,height:10});
 const h=new LayoutEngine([],{layout:'HorizontalMasonry',widthMode:'hug',heightMode:'hug',width:0,height:0,rows:'40 50',gap:10,padding:5});h.arrange();assert.deepEqual(h.getRootBounds(),{x:0,y:0,width:10,height:110});
});
test('horizontal RTL masonry keeps margins physical and mirrors stacking start',()=>{
 const e=new LayoutEngine([card('a',20,{widthMode:'fixed',heightMode:'fill',bounds:{width:40,height:20},margin:{left:3,right:9}})],{layout:'HorizontalMasonry',rows:1,width:200,height:100,direction:'rtl'});e.arrange();assert.equal(e.getBounds('a').x,151);assert.equal(e.getMasonryLayout().contentWidth,52);
});
test('masonry mode metadata stays project-gated and rejects native export',async()=>{
 const {layoutType}=await import('../src/layout/intelligence.js');const {layoutProperty,LAYOUT_CHOICES}=await import('../src/layout/contract.js');
 assert.equal(layoutProperty('LayoutMode','Masonry'),6);assert.equal(LAYOUT_CHOICES.LayoutMode[7],'Horizontal Masonry');assert.equal(layoutType({settings:{}},'LayoutMode'),null);
 assert.ok(layoutType({settings:{anchoring:true}},'LayoutMode').members.some(s=>s.name==='vbLayoutHorizontalMasonry'&&s.value===7));
});
test('masonry randomized rectangles do not overlap and lane snapshots are detached',()=>{
 let seed=27;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(const direction of ['ltr','rtl'])for(let trial=0;trial<20;trial++){
  const nodes=Array.from({length:60},(_,i)=>card(i,5+Math.floor(rnd()*45),{columnSpan:1+Math.floor(rnd()*3)}));const e=new LayoutEngine(nodes,{layout:'Masonry',columns:5,width:500,height:200,gap:3,crossGap:7,direction});e.arrange();const g=e.getMasonryLayout();
  for(let i=0;i<g.cells.length;i++)for(let j=0;j<i;j++){const a=g.cells[i],b=g.cells[j];assert.ok(a.x+a.width<=b.x+1e-9||b.x+b.width<=a.x+1e-9||a.y+a.height<=b.y+1e-9||b.y+b.height<=a.y+1e-9);}
  g.lanes[0].names.push('mutated');assert.equal(e.getMasonryLayout().lanes[0].names.includes('mutated'),false);
 }
});
test('mode bookkeeping avoids scanning every node just to select an arrange path',()=>{
 const e=new LayoutEngine([{id:'child',bounds:{width:30,height:20}}],{width:100,height:100});e.data.mode.includes=()=>{throw new Error('Unexpected whole-mode scan');};
 e.arrange();e.update('child',{layout:'Grid'}).arrange();assert.equal(e.modeCounts[5],1);assert.ok(e.getGridLayout('child'));
 const before=Array.from(e.modeCounts);assert.throws(()=>e.update('child',{layout:9}));assert.deepEqual(Array.from(e.modeCounts),before);
 e.configure({layout:'HorizontalMasonry'}).arrange();assert.equal(e.modeCounts[7],1);e.setNodes([]).arrange();assert.equal(e.modeCounts[5],0);assert.equal(e.modeCounts[7],1);
 e.configure({layout:'Absolute'}).arrange();assert.equal(e.getMasonryLayout(),null);assert.equal(e.modeCounts[0],1);
});

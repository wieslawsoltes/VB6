import test from 'node:test';import assert from 'node:assert/strict';
import {LayoutEngine,LayoutMode} from '../packages/auto-layout/src/index.js';
import {distribute,normalizeTracks} from '../packages/auto-layout/src/advanced.js';
const node=(id,width=40,height=20,extra={})=>({id,bounds:{x:0,y:0,width,height},shrink:0,...extra});
const eq=(e,id,b)=>assert.deepEqual(e.getBounds(id),b);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('advanced modes preserve existing numeric identifiers',()=>{assert.deepEqual(LayoutMode,{Absolute:0,Horizontal:1,Vertical:2,Wrap:3,VerticalWrap:4,Grid:5});});
test('nested Hug containers measure from leaves without overwriting authored bounds',()=>{
 const e=new LayoutEngine([node('p',200,100,{layout:1,widthMode:'hug',heightMode:'hug',padding:[5,10,15,20],gap:7}),node('a',40,20,{parent:'p'}),node('b',60,30,{parent:'p'})],{width:500,height:400});
 e.arrange();eq(e,'p',{x:0,y:0,width:137,height:50});eq(e,'a',{x:20,y:5,width:40,height:20});eq(e,'b',{x:67,y:5,width:60,height:30});assert.equal(e.nodes[0].bounds.width,200);
 e.update('a',{bounds:{width:90}}).arrange();assert.equal(e.getBounds('p').width,187);
});
for(const axis of ['width','height'])test('Fill '+axis+' honors min/max and redistributes',()=>{
 const horizontal=axis==='width',e=new LayoutEngine([node(1,20,20,{[axis+'Mode']:'fill',['max'+axis[0].toUpperCase()+axis.slice(1)]:30}),node(2,20,20,{[axis+'Mode']:'fill'})],{width:100,height:100,layout:horizontal?1:2,gap:10});e.arrange();close(e.getBounds(1)[axis],30);close(e.getBounds(2)[axis],60);
});
test('Fill cross axis and ignored absolute child do not affect Hug',()=>{
 const e=new LayoutEngine([node('p',200,100,{layout:2,heightMode:'hug',padding:5,gap:10}),node('a',40,20,{parent:'p',widthMode:'fill'}),node('overlay',900,900,{parent:'p',ignoreLayout:true}),node('hidden',900,900,{parent:'p',visible:false})],{width:400,height:300});e.arrange();eq(e,'a',{x:5,y:5,width:190,height:20});assert.equal(e.getBounds('p').height,30);assert.equal(e.getBounds('overlay').width,900);
});
for(const mode of [3,4])test('wrap mode '+mode+' has independent main/cross gaps and Hug cross size',()=>{
 const vertical=mode===4,children=Array.from({length:4},(_,id)=>node(id,vertical?10:40,vertical?40:10,{parent:'p'}));
 const e=new LayoutEngine([node('p',vertical?100:90,vertical?90:100,{layout:mode,[vertical?'widthMode':'heightMode']:'hug',gap:5,crossGap:13}),...children],{width:300,height:300});e.arrange();
 eq(e,3,{x:vertical?23:45,y:vertical?45:23,width:vertical?10:40,height:vertical?40:10});close(e.getBounds('p')[vertical?'width':'height'],33);
});
test('Hug wrapping respects a finite maximum main dimension',()=>{
 const e=new LayoutEngine([node('p',500,100,{layout:3,widthMode:'hug',heightMode:'hug',maxWidth:100,gap:5}),...Array.from({length:4},(_,id)=>node(id,40,10,{parent:'p'}))],{width:500,height:400});e.arrange();eq(e,'p',{x:0,y:0,width:85,height:25});
});
test('Hug/Fill circular axes use the authored parent dimension deterministically',()=>{
 const e=new LayoutEngine([node('p',200,100,{layout:1,widthMode:'hug',heightMode:'hug'}),node('c',50,20,{parent:'p',widthMode:'fill'})],{width:500,height:400});e.arrange();assert.equal(e.getBounds('p').width,200);assert.equal(e.getBounds('c').width,200);assert.equal(e.getBounds('p').height,20);
});
test('root Hug follows intrinsic children and preserves passed available size',()=>{
 const e=new LayoutEngine([node(1),node(2,20,30)],{width:500,height:200,layout:1,gap:5,widthMode:'hug',heightMode:'hug',padding:10});e.arrange();assert.deepEqual(e.getRootBounds(),{x:0,y:0,width:85,height:50});assert.equal(e.arrange().visited,0);
});
test('baseline ascent plus descent determines natural Hug line height',()=>{
 const e=new LayoutEngine([node('p',100,100,{layout:1,heightMode:'hug',alignItems:'baseline'}),node('a',20,20,{parent:'p',baseline:18}),node('b',20,30,{parent:'p',baseline:8})],{width:200,height:100});e.arrange();close(e.getBounds('p').height,40);close(e.getBounds('a').y+18,e.getBounds('b').y+8);close(e.getBounds('b').y,10);
});
test('signed manual gaps overlap controls without changing authored bounds',()=>{
 const e=new LayoutEngine([node(1),node(2)],{width:200,height:100,layout:1,gap:-10});e.arrange();assert.equal(e.getBounds(2).x,30);e.configure({gap:0}).arrange();assert.equal(e.getBounds(2).x,40);
});
for(const alignContent of ['center','end','space-between','space-around','space-evenly','stretch'])test('wrapped line distribution '+alignContent,()=>{
 const e=new LayoutEngine([node(1,60,10),node(2,60,10)],{width:100,height:100,layout:3,crossGap:10,alignContent});e.arrange();const a=e.getBounds(1),b=e.getBounds(2);assert.ok(a.y>=0&&b.y>a.y&&b.y+b.height<=100);if(alignContent==='space-between')close(b.y,90);if(alignContent==='center')close(a.y,35);if(alignContent==='end')close(a.y,70);
});
test('intrinsic callback remeasures against allocated Fill width',()=>{
 const seen=[],e=new LayoutEngine([node('p',200,100,{layout:2,heightMode:'hug',padding:10}),node('text',20,10,{parent:'p',widthMode:'fill',heightMode:'hug',measure:c=>{seen.push(c.width);return {height:Math.ceil(900/Math.max(1,c.width))*10,width:900,baseline:8};}})],{width:300,height:400});e.arrange();close(e.getBounds('text').width,180);close(e.getBounds('text').height,50);close(e.getBounds('p').height,70);assert.ok(seen.includes(180));const count=seen.length;e.arrange();assert.equal(seen.length,count);
});
test('bad or oscillating intrinsic callbacks leave the last valid geometry intact',()=>{
 const e=new LayoutEngine([node(1,40,20,{widthMode:'hug',measure:()=>({width:50})})],{width:100,height:100});e.arrange();const old=e.getBounds(1);e.update(1,{measure:()=>({width:NaN})});assert.throws(()=>e.arrange(),/measured/);assert.deepEqual(e.getBounds(1),old);
 let alternate=0;e.update(1,{measure:()=>({width:++alternate%2?20:30})});assert.throws(()=>e.arrange(),/converge/);assert.deepEqual(e.getBounds(1),old);e.update(1,{measure:()=>({width:70})});e.arrange();assert.equal(e.getBounds(1).width,70);
});
test('grid combines fixed, Hug, and proportional fraction tracks',()=>{
 const e=new LayoutEngine([node(1,10,20,{widthMode:'fill'}),node(2,40,20,{widthMode:'fill'}),node(3,10,20,{widthMode:'fill'})],{width:300,height:100,layout:5,columns:'50 hug 1fr',gap:10});e.arrange();eq(e,1,{x:0,y:0,width:50,height:20});eq(e,2,{x:60,y:0,width:40,height:20});eq(e,3,{x:110,y:0,width:190,height:20});
});
test('grid fraction rows and columns use independently weighted available space',()=>{
 const e=new LayoutEngine(Array.from({length:4},(_,i)=>node(i,1,1,{widthMode:'fill',heightMode:'fill'})),{width:310,height:210,layout:5,columns:'1fr 2fr',rows:'1fr 3fr',gap:10,crossGap:10});e.arrange();eq(e,3,{x:110,y:60,width:200,height:150});
});
test('grid span reserves cells and moves following items into the next row',()=>{
 const e=new LayoutEngine([node(0,1,10,{columnSpan:2,widthMode:'fill'}),node(1,1,10,{widthMode:'fill'}),node(2,1,10,{widthMode:'fill'})],{width:300,height:100,layout:5,columns:3,gap:0,crossGap:7});e.arrange();eq(e,0,{x:0,y:0,width:200,height:10});eq(e,1,{x:200,y:0,width:100,height:10});eq(e,2,{x:0,y:17,width:100,height:10});
});
test('grid explicit cell and spanning intrinsic rows preserve preferred extents',()=>{
 const e=new LayoutEngine([node(0,80,60,{gridColumn:1,gridRow:1,rowSpan:2}),node(1,30,20)],{width:200,height:300,layout:5,columns:'hug hug',rows:'hug',gap:5,crossGap:10});e.arrange();eq(e,0,{x:35,y:30,width:80,height:60});assert.equal(e.getBounds(1).y,0);
});
test('grid cell self alignment overrides container values without affecting siblings',()=>{
 const e=new LayoutEngine([node(0,20,10,{justifySelf:'end',align:'center'}),node(1,20,10,{widthMode:'fill',heightMode:'fill'})],{width:200,height:80,layout:5,columns:2,rows:'1fr'});e.arrange();eq(e,0,{x:80,y:35,width:20,height:10});eq(e,1,{x:100,y:0,width:100,height:80});
});
test('grid min/max fraction tracks freeze without stealing the next fraction share',()=>{
 const e=new LayoutEngine([node(0,1,10,{widthMode:'fill'}),node(1,1,10,{widthMode:'fill'})],{width:300,height:100,layout:5,columns:[{size:'1fr',min:20,max:50},'1fr']});e.arrange();assert.equal(e.getBounds(0).width,50);assert.equal(e.getBounds(1).width,250);
});
test('grid tracks are detached from user mutation and updates are atomic',()=>{
 const columns=[{size:'1fr',max:80},'1fr'],e=new LayoutEngine([node(0,1,10,{widthMode:'fill'})],{width:200,height:100,layout:5,columns});e.arrange();columns[0].max=5;assert.equal(e.getBounds(0).width,80);const buffer=e.rects;assert.throws(()=>e.configure({columns:'nonsense'}));e.configure({columns:'1fr 3fr'}).arrange();assert.equal(e.rects,buffer);assert.equal(e.getBounds(0).width,50);
});
for(const value of ['0fr','-4','x',new Array(1025).fill('1fr'),'9'.repeat(1000)+'fr'])test('invalid grid tracks fail atomically '+String(value).slice(0,12),()=>assert.throws(()=>normalizeTracks(value)));
test('huge explicit grid span is bounded and cannot publish partial output',()=>{
 const e=new LayoutEngine([node(1)],{width:100,height:100});e.arrange();const old=e.getBounds(1);e.update(1,{gridRow:262143,rowSpan:2});e.configure({layout:5});assert.throws(()=>e.arrange(),/budget/);assert.deepEqual(e.getBounds(1),old);
});
test('cross gap can return to inherited state without reallocating the graph',()=>{const e=new LayoutEngine([node(1,60,10),node(2,60,10)],{width:100,height:100,layout:3,gap:5,crossGap:20});e.arrange();close(e.getBounds(2).y,30);const r=e.rects;e.configure({crossGap:undefined}).arrange();close(e.getBounds(2).y,15);assert.equal(e.rects,r);});
test('extreme finite grow weights do not overflow a proportional allocation',()=>{const e=new LayoutEngine([node(1,0,10,{grow:1e308}),node(2,0,10,{grow:1e308})],{width:100,height:50,layout:1});e.arrange();close(e.getBounds(1).width,50);close(e.getBounds(2).width,50);});
test('tiny positive grow weights preserve their relative size',()=>{const e=new LayoutEngine([node(1,0,10,{grow:1e-310}),node(2,0,10,{grow:2e-310})],{width:90,height:50,layout:1});e.arrange();close(e.getBounds(1).width,30);close(e.getBounds(2).width,60);});
// Independent repeated-freezing reference used only by tests, never the solver.
function reference(values,weights,mins,maxs,free){const out=[...values],sign=Math.sign(free),open=new Set(weights.map((v,i)=>v>0?i:-1).filter(i=>i>=0));let remaining=Math.abs(free);for(let pass=0;pass<=out.length&&open.size&&remaining>1e-9;pass++){const weight=[...open].reduce((s,i)=>s+weights[i],0),level=remaining/weight;let frozen=[];for(const i of open){const capacity=sign>0?maxs[i]-out[i]:out[i]-mins[i];if(capacity<level*weights[i])frozen.push([i,capacity]);}if(!frozen.length){for(const i of open)out[i]+=sign*level*weights[i];break;}for(const [i,cap]of frozen){out[i]+=sign*cap;remaining-=cap;open.delete(i);}}return out;}
test('capped distribution matches 2,000 seeded independent grow/shrink cases',()=>{
 let seed=17;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let n=0;n<2000;n++){const count=1+Math.floor(rand()*80),ids=Array.from({length:count},(_,i)=>i),mins=ids.map(()=>rand()*20),maxs=mins.map(v=>v+rand()*80),initial=mins.map((v,i)=>v+rand()*(maxs[i]-v)),weights=ids.map(()=>rand()<.1?0:rand()*8),free=(rand()-.5)*count*200,expected=reference(initial,weights,mins,maxs,free),actual=[...initial];distribute(ids,0,count,actual,weights,mins,maxs,free);actual.forEach((v,i)=>close(v,expected[i]));}
});


test('grid fractional tracks normalize very large finite weights',()=>{
  const weight='1'+'0'.repeat(300),double='2'+'0'.repeat(300);
  const e=new LayoutEngine([{id:'a',widthMode:'fill',bounds:{width:10,height:10}},{id:'b',widthMode:'fill',bounds:{width:10,height:10}}],{width:300,height:100,layout:'Grid',columns:[weight+'fr',double+'fr']});
  e.arrange();assert.equal(e.getBounds('a').width,100);assert.equal(e.getBounds('b').width,200);
  assert.equal(e.arrange().passes,0);
});
test('intrinsic callbacks cannot reenter or mutate the solver',()=>{
  let engine;engine=new LayoutEngine([{id:'label',widthMode:'hug',bounds:{width:20,height:10},measure:()=>{engine.update('label',{grow:1});return {width:40};}}],{width:100,height:100});
  assert.throws(()=>engine.arrange(),/mutation.*measurement/i);
  engine.update('label',{measure:()=>({width:40,height:10})});engine.arrange();assert.equal(engine.getBounds('label').width,40);
});

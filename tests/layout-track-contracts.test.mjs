import test from 'node:test';import assert from 'node:assert/strict';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
import {normalizeTracks,serializeTracks,resolveTrackTemplate} from '../packages/auto-layout/src/track-template.js';
import {normalizeGridLine,normalizeAreas} from '../packages/auto-layout/src/grid-lines.js';
import {normalizeVariables,evaluateLength,parseLength} from '../packages/auto-layout/src/track-expression.js';
import {newProject,createControl,normalizeProject} from '../src/project/model.js';
import {layoutEdit,editLayoutProperties} from '../src/layout/authoring.js';
import {formGridLayout,materializeGridTracks,resizeGridTrack,moveGridControls} from '../src/layout/grid-tools.js';
import {layoutProperty,layoutDefaults} from '../src/layout/contract.js';
import {layoutMembers} from '../src/layout/intelligence.js';
import {encodeLayoutSidecar,applyLayoutSidecar} from '../src/layout/project-sidecar.js';
import {compileProject} from '../src/language/compiler.js';
import {nativeLayoutSeed} from '../src/native/layout-seed.js';
const child=(id,p={})=>({id,bounds:{width:30,height:20},...p});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

for(const [expr,extent,expected]of [['25%',400,100],['calc(100% / 4 + 10px)',400,110],['clamp(30, 10%, 50)',400,40],['min(25%, 80)',400,80],['max(25%, 120)',400,120],['calc(10 * 3 - 5)',0,25],['var(--absent, calc(50% - 5))',100,45]])
 test('bounded expression '+expr,()=>assert.equal(evaluateLength(expr,extent),expected));
for(const input of ['calc(5 / 0)','calc(10px * 2px)','calc(5 / 10%)','calc((2)','url(x)','min()','calc(1, 2)','clamp(1,2)','var(bad)','calc(1e999)','globalThis','calc(0);throw 1'])
 test('invalid expression rejected: '+input,()=>assert.throws(()=>evaluateLength(input,100)));
test('expression ASTs cannot be mutated through the shared cache',()=>{const n=parseLength('calc(1 + 2)');assert.throws(()=>n.args[0].left.value=99);assert.equal(evaluateLength('calc(1 + 2)',0),3);});
test('object track cycles, nulls, unbounded intrinsic values and deep functions fail before publication',()=>{
 const a={repeat:'auto-fit'};a.tracks=[a];assert.throws(()=>normalizeTracks([a]),/nesting/);
 for(const t of [{size:null},{min:null},{max:null},{mode:1,value:NaN},{mode:1,value:Infinity}])assert.throws(()=>normalizeTracks([t]));
 assert.throws(()=>normalizeTracks('repeat(1, '.repeat(10)+'20'+')'.repeat(10)),/nesting/);
});
test('track JSON round-trip retains named boundaries and unresolved percentages/tokens',()=>{
 const t=normalizeTracks('[first] repeat(auto-fill, [card] minmax(var(--min, 40), 1fr)) [last] 10%');
 assert.deepEqual(normalizeTracks(serializeTracks(t)),t);
});
test('automatic repetition honors a multi-track pattern and static prefix/suffix',()=>{
 const t=normalizeTracks('30 repeat(auto-fill, 40 60) 20');assert.equal(resolveTrackTemplate(t,419,10).length,6);assert.equal(resolveTrackTemplate(t,420,10).length,8);
 assert.throws(()=>resolveTrackTemplate(normalizeTracks('repeat(auto-fill, 1)'),100000,0),/budget/);
 assert.throws(()=>resolveTrackTemplate(normalizeTracks('repeat(auto-fill, 10)'),100,-10),/advance/);
});
test('negative and reversed explicit line pairs use the explicit track boundary',()=>{
 const e=new LayoutEngine([child('a',{gridColumnStart:-1,gridColumnEnd:-3}),child('b',{gridColumn:9,gridRow:1})],{layout:'Grid',width:500,height:100,columns:'repeat(4, 20)'});e.arrange();
 const c=e.getGridLayout().cells[0];assert.deepEqual([c.column,c.columnSpan],[2,2]);assert.equal(e.getGridLayout().columns.length,10);
});
test('a named area edge override retains the unmodified opposite area edge',()=>{
 const e=new LayoutEngine([child('a',{gridArea:'a',gridColumnEnd:4})],{layout:'Grid',width:300,height:60,columns:3,gridTemplateAreas:'"a a ."'});e.arrange();assert.equal(e.getGridLayout().cells[0].columnSpan,3);
});
for(const line of [0,'span -2','auto 2','span','a b','name 0','span span','1.5','x '.repeat(100)])test('invalid line selector '+String(line).slice(0,25),()=>assert.throws(()=>normalizeGridLine(line)));
for(const areas of ['"a a" "a b"','"a b" "c"','"a" garbage','"a b" "b a"',{},['bad!']])test('invalid named area shape '+JSON.stringify(areas),()=>assert.throws(()=>normalizeAreas(areas)));
test('inherited variables and direction update nested grids without aliasing caller records',()=>{
 const vars={'--min':80},inner={'--min':120},e=new LayoutEngine([child('panel',{layout:'Grid',bounds:{width:410,height:100},layoutVariables:inner,columns:'repeat(auto-fill,minmax(var(--min),1fr))'}),child('a',{parent:'panel',widthMode:'fill'})],{width:800,height:200,direction:'rtl',layoutVariables:vars});
 vars['--min']=999;inner['--min']=999;e.arrange();assert.equal(e.getGridLayout('panel').columns.length,3);assert.equal(e.getGridLayout('panel').direction,'rtl');
 e.update('panel',{layoutVariables:undefined,direction:'ltr'}).arrange();assert.equal(e.getGridLayout('panel').columns.length,5);assert.equal(e.getGridLayout('panel').direction,'ltr');
 e.configure({layoutVariables:{'--min':100}}).arrange();assert.equal(e.getGridLayout('panel').columns.length,4);
});
test('cyclic variable expansion and invalid resolved limits preserve last-successful geometry',()=>{
 const e=new LayoutEngine([child('a')],{width:200,height:50,layout:'Grid',columns:'var(--size)',layoutVariables:{'--size':100}});e.arrange();const before=e.getGridLayout(),r=Array.from(e.rects);
 e.configure({layoutVariables:{'--size':'var(--loop)','--loop':'var(--size)'}});assert.throws(()=>e.arrange(),/Cyclic/);assert.deepEqual(e.getGridLayout(),before);assert.deepEqual(Array.from(e.rects),r);
 e.configure({layoutVariables:{'--size':-10}});assert.throws(()=>e.arrange(),/resolved/);e.configure({layoutVariables:{'--size':80}}).arrange();assert.equal(e.getGridLayout().columns[0].size,80);
});
test('huge finite lengths cannot publish nonfinite rectangles',()=>{
 const e=new LayoutEngine([child('a'),child('b'),child('c')],{width:200,height:60,layout:'Grid'});e.arrange();const before=Array.from(e.rects);
 e.configure({columns:'1e308 1e308 1e308'});assert.throws(()=>e.arrange(),/Nonfinite/);assert.deepEqual(Array.from(e.rects),before);
});
test('RTL respects physical margins and leaves absolute anchors and docking untouched',()=>{
 const e=new LayoutEngine([child('a',{margin:{left:7,right:13}}),child('b')],{width:200,height:80,layout:'Horizontal',direction:'rtl'});e.arrange();assert.equal(e.getBounds('a').x,157);assert.equal(e.getBounds('b').x,120);
 const a=new LayoutEngine([child('anchor',{bounds:{x:10,y:0,width:20,height:20},anchor:5}),child('dock',{dock:'Left',bounds:{width:30,height:20}})],{width:200,height:80,direction:'rtl'});a.arrange();assert.equal(a.getBounds('anchor').x,10);assert.equal(a.getBounds('dock').x,0);
});
test('reverse and wrap-reverse preserve declaration order and original baselines',()=>{
 const e=new LayoutEngine(['a','b','c'].map(id=>child(id,{shrink:0})),{width:70,height:90,layout:'Wrap',gap:10,reverse:true,wrapReverse:true});e.arrange();assert.deepEqual(e.nodes.map(c=>c.id),['a','b','c']);
 assert.equal(e.getBounds('c').x,0);assert.equal(e.getBounds('b').x,40);assert.equal(e.getBounds('c').y,70);assert.equal(e.getBounds('a').y,40);
 e.configure({reverse:false,wrapReverse:false}).arrange();assert.equal(e.getBounds('a').x,0);assert.equal(e.getBounds('a').y,0);
});
const project=()=>{const p=newProject('ResponsiveGrid');p.settings.anchoring=true;const f=p.modules[0].form;Object.assign(f.properties,{LayoutMode:5,ClientWidth:4500,ClientHeight:1000,LayoutGap:100,LayoutGridColumns:'repeat(auto-fit,minmax(1000,1fr))'});const a=createControl('CommandButton','A');a.id='a';Object.assign(a.properties,{LayoutWidthMode:2,Width:300,Height:300});f.controls=[a];return {p,f,a};};
test('new metadata remains project scoped and has correct IntelliSense types',()=>{
 const {p,f}=project();const values={LayoutDirection:1,LayoutReverse:-1,LayoutWrapReverse:-1,LayoutVariables:'{"--min":1000}',LayoutGridAreas:'"head head"',LayoutGridColumns:'[start] 1fr [body] 1fr [end]'};
 Object.assign(f.properties,values);Object.assign(f.controls[0].properties,{LayoutArea:'head',LayoutColumnEnd:'-1'});
 const copy=normalizeProject(p);for(const [k,v]of Object.entries(values))assert.equal(copy.modules[0].form.properties[k],v);
 const sidecar=encodeLayoutSidecar(p);copy.modules[0].form.properties.LayoutDirection=0;applyLayoutSidecar(copy,sidecar);assert.equal(copy.modules[0].form.properties.LayoutDirection,1);
 const members=layoutMembers(p,'CommandButton');assert.equal(members.find(m=>m.name==='LayoutColumnStart').type,'String');assert.equal(members.find(m=>m.name==='LayoutReverse').type,'Boolean');
 p.modules[0].code='Private Sub Form_Load()\nMe.LayoutDirection = vbLayoutDirectionRightToLeft\nMe.LayoutGridAreas = ""\nEnd Sub';assert.equal(compileProject(p).valid,true);p.settings.anchoring=false;assert.equal(compileProject(p).valid,false);assert.deepEqual(layoutMembers(p,'Form'),[]);
});
test('advanced metadata still diagnoses unsupported native layout rather than discarding it',()=>{const {p,f}=project();assert.throws(()=>nativeLayoutSeed(p),/HTML\/Electron/);f.properties.LayoutMode=0;f.properties.LayoutGridColumns='1fr 1fr';f.properties.LayoutDirection=1;assert.throws(()=>nativeLayoutSeed(p),/LayoutDirection/);});
test('responsive axis expansion and resizing are explicit, atomic, and undo-friendly',()=>{
 const {f}=project(),before=JSON.stringify(f);assert.throws(()=>layoutEdit(f,d=>resizeGridTrack(d,null,'columns',0,1200)),/Expand/);
 const expanded=layoutEdit(f,d=>materializeGridTracks(d,null,'columns'));assert.equal(JSON.stringify(f),before);assert.equal(normalizeTracks(expanded.form.properties.LayoutGridColumns).length,4);
 const resized=layoutEdit(expanded.form,d=>resizeGridTrack(d,null,'columns',0,1200));assert.equal(normalizeTracks(resized.form.properties.LayoutGridColumns)[0].value,1200);
});
test('cell movement materializes named spans so repeated arrows actually move the control',()=>{
 const {f,a}=project();f.properties.LayoutGridColumns='[left] 1000 1000 [end] 1000';Object.assign(a.properties,{LayoutColumnStart:'left',LayoutColumnEnd:'end'});
 const result=layoutEdit(f,d=>moveGridControls(d,['a'],1,1));const p=result.form.controls[0].properties;assert.equal(p.LayoutColumn,1);assert.equal(p.LayoutRow,1);assert.equal(p.LayoutColumnSpan,2);assert.equal(p.LayoutColumnStart,'');assert.equal(p.LayoutColumnEnd,'');
 const cell=formGridLayout(result.form).cells[0];assert.deepEqual([cell.column,cell.row,cell.columnSpan],[1,1,2]);
});
test('malformed UI strings and mixed invalid transactions never mutate the input form',()=>{
 const {f}=project(),before=JSON.stringify(f);for(const [k,v]of [['LayoutVariables','{"--a":{}}'],['LayoutGridAreas','"a a" "a b"'],['LayoutColumnStart','0']])assert.throws(()=>layoutProperty(k,v));
 assert.throws(()=>layoutEdit(f,d=>editLayoutProperties(d,[],{LayoutDirection:1,LayoutGridColumns:'repeat(auto-fill, 1fr)'})));assert.equal(JSON.stringify(f),before);
});
test('reparenting from a named area keeps resolved spans instead of stale legacy values',async()=>{
 const {placeGridControls}=await import('../src/layout/grid-tools.js');const {f,a}=project();f.properties.LayoutGridColumns='1000 1000 1000';Object.assign(a.properties,{LayoutColumnStart:'1',LayoutColumnEnd:'-1'});
 const target=createControl('Frame','Target');target.id='target';Object.assign(target.properties,{LayoutMode:5,LayoutGridColumns:'1000 1000',Width:3000,Height:2000});f.controls.push(target);
 const result=layoutEdit(f,d=>placeGridControls(d,['a'],'target',0,0)),item=result.form.controls.find(c=>c.id==='a');assert.equal(item.properties.LayoutColumnSpan,3);assert.equal(item.properties.LayoutColumnEnd,'');assert.equal(item.nativeParentId,'target');assert.equal(formGridLayout(result.form,'target').cells[0].columnSpan,3);
});
test('masonry rulers resize only the lane axis and explicit expansion preserves count',()=>{
 const {f}=project();f.properties.LayoutMode=6;const before=JSON.stringify(f);
 assert.throws(()=>layoutEdit(f,d=>resizeGridTrack(d,null,'rows',0,300)),/stacking axis/);assert.equal(JSON.stringify(f),before);
 const expanded=layoutEdit(f,d=>materializeGridTracks(d,null,'columns'));assert.equal(normalizeTracks(expanded.form.properties.LayoutGridColumns).length,4);
 const sized=layoutEdit(expanded.form,d=>resizeGridTrack(d,null,'columns',1,1200));assert.equal(normalizeTracks(sized.form.properties.LayoutGridColumns)[1].value,1200);
});

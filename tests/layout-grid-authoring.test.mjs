import test from 'node:test';import assert from 'node:assert/strict';
import {newProject,createControl,normalizeProject} from '../src/project/model.js';
import {layoutEdit} from '../src/layout/authoring.js';
import {resizeGridTrack,moveGridControls,placeGridControls,formGridLayout} from '../src/layout/grid-tools.js';
import {gridCellAt} from '../src/layout/grid-guides.js';
import {normalizeTracks} from '../packages/auto-layout/src/advanced.js';
import {encodeLayoutSidecar,applyLayoutSidecar} from '../src/layout/project-sidecar.js';
import {nativeLayoutSeed} from '../src/native/layout-seed.js';
import {compileProject} from '../src/language/compiler.js';
const make=()=>{const p=newProject('Grid'),f=p.modules[0].form;p.settings.anchoring=true;Object.assign(f.properties,{LayoutMode:5,LayoutGridColumns:'600 900 1fr',LayoutGridRows:'450 450',LayoutGridAutoFlow:0});f.controls=['A','B','C'].map((name,i)=>{const c=createControl('CommandButton',name);c.id=name;Object.assign(c.properties,{Width:300,Height:300});return c;});return {p,f};};
test('resizing an empty track preserves other track definitions and input ownership',()=>{
  const {f}=make(),before=JSON.stringify(f),out=layoutEdit(f,d=>resizeGridTrack(d,null,'rows',1,750));
  assert.equal(JSON.stringify(f),before);assert.deepEqual(normalizeTracks(out.form.properties.LayoutGridRows).map(t=>t.value),[450,750]);
  assert.equal(out.form.properties.LayoutGridColumns,'600 900 1fr');
});
test('implicit tracks can be materialized and explicit limits are retained',()=>{
  const {f}=make();f.properties.LayoutGridRows='';const out=layoutEdit(f,d=>resizeGridTrack(d,null,'rows',3,600));
  const tracks=normalizeTracks(out.form.properties.LayoutGridRows);assert.equal(tracks.length,4);assert.equal(tracks[0].mode,1);assert.equal(tracks[3].value,600);
  f.properties.LayoutGridColumns='[{"size":"1fr","min":300,"max":600},"2fr"]';
  const next=layoutEdit(f,d=>resizeGridTrack(d,null,'columns',0,450));assert.equal(normalizeTracks(next.form.properties.LayoutGridColumns)[0].max,600);
  assert.throws(()=>layoutEdit(f,d=>resizeGridTrack(d,null,'columns',0,750)),/maximum/);
});
test('invalid track edits leave the original form unchanged',()=>{
  const {f}=make(),before=JSON.stringify(f);
  for(const [axis,index,size]of [['bad',0,300],['rows',1024,300],['rows',0,NaN],['rows',0,-1]])assert.throws(()=>layoutEdit(f,d=>resizeGridTrack(d,null,axis,index,size)));
  assert.equal(JSON.stringify(f),before);
});
test('keyboard grid movement preserves relative cells, spans and control order',()=>{
  const {f}=make(),out=layoutEdit(f,d=>moveGridControls(d,['A','B'],0,1));
  assert.deepEqual(out.form.controls.map(c=>c.id),['A','B','C']);
  assert.deepEqual(out.form.controls.slice(0,2).map(c=>[c.properties.LayoutRow,c.properties.LayoutColumn]),[[1,0],[1,1]]);
  const left=layoutEdit(out.form,d=>moveGridControls(d,['A','B'],-1,0));assert.deepEqual(left.form.controls.slice(0,2).map(c=>c.properties.LayoutColumn),[0,1]);
});
test('cell movement rejects nonparticipating children and out-of-budget destinations',()=>{
  const {f}=make();f.controls[0].properties.LayoutIgnore=-1;assert.throws(()=>layoutEdit(f,d=>moveGridControls(d,['A'],1,0)),/participating/);
  f.controls[0].properties.LayoutIgnore=0;assert.throws(()=>layoutEdit(f,d=>moveGridControls(d,['A'],1024,0)),/budget/);
});
test('pointer drops explicitly address empty cells and preserve identities',()=>{
  const {f}=make(),out=layoutEdit(f,d=>placeGridControls(d,['C'],null,2,1)),c=out.form.controls.find(c=>c.id==='C');
  assert.equal(c.name,'C');assert.equal(c.properties.LayoutColumn,2);assert.equal(c.properties.LayoutRow,1);
  const grid=formGridLayout(out.form);const hit=gridCellAt(grid,{x:grid.columns[2].start+50,y:grid.rows[1].start+50});assert.deepEqual([hit.column,hit.row],[2,1]);
});
test('new grid packing property round-trips and keeps native diagnostics explicit',()=>{
  const {p,f}=make();f.properties.LayoutGridAutoFlow=3;const copy=normalizeProject(p);assert.equal(copy.modules[0].form.properties.LayoutGridAutoFlow,3);
  copy.modules[0].form.properties.LayoutGridAutoFlow=0;applyLayoutSidecar(copy,encodeLayoutSidecar(p));assert.equal(copy.modules[0].form.properties.LayoutGridAutoFlow,3);
  assert.throws(()=>nativeLayoutSeed(p),/HTML\/Electron/);
  p.modules[0].code='Private Const Flow As Long = vbLayoutGridFlowColumnDense';assert.equal(compileProject(p).valid,true);p.settings.anchoring=false;assert.equal(compileProject(p).valid,false);
});

test('same-grid drops preserve relative placement and all model ordering',()=>{
  const {f}=make(),out=layoutEdit(f,d=>placeGridControls(d,['A','B'],null,1,1));
  assert.deepEqual(out.form.controls.map(c=>c.id),['A','B','C']);
  assert.deepEqual(out.form.controls.slice(0,2).map(c=>[c.properties.LayoutRow,c.properties.LayoutColumn]),[[1,1],[1,2]]);
});
test('cross-container multi-drop packs multi-row spans without collisions',()=>{
  const {f}=make();const target=createControl('Frame','Target');target.id='target';Object.assign(target.properties,{Width:3000,Height:3000,LayoutMode:5,LayoutGridColumns:'600 600',LayoutGridRows:'450 450 450 450'});f.controls.push(target);f.controls[0].properties.LayoutRowSpan=2;
  const out=layoutEdit(f,d=>placeGridControls(d,['A','B','C'],'target',0,1)),cells=formGridLayout(out.form,'target').cells;
  const occupied=new Set();for(const c of cells)for(let row=c.row;row<c.row+c.rowSpan;row++)for(let column=c.column;column<c.column+c.columnSpan;column++){const key=row*1024+column;assert.equal(occupied.has(key),false);occupied.add(key);}
  assert.equal(cells.find(c=>c.id==='A').row,1);
});
test('an empty grid without authored rows offers its first implicit drop row',()=>{
  const {f}=make();f.controls=[];f.properties.LayoutGridRows='';const hit=gridCellAt(formGridLayout(f),{x:650,y:200});assert.equal(hit.row,0);assert.equal(hit.column,1);
});

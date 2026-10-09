import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
function project(code,properties={}){
 const p=newProject('Surfaces'),m=p.modules[0],c=createControl('PictureBox','Canvas');
 Object.assign(c.properties,{AutoRedraw:-1,ScaleMode:3},properties);m.form.controls=[c];
 m.code='Option Explicit\nPrivate Sub Form_Load()\n'+code+'\nEnd Sub';return p;
}
for(const optimization of [0,1,2])test(`original Win32 Workbench exports unchanged at O${optimization}`,()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../examples/win32.vb6web',import.meta.url),'utf8')),before=JSON.stringify(p);
 const a=compileWin32(p,{optimization});assert.equal(JSON.stringify(p),before);assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
 for(const api of ['CreateDIBSection','BeginPaint','EndPaint','BitBlt','DeleteDC'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
});
for(const optimization of [0,1,2])test(`surface behavior fixture is deterministic and remains within the native size budget O${optimization}`,()=>{
 const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlSurfaces'),before=JSON.stringify(p);
 const a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);
 assert.equal(checks.length,19);assert.ok(a.bytes.length<100000);assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
 for(const api of ['IsWindow','CreateDIBSection','SaveDC','RestoreDC','GetGuiResources','DeleteObject','BeginPaint','EndPaint','GetClipRgn','GetViewportOrgEx'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
});
test('surface demand discovers nested lexical With bindings without executing or mutating authored ASTs',()=>{
 const p=project('Dim n As Long\nWith Canvas\n .BackColor=123\n With Canvas\n  .CurrentX=2.5\n End With\n n=.hDC\n .Cls\nEnd With');
 const before=JSON.stringify(p);assert.ok(compileWin32(p).bytes.length);assert.equal(JSON.stringify(p),before);
});
test('private drawing kernel cannot collide with or capture an authored module',()=>{
 const p=project('Dim n As Long\nn=Canvas.hDC\nCanvas.Cls');
 p.modules.push({id:'private-name',kind:'module',name:'NativeSurfaceKernel',code:'Public Function SurfaceDC() As Long\nSurfaceDC=7\nEnd Function'});
 const a=compileWin32(p);assert.ok(a.report.records.some(r=>r.name==='nativesurfacekernel1.surface'));
 assert.ok(a.report.sourceMap.some(s=>s.source==='NativeSurfaceKernel'&&s.procedure==='SurfaceDC'));
 assert.ok(!a.report.sourceMap.some(s=>s.source==='NativeSurfaceKernel1'));
});
test('record With stays distinct from drawing receivers during demand discovery',()=>{
 const p=project('Dim r As R,n As Long\nWith r\n .CurrentX=12\n n=.CurrentX\nEnd With\nn=Canvas.hDC');
 p.modules[0].code='Private Type R\n CurrentX As Long\nEnd Type\n'+p.modules[0].code;
 assert.ok(compileWin32(p).bytes.length);
});
for(const [property,value]of [['ScaleMode',2],['DrawWidth',0],['DrawStyle',7],['DrawMode',17],['FillStyle',8]])test('unsupported authored surface state fails explicitly: '+property,()=>{
 assert.throws(()=>compileWin32(project('Canvas.Cls',{[property]:value})),/ScaleMode|Invalid native drawing/);
});
for(const code of ['Canvas.Cls 1','Canvas.Refresh 1','Canvas.hDC=0'])test('invalid native surface signature is not ignored: '+code,()=>assert.throws(()=>compileWin32(project(code))));

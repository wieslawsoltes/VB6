import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {newProject,createControl} from '../src/project/model.js';import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const project=code=>{const p=newProject('Surfaces');p.modules[0].code='Private Sub Form_Load()\n'+code+'\nEnd Sub';p.modules[0].form.controls=[createControl('PictureBox','Canvas')];return p;};
for(const optimization of [0,1,2])test(`unchanged Win32 Workbench exports native GDI surface code O${optimization}`,()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../examples/win32.vb6web',import.meta.url))),before=JSON.stringify(p),a=compileWin32(p,{optimization});
 assert.deepEqual(a.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);assert.equal(a.report.extraction,false);assert.equal(a.report.target,'win32-aot');
 for(const api of ['CreateDIBSection','BitBlt','GetClassInfoW','RegisterClassW','StretchBlt','SetWorldTransform'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
 assert.ok(!a.report.sourceMap.some(s=>s.source.startsWith('NativeDrawingSurface')),'private services do not invent authored sequence points');
});
test('unused surfaces do not add a GDI bitmap runtime to ordinary forms',()=>{
 const a=compileWin32(project('Caption="ready"'));
 for(const api of ['CreateDIBSection','BitBlt','GetClassInfoW'])assert.ok(!a.report.imports.some(i=>i.symbol===api),api);
});
for(const code of ['Canvas.Cls 1','Canvas.hDC=3','Canvas.ScaleWidth=10','Dim dc As Long\ndc=Missing.hDC'])test('invalid native surface operation is diagnosed: '+code,()=>assert.throws(()=>compileWin32(project(code))));
test('private native service name collisions preserve authored module scope',()=>{
 const p=project('Dim dc As Long\ndc=Canvas.hDC');p.modules.push({id:'other',name:'NativeDrawingSurface',kind:'module',code:'Private Sub SurfaceDC()\nEnd Sub'});
 const a=compileWin32(p);assert.ok(a.report.sourceMap.some(s=>s.source==='NativeDrawingSurface'));assert.ok(a.report.records.some(r=>r.name==='nativedrawingsurface1.surface'));
});

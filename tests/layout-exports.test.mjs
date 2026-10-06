import test from 'node:test';import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {sourceFiles,importFiles} from '../src/project/formats.js';
import {bytesOf} from '../src/project/native-text.js';
import {encodeLayoutSidecar,decodeLayoutSidecar,applyLayoutSidecar,stripLayoutDesignerProperties} from '../src/layout/project-sidecar.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {diagnosticSnapshot,ProjectDiagnosticCache} from '../src/language/diagnostics.js';
const make=()=>{const p=newProject('LayoutExport'),m=p.modules[0];m.code='';m.form.controls=[createControl('CommandButton','B')];return p;};
const text=v=>new TextDecoder().decode(bytesOf(v));
test('native project source export/import preserves opt-in and control-array layout metadata',async()=>{
 const p=make();p.settings.anchoring=true;const m=p.modules[0];m.form.properties.LayoutGap=45;for(const index of [1,3]){const c=createControl('CommandButton','A');Object.assign(c.properties,{Index:index,Anchor:index===1?15:10,Dock:0,MinimumWidth:123.5});m.form.controls.push(c);}m.form.controls[0].properties.Anchor=10;
 const original=JSON.stringify(p),files=sourceFiles(p);assert.equal(JSON.stringify(p),original);const side=Object.keys(files).find(k=>k.endsWith('.vb6layout.json'));assert.ok(side);const frm=Object.keys(files).find(k=>k.endsWith('.frm'));assert.doesNotMatch(text(files[frm]),/^\s*(?:Anchor|Dock|MinimumWidth|LayoutGap)\s*=/m);
 const q=(await importFiles(new Map(Object.entries(files)))).project;assert.equal(q.settings.anchoring,true);assert.equal(q.modules[0].form.properties.LayoutGap,45);assert.deepEqual(q.modules[0].form.controls.filter(c=>c.name==='A').map(c=>[c.properties.Index,c.properties.Anchor,c.properties.MinimumWidth]),[[1,15,123.5],[3,10,123.5]]);assert.ok(!q.assets?.[side]);
});
test('default-off exports contain no companion; dormant layout survives explicitly disabled round trip',async()=>{
 const p=make();assert.equal(Object.keys(sourceFiles(p)).some(k=>k.endsWith('.vb6layout.json')),false);p.modules[0].form.controls[0].properties.Anchor=10;const files=sourceFiles(p);assert.equal(decodeLayoutSidecar(bytesOf(files[Object.keys(files).find(k=>k.endsWith('.vb6layout.json'))])).enabled,false);const q=(await importFiles(new Map(Object.entries(files)))).project;assert.equal(q.settings.anchoring,false);assert.equal(q.modules[0].form.controls[0].properties.Anchor,10);
});
test('layout companion load validates atomically, does not enable from arbitrary truthy data',()=>{
 const p=make();p.settings.anchoring=true;p.modules[0].form.controls[0].properties.Anchor=10;const data=JSON.parse(text(encodeLayoutSidecar(p))),original=JSON.stringify(p);data.modules[0].nodes[0].properties.Anchor=16;assert.throws(()=>applyLayoutSidecar(p,new TextEncoder().encode(JSON.stringify(data))),/Anchor/);assert.equal(JSON.stringify(p),original);
 for(const bad of [{...data,enabled:1},{...data,version:2},{...data,modules:[...data.modules,...data.modules]},{...data,modules:[{name:'Form1',nodes:[{name:'B',index:null,form:false,properties:{__proto__:null,constructor:'payload'}}]}]}])assert.throws(()=>decodeLayoutSidecar(new TextEncoder().encode(JSON.stringify(bad))),/Layout companion/);
});
test('companion reapplication removes stale keys and handles casing without trusting IDs',()=>{
 const p=make();p.settings.anchoring=true;p.modules[0].form.controls[0].properties.Anchor=10;const bytes=encodeLayoutSidecar(p);p.modules[0].form.controls[0].properties.Dock=5;p.modules[0].form.controls[0].id='new-id';p.modules[0].name='FORM1';applyLayoutSidecar(p,bytes);assert.equal(p.modules[0].form.controls[0].properties.Dock,undefined);assert.equal(p.modules[0].form.controls[0].properties.Anchor,10);
});
test('native envelope stripping never strips VB code or nested vendor property bags',()=>{
 const input='VERSION 5.00\r\nBegin VB.Form Form1\r\n Anchor = 15\r\n BeginProperty Vendor\r\n Anchor = 8\r\n EndProperty\r\nEnd\r\nAttribute VB_Name = "Form1"\r\nPrivate Sub Form_Load()\r\n Anchor = 4\r\nEnd Sub\r\n';const out=stripLayoutDesignerProperties(input);assert.ok(!out.includes('Anchor = 15'));assert.ok(out.includes('Anchor = 8'));assert.ok(out.endsWith(' Anchor = 4\r\nEnd Sub\r\n'));
});
for(const source of ['B.Anchor=10','With B\n.Anchor=10\nEnd With','Form1.B.Dock=5','Me.PerformLayout','Dim b2 As commandbutton\nb2.Anchor=5'])test('known layout member is unavailable in disabled VB code: '+source.split('\n')[0],()=>{
 const p=make();p.modules[0].code='Private Sub Form_Load()\n'+source+'\nEnd Sub';assert.equal(compileProject(p).valid,false);p.settings.anchoring=true;assert.deepEqual(compileProject(p).diagnostics,[]);
});
test('declaration-only diagnostics cache invalidates layout receivers when model changes',()=>{
 const p=make();p.modules[0].code='Private Sub Form_Load()\nB.Anchor=10\nEnd Sub';const cache=new ProjectDiagnosticCache();assert.equal(cache.check(diagnosticSnapshot(p)).valid,false);p.modules[0].form.controls[0].name='Renamed';assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);p.modules[0].form.controls[0].name='B';assert.equal(cache.check(diagnosticSnapshot(p)).valid,false);
});
test('opt-in enum types have actual Long storage and runtime namespaces, not editor-only types',async()=>{
 const p=make();p.settings.anchoring=true;p.startup='Sub Main';p.modules=[{id:'M',name:'M',kind:'module',code:'Public Result As Long\nPublic Sub Main()\nDim a As AnchorStyles\na=AnchorStyles.vbAnchorRight Or vbAnchorBottom\nResult=a\nEnd Sub'}];const compiled=compileProject(p);assert.deepEqual(compiled.diagnostics,[]);const vm=new VirtualMachine(compiled);await vm.start();assert.equal(vm.instances.get('m').fields.get('result').get(),10);vm.stop();
});

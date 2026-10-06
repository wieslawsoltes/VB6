import test from 'node:test';import assert from 'node:assert/strict';
import {newProject,createControl,normalizeProject} from '../src/project/model.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {diagnosticSnapshot,ProjectDiagnosticCache} from '../src/language/diagnostics.js';
import {buildObjectCatalog} from '../src/ide/object-catalog.js';
import {arrangeFormEdit} from '../src/layout/model.js';
import {layoutProperty,layoutEnabled,validateLayout} from '../src/layout/contract.js';
const make=()=>{const p=newProject(),m=p.modules[0],c=createControl('CommandButton','Button1',300,300);m.form.controls=[c];return {p,m,c};};
test('opt-in is strict and dormant data is preserved without classic defaults',()=>{
  const {p,c}=make();assert.equal(layoutEnabled(p),false);assert.equal(Object.hasOwn(c.properties,'Anchor'),false);c.properties.Anchor=10;
  assert.equal(normalizeProject(p).modules[0].form.controls[0].properties.Anchor,10);
  for(const value of [1,'true',-1,undefined]){p.settings.anchoring=value;assert.equal(layoutEnabled(normalizeProject(p)),false);}
});
test('extension constants bind only inside opted-in projects, including worker cache flips',()=>{
  const {p,m}=make();m.code='Private Const A As Long = vbAnchorLeft Or vbAnchorBottom';
  assert.equal(compileProject(p).valid,false);p.settings.anchoring=true;assert.equal(compileProject(p).valid,true);
  const cache=new ProjectDiagnosticCache();assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);p.settings.anchoring=false;assert.equal(cache.check(diagnosticSnapshot(p)).valid,false);
});
test('runtime constant library is project isolated',()=>{
  const {p}=make(),a=new VirtualMachine(p);p.settings.anchoring=true;const b=new VirtualMachine(p);assert.equal(a.library.has('vbanchorright'),false);assert.equal(b.library.get('vbanchorright'),8);a.stop();b.stop();
});
test('members, constants, contextual enums and Object Browser follow project flag',()=>{
  const {p,m}=make(),s=new EditorIntelligence(),list=text=>s.completions(p,m,1,text,text.length).items.map(i=>i.name);
  assert.equal(list('Button1.').includes('Anchor'),false);assert.equal(list('vbAnchor').length,0);
  p.settings.anchoring=true;assert.ok(list('Button1.').includes('Anchor'));assert.ok(list('Button1.Anchor = ').includes('vbAnchorRight'));assert.ok(list('vbAnchor').includes('vbAnchorNone'));
  assert.ok(buildObjectCatalog(p).find(c=>c.name==='CommandButton').members.some(m=>m.name==='Anchor'));
  p.settings.anchoring=false;assert.equal(list('Button1.').includes('Anchor'),false);assert.equal(buildObjectCatalog(p).find(c=>c.name==='CommandButton').members.some(m=>m.name==='Anchor'),false);
});
test('user classes with Anchor members are unaffected',()=>{
  const {p,m}=make();const cls={id:'c',name:'Custom',kind:'class',code:'Public Anchor As String'};p.modules.push(cls);m.code='Dim x As Custom';
  const s=new EditorIntelligence();assert.equal(s.resolve(p,m,1,'x.Anchor').type,'String');
});
test('layout validation rejects unsupported component fields and bad bounds',()=>{
  const {p,m,c}=make();p.settings.anchoring=true;c.properties.Anchor=16;assert.throws(()=>normalizeProject(p),/Anchor/);c.properties.Anchor=10;c.properties.MinimumWidth=100;c.properties.MaximumWidth=90;assert.throws(()=>normalizeProject(p),/MaximumWidth/);
  delete c.properties.MaximumWidth;m.form.controls=[createControl('Timer')];m.form.controls[0].properties.Anchor=5;assert.throws(()=>validateLayout(p),/component/);
  assert.throws(()=>layoutProperty('MinimumWidth',Infinity),/between/);
});
test('designer form resize, nested resize and restoration share solver geometry',()=>{
  const {p,m,c}=make();p.settings.anchoring=true;c.properties.Anchor=10;const before=structuredClone(m.form);m.form.properties.ClientWidth+=1000;m.form.properties.ClientHeight+=500;arrangeFormEdit(before,m.form);
  assert.equal(c.properties.Left,1300);assert.equal(c.properties.Top,800);
  m.form.properties.ClientWidth=before.properties.ClientWidth;m.form.properties.ClientHeight=before.properties.ClientHeight;arrangeFormEdit(before,m.form);assert.equal(c.properties.Left,300);
  const frame=createControl('Frame','Frame1',0,0);c.parent=frame.name;m.form.controls.push(frame);const original=structuredClone(m.form);frame.properties.Width+=700;frame.properties.Height+=400;arrangeFormEdit(original,m.form,[frame.id]);assert.equal(c.properties.Left,1000);assert.equal(c.properties.Top,700);
});
test('designer structural edits include added nodes, preserve new parent baseline and docking order',()=>{
 const {p,m,c}=make();p.settings.anchoring=true;const before=structuredClone(m.form);const added=createControl('TextBox','Added');added.properties.Dock=5;m.form.controls.push(added);arrangeFormEdit(before,m.form,[added.id]);assert.equal(added.properties.Width,9000);
 const frame=createControl('Frame','F');m.form.controls.push(frame);const old=structuredClone(m.form);c.parent=frame.name;c.nativeParentId=frame.id;c.properties.Anchor=10;arrangeFormEdit(old,m.form);assert.equal(c.properties.Left,300);const base=structuredClone(m.form);frame.properties.Width+=500;arrangeFormEdit(base,m.form,[frame.id]);assert.equal(c.properties.Left,800);
});

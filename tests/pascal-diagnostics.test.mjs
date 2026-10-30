import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {compileProject} from '../src/language/compiler.js';
import {diagnosticSnapshot,ProjectDiagnosticCache} from '../src/language/diagnostics.js';
import {pascalFormProject} from './pascal-integration-fixtures.mjs';

const normalize=result=>result.diagnostics.map(({origin,...diagnostic})=>diagnostic);
function check(cache,project){
  const result=cache.check(diagnosticSnapshot(project));
  assert.deepEqual(normalize(result),compileProject(project).diagnostics);
  return result;
}

test('Pascal diagnostic snapshots preserve detached declarations and omit assets',()=>{
  const project=pascalFormProject(),form=project.modules[0].form;
  project.assets={picture:'x'.repeat(100000)};
  form.properties.Picture='y'.repeat(100000);form.properties.MDIChild=0;
  form.controls[0].properties.Index=undefined;
  form.menus=[{name:'FileMenu',type:'Menu',properties:{Caption:'File'},items:[{name:'ExitMenu',type:'Menu',properties:{Index:4,Picture:'z'.repeat(100000)}}]}];
  const snapshot=diagnosticSnapshot(project),copy=snapshot.modules[0].form;
  assert.equal(snapshot.assets,undefined);assert.equal(copy.properties.Picture,null);
  assert.equal(copy.properties.MDIChild,0);assert.equal(Object.hasOwn(copy.controls[0].properties,'Index'),false);
  assert.equal(copy.menus[0].items[0].properties.Index,4);
  assert.ok(JSON.stringify(snapshot).length<8000);
  form.controls[0].name='Changed';form.menus[0].items[0].properties.Index=9;
  assert.equal(copy.controls[0].name,'MessageText');assert.equal(copy.menus[0].items[0].properties.Index,4);
});

test('automatic Pascal form diagnostics match execution and invalidate after designer renames',()=>{
  const project=pascalFormProject(),cache=new ProjectDiagnosticCache();
  assert.equal(check(cache,project).valid,true);assert.equal(check(cache,project).semanticCacheHit,true);
  project.modules[0].form.controls[0].name='OtherText';
  const invalid=check(cache,project);assert.equal(invalid.valid,false);assert.equal(invalid.stats.compiledModules,1);
  project.modules[0].form.controls[0].name='MessageText';assert.equal(check(cache,project).valid,true);
});

test('Pascal cache observes other form declarations without recompiling unchanged VB syntax',()=>{
  const project=pascalFormProject(),cache=new ProjectDiagnosticCache();
  project.modules[0].code='unit MainForm; interface implementation procedure Form_Load; begin OtherForm.Caption := \'Ready\' end; end.';
  project.modules.push({name:'OtherForm',id:'other',kind:'form',language:'vb6',code:'',form:{name:'OtherForm',type:'Form',properties:{},controls:[]}});
  assert.equal(check(cache,project).valid,true);
  project.modules[1].kind='module';delete project.modules[1].form;
  const changed=check(cache,project);assert.equal(changed.stats.compiledModules,2);assert.equal(changed.semanticCacheHit,false);
  const again=check(cache,project);assert.equal(again.stats.compiledModules,0);
});

test('Pascal declaration cache includes types and attributes but ignores unrelated asset values',()=>{
  const project=pascalFormProject(),cache=new ProjectDiagnosticCache();check(cache,project);
  project.modules[0].form.controls[0].type='RichTextBox';assert.equal(check(cache,project).stats.compiledModules,1);
  project.modules[0].attributes=['Attribute VB_Description = "Changed"'];assert.equal(check(cache,project).stats.compiledModules,1);
  project.modules[0].form.controls[0].properties.Picture='asset1';check(cache,project);
  project.modules[0].form.controls[0].properties.Picture='asset2';assert.equal(check(cache,project).stats.compiledModules,0);
});

test('Pascal snapshots reject cyclic or excessively deep declaration graphs',()=>{
  const project=pascalFormProject(),form=project.modules[0].form;
  form.children=[form];assert.throws(()=>diagnosticSnapshot(project),/acyclic/);
  delete form.children;let node=form;
  for(let i=0;i<258;i++){const child={name:'Nested'+i,type:'Frame',properties:{}};node.children=[child];node=child;}
  assert.throws(()=>diagnosticSnapshot(project),/256 levels/);
});

test('actual diagnostics worker compiles Pascal forms and returns fresh rename errors',async t=>{
  const workerSource=new URL('../src/editor/diagnostics-worker.js',import.meta.url).href;
  const bootstrap=`import {parentPort} from 'node:worker_threads'; globalThis.postMessage=value=>parentPort.postMessage(value); await import(${JSON.stringify(workerSource)}); parentPort.on('message',data=>globalThis.onmessage({data}));`;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)));
  t.after(()=>worker.terminate());
  const project=pascalFormProject();
  const request=async revision=>{const reply=once(worker,'message',{signal:AbortSignal.timeout(10000)});worker.postMessage({type:'diagnostics-check',revision,project:diagnosticSnapshot(project)});return(await reply)[0];};
  let reply=await request(1);assert.equal(reply.revision,1);assert.equal(reply.result.valid,true,JSON.stringify(reply.result.diagnostics));
  project.modules[0].form.controls[0].name='Renamed';reply=await request(2);
  assert.equal(reply.revision,2);assert.equal(reply.result.valid,false);assert.deepEqual(normalize(reply.result),compileProject(project).diagnostics);
});

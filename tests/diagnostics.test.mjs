import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {diagnosticSnapshot,ProjectDiagnosticCache} from '../src/language/diagnostics.js';
import {DiagnosticsScheduler} from '../src/editor/diagnostics-scheduler.js';

const module=(name='Module1',code='Public Sub Main()\nEnd Sub')=>({id:name,name,kind:'module',code});
const project=(...modules)=>({name:'Test',modules:modules.length?modules:[module()],settings:{}});
const normalize=diagnostics=>diagnostics.map(({origin,...d})=>d);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function idle(s){for(let i=0;i<1000;i++){if(!s.pending&&!s.busy&&!s.timer)return;await wait(2);}throw new Error('Diagnostics did not settle');}

for(const [name,p] of [
 ['valid source',project()],
 ['invalid procedure',project(module('A','Sub Main()\nDim x As\nEnd Sub'))],
 ['duplicate module',project(module('Same'),{...module('same'),id:'other'})],
 ['conditional compilation', {...project(module('M','#If SHOW Then\nBad Syntax\n#End If')),settings:{conditionalConstants:{SHOW:false}}}],
 ['cross-module record ByVal',project(module('A','Public Type T\nx As Long\nEnd Type'),module('B','Sub F(ByVal value As T)\nEnd Sub'))],
 ['array ByVal',project(module('M','Sub F(ByVal values() As Long)\nEnd Sub'))],
 ['two broken modules',project(module('A','Option Duck'),module('B','Sub Main(\nEnd Sub'))]
])test('diagnostics match execution compiler: '+name,()=>{
 const result=new ProjectDiagnosticCache().check(diagnosticSnapshot(p));
 assert.deepEqual(normalize(result.diagnostics),compileProject(p).diagnostics);assert.equal(result.valid,compileProject(p).valid);
});

test('diagnostics cache reparses only changed source and prunes closed modules',()=>{
 const cache=new ProjectDiagnosticCache(),p=project(module('A'),module('B'));
 assert.equal(cache.check(diagnosticSnapshot(p)).stats.compiledModules,2);
 assert.equal(cache.check(diagnosticSnapshot(p)).stats.cacheHits,2);
 p.modules[1].code+='\n';const next=cache.check(diagnosticSnapshot(p));assert.equal(next.stats.compiledModules,1);assert.equal(next.stats.cacheHits,1);
 p.modules.pop();cache.check(diagnosticSnapshot(p));assert.equal(cache.entries.size,1);
});
test('diagnostics invalidates renamed modules, kinds, and conditional settings',()=>{
 const cache=new ProjectDiagnosticCache(),p=project();cache.check(diagnosticSnapshot(p));
 for(const mutate of [()=>p.modules[0].name='Renamed',()=>p.modules[0].kind='class',()=>p.settings.conditionalConstants={A:1}]){mutate();assert.equal(cache.check(diagnosticSnapshot(p)).stats.compiledModules,1);}
});
test('diagnostic cache keeps cross-module record checks fresh even on source cache hits',()=>{
 const cache=new ProjectDiagnosticCache(),p=project(module('A','Public Type T\nx As Long\nEnd Type'),module('B','Sub F(ByVal value As T)\nEnd Sub'));
 assert.equal(cache.check(diagnosticSnapshot(p)).diagnostics.length,1);p.modules[0].code='';assert.equal(cache.check(diagnosticSnapshot(p)).diagnostics.length,0);
});
test('compiler snapshot excludes assets and detaches mutable settings',()=>{
 const p=project();p.assets={image:'x'.repeat(100000)};p.modules[0].form={huge:'y'.repeat(100000)};p.settings.conditionalConstants={A:1};
 const s=diagnosticSnapshot(p);p.settings.conditionalConstants.A=2;assert.equal(s.settings.conditionalConstants.A,1);assert.equal(s.modules[0].form,undefined);assert.equal(s.assets,undefined);
});
test('diagnostic snapshot has explicit resource limits',()=>{
 assert.throws(()=>diagnosticSnapshot({modules:Array.from({length:2049},()=>module())}),/2,048/);
 assert.throws(()=>diagnosticSnapshot(project(module('Huge','x'.repeat(16*1024*1024+1)))),/16 Mi/);
 assert.throws(()=>diagnosticSnapshot(null),/project/);
});
test('fallback diagnostics debounce bursts and deliver only latest source',async()=>{
 const results=[],s=new DiagnosticsScheduler({workerFactory:null,delay:8,onResult:r=>results.push(r)});const p=project(module('M','bad syntax'));
 s.schedule(p);p.modules[0].code='Sub Main()\nEnd Sub';s.schedule(p);await idle(s);
 assert.equal(results.length,1);assert.equal(results[0].valid,true);assert.equal(results[0].mode,'fallback');assert.equal(s.metrics.requests,2);s.dispose();
});
test('fallback yields between modules and aborts a superseded snapshot',async()=>{
 const results=[],s=new DiagnosticsScheduler({workerFactory:null,delay:0,onResult:r=>results.push(r)});
 s.schedule(project(...Array.from({length:60},(_,i)=>module('M'+i,'bad syntax'))));await wait(8);s.schedule(project());await idle(s);
 assert.equal(results.length,1);assert.equal(results[0].valid,true);assert.ok(s.metrics.discarded>0);s.dispose();
});
test('out-of-order worker replies cannot overwrite a newer project',async()=>{
 const results=[],messages=[];const worker={postMessage:m=>messages.push(m),terminate(){}};
 const s=new DiagnosticsScheduler({workerFactory:()=>worker,delay:0,onResult:r=>results.push(r)});
 s.schedule(project(module('Old','bad syntax')));await wait(4);s.schedule(project(module('New')));await wait(4);
 const old=messages[0];worker.onmessage({data:{type:'diagnostics-result',revision:old.revision,result:{valid:false,diagnostics:[],stats:{}}}});
 assert.equal(messages.length,2);assert.equal(results.length,0);
 worker.onmessage({data:{type:'diagnostics-result',revision:old.revision,result:{valid:false}}});assert.equal(results.length,0);
 worker.onmessage({data:{type:'diagnostics-result',revision:messages[1].revision,result:{valid:true,diagnostics:[],stats:{}}}});
 assert.equal(results.length,1);assert.equal(results[0].valid,true);s.dispose();
});
test('worker constructor failure has an operational fallback',async()=>{
 const results=[],s=new DiagnosticsScheduler({workerFactory:()=>{throw new Error('CSP');},delay:0,onResult:r=>results.push(r)});s.schedule(project());await idle(s);assert.equal(results[0].valid,true);assert.equal(results[0].mode,'fallback');s.dispose();
});
test('worker script errors terminate/revoke worker and fall back',async()=>{
 let stopped=0,released=0;const results=[],worker={postMessage(){},terminate(){stopped++;},releaseSource(){released++;}};
 const s=new DiagnosticsScheduler({workerFactory:()=>worker,delay:0,onResult:r=>results.push(r)});s.schedule(project());await wait(4);worker.onerror({preventDefault(){}});await idle(s);assert.equal(stopped,1);assert.equal(released,1);assert.equal(results[0].valid,true);s.dispose();
});
test('unresponsive workers time out rather than leave the status pending',async()=>{
 let stopped=0;const results=[],worker={postMessage(){},terminate(){stopped++;}};const s=new DiagnosticsScheduler({workerFactory:()=>worker,delay:0,timeout:8,onResult:r=>results.push(r)});s.schedule(project());await idle(s);assert.equal(stopped,1);assert.equal(results[0].mode,'fallback');s.dispose();
});
test('cancelling a run prevents delayed diagnostics reaching the IDE',async()=>{
 const results=[],s=new DiagnosticsScheduler({workerFactory:null,delay:8,onResult:r=>results.push(r)});s.schedule(project());s.cancel();await wait(20);assert.equal(s.pending,false);assert.equal(results.length,0);s.schedule(project());await idle(s);assert.equal(results.length,1);s.dispose();
});
test('disposal drops caches, timers and pending delivery',async()=>{
 const results=[],s=new DiagnosticsScheduler({workerFactory:null,delay:8,onResult:r=>results.push(r)});s.schedule(project());s.dispose();s.schedule(project());await wait(20);assert.equal(results.length,0);assert.equal(s.cache.entries.size,0);assert.equal(s.pending,false);
});

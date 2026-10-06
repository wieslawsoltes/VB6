import {WIN32_SYSTEM_SAMPLES} from '../src/project/win32-system-examples.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {WIN32_SERVICE_SAMPLES,createWin32ServiceExample} from '../src/project/win32-service-examples.js';
import {exportApplication} from '../src/exporter/exporter.js';

for(const sample of [...WIN32_SERVICE_SAMPLES,...WIN32_SYSTEM_SAMPLES]){
  test('shipped '+sample.id+' compiles and runs twice with no handle/buffer leaks',async t=>{
    const project={id:sample.id,name:sample.name,startup:'Sub Main',modules:[{kind:'module',name:'Services',code:sample.code+'\nPublic Sub Main()\nDebug.Print RunService(TargetWindow())\nDebug.Print RunService(TargetWindow())\nEnd Sub\nPrivate Declare Function TargetWindow Lib "sample" () As Long\n'}]};
    const compiled=compileProject(project);assert.deepEqual(compiled.diagnostics,[]);const out=[],vm=new VirtualMachine(compiled,{print:s=>out.push(s)});t.after(()=>vm.stop());
    const api=vm.win32.api,window=api.registerWindow({}),before=api.handles.entries.size;
    api.register('sample','TargetWindow',()=>window,{arity:0});await vm.start();if(vm.state==='error')throw vm.lastError;
    assert.equal(out.length,2);for(const result of out)for(const expected of sample.expected)assert.ok(result.includes(expected),result);
    assert.equal(api.handles.entries.size,before);assert.equal(api.memory.used,0);
  });
  test('shipped '+sample.id+' is available as classic form and single HTML app',()=>{
    const project=createWin32ServiceExample(sample);assert.deepEqual(compileProject(project).diagnostics,[]);const html=exportApplication(project);assert.ok(html.includes('Run API sample'));assert.ok(html.includes('RunService'));assert.equal(project.modules[1].code,sample.code);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';
import {VBScalar} from '../src/runtime/values.js';

function create(t,code){
  const project={name:'Debugger scalar integration',startup:'Sub Main',modules:[{kind:'module',name:'M',code}]};
  const output=[],vm=new VirtualMachine(project,{print:text=>output.push(text)},{debuggerEnabled:true});
  assert.ok(vm.program.valid,JSON.stringify(vm.program.diagnostics));t.after(()=>vm.stop());
  return {project,vm,output};
}
function pause(vm){return new Promise(resolve=>{const off=vm.on('pause',event=>{off();resolve(event);});});}

test('Immediate void source and host calls stay silent with scalar metadata',async t=>{
  const {vm,output}=create(t,'Sub Main()\nEnd Sub\nSub Silent()\nEnd Sub');
  await vm.prepareImmediateContext();
  vm.library.set('hostvoid',()=>undefined);
  vm.library.set('taggedvoid',()=>new VBScalar(undefined,'empty',true));
  for(const text of ['Silent','Call Silent()','HostVoid()','TaggedVoid()']){
    assert.equal(await vm.immediate(text),undefined,text);
    assert.deepEqual(output,[],text);
  }
});

test('explicit Immediate Empty and Null remain visible; zero and False are not void',async t=>{
  const {vm,output}=create(t,'Public value As Variant\nSub Main()\nEnd Sub');
  await vm.prepareImmediateContext();
  await vm.immediate('? value');await vm.immediate('Print Empty');await vm.immediate('? Null');
  await vm.immediate('CInt(0)');await vm.immediate('CBool(0)');
  assert.deepEqual(output,['Empty','Empty','Null','0','False']);
});

test('event-mode Immediate retains Variant promotion and exposes the new subtype',async t=>{
  const {vm,output}=create(t,'Public value As Variant\nSub Main()\nDebug.Print "unexpected startup"\nEnd Sub\nSub Tick()\nvalue = value + 1\nEnd Sub');
  await vm.prepareImmediateContext();await vm.immediate('value = CInt(32767)');
  assert.equal(vm.inspectDebug('value').type,'Integer');
  vm.configureImmediateEvents(true);await vm.dispatch('M','Tick');
  assert.equal(await vm.immediate('? VarType(value)'),3);
  assert.equal(vm.inspectDebug('value').type,'Long');
  assert.equal(vm.inspectDebug('value').value,'32768');
  assert.deepEqual(output,['3']);
});

test('versioned code retains a ByRef Variant cell and its promotion across revisions',async t=>{
  const code='Sub Main()\nDim value As Variant\nvalue = CInt(32767)\nWork value\nDebug.Print VarType(value)\nWork value\nDebug.Print value\nEnd Sub\nSub Work(ByRef value As Variant)\nvalue = value + 1\nEnd Sub';
  const {project,vm,output}=create(t,code),stopped=pause(vm);
  vm.setBreakpoint('M',10);const running=vm.start();await stopped;
  const cell=vm.currentFrame.locals.get('value');
  assert.equal(vm.inspectDebug('value').type,'Integer');
  project.modules[0].code=code.replace('value = value + 1','Dim delta As Long\ndelta = 10\nvalue = value + delta');
  const result=vm.applyEdits(project,{policy:'versioned'});
  assert.equal(result.retainedFrames.length,2);assert.equal(vm.currentFrame.locals.get('value'),cell);
  assert.equal(vm.inspectDebug('value').type,'Integer');
  vm.breakpoints.clear();vm.resume();await running;
  assert.deepEqual(output,['3','32778']);
});

test('strict rejection preserves tagged local identity, subtype and pause ticket',async t=>{
  const code='Sub Main()\nDim value As Variant\nvalue = CByte(7)\nDebug.Print VarType(value)\nEnd Sub';
  const {project,vm,output}=create(t,code),stopped=pause(vm);
  vm.setBreakpoint('M',4);const running=vm.start();await stopped;
  const frame=vm.currentFrame,cell=frame.locals.get('value'),scalar=cell.getScalar(),pauseId=vm.debugPauseId;
  project.modules[0].code=code.replace('Dim value As Variant','Dim value As Long');
  assert.throws(()=>vm.applyEdits(project,{policy:'strict'}),/Restart required/);
  assert.equal(vm.currentFrame,frame);assert.equal(vm.debugPauseId,pauseId);
  assert.equal(cell.getScalar(),scalar);assert.equal(vm.inspectDebug('value').type,'Byte');
  vm.resume();await running;assert.deepEqual(output,['17']);
});

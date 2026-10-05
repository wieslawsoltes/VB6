import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';

const source = {name:'DebuggerIntegration',startup:'Sub Main',modules:[{
  name:'M',kind:'module',code:'Public value As Long\nSub Main()\nvalue = 1\nEnd Sub'
}]};

test('debugger Reset settles queued events and retains native automation cleanup', async () => {
  let closed = 0, delivered = 0;
  const vm = new VirtualMachine(source, {automation:{createSession:()=>({
    close:async()=>{closed++;}
  })}}, {debuggerEnabled:true});
  vm.eventQueue.push({resolve:()=>{delivered++;}});
  vm.pauseRequested = true;
  vm.runTarget = {module:'M',line:3};
  vm.stepMode = {mode:'into',depth:0};
  vm.stop();
  await vm.automationClose;
  assert.equal(closed,1);
  assert.equal(delivered,1);
  assert.equal(vm.eventQueue.length,0);
  assert.equal(vm.state,'stopped');
  assert.equal(vm.pauseRequested,false);
  assert.equal(vm.runTarget,null);
  assert.equal(vm.stepMode,null);
});

test('design Immediate Reset closes opt-in automation without starting user code', async () => {
  let closed = 0;
  const vm = new VirtualMachine(source, {automation:{createSession:()=>({
    close:async()=>{closed++;}
  })}}, {debuggerEnabled:true});
  try {
    await vm.prepareImmediateContext();
    assert.equal(await vm.immediate('? value'),0);
    assert.equal(vm.instructionCount,0);
  } finally {
    vm.stop();
    await vm.automationClose;
  }
  assert.equal(closed,1);
});

test('invalid stepping modes do not mutate a paused debugger', () => {
  const vm = new VirtualMachine(source, {}, {debuggerEnabled:true});
  try {
    vm.setState('paused');
    assert.throws(()=>vm.resume('unknown'),/Invalid stepping mode/);
    assert.equal(vm.state,'paused');
    assert.equal(vm.stepMode,null);
  } finally { vm.stop(); }
});

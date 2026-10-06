import test from 'node:test';
import assert from 'node:assert/strict';
import {isBreakpointStop} from '../tools/native-debugger-stop.mjs';
const target={pid:1234,symbol:'DebugTarget!DebugTick',id:7};
const session={state:'paused',pid:1234,lastStop:'Breakpoint 7 hit\r\nDebugTarget!DebugTick:\r\n'};
const stack={frames:[{index:0,symbol:'DebugTarget!DebugTick+0x2 [C:\\src\\target.c @ 17]'}]};
test('native qualification requires current-frame symbol, target PID and breakpoint event',()=>{
  assert.equal(isBreakpointStop(session,stack,target),true);
  assert.equal(isBreakpointStop({...session,pid:5678},stack,target),false);
  assert.equal(isBreakpointStop({...session,state:'running'},stack,target),false);
  assert.equal(isBreakpointStop({...session,lastStop:'Breakpoint 70 hit\n'},stack,target),false);
  assert.equal(isBreakpointStop({...session,lastStop:'Create process\n'},stack,target),false);
});
test('native qualification rejects a suspended caller and missing frame zero',()=>{
  assert.equal(isBreakpointStop(session,{frames:[{index:0,symbol:'ntdll!ZwDelayExecution+0x14'}, {...stack.frames[0],index:4}]},target),false);
  assert.equal(isBreakpointStop(session,{frames:[{...stack.frames[0],index:4}]},target),false);
  assert.equal(isBreakpointStop(session,{frames:[{index:0,symbol:'DebugTarget!DebugTickOther'}]},target),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';
import {immediateStatements} from '../src/runtime/debug-control.js';

function runtime(t,code='',modules=[],host={},options={}){
  const output=[],vm=new VirtualMachine({name:'Immediate',startup:'Sub Main',modules:[{name:'M',kind:'module',code},...modules]},
    {print:text=>output.push(text),...host},{debuggerEnabled:true,...options});
  t.after(()=>vm.stop());return {vm,output};
}

test('design Immediate prepares storage without invoking startup',async t=>{
  const {vm,output}=runtime(t,'Public counter As Long\nSub Main()\ncounter = 999\nDebug.Print "startup"\nEnd Sub');
  await vm.prepareImmediateContext();assert.equal(vm.state,'idle');assert.equal(vm.stack.length,0);assert.equal(vm.instructionCount,0);
  assert.equal(await vm.immediate('? counter'),0);assert.deepEqual(output,['0']);
});
test('design Immediate supports a module project without Sub Main',async t=>{
  const {vm}=runtime(t,'Private counter As Long\nPublic Function Bump() As Long\ncounter = counter + 1\nBump = counter\nEnd Function');
  await vm.prepareImmediateContext();assert.equal(await vm.immediate('? Bump()'),1);assert.equal(await vm.immediate('? Bump()'),2);
});
test('Immediate preparation requires a fresh explicitly enabled debugger',async t=>{
  const {vm}=runtime(t,'',[],{},{debuggerEnabled:false});await assert.rejects(vm.prepareImmediateContext(),/fresh debugger runtime/);
  const other=runtime(t).vm;await other.initialize();await assert.rejects(other.prepareImmediateContext(),/fresh debugger runtime/);
});
test('concurrent preparation retains exactly one initialized module instance',async t=>{
  const {vm}=runtime(t,'Public value As Long');await Promise.all([vm.prepareImmediateContext(),vm.prepareImmediateContext()]);
  await vm.immediate('value = 7');const instance=vm.instances.get('m');await vm.prepareImmediateContext();assert.equal(vm.instances.get('m'),instance);assert.equal(await vm.immediate('? value'),7);
});
test('invalid design source cannot enter an initialized context',async t=>{
  const {vm}=runtime(t,'Sub Main(\n');await assert.rejects(vm.prepareImmediateContext());assert.equal(vm.state,'stopped');assert.equal(vm.debugEvaluation,undefined);
});
test('preparation creates form storage but does not invoke form startup events',async t=>{
  let attached=0;
  const {vm,output}=runtime(t,'',[{name:'Form1',kind:'form',form:{type:'Form',properties:{},controls:[]},code:'Public value As Long\nSub Form_Initialize()\nDebug.Print "initialize"\nEnd Sub\nSub Form_Load()\nDebug.Print "load"\nEnd Sub'}],{createForm:()=>{attached++;return {controlMap:new Map()};}});
  await vm.prepareImmediateContext();assert.equal(attached,1);assert.deepEqual(output,[]);assert.equal(await vm.immediate('? value',{module:'Form1'}),0);
});
test('design Immediate selects each active module private context',async t=>{
  const {vm}=runtime(t,'Private n As Long\nPrivate Function ReadN() As Long\nReadN = n\nEnd Function',[{name:'Other',kind:'module',code:'Private n As Long\nPrivate Function ReadN() As Long\nReadN = n\nEnd Function'}]);
  await vm.prepareImmediateContext();await vm.immediate('n = 3',{module:'M'});await vm.immediate('n = 8',{module:'oThEr'});
  assert.equal(await vm.immediate('? ReadN()',{module:'M'}),3);assert.equal(await vm.immediate('? ReadN()',{module:'Other'}),8);
  await assert.rejects(vm.immediate('? n',{module:'Missing'}),/No initialized module context/);
});
test('design Immediate retains implicit temporary variables per module',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();await vm.immediate('temporary = 17');assert.equal(await vm.immediate('? temporary'),17);
});
test('Immediate separators honor comments dates strings type suffixes and named arguments',()=>{
  assert.deepEqual(immediateStatements('? "it\'s:12": Print #10:30:00#: x# = 2: Call Work(value:=3) \' : x = 999'),['? "it\'s:12"','Print #10:30:00#','x# = 2','Call Work(value:=3)']);
  assert.deepEqual(immediateStatements('x = 1: Rem ignore: x = 2\n? x\r\n\'comment'),['x = 1','? x']);
});
test('Immediate apostrophe comments never execute their colon tail',async t=>{
  const {vm}=runtime(t,'Public n As Long');await vm.prepareImmediateContext();await vm.immediate('n = 1 \' : n = 999\n? n');assert.equal(await vm.immediate('? n'),1);
});
test('Immediate Rem comments consume only their own physical line',async t=>{
  const {vm}=runtime(t,'Public n As Long');await vm.prepareImmediateContext();await vm.immediate('n = 2: Rem ignore: n = 999\nPrint n');assert.equal(await vm.immediate('? n'),2);
});
test('Immediate standalone Print supports literals and preserves question marks',async t=>{
  const {vm,output}=runtime(t);await vm.prepareImmediateContext();await vm.immediate('Print "why?: now"');assert.deepEqual(output,['"why?: now"']);
});
test('design Immediate suppresses interactive breakpoint and Stop/Assert suspension',async t=>{
  const {vm}=runtime(t,'Function Value() As Long\nStop\nDebug.Assert False\nValue = 12\nEnd Function');await vm.prepareImmediateContext();
  vm.setBreakpoint('M',4);vm.on('pause',()=>assert.fail('Explicit evaluation must not suspend indefinitely'));
  assert.equal(await vm.immediate('? Value()'),12);assert.equal(vm.state,'idle');assert.equal(vm.instructionCount,0);
});
test('idle Immediate is instruction-bounded even under On Error Resume Next',async t=>{
  const {vm}=runtime(t,'Function Spin() As Long\nOn Error Resume Next\nDo\nLoop\nEnd Function');await vm.prepareImmediateContext();
  await assert.rejects(vm.immediate('? Spin()',{instructionLimit:15}),/instruction limit/);assert.equal(vm.debugEvaluation,null);assert.equal(vm.state,'idle');assert.equal(vm.stack.length,0);assert.equal(await vm.immediate('? 2 + 2'),4);
});
test('idle Immediate is time-bounded when native work never resolves',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();vm.library.set('waitforever',()=>new Promise(()=>{}));
  await assert.rejects(vm.immediate('? WaitForever()',{timeLimit:15}),/time limit/);assert.equal(vm.stack.length,0);assert.equal(vm.debugEvaluation,null);
});
test('idle Immediate cancellation rejects concurrent commands and remains reusable',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();vm.library.set('waitforever',()=>new Promise(()=>{}));
  const pending=vm.immediate('? WaitForever()');await assert.rejects(vm.immediate('x = 999'),/in progress/);assert.equal(vm.cancelEvaluation().cancelled,true);
  await assert.rejects(pending,/cancelled/);assert.equal(await vm.immediate('? 5'),5);
});
test('idle Immediate restores Err and debugger state after evaluation errors',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();vm.err.Number=13;vm.err.Description='retained';vm.lastErrorErl=40;
  await assert.rejects(vm.immediate('? 1 / 0'));assert.equal(vm.err.Number,13);assert.equal(vm.err.Description,'retained');assert.equal(vm.lastErrorErl,40);assert.equal(vm.currentFrame,null);
});
test('Reset aborts Immediate without resurrecting a stopped session',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();vm.library.set('waitforever',()=>new Promise(()=>{}));const pending=vm.immediate('? WaitForever()');vm.stop();
  await assert.rejects(pending,/cancelled/);assert.equal(vm.state,'stopped');assert.equal(vm.debugEvaluation,null);await assert.rejects(vm.immediate('? 1'),/Pause execution/);
});
test('idle Immediate validates stale frame identities instead of silently ignoring them',async t=>{
  const {vm}=runtime(t);await vm.prepareImmediateContext();await assert.rejects(vm.immediate('? 1',{pauseId:99}),/context changed/);await assert.rejects(vm.immediate('? 1',{frameIndex:0}),/frame/);
});

test('design Immediate does not dispatch background events or reuse storage for startup',async t=>{
  const {vm,output}=runtime(t,'Sub Tick()\nDebug.Print "event"\nEnd Sub');await vm.prepareImmediateContext();
  await vm.dispatch('M','Tick');assert.equal(vm.eventQueue.length,0);assert.deepEqual(output,[]);
  await assert.rejects(vm.start(),/Reset design-mode Immediate/);assert.equal(vm.state,'idle');
  vm.stop();await assert.rejects(vm.prepareImmediateContext(),/was reset/);
});

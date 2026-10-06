import {uniqueInstructionLines} from '../src/runtime/instruction-map.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';
const project=(code,modules=[])=>({name:'Boundary tests',startup:'Sub Main',modules:[{kind:'module',name:'M',code},...modules]});
async function prepared(t,code,modules=[],host={}){const output=[],vm=new VirtualMachine(project(code,modules),{print:s=>output.push(s),...host},{debuggerEnabled:true});assert.ok(vm.program.valid,JSON.stringify(vm.program.diagnostics));t.after(()=>vm.stop());await vm.prepareImmediateContext();return {vm,output};}
const atPause=vm=>new Promise(resolve=>{const off=vm.on('pause',e=>{off();resolve(e);});});
async function paused(t,code,line){const p=project(code),out=[],vm=new VirtualMachine(p,{print:s=>out.push(s)},{debuggerEnabled:true});assert.ok(vm.program.valid);t.after(()=>vm.stop());const at=atPause(vm);vm.setBreakpoint('M',line);const running=vm.start();await at;return {vm,p,running,out};}

test('design events remain off until explicitly enabled',async t=>{const {vm}=await prepared(t,'Public n As Long\nSub Tick()\nn = n + 1\nEnd Sub');await vm.dispatch('M','Tick');assert.equal(await vm.immediate('? n'),0);assert.deepEqual(vm.configureImmediateEvents(true),{enabled:true,state:'running',startupExecuted:false});await vm.dispatch('M','Tick');assert.equal(await vm.immediate('? n'),1);vm.configureImmediateEvents(false);await vm.dispatch('M','Tick');assert.equal(await vm.immediate('? n'),1);});
test('design events never execute Sub Main as a side effect',async t=>{const {vm,output}=await prepared(t,'Sub Main()\nDebug.Print "startup"\nEnd Sub\nSub Tick()\nDebug.Print "tick"\nEnd Sub');vm.configureImmediateEvents(true);await vm.dispatch('M','Tick');assert.deepEqual(output,['tick']);await assert.rejects(vm.start(),/Reset design-mode/);});
test('an Immediate event handler supports real breakpoints and source stepping',async t=>{const {vm,output}=await prepared(t,'Public n As Long\nSub Tick()\nn = n + 1\nDebug.Print n\nEnd Sub');vm.configureImmediateEvents(true);vm.setBreakpoint('M',3);const first=atPause(vm),event=vm.dispatch('M','Tick');await first;assert.equal(vm.state,'paused');assert.equal(vm.debugStack()[0].procedure,'Tick');const second=atPause(vm);vm.resume('into');await second;assert.equal(vm.currentFrame.proc.code[vm.currentFrame.pc].line,4);vm.breakpoints.clear();vm.resume();await event;assert.deepEqual(output,['1']);});
test('Immediate event delivery waits for explicit evaluation and retains ordering',async t=>{const {vm,output}=await prepared(t,'Sub Tick()\nDebug.Print "event"\nEnd Sub');vm.configureImmediateEvents(true);let release;vm.library.set('wait',()=>new Promise(r=>release=r));const evaluation=vm.immediate('Wait()');while(!release)await new Promise(r=>setTimeout(r,0));const event=vm.dispatch('M','Tick');assert.equal(vm.eventQueue.length,1);assert.deepEqual(output,[]);release();await evaluation;await event;assert.deepEqual(output,['event']);});
test('Reset settles design events queued behind a paused callback',async t=>{const {vm}=await prepared(t,'Sub Tick()\nDebug.Print 1\nEnd Sub');vm.configureImmediateEvents(true);vm.setBreakpoint('M',2);const at=atPause(vm),first=vm.dispatch('M','Tick');await at;const second=vm.dispatch('M','Tick');vm.stop();await Promise.all([first,second]);assert.equal(vm.stack.length,0);assert.equal(vm.eventQueue.length,0);});
test('event delivery options are validated without mutating the runtime',async t=>{const {vm}=await prepared(t,'Sub Tick()\nDebug.Print 1\nEnd Sub');assert.throws(()=>vm.configureImmediateEvents('yes'),/prepared design-mode/);assert.equal(vm.state,'idle');vm.configureImmediateEvents(true);vm.setBreakpoint('M',2);const at=atPause(vm),event=vm.dispatch('M','Tick');await at;assert.throws(()=>vm.configureImmediateEvents(false),/Finish the current handler/);vm.stop();await event;});
test('design form initialization is lazy and precedes Load exactly once',async t=>{const form={kind:'form',name:'Form1',form:{type:'Form',properties:{},controls:[]},code:'Sub Form_Initialize()\nDebug.Print "init"\nEnd Sub\nSub Form_Load()\nDebug.Print "load"\nEnd Sub\nSub Form_Activate()\nDebug.Print "activate"\nEnd Sub'};const {vm,output}=await prepared(t,'',[form],{createForm:()=>({controlMap:new Map(),Show(){this.shown=true;},Hide(){this.shown=false;}})});assert.deepEqual(output,[]);vm.configureImmediateEvents(true);await vm.immediate('Form1.Show');await vm.immediate('Form1.Show');assert.deepEqual(output,['init','load','activate','activate']);});

test('versioned edit retains an unmappable active statement and uses new code on next invocation',async t=>{const code='Sub Main()\nWorker\nWorker\nEnd Sub\nSub Worker()\nDebug.Print 1\nDebug.Print 2\nEnd Sub';const {vm,p,running,out}=await paused(t,code,6);p.modules[0].code=code.replace('Debug.Print 1\n','');assert.throws(()=>vm.applyEdits(p),/Restart required/);const result=vm.applyEdits(p,{policy:'versioned'});assert.equal(result.retainedFrames.length,2);assert.equal(vm.debugStack()[1].sourceText,code);assert.equal(vm.debugStack()[1].retained,true);vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['1','2','2']);});
test('versioned control flow edit retains For iterator state and ByRef aliases',async t=>{const code='Sub Main()\nDim n As Long\nWork n\nDebug.Print n\nWork n\nDebug.Print n\nEnd Sub\nSub Work(ByRef n As Long)\nDim i As Long\nFor i = 1 To 2\nn = n + 1\nNext\nEnd Sub';const {vm,p,running,out}=await paused(t,code,11);const cell=vm.currentFrame.locals.get('n');p.modules[0].code=code.replace('For i = 1 To 2\nn = n + 1\nNext','n = n + 10');vm.applyEdits(p,{policy:'versioned'});assert.equal(vm.currentFrame.locals.get('n'),cell);assert.equal(vm.currentFrame.temps.size,1);vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['2','12']);});
test('versioned edits support changed local layouts and active procedure signatures',async t=>{const code='Sub Main()\nDebug.Print Work(2)\nDebug.Print Work(3)\nEnd Sub\nFunction Work(n As Long) As Long\nWork = n + 1\nEnd Function';const {vm,p,running,out}=await paused(t,code,6);p.modules[0].code=code.replace('Function Work(n As Long) As Long\nWork = n + 1','Function Work(n As Long, Optional extra As Long = 10) As Long\nDim total As Long\ntotal = n + extra\nWork = total');vm.applyEdits(p,{policy:'versioned'});assert.equal(vm.currentFrame.proc.params.length,1);vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['3','13']);});
test('repeated versioned edits never relabel retained source as the latest revision',async t=>{const code='Sub Main()\nDebug.Print 1\nDebug.Print 2\nEnd Sub';const {vm,p,running,out}=await paused(t,code,2);p.modules[0].code=code.replace('Debug.Print 1\n','');vm.applyEdits(p,{policy:'versioned'});p.modules[0].code=p.modules[0].code.replace('2','3');vm.applyEdits(p,{policy:'versioned'});assert.equal(vm.debugStack()[0].sourceText,code);assert.equal(vm.debugStack()[0].revision,0);assert.throws(()=>vm.setNextStatement('M',2),/retained source revision/);vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['1','2']);});
test('versioned removal of an active procedure keeps that invocation alive',async t=>{const code='Sub Main()\nWorker\nEnd Sub\nSub Worker()\nDebug.Print 4\nEnd Sub';const {vm,p,running,out}=await paused(t,code,5);p.modules[0].code='Sub Main()\nDebug.Print 9\nEnd Sub';vm.applyEdits(p,{policy:'versioned'});assert.equal(vm.program.modules.get('m').procedures.has('worker'),false);vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['4']);});
test('versioned invalid source and incompatible storage changes remain atomic',async t=>{const code='Public count As Long\nSub Main()\nDebug.Print count\nEnd Sub';const {vm,p,running}=await paused(t,code,3),old=vm.currentFrame.proc;p.modules[0].code='Sub Broken(';assert.throws(()=>vm.applyEdits(p,{policy:'versioned'}));assert.equal(vm.currentFrame.proc,old);p.modules[0].code=code.replace('count As Long','count As String');assert.throws(()=>vm.applyEdits(p,{policy:'versioned'}),/storage changed/);assert.equal(vm.currentFrame.proc,old);assert.equal(vm.codeRevision,undefined);vm.resume();await running;});
test('safe versioned edits still update the pending statement immediately',async t=>{const {vm,p,running,out}=await paused(t,'Sub Main()\nDebug.Print 1\nEnd Sub',2);p.modules[0].code='Sub Main()\nDebug.Print 2\nEnd Sub';const result=vm.applyEdits(p,{policy:'versioned'});assert.deepEqual(result.retainedFrames,[]);assert.equal(vm.debugStack()[0].retained,undefined);vm.resume();await running;assert.deepEqual(out,['2']);});


test('versioned edits never alias a changed Static local type to an old live cell',async t=>{
  const code='Sub Main()\nWork\nWork\nEnd Sub\nSub Work()\nStatic value As Long\nvalue = value + 1\nDebug.Print value\nEnd Sub';
  const {vm,p,running,out}=await paused(t,code,7),cell=vm.currentFrame.locals.get('value');
  p.modules[0].code=code.replace('Static value As Long','Static value As String').replace('value = value + 1','value = "new"');
  assert.throws(()=>vm.applyEdits(p,{policy:'versioned'}),/static local storage/i);
  assert.equal(vm.currentFrame.locals.get('value'),cell);assert.equal(cell.get(),0);assert.equal(vm.codeRevision,undefined);
  vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['1','2']);
});
test('inactive static layouts are protected by both live-edit policies',async t=>{
  const code='Sub Main()\nWork\nDebug.Print "pause"\nWork\nEnd Sub\nSub Work()\nStatic value As Long\nvalue = value + 1\nDebug.Print value\nEnd Sub';
  const {vm,p,running,out}=await paused(t,code,3);
  p.modules[0].code=code.replace('Static value As Long','Static value As String');
  for(const policy of ['strict','versioned'])assert.throws(()=>vm.applyEdits(p,{policy}),/static local storage/i);
  vm.breakpoints.clear();vm.resume();await running;assert.deepEqual(out,['1','pause','2']);
});
test('adding a new Static local preserves an existing compatible static value',async t=>{
  const code='Sub Main()\nWork\nDebug.Print "pause"\nWork\nEnd Sub\nSub Work()\nStatic value As Long\nvalue = value + 1\nDebug.Print value\nEnd Sub';
  const {vm,p,running,out}=await paused(t,code,3);
  p.modules[0].code=code.replace('Static value As Long','Static value As Long\nStatic added As Long');
  vm.applyEdits(p,{policy:'versioned'});vm.breakpoints.clear();vm.resume();await running;
  assert.deepEqual(out,['1','pause','2']);
});


test('large retained instruction mapping indexes each new instruction only once',()=>{
  let reads=0;const make=(line,n)=>({line,get op(){reads++;return 'print';},value:n});
  const old=Array.from({length:5000},(_,i)=>make(i+1,i)),next=Array.from({length:5000},(_,i)=>make(i+2,i));
  const mapping=uniqueInstructionLines(old,next);assert.equal(mapping.size,5000);assert.equal(mapping.get(5000),5001);
  assert.equal(reads,10000,'Each old/new instruction is serialized once, without a quadratic candidate scan');
  assert.equal(uniqueInstructionLines([{op:'print',line:1,value:1}],[{op:'print',line:2,value:1},{op:'print',line:3,value:1}]).size,0,'Duplicate destinations remain ambiguous');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {isSequencePoint} from '../src/runtime/debug-control.js';

const project=(code,modules=[])=>({name:'Debugger',startup:'Sub Main',settings:{},modules:[{name:'M',kind:'module',code},...modules]});
const create=(code,options={},modules=[])=>{
  const p=project(code,modules),output=[],vm=new VirtualMachine(compileProject(p),{print:value=>output.push(value)},options);
  assert.equal(vm.program.valid,true,JSON.stringify(vm.program.diagnostics));return {vm,p,output};
};
// Test failures must reset suspended execution instead of hanging the suite.
async function run(paused,{vm,...rest},start={}){
  let failure,count=0;vm.on('pause',e=>{if(++count>100){failure ||= new Error('Unexpected repeated pause');vm.stop();return;}Promise.resolve().then(()=>paused(e,vm,rest)).catch(error=>{failure ||= error;vm.stop();});});
  const timer=setTimeout(()=>{failure ||= new Error('Debugger test timed out');vm.stop();},2000);try{await vm.start(start);if(failure)throw failure;assert.ok(count<100);return {count,...rest};}finally{clearTimeout(timer);vm.stop();}
}
const debug={debuggerEnabled:true};

test('compiler emits separate colon sequence points and hides declarations and implicit return',()=>{
  const {vm}=create('Sub Main()\nDim x As Long\nx = 1: x = 2: Debug.Print x\nEnd Sub');
  const code=vm.program.modules.get('m').procedures.get('main').code;
  assert.deepEqual(code.filter(isSequencePoint).map(i=>[i.op,i.line]),[['assign',3],['assign',3],['print',3]]);
  assert.equal(isSequencePoint(code[0]),false);assert.equal(isSequencePoint(code.at(-1)),false);
});
test('F8 steps each colon statement once without a synthetic return stop',async()=>{
  const trace=[],result=await run((e,vm)=>{trace.push([e.instruction.line,e.frame.locals.get('x')?.get()]);vm.resume('into');},create('Sub Main()\nDim x As Long\nx = 1: x = 2: Debug.Print x\nEnd Sub'),{breakOnEntry:true});
  assert.deepEqual(trace,[[3,0],[3,1],[3,2]]);assert.deepEqual(result.output,['2']);
});
test('physical-line breakpoints hit once per loop traversal, not once per colon',async()=>{
  const data=create('Sub Main()\nDim i As Long, n As Long\nFor i = 1 To 2\nn = n + 1: n = n + 1\nNext\nDebug.Print n\nEnd Sub');data.vm.setBreakpoint('M',4);
  const seen=[];const result=await run((e,vm)=>{seen.push(e.frame.locals.get('n').get());vm.resume();},data);assert.deepEqual(seen,[0,2]);assert.deepEqual(result.output,['4']);
});
test('single-line If exposes only the condition and selected statements, not skip jumps',async()=>{
  const seen=[];await run((e,vm)=>{seen.push(e.instruction.op);vm.resume('into');},create('Sub Main()\nIf True Then Debug.Print 1: Debug.Print 2 Else Debug.Print 9\nEnd Sub'),{breakOnEntry:true});assert.deepEqual(seen,['branch','print','print']);
});
test('ElseIf and Case skip jumps never cause phantom pauses',async()=>{
  const code='Sub Main()\nIf False Then\nDebug.Print 1\nElseIf True Then\nDebug.Print 2\nElse\nDebug.Print 3\nEnd If\nSelect Case 2\nCase 1\nDebug.Print 4\nCase 2\nDebug.Print 5\nCase Else\nDebug.Print 6\nEnd Select\nEnd Sub',seen=[];
  const result=await run((e,vm)=>{seen.push(e.instruction.op);vm.resume('into');},create(code),{breakOnEntry:true});assert.ok(!seen.includes('jump'));assert.deepEqual(result.output,['2','5']);
});
test('Step Over skips the callee but stops on the following same-line statement',async()=>{
  const trace=[];await run((e,vm)=>{trace.push(e.instruction.procedure+':'+e.instruction.op);vm.resume('over');},create('Sub Main()\nCall Worker(): Debug.Print 2\nEnd Sub\nSub Worker()\nDebug.Print 1\nEnd Sub'),{breakOnEntry:true});assert.deepEqual(trace,['Main:expr','Main:print']);
});
test('a callee breakpoint interrupts Step Over, and Step Out resumes at the caller statement',async()=>{
  const data=create('Sub Main()\nWorker\nDebug.Print 2\nEnd Sub\nSub Worker()\nDebug.Print 1\nEnd Sub');data.vm.setBreakpoint('M',6);const trace=[];
  await run((e,vm)=>{trace.push([e.instruction.line,e.reason]);vm.resume(trace.length===1?'over':trace.length===2?'out':'continue');},data,{breakOnEntry:true});assert.deepEqual(trace,[[2,'step'],[6,'breakpoint'],[3,'step']]);
});
test('Step Out handles recursive frames, not just procedure names',async()=>{
  const data=create('Sub Main()\nWorker 2\nDebug.Print 9\nEnd Sub\nSub Worker(n As Long)\nIf n > 0 Then Worker n - 1\nDebug.Print n\nEnd Sub');data.vm.setBreakpoint('M',7,'n = 0');const depths=[];
  await run((e,vm)=>{depths.push(e.frame.depth);vm.breakpoints.clear();vm.resume(depths.length===1?'out':'continue');},data);assert.deepEqual(depths,[3,2]);
});
test('call-stack caller locations identify the call site, not the next statement',async()=>{
  const data=create('Sub Main()\nWorker\nDebug.Print 2\nEnd Sub\nSub Worker()\nDebug.Print 1\nEnd Sub');data.vm.setBreakpoint('M',6);
  await run((e,vm)=>{assert.deepEqual(vm.debugStack().map(f=>f.line),[2,6]);assert.equal(new Set(vm.debugStack().map(f=>f.id)).size,2);vm.resume();},data);
});
test('Stop breaks at its own source line, including the final statement',async()=>{
  const seen=[];const result=await run((e,vm)=>{seen.push([e.instruction.line,e.reason]);vm.resume();},create('Sub Main()\nDebug.Print 1\nStop\nEnd Sub'));assert.deepEqual(seen,[[3,'stop']]);assert.deepEqual(result.output,['1']);
});
test('Debug.Assert evaluates once, pauses on its own line, and continues after it',async()=>{
  const data=create('Private n As Long\nSub Main()\nDebug.Assert Check()\nDebug.Print n\nEnd Sub\nFunction Check() As Boolean\nn = n + 1\nCheck = False\nEnd Function');
  const result=await run((e,vm)=>{assert.equal(e.reason,'assert');assert.equal(e.instruction.line,3);vm.resume();},data);assert.equal(result.count,1);assert.equal(result.output.at(-1),'1');
});
test('release Debug.Assert does not evaluate its expression',async()=>{
  const data=create('Private n As Long\nSub Main()\nDebug.Assert Check()\nDebug.Print n\nEnd Sub\nFunction Check() As Boolean\nn = n + 1\nEnd Function',{debugStatements:false});await data.vm.start();assert.deepEqual(data.output,['0']);data.vm.stop();
});
test('release Stop resets instead of waiting forever for an absent debugger',async()=>{
  const data=create('Sub Main()\nStop\nDebug.Print 99\nEnd Sub',{debugStatements:false});await data.vm.start();assert.equal(data.vm.state,'stopped');assert.deepEqual(data.output,[]);
});
test('Break on All Errors pauses a handled error and then delivers Resume Next exactly once',async()=>{
  const data=create('Sub Main()\nOn Error Resume Next\nErr.Raise 5, "test", "failure"\nDebug.Print Err.Number\nEnd Sub',{...debug,errorTrapping:'all'});
  const result=await run((e,vm)=>{assert.equal(e.reason,'error');assert.equal(e.instruction.line,3);assert.equal(e.error.handled,true);assert.equal(vm.err.Number,5);assert.equal(vm.stack.length,1);vm.resume();},data);assert.equal(result.count,1);assert.deepEqual(result.output,['5']);
});
test('Break on Unhandled Errors does not pause a locally handled error',async()=>{
  const data=create('Sub Main()\nOn Error Resume Next\nError 13\nDebug.Print Err.Number\nEnd Sub',debug);
  const result=await run(()=>{assert.fail('handled error must not pause');},data);assert.equal(result.count,0);assert.deepEqual(result.output,['13']);
});
test('Break on Unhandled Errors respects a suspended caller handler',async()=>{
  const data=create('Sub Main()\nOn Error GoTo handler\nWorker\nExit Sub\nhandler:\nDebug.Print Err.Number\nEnd Sub\nSub Worker()\nError 11\nEnd Sub',debug);
  const result=await run(()=>assert.fail('caller handles this error'),data);assert.equal(result.count,0);assert.deepEqual(result.output,['11']);
});
test('an unhandled error keeps locals and frames alive and retries after an Immediate repair',async()=>{
  const data=create('Sub Main()\nDim divisor As Long\nDebug.Print 12 / divisor\nDebug.Print "done"\nEnd Sub',debug);
  const result=await run(async(e,vm)=>{assert.equal(e.reason,'error');assert.equal(e.instruction.line,3);assert.equal(vm.stack.length,1);assert.equal(e.frame.locals.get('divisor').get(),0);await vm.immediate('divisor = 3');vm.resume();},data);assert.equal(result.count,1);assert.deepEqual(result.output,['4','done']);
});
test('retained fault context allows explicit skip without entering an error handler',async()=>{
  const result=await run((e,vm)=>vm.resumeError('next'),create('Sub Main()\nError 5\nDebug.Print 2\nEnd Sub',debug));assert.deepEqual(result.output,['2']);assert.equal(result.count,1);
});
test('Set Next Statement redirects a fault without replaying it',async()=>{
  const result=await run((e,vm)=>{if(e.reason==='set-next')return;vm.setNextStatement('M',4);vm.resume();},create('Sub Main()\nDebug.Print 1 / 0\nDebug.Print "skip"\nDebug.Print "keep"\nEnd Sub',debug));assert.deepEqual(result.output,['keep']);
});
test('handled errors can be explicitly retried after editing locals',async()=>{
  const data=create('Sub Main()\nDim divisor As Long\nOn Error Resume Next\nDebug.Print 8 / divisor\nDebug.Print Err.Number\nEnd Sub',{...debug,errorTrapping:'all'});
  const result=await run(async(e,vm)=>{await vm.immediate('divisor = 2');vm.resumeError('retry');},data);assert.deepEqual(result.output,['4','0']);
});
test('all-errors mode does not present the same error twice during caller unwinding',async()=>{
  const result=await run((e,vm)=>{assert.equal(vm.stack.length,2);vm.resume();},create('Sub Main()\nOn Error Resume Next\nWorker\nDebug.Print Err.Number\nEnd Sub\nSub Worker()\nError 13\nEnd Sub',{...debug,errorTrapping:'all'}));assert.equal(result.count,1);assert.deepEqual(result.output,['13']);
});
const classModule={name:'Thing',kind:'class',code:'Sub Work()\nError 5\nEnd Sub'};
const caller='Sub Main()\nDim item As Thing\nSet item = New Thing\nOn Error Resume Next\nitem.Work\nDebug.Print Err.Number\nEnd Sub';
test('Break in Class Module stops inside an unhandled class even when its caller handles it',async()=>{
  const result=await run((e,vm)=>{assert.equal(e.instruction.source,'Thing');assert.equal(vm.stack.length,2);assert.equal(e.error.handled,true);vm.resume();},create(caller,{...debug,errorTrapping:'class'},[classModule]));assert.equal(result.count,1);assert.deepEqual(result.output,['5']);
});
test('Break in Class Module leaves locally handled class errors alone',async()=>{
  const result=await run(()=>assert.fail('class has its own handler'),create(caller,{...debug,errorTrapping:'class'},[{...classModule,code:'Sub Work()\nOn Error Resume Next\nError 5\nEnd Sub'}]));assert.equal(result.count,0);
});
test('unhandled class error selects the caller site in unhandled mode',async()=>{
  const code=caller.replace('On Error Resume Next\n','');
  const result=await run((e,vm)=>{assert.equal(e.instruction.source,'M');assert.equal(e.instruction.line,4);assert.equal(e.error.source,'Thing');assert.equal(e.error.line,2);vm.resumeError('next');},create(code,debug,[classModule]));assert.equal(result.count,1);
});
test('errors in active handlers propagate to another eligible handler, not themselves',async()=>{
  const code='Sub Main()\nOn Error Resume Next\nWorker\nDebug.Print Err.Number\nEnd Sub\nSub Worker()\nOn Error GoTo handler\nError 5\nExit Sub\nhandler:\nError 13\nEnd Sub';
  const result=await run((e,vm)=>vm.resume(),create(code,{...debug,errorTrapping:'all'}));assert.equal(result.count,2);assert.deepEqual(result.output,['13']);
});
test('Erl and Err metadata survive a debugger error stop',async()=>{
  await run((e,vm)=>{assert.equal(e.error.erl,100);assert.equal(vm.lastErrorErl,100);assert.equal(vm.err.Source,'custom');assert.equal(vm.err.HelpContext,42);vm.resumeError('next');},create('Sub Main()\n100 Err.Raise 5, "custom", "message", "help.chm", 42\nEnd Sub',debug));
});
test('automatic error breaks remain opt-in for headless callers',async()=>{
  const data=create('Sub Main()\nError 11\nEnd Sub');await assert.rejects(()=>data.vm.start(),e=>e.number===11);assert.equal(data.vm.state,'error');assert.equal(data.vm.stack.length,0);data.vm.stop();
});
test('Reset during an error stop unwinds the entire suspended call stack',async()=>{
  const data=create('Sub Main()\nWorker\nEnd Sub\nSub Worker()\nError 5\nEnd Sub',debug);await run((e,vm)=>vm.stop(),data);assert.equal(data.vm.stack.length,0);assert.equal(data.vm.pauseResolver,null);assert.equal(data.vm.debugger.pendingError,null);
});
test('queued events are settled on Reset without running',async()=>{
  const data=create('Sub Main()\nStop\nEnd Sub\nSub Later()\nDebug.Print 99\nEnd Sub');let queued;
  await run((e,vm)=>{queued=vm.dispatch('M','Later');vm.stop();},data);await queued;assert.equal(data.vm.eventQueue.length,0);assert.deepEqual(data.output,[]);
});
test('invalid stepping and trapping options fail without losing the pause',async()=>{
  await run((e,vm)=>{assert.throws(()=>vm.resume('invalid'),/stepping/);assert.throws(()=>vm.configureDebugger({errorTrapping:'invalid'}),/trapping/);assert.equal(vm.state,'paused');vm.resume();},create('Sub Main()\nStop\nEnd Sub'));
});
test('Set Next and code edits advance the debugger context revision',async()=>{
  let original;await run((e,vm,{p})=>{if(e.reason==='set-next'||e.reason==='code-edit')return;if(original)return;original=vm.debugPauseId;vm.setNextStatement('M',3);assert.equal(vm.debugPauseId,original+1);p.modules[0].code="' header\n"+p.modules[0].code;vm.applyEdits(p);assert.equal(vm.debugPauseId,original+2);vm.breakpoints.clear();vm.resume();},create('Sub Main()\nDebug.Print 1\nDebug.Print 2\nEnd Sub'),{breakOnEntry:true});
});
test('Immediate parses indexed member assignment and multiple colon statements',async()=>{
  const data=create('Sub Main()\nDim a(2) As Long\nStop\nDebug.Print a(1)\nEnd Sub');const result=await run(async(e,vm)=>{assert.equal(await vm.immediate('a(1) = 7: ? a(1) + 2'),9);vm.resume();},data);assert.deepEqual(result.output,['9','7']);
});
test('Immediate Set assignment calls Property Set and not Property Let',async()=>{
  const code='Sub Main()\nDim a As Box, b As Box\nSet a = New Box\nSet b = New Box\nStop\nDebug.Print a.Child Is b\nEnd Sub';
  const box={name:'Box',kind:'class',code:'Private value As Box\nPublic Property Set Child(ByVal item As Box)\nSet value = item\nEnd Property\nPublic Property Get Child() As Box\nSet Child = value\nEnd Property'};
  const result=await run(async(e,vm)=>{await vm.immediate('Set a.Child = b');vm.resume();},create(code,{},[box]));assert.deepEqual(result.output,['-1']);
});
test('Immediate preserves colons inside string literals',async()=>{
  const result=await run(async(e,vm)=>{await vm.immediate('? "a:b": ? 3');vm.resume();},create('Sub Main()\nStop\nEnd Sub'));assert.deepEqual(result.output,['"a:b"','3']);
});
test('procedure watch observes a caller variable mutated ByRef in the callee',async()=>{
  const data=create('Sub Main()\nDim n As Long\nWorker n\nDebug.Print n\nEnd Sub\nSub Worker(ByRef value As Long)\nvalue = 10\nDebug.Print value\nEnd Sub');data.vm.setWatchpoints([{id:'n',expression:'n',module:'M',procedure:'Main',mode:'change'}]);
  const result=await run((e,vm)=>{assert.equal(e.reason,'watch:n');assert.equal(e.instruction.procedure,'Worker');assert.equal(e.watch.frameIndex,0);vm.setWatchpoints([]);vm.resume();},data);assert.equal(result.count,1);assert.deepEqual(result.output,['10','10']);
});
test('module watch persists across procedure exits and sees the final mutation',async()=>{
  const data=create('Private n As Long\nSub Main()\nWorker\nWorker\nEnd Sub\nSub Worker()\nn = n + 1\nEnd Sub');data.vm.setWatchpoints([{id:'n',expression:'n',module:'M',mode:'change'}]);const values=[];
  await run((e,vm)=>{values.push(vm.instances.get('m').fields.get('n').get());vm.resume();},data);assert.deepEqual(values,[1,2]);
});
test('procedure watches do not compare different recursive invocations as the same variable',async()=>{
  const data=create('Sub Main()\nWorker 2\nEnd Sub\nSub Worker(n As Long)\nIf n > 0 Then Worker n - 1\nDebug.Print n\nEnd Sub');data.vm.setWatchpoints([{expression:'n',module:'M',procedure:'Worker',mode:'change'}]);const result=await run(()=>assert.fail('distinct frames need distinct baselines'),data);assert.equal(result.count,0);
});
test('module watch is not shadowed by a same-named local variable',async()=>{
  const data=create('Private n As Long\nSub Main()\nDim n As Long\nn = 5\nDebug.Print n\nEnd Sub');data.vm.setWatchpoints([{expression:'n',module:'M',mode:'change'}]);const result=await run(()=>assert.fail('module field never changed'),data);assert.equal(result.count,0);
});
test('invalid breakpoint updates are atomic',()=>{
  const {vm}=create('Sub Main()\nDim n As Long\nn = 1\nEnd Sub');vm.setBreakpoint('M',3);
  for(const line of [1,2,4,9])assert.throws(()=>vm.setBreakpoint('M',line),/not executable/);
  assert.throws(()=>vm.replaceBreakpoints([{module:'M',line:3},{module:'M',line:2}]));assert.equal(vm.breakpoints.size,1);
  vm.replaceBreakpoints([{module:'M',line:3,enabled:false}]);assert.equal([...vm.breakpoints.values()][0].enabled,false);
});
test('disabled breakpoints are retained but never stop execution',async()=>{
  const data=create('Sub Main()\nDebug.Print 1\nEnd Sub');data.vm.setBreakpoint('M',2,'',false);const result=await run(()=>assert.fail('disabled'),data);assert.equal(result.count,0);
});
test('failing breakpoint conditions stop visibly without invoking user code',async()=>{
  const data=create('Sub Main()\nDebug.Print 1\nEnd Sub\nFunction SideEffect()\nDebug.Print 99\nEnd Function');data.vm.setBreakpoint('M',2,'SideEffect()');const result=await run((e,vm)=>{assert.equal(e.reason,'breakpoint-condition');assert.match(e.conditionError,/Automatic/);vm.resume();},data);assert.deepEqual(result.output,['1']);
});
test('design-mode Run to Cursor stops before its target without installing a persistent breakpoint',async()=>{
  const data=create('Sub Main()\nDebug.Print 1\nDebug.Print 2\nEnd Sub');const result=await run((e,vm)=>{assert.equal(e.reason,'run-to-cursor');assert.equal(e.instruction.line,3);assert.equal(vm.breakpoints.size,0);assert.equal(vm.runTarget,null);vm.resume();},data,{runToCursor:{module:'M',line:3}});assert.equal(result.count,1);assert.deepEqual(result.output,['1','2']);
});
test('trapping settings can change while paused without invalidating source edits',async()=>{
  const data=create('Sub Main()\nOn Error Resume Next\nStop\nError 5\nDebug.Print 1\nEnd Sub',debug);let changed=false;
  const result=await run((e,vm,{p})=>{if(e.reason==='code-edit')return;if(!changed){changed=true;vm.configureDebugger({errorTrapping:'all'});p.settings.errorTrapping='all';vm.applyEdits(p);}vm.resume();},data);assert.equal(result.count,3);assert.deepEqual(result.output,['1']);
});

test('source columns identify repeated colon statements and single-line If branches',()=>{
  const line='  x = 1: x = 1: Debug.Print "a:b"',data=create('Sub Main()\nDim x As Long\n'+line+'\nIf True Then x = 2: x = 3 Else x = 4\nEnd Sub');
  const code=data.vm.program.modules.get('m').procedures.get('main').code;
  assert.deepEqual(code.filter(i=>i.line===3&&isSequencePoint(i)).map(i=>line.slice(i.column-1,i.endColumn-1)),['x = 1','x = 1','Debug.Print "a:b"']);
  const source=data.p.modules[0].code.split('\n')[3];assert.deepEqual(code.filter(i=>i.line===4&&isSequencePoint(i)).map(i=>source.slice(i.column-1,i.endColumn-1).trim()),['If True Then','x = 2','x = 3','x = 4']);
});
test('continued statements do not claim a misleading single-physical-line span',()=>{
  const {vm}=create('Sub Main()\nDebug.Print 1 + _\n2\nEnd Sub'),ins=vm.program.modules.get('m').procedures.get('main').code[0];assert.equal(ins.line,2);assert.equal(ins.column,undefined);
});
test('Run to Cursor can target the second statement on a colon-separated line',async()=>{
  const line='Debug.Print 1: Debug.Print 2: Debug.Print 3',data=create('Sub Main()\n'+line+'\nEnd Sub');
  const result=await run((e,vm)=>{assert.equal(e.instruction.column,line.indexOf('Debug.Print 2')+1);assert.deepEqual(data.output,['1']);vm.resume();},data,{runToCursor:{module:'M',line:2,column:line.indexOf('Debug.Print 2')+1}});assert.equal(result.count,1);assert.deepEqual(result.output,['1','2','3']);
});
test('Set Next Statement can skip only one colon statement',async()=>{
  const line='Debug.Print 1: Debug.Print 2: Debug.Print 3';const result=await run((e,vm)=>{if(e.reason==='set-next')return;vm.setNextStatement('M',2,line.indexOf('Debug.Print 2')+1);vm.resume();},create('Sub Main()\n'+line+'\nEnd Sub'),{breakOnEntry:true});assert.deepEqual(result.output,['2','3']);
});
test('whitespace-only edits relocate caller columns without requiring a restart',async()=>{
  const data=create('Sub Main()\nWorker\nDebug.Print 2\nEnd Sub\nSub Worker()\nDebug.Print 1\nEnd Sub');data.vm.setBreakpoint('M',6);
  await run((e,vm,{p})=>{if(e.reason==='code-edit')return;p.modules[0].code=p.modules[0].code.replace('Worker\n','    Worker\n');vm.applyEdits(p);assert.equal(vm.debugStack()[0].column,5);vm.breakpoints.clear();vm.resume();},data);
});
test('an empty startup initializer does not consume Step Into before executable entry',async()=>{
  const data=create('Sub Main()\nDebug.Print 1\nEnd Sub',{},[{name:'F',kind:'form',form:{type:'Form'},code:'Sub Form_Initialize()\nEnd Sub'}]);
  const result=await run((e,vm)=>{assert.equal(e.instruction.source,'M');assert.equal(e.instruction.line,2);vm.resume();},data,{breakOnEntry:true});assert.equal(result.count,1);
});
test('unobserved execution uses the debugger fast path',async()=>{
  const {vm}=create('Sub Main()\nDim n As Long\nFor n = 1 To 100\nNext\nEnd Sub');let calls=0;vm.debugger.checkpoint=()=>{calls++;};await vm.start();assert.equal(calls,0);vm.stop();
});

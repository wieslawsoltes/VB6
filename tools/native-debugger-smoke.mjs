/** Real Windows integration; never substituted by mocks or marked a pass when
 * CDB, a target architecture, symbols or a command are unavailable. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createNativeDebuggerBridge} from '../packages/native-debugger/src/bridge.mjs';
import {CdbSession,findCdb,breakWindowsProcess} from '../packages/native-debugger/src/cdb-session.mjs';
import {isBreakpointStop} from './native-debugger-stop.mjs';

if(process.platform!=='win32')throw new Error('Run this test on Windows with Microsoft Debugging Tools installed.');
const target=await fs.realpath(process.argv[2]||'reports/native-debugger/x64/DebugTarget.exe'),directory=path.dirname(target),cdbPath=await findCdb();
const image=await fs.readFile(target),pe=image.readUInt32LE(0x3c);
assert.equal(image.subarray(pe,pe+4).toString('hex'),'50450000','Target must be a PE executable');
const architecture=({0x14c:'x86',0x8664:'x64',0xaa64:'arm64'})[image.readUInt16LE(pe+4)];
assert.ok(architecture,'Recognized target architecture');
const report={platform:process.platform,architecture,hostArchitecture:process.arch,target,cdbPath,checks:[]},owned=new Set(),sessions=[];
const record=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS '+name);};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function make(options){const session=new CdbSession({cdbPath,timeout:30000,breakProcess:async pid=>{report.breakRequests=(report.breakRequests||0)+1;await breakWindowsProcess(pid);}});sessions.push(session);session.on('output',e=>{report.output=((report.output||'')+e.text).slice(-200000);});await session.start(options);if(options.executable)owned.add(session.pid);return session;}
async function hit(session,symbol,max=30){
  const pid=session.pid,breakpoint=await session.request('setBreakpoint',{location:symbol,pauseId:session.pauseId});
  for(let i=0;i<max;i++){
    await session.request('continue',{pauseId:session.pauseId});await session.waitPaused();const stack=await session.request('stack');
    if(isBreakpointStop(session,stack,{pid,symbol,id:breakpoint.id})){record('breakpoint '+symbol,{pauseId:session.pauseId});return breakpoint;}
  }
  throw new Error('Did not reach '+symbol+' after '+max+' debugger stops.');
}
try{
  const launched=await make({executable:target,args:['--children'],debugChildren:true});assert.ok(launched.pid>0);record('launch attaches before application startup',{pid:launched.pid});
  const parentPid=launched.pid,bp=await hit(launched,'DebugTarget!DebugTick');
  const argcAddress=await launched.request('resolveSymbol',{symbol:'DebugTarget!DebugArgumentCount'});
  const argcBytes=await launched.request('readMemory',{address:argcAddress.address,count:4});
  assert.equal(argcBytes.unreadableBytes,0);assert.equal(Buffer.from(argcBytes.bytes).readUInt32LE(),2);
  record('native launch preserves the approved argument vector',{architecture});
  // Windows may deliver the child's CREATE_PROCESS event after an already
  // pending breakpoint in the parent. Drive the debug event loop, not wall-clock
  // sleeps, until CDB has observed both. Never treat a missing child as a pass.
  const childAddress=await launched.request('resolveSymbol',{symbol:'DebugTarget!DebugChildPid'});
  const childMemory=await launched.request('readMemory',{address:childAddress.address,count:4});
  assert.equal(childMemory.unreadableBytes,0);
  const childPid=Buffer.from(childMemory.bytes).readUInt32LE();
  if(childPid)owned.add(childPid);
  let processes=await launched.request('processes');
  for(let n=0;processes.processes.length<2&&n<30;n++){
    await launched.request('continue',{pauseId:launched.pauseId});await launched.waitPaused();
    processes=await launched.request('processes');
  }
  assert.ok(childPid>0,'Fixture did not create its requested child');
  assert.ok(processes.processes.some(p=>p.pid===childPid),JSON.stringify({childPid,processes}));
  assert.ok(processes.processes.length>=2,JSON.stringify(processes));for(const p of processes.processes)owned.add(p.pid);
  // Inspect the requested parent even when the last event arrived in its child.
  const parent=processes.processes.find(p=>p.pid===parentPid);
  assert.ok(parent,'Parent remains attached');
  await launched.request('selectProcess',{index:parent.index,pauseId:launched.pauseId});
  // Return to an actual source breakpoint rather than stepping a thread that
  // was only suspended while Windows delivered the child creation event.
  for(let n=0;n<30;n++){
    if(isBreakpointStop(launched,await launched.request('stack'),{pid:parentPid,symbol:'DebugTarget!DebugTick',id:bp.id}))break;
    await launched.request('continue',{pauseId:launched.pauseId});await launched.waitPaused();
  }
  assert.ok(isBreakpointStop(launched,await launched.request('stack'),{pid:parentPid,symbol:'DebugTarget!DebugTick',id:bp.id}),'Parent must stop at the actual DebugTick breakpoint, not a caller frame');
  const stopContext={pid:launched.pid,processIndex:launched.processIndex,threadIndex:launched.threadIndex};
  record('native child process tracking',{processes:processes.processes});
  const threads=await launched.request('threads');assert.ok(threads.threads.length>=2);record('native thread enumeration',{threads:threads.threads.length});
  const before=launched.pauseId,all=await launched.request('allProcessStacks',{pauseId:before});assert.ok(all.processes.length>=2);assert.ok(all.processes.every(p=>p.text.length>0));assert.ok(launched.pauseId>before);assert.deepEqual({pid:launched.pid,processIndex:launched.processIndex,threadIndex:launched.threadIndex},stopContext);assert.ok(isBreakpointStop(launched,await launched.request('stack'),{pid:parentPid,symbol:'DebugTarget!DebugTick',id:bp.id}));record('cross-process native stack snapshots restore current context');
  const registers=await launched.request('registers');assert.ok(registers.registers.rip||registers.registers.eip);
  const expectedRegisters=new Set(('eax ebx ecx edx esi edi eip esp ebp rax rbx rcx rdx rsi rdi rip rsp rbp r8 r9 r10 r11 r12 r13 r14 r15 iopl cs ss ds es fs gs efl').split(' '));
  assert.ok(Object.keys(registers.registers).every(name=>expectedRegisters.has(name)),'Disassembly memory operands must not be reported as registers');
  record('native x86 or x64 register context',{registers:registers.registers});
  const disassembly=await launched.request('disassemble');assert.match(disassembly.text,/DebugTick|[0-9a-f]{8}/i);record('native machine disassembly');
  const counter=await launched.request('resolveSymbol',{symbol:'DebugTarget!DebugCounter'});const memory=await launched.request('readMemory',{address:counter.address,count:4});assert.equal(memory.unreadableBytes,0);record('resolve exported data address and read native memory',{address:counter.address});
  const writePause=launched.pauseId;
  const written=await launched.request('writeMemory',{address:counter.address,bytes:[37,0,0,0],pauseId:writePause});
  assert.equal(written.pauseId,launched.pauseId);assert.ok(written.pauseId>writePause);
  await assert.rejects(launched.request('continue',{pauseId:writePause}),{code:'STALE_PAUSE'});
  assert.deepEqual((await launched.request('readMemory',{address:counter.address,count:4})).bytes,[37,0,0,0]);record('native memory write readback and mutation-ticket invalidation');
  await launched.request('stepMode',{mode:'source',pauseId:launched.pauseId});const lineBefore=/target\.c @ (\d+)/i.exec((await launched.request('stack')).text)?.[1];assert.ok(lineBefore,'Source breakpoint requires line symbols');const at=launched.pauseId;await launched.request('stepOver',{pauseId:at});await launched.waitPaused();assert.ok(launched.pauseId>at);const lineAfter=/target\.c @ (\d+)/i.exec((await launched.request('stack')).text)?.[1];assert.ok(lineAfter,'Source step retains line symbols');assert.notEqual(lineAfter,lineBefore);record('source-line step using matching fixture symbols',{lineBefore,lineAfter});
  await assert.rejects(launched.request('setRegister',{register:registers.registers.rip?'rax':'eax',value:'1',pauseId:at}),{code:'STALE_PAUSE'});record('stale native mutation rejected');
  await launched.request('stepMode',{mode:'assembly',pauseId:launched.pauseId});await launched.request('removeBreakpoint',{id:bp.id,pauseId:launched.pauseId});
  await hit(launched,'DebugLibrary!LibraryTick');const dllStack=await launched.request('stack');assert.match(dllStack.text,/DebugLibrary!LibraryTick/);assert.match(dllStack.text,/DebugTarget!/);record('native DLL call stack includes caller in host executable');
  const detachedPid=launched.pid;await launched.request('detach');assert.equal(alive(detachedPid),true);record('detach preserves running target',{pid:detachedPid});

  const outside=spawn(target,[],{cwd:directory,stdio:'ignore',windowsHide:true});owned.add(outside.pid);await new Promise((resolve,reject)=>{outside.once('spawn',resolve);outside.once('error',reject);});
  const attached=await make({pid:outside.pid});assert.equal(attached.pid,outside.pid);record('attach to an independently launched process',{pid:outside.pid});
  const attachedBreakpoint=await hit(attached,'DebugTarget!DebugTick');
  await attached.request('removeBreakpoint',{id:attachedBreakpoint.id,pauseId:attached.pauseId});
  const watched=await attached.request('resolveSymbol',{symbol:'DebugTarget!DebugCounter'});
  const watchBefore=await attached.request('readMemory',{address:watched.address,count:4});
  assert.equal(watchBefore.unreadableBytes,0);
  const dataBreakpoint=await attached.request('setDataBreakpoint',{address:watched.address,access:'write',size:4,pauseId:attached.pauseId});
  assert.equal(dataBreakpoint.kind,'data');
  await attached.request('enableBreakpoint',{id:dataBreakpoint.id,enabled:false,pauseId:attached.pauseId});
  assert.equal(attached.snapshot().breakpoints.find(b=>b.id===dataBreakpoint.id).enabled,false);
  await attached.request('enableBreakpoint',{id:dataBreakpoint.id,enabled:true,pauseId:attached.pauseId});
  await attached.request('continue',{pauseId:attached.pauseId});await attached.waitPaused();
  assert.match(attached.lastStop,new RegExp('Breakpoint '+dataBreakpoint.id+' hit','i'));
  const watchAfter=await attached.request('readMemory',{address:watched.address,count:4});
  assert.equal(watchAfter.unreadableBytes,0);
  assert.equal(Buffer.from(watchAfter.bytes).readInt32LE(),Buffer.from(watchBefore.bytes).readInt32LE()+1);
  assert.match((await attached.request('stack')).text,/DebugTarget!DebugTick/);
  record('real hardware write watchpoint stops on a native data change',{id:dataBreakpoint.id,address:watched.address,reason:attached.lastStop});
  await attached.request('removeBreakpoint',{id:dataBreakpoint.id,pauseId:attached.pauseId});
  assert.equal(attached.snapshot().breakpoints.length,0);
  await attached.request('continue',{pauseId:attached.pauseId});await attached.request('pause');assert.equal(attached.state,'paused');assert.ok(report.breakRequests>=1);record('break running native process through DebugBreakProcess');
  await attached.request('detach');assert.equal(alive(outside.pid),true);record('attached process survives debugger shutdown');
  // Exercise the same authenticated HTTP surface used by the browser, with a
  // real CDB session and real target. The test authorizes only its own fixture.
  const bridge=await createNativeDebuggerBridge({port:0,origins:['https://ide.example'],authorize:async request=>request.operation==='attach'&&request.pid===outside.pid});
  const rpc=async(method,params={},overrides={})=>{
    const response=await fetch(bridge.url,{method:'POST',headers:{Origin:'https://ide.example','Content-Type':'application/json',Authorization:'Bearer '+bridge.token,...overrides},body:JSON.stringify({method,params})});
    return {status:response.status,...await response.json()};
  };
  try{
    assert.equal((await rpc('attach',{pid:outside.pid},{Authorization:'Bearer wrong'})).status,401);
    assert.equal((await rpc('attach',{pid:outside.pid},{Origin:'https://unapproved.example'})).status,403);
    assert.equal((await rpc('attach',{pid:process.pid})).error.code,'CONSENT_DENIED');
    assert.equal((await rpc('capabilities')).result.interpreterFrames,false);
    const connected=await rpc('attach',{pid:outside.pid});assert.equal(connected.status,200,JSON.stringify(connected));
    const id=connected.result.id,pauseId=connected.result.pauseId;
    assert.ok((await rpc('threads',{session:id})).result.threads.length>=2);
    assert.equal((await rpc('continue',{session:id,pauseId:pauseId+1})).error.code,'STALE_PAUSE');
    assert.equal((await rpc('continue',{session:id,pauseId})).result.state,'running');
    const stopped=await rpc('pause',{session:id});assert.equal(stopped.status,200,JSON.stringify(stopped));assert.equal(stopped.result.state,'paused');
    assert.ok((await rpc('stack',{session:id})).result.frames.length>0);
    const data=await rpc('resolveSymbol',{session:id,symbol:'DebugTarget!DebugCounter'});
    assert.equal(data.status,200,JSON.stringify(data));
    assert.equal((await rpc('setDataBreakpoint',{session:id,address:data.result.address,access:'write',size:4})).error.code,'INVALID_ARGUMENT');
    const hw=await rpc('setDataBreakpoint',{session:id,address:data.result.address,access:'write',size:4,pauseId:stopped.result.pauseId});
    assert.equal(hw.status,200,JSON.stringify(hw));assert.equal(hw.result.kind,'data');
    assert.equal((await rpc('removeBreakpoint',{session:id,id:hw.result.id,pauseId:stopped.result.pauseId})).status,200);
    record('authenticated native bridge installs hardware watches only with a pause identity');
    assert.equal((await rpc('command',{session:id,command:'.shell forbidden'})).error.code,'UNKNOWN_OPERATION');
    assert.ok((await rpc('events',{session:id,after:0})).result.events.length>0);
    assert.equal((await rpc('detach',{session:id})).status,200);
    assert.equal((await rpc('status',{session:id})).error.code,'UNKNOWN_SESSION');
    assert.equal(alive(outside.pid),true);record('real authenticated HTTP bridge enforces consent, origins and stale pauses');
    assert.equal((await rpc('attach',{pid:outside.pid})).status,200);
  }finally{await bridge.close();}
  assert.equal(alive(outside.pid),true);record('closing the HTTP bridge detaches rather than terminates its target');
  report.passed=true;
}catch(error){report.passed=false;report.error={message:error.message,stack:error.stack};throw error;}
finally{
  for(const session of sessions)await session.abort();
  for(const pid of owned)if(pid&&alive(pid))try{process.kill(pid);}catch{}
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'native-debugger-results.json'),JSON.stringify(report,null,2)+'\n');
}

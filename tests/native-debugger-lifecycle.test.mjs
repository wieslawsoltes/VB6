import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import http from 'node:http';
import {CdbSession} from '../packages/native-debugger/src/cdb-session.mjs';
import {breakWindowsProcess} from '../packages/native-debugger/src/windows-break.mjs';
import {createNativeDebuggerBridge} from '../packages/native-debugger/src/bridge.mjs';
const delay=()=>new Promise(r=>setImmediate(r));

test('native break helper resolves system PowerShell and routes WOW64 through x86 API caller',async()=>{
  const calls=[];
  await breakWindowsProcess(1234,{platform:'win32',environment:{SystemRoot:'C:\\Windows'},architecture:'x64',execute:async(...args)=>{calls.push(args);return {stdout:calls.length===1?'VB6_BREAK_ROUTE:1234:01dc010203040506':'VB6_BREAK_DONE:1234:01dc010203040506:32'};}});
  assert.equal(calls.length,2);
  const [file,args,options]=calls[0];
  assert.equal(file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args.slice(0,3),['-NoProfile','-NonInteractive','-Command']);
  assert.match(args[3],/IsWow64Process\(handle,out wow64\)/);
  assert.match(args[3],/IntPtr.Size==8 && wow64/);
  assert.equal(calls[1][0],'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.match(args[3],/OpenProcess\(0x1F0FFF,false,pid\)/);
  assert.match(args[3],/Request\(1234,\$null\)/);
  assert.match(args[3],/CloseHandle\(handle\)/);
  assert.equal(options.shell,false);
});
test('32-bit Node uses Sysnative for architecture discovery on a 64-bit Windows host',async()=>{
  let file;
  await breakWindowsProcess(42,{platform:'win32',environment:{SystemRoot:'D:\\Windows',PROCESSOR_ARCHITEW6432:'AMD64'},architecture:'ia32',execute:async f=>{file=f;return {stdout:'VB6_BREAK_DONE:42:01dc010203040506:64'};}});
  assert.equal(file,'D:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe');
});
test('native break helper rejects untrusted PID text before starting PowerShell and propagates denial',async()=>{
  let called=false;
  await assert.rejects(breakWindowsProcess('1;Stop-Process',{platform:'win32',execute:async()=>{called=true;}}));
  assert.equal(called,false);
  await assert.rejects(breakWindowsProcess(1,{platform:'linux'}),{code:'WINDOWS_REQUIRED'});
  await assert.rejects(breakWindowsProcess(1,{platform:'win32',execute:async()=>{throw new Error('Access denied');}}),/Access denied/);
});
test('aborting native startup before process creation cannot launch a debugger later',async()=>{
  let spawned=0;
  const session=new CdbSession({platform:'win32',cdbPath:'C:\\cdb.exe',spawnProcess:()=>{spawned++;throw new Error('Must not spawn');}});
  const started=session.start({pid:1});await session.abort();
  await assert.rejects(started,{code:'DEBUGGER_EXITED'});assert.equal(spawned,0);assert.equal(session.state,'closed');assert.equal(session.directory,null);
});
test('closed, failed and not-started native pause waits reject immediately without leaking listeners',async()=>{
  const s=new CdbSession();
  await assert.rejects(s.waitPaused(),{code:'DEBUGGER_EXITED'});
  s.fail(Object.assign(new Error('Transport failure'),{code:'EPIPE'}));await assert.rejects(s.waitPaused(),{code:'EPIPE'});
  s.state='running';const waiting=s.waitPaused();await s.abort();await assert.rejects(waiting,{code:'DEBUGGER_EXITED'});
  await assert.rejects(s.waitPaused(),{code:'DEBUGGER_EXITED'});
  assert.equal(s.listenerCount('paused'),0);assert.equal(s.listenerCount('closed'),0);assert.equal(s.listenerCount('failure'),0);
});
test('native child stops invalidate the previous selected PID and resolved process snapshots restore it',()=>{
  const s=new CdbSession();s.state='running';s.processIndex=0;s.targetPid=10;s.rememberProcesses([{index:0,pid:10},{index:1,pid:20}],true);
  s.receive('Child breakpoint\r\n1:003> ');assert.equal(s.pid,20);assert.equal(s.snapshot().targetPid,10);assert.equal(s.threadIndex,3);
  s.state='running';s.receive('New child breakpoint\r\n2:004> ');assert.equal(s.pid,null,'Never report the old target for an unknown process index');
  s.rememberProcesses([{index:0,pid:10},{index:2,pid:30}],true);assert.equal(s.pid,30);assert.equal(s.processIds.has(1),false);
  s.receive('0:000> ');assert.equal(s.pid,10);
});
test('late debugger output after abort cannot resurrect a native pause',async()=>{
  const s=new CdbSession();s.state='running';let pauses=0;s.on('paused',()=>pauses++);
  await s.abort();s.receive('Breakpoint\r\n0:000> ');assert.equal(s.state,'closed');assert.equal(pauses,0);
});
test('native startup listeners settle when abort occurs while waiting for the initial prompt',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(c,e,d){d();}});child.kill=()=>{};
  let spawned;const didSpawn=new Promise(r=>{spawned=r;});
  const s=new CdbSession({platform:'win32',cdbPath:'C:\\cdb.exe',spawnProcess:()=>{spawned();return child;}});
  const start=s.start({pid:1});await didSpawn;await s.abort();await assert.rejects(start,{code:'DEBUGGER_EXITED'});assert.equal(s.listenerCount('paused'),0);
});

function request(bridge){return new Promise(resolve=>{
  const req=http.request(bridge.url,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json',Origin:'https://ide.example'}},res=>{res.resume();res.on('end',resolve);});
  req.on('error',resolve);req.end(JSON.stringify({method:'attach',params:{pid:1234}}));
});}
test('bridge closure aborts consent without creating a session and is idempotent',async()=>{
  let entered,approvalSignal,created=0;const waiting=new Promise(r=>{entered=r;});
  const bridge=await createNativeDebuggerBridge({port:0,origins:['https://ide.example'],createSession:()=>{created++;},authorize:async(_, {signal})=>{approvalSignal=signal;entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return true;}});
  const pending=request(bridge);await waiting;await bridge.close();await pending;
  assert.equal(approvalSignal.aborted,true);assert.equal(created,0);await bridge.close();
});
test('bridge closure aborts an opening native session and rejects late startup completion',async()=>{
  let entered,finish;const waiting=new Promise(r=>{entered=r;});let aborts=0;
  class Session extends EventEmitter {snapshot(){return {state:'starting'};}async start(){entered();await new Promise(r=>{finish=r;});}async abort(){aborts++;}async request(){throw new Error('Late session must not be retained');}}
  const bridge=await createNativeDebuggerBridge({port:0,origins:['https://ide.example'],authorize:async()=>true,createSession:()=>new Session()});
  const pending=request(bridge);await waiting;await bridge.close();assert.equal(aborts,1);finish();await pending;await delay();assert.equal(aborts,2);
});

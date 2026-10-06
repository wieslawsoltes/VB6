import test from 'node:test';
import assert from 'node:assert/strict';
import {breakWindowsProcess} from '../packages/native-debugger/src/windows-break.mjs';
import {CdbSession} from '../packages/native-debugger/src/cdb-session.mjs';
const identity='01dc010203040506',pid=42;
const reply=(kind='DONE',bits=64,id=identity)=>`VB6_BREAK_${kind}:${pid}:${id}${kind==='DONE'?':'+bits:''}`;
const base={platform:'win32',environment:{SystemRoot:'C:\\Windows'},architecture:'x64',now:()=>0};
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function running(breakProcess,timeout=1000){const s=new CdbSession({breakProcess,timeout});s.state='running';s.pid=s.targetPid=pid;return s;}
function noWaiters(s){assert.equal(s.listenerCount('paused'),0);assert.equal(s.listenerCount('closed'),0);assert.equal(s.listenerCount('failure'),0);assert.equal(s.breakAbort,null);}

test('native-bitness break needs only one directly owned helper and explicit completion',async()=>{
  const calls=[];
  const result=await breakWindowsProcess(pid,{...base,execute:async(...args)=>{calls.push(args);return {stdout:reply()+'\r\n'};}});
  assert.equal(calls.length,1);assert.equal(result.routed,false);assert.equal(result.bitness,64);
  assert.equal(calls[0][2].timeout,15000);assert.equal(calls[0][2].shell,false);
  const script=calls[0][1][3];
  assert.doesNotMatch(script,/EncodedCommand|Start-Process|Join-Path|Test-Path|& \$helper/);
  assert.match(script,/CheckRemoteDebuggerPresent\(handle,out debugged\)/);
  assert.match(script,/finally \{ Check\(CloseHandle\(handle\)/);
  assert.match(script,/\$ProgressPreference='SilentlyContinue'/);
});
test('WOW64 route uses direct x86 ownership, exact creation identity and one shared deadline',async()=>{
  let clock=100,calls=[];
  const result=await breakWindowsProcess(pid,{...base,now:()=>clock,execute:async(...args)=>{
    calls.push(args);clock+=calls.length===1?4250:500;
    return {stdout:calls.length===1?reply('ROUTE'):reply('DONE',32)};
  }});
  assert.equal(calls.length,2);assert.equal(calls[0][2].timeout,15000);assert.equal(calls[1][2].timeout,10750);
  assert.match(calls[1][0],/\\SysWOW64\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.match(calls[1][1][3],new RegExp("Request\\(42,'"+identity+"'\\)"));
  assert.match(calls[1][1][3],/String\.Equals\(identity,expectedCreation,StringComparison\.Ordinal\)/);
  assert.match(calls[1][1][3],/IntPtr.Size!=4 \|\| !wow64/);
  assert.deepEqual(result.phases,[{phase:'native-host',elapsedMs:4250},{phase:'x86-host',elapsedMs:500}]);
  assert.equal(result.elapsedMs,4750);assert.equal(result.routed,true);assert.equal(result.bitness,32);
});
for(const stdout of ['', 'anything', reply().replace(':42:',':43:'), reply()+'\n'+reply(), reply('ROUTE')+':32',reply().replace(identity,"x';exit;#"),reply().replace(':64',':16')]){
  test('invalid helper reply is rejected without speculative follow-up: '+JSON.stringify(stdout),async()=>{
    let calls=0;
    await assert.rejects(breakWindowsProcess(pid,{...base,execute:async()=>{calls++;return {stdout};}}),{code:'BREAK_PROTOCOL',phase:'native-host'});
    assert.equal(calls,1);
  });
}
for(const stdout of [reply('ROUTE'),reply('DONE',64),reply('DONE',32,'01dc010203040507')]){
  test('routed caller must acknowledge same identity exactly once: '+stdout,async()=>{
    let calls=0;
    await assert.rejects(breakWindowsProcess(pid,{...base,execute:async()=>({stdout:++calls===1?reply('ROUTE'):stdout})}),{code:'BREAK_PROTOCOL',phase:'x86-host'});
    assert.equal(calls,2);
  });
}
test('expired routing deadline never starts a late break helper',async()=>{
  let clock=0,calls=0;
  await assert.rejects(breakWindowsProcess(pid,{...base,now:()=>clock,execute:async()=>{calls++;clock=15000;return {stdout:reply('ROUTE')};}}),{code:'TIMEOUT',phase:'x86-host'});
  assert.equal(calls,1);
});
test('native helper timeout remains failure with original exit details and no retry',async()=>{
  const failure=Object.assign(new Error('Command timed out'),{killed:true,code:null,signal:'SIGTERM',stderr:'diagnostics'});let calls=0;
  await assert.rejects(breakWindowsProcess(pid,{...base,execute:async()=>{if(++calls===1)return {stdout:reply('ROUTE')};throw failure;}}),error=>{
    assert.equal(error,failure);assert.equal(error.phase,'x86-host');assert.equal(error.killed,true);assert.equal(error.signal,'SIGTERM');assert.equal(error.stderr,'diagnostics');return true;
  });
  assert.equal(calls,2);
});
test('aborted helper cannot spawn after delayed discovery resolves',async()=>{
  const c=new AbortController(),reason=new Error('Stopped');let calls=0;
  await assert.rejects(breakWindowsProcess(pid,{...base,signal:c.signal,execute:async(f,a,o)=>{calls++;assert.equal(o.signal,c.signal);c.abort(reason);return {stdout:reply('ROUTE')};}}),e=>e===reason);
  assert.equal(calls,1);
  await assert.rejects(breakWindowsProcess(pid,{...base,signal:c.signal,execute:async()=>{calls++;}}),e=>e===reason);
  assert.equal(calls,1);
});
test('pause requires both native helper completion and debugger prompt in either order',async()=>{
  for(const helperFirst of [true,false]){
    const d=deferred();const s=running(()=>d.promise);let settled=false;
    const result=s.request('pause').then(v=>{settled=true;return v;});await tick();
    if(helperFirst)d.resolve();else s.receive('Break instruction exception\r\n0:005> ');
    await tick();assert.equal(settled,false);
    if(helperFirst)s.receive('Break instruction exception\r\n0:005> ');else d.resolve();
    assert.equal((await result).state,'paused');noWaiters(s);
  }
});
test('a real CDB stop does not turn a subsequent helper failure into success',async()=>{
  const d=deferred(),failure=Object.assign(new Error('helper killed'),{killed:true});const s=running(()=>d.promise);
  const result=s.request('pause');const rejection=assert.rejects(result,e=>e===failure);await tick();
  s.receive('Break instruction exception\r\n0:005> ');d.reject(failure);await rejection;
  assert.equal(s.state,'paused');noWaiters(s);
});
test('helper failure cancels the stop waiter immediately and retains current state',async()=>{
  const failure=new Error('Access denied');const s=running(()=>Promise.reject(failure));
  await assert.rejects(s.request('pause'),e=>e===failure);assert.equal(s.state,'running');noWaiters(s);
});
test('stop timeout cancels the helper and is observed while helper is pending',async()=>{
  let aborted=false;
  const s=running((pid,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true})),100);
  await assert.rejects(s.request('pause'),{code:'TIMEOUT'});assert.equal(aborted,true);noWaiters(s);
});
test('abort after a CDB stop cancels pending helper and cannot return a stale paused snapshot',async()=>{
  const d=deferred();let signal;
  const s=running((pid,options)=>{signal=options.signal;return d.promise;});
  const pending=s.request('pause');const rejection=assert.rejects(pending,{code:'DEBUGGER_EXITED'});await tick();
  s.receive('Break instruction exception\r\n0:005> ');await s.abort();assert.equal(signal.aborted,true);d.resolve();await rejection;
  assert.equal(s.state,'closed');noWaiters(s);
});
test('native transport failure cancels pending break even after a prompt',async()=>{
  const d=deferred();let signal;const s=running((pid,o)=>{signal=o.signal;return d.promise;});
  const failure=Object.assign(new Error('pipe closed'),{code:'EPIPE'});
  const pending=s.request('pause');const rejection=assert.rejects(pending,e=>e===failure);await tick();
  s.receive('Break instruction exception\r\n0:005> ');s.fail(failure);assert.equal(signal.aborted,true);d.resolve();await rejection;
  assert.equal(s.state,'failed');noWaiters(s);
});
test('abort before queued break execution cannot dispatch a late OS request',async()=>{
  let calls=0;const s=running(()=>{calls++;});const pending=s.request('pause');const rejected=assert.rejects(pending);
  await s.abort();await rejected;assert.equal(calls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import http from 'node:http';
import {CdbSession} from '../packages/native-debugger/src/cdb-session.mjs';
import {createNativeDebuggerBridge} from '../packages/native-debugger/src/bridge.mjs';
import {address,symbol,expression,parseProcesses,parseThreads,parseRegisters,parseMemory,parseStack} from '../packages/native-debugger/src/protocol.mjs';

function engine({respond,timeout=2000,initial='0:000> '}={}){
  const writes=[],argv=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
  child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0,null));};
  const pendingBreakpoints=new Set();
  child.stdin=new Writable({write(bytes,_,done){const input=bytes.toString();writes.push(input);done();queueMicrotask(()=>{
    if(input==='qd\n'){child.emit('exit',0,null);return;}
    if(/^(g|t|p|gu)\n$/.test(input))return;
    const marker=/; \.echo (VB6_[0-9a-f]+)\n$/.exec(input);if(!marker)return;
    const command=input.slice(0,marker.index);let result=respond?.(command,input);
    if(result===null)return;
    if(result===undefined){
      if(command==='|'||command==='|.')result=' . 0 id: 4d2 create name: fixture.exe';
      else if(command==='~')result=' . 0 Id: 4d2.3c0 Suspend: 0 Teb: 00000000 Unfrozen';
      else if(command==='r')result='rax=0000000000000001 rip=00007ff6`12345678 rsp=00000000`12340000';
      else if(command.startsWith('kn'))result='00 00000000`12340000 00007ff6`12345600 fixture!Tick+0x2';
      else if(/^b[pua]\d+ /.test(command)){pendingBreakpoints.add(Number(/^b[pua](\d+)/.exec(command)[1]));result='';}
      else if(command==='bl')result=[...pendingBreakpoints].map(id=>`${id} e Disable Clear 00007ff6\`12345678 fixture!Tick`).join('\n');
      else result='';
    }
    child.stdout.write(command+'; .echo '+marker[1]+'\r\n'+result+'\r\n'+marker[1]+'\r\n0:000> ');
  });}});
  const session=new CdbSession({platform:'win32',cdbPath:'C:\\Debuggers\\cdb.exe',timeout,spawnProcess:(...args)=>{argv.push(args);queueMicrotask(()=>child.stdout.write(initial));return child;},breakProcess:async()=>{queueMicrotask(()=>child.stdout.write('Break instruction exception\r\n0:000> '));}});
  return {session,child,writes,argv};
}
async function started(t,options={}){const e=engine(options);t.after(()=>e.session.abort());await e.session.start({pid:1234});return e;}

test('native addresses preserve all 64 bits and reject numeric or executable text',()=>{
  assert.equal(address('ffffffffffffffff'),'0xffffffffffffffff');assert.equal(address('000000001234'),'0x1234');
  for(const value of [1234,'0x1;g','0x','0x10000000000000000','-1','x\n.shell','0x1`2'])assert.throws(()=>address(value));
});
test('native command inputs accept bounded expressions and reject injection',()=>{
  assert.equal(symbol('fixture!Tick+0x2'),'fixture!Tick+0x2');assert.equal(expression('poi(@rsp + 8)'),'poi(@rsp + 8)');
  for(const value of ['mod!x;g','mod!x\nqd','!shell','mod!*','mod!x"'])assert.throws(()=>symbol(value));
  for(const value of ['1; .shell echo fail','1\ng','$.call fn()','x\\y','"hello"','.load x',' '.repeat(3000),''])assert.throws(()=>expression(value));
});
test('native text parsers keep decimal indices separate from hexadecimal IDs',()=>{
  assert.deepEqual(parseProcesses('. 10 id: 4d2 create name: fixture.exe')[0],{index:10,pid:1234,name:'fixture.exe',current:true,exception:false});
  const thread=parseThreads('# 10 Id: 4d2.3c0 Suspend: 0')[0];assert.equal(thread.index,10);assert.equal(thread.tid,960);assert.equal(thread.exception,true);
  assert.equal(parseRegisters('rax=ffff8000`00000001 rip=00000001`00000000').rax,'0xffff800000000001');
  assert.equal(parseStack('0a 00000000`12340000 00007ff6`12345600 module!A [C:\\A.cpp @ 3]')[0].index,10);
});
test('native memory parser never substitutes zeroes for unreadable target memory',()=>{
  const result=parseMemory('ffffffff`ffff0000  01 02 ?? 04-05 06 07 08  ........\r\nffffffff`ffff0008  09 0a  ........','ffffffffffff0000',12);
  assert.deepEqual(result.bytes,[1,2,null,4,5,6,7,8,9,10,null,null]);assert.equal(result.unreadableBytes,3);
});
test('native session opts out of inherited scripts, shell commands and target termination',async t=>{
  const {session,argv}=await started(t);assert.equal(session.state,'paused');assert.equal(session.pid,1234);
  const [file,args,options]=argv[0];assert.equal(file,'C:\\Debuggers\\cdb.exe');for(const flag of ['-pd','-noshell','-noinh','-sins','-netsyms:no','-cf'])assert.ok(args.includes(flag));assert.equal(options.shell,false);assert.deepEqual(args.slice(-2),['-p','1234']);
});
test('native session validates targets before invoking a process',async()=>{
  for(const target of [{pid:0},{pid:1,executable:'C:\\a.exe'},{executable:'relative.exe'},{executable:'C:\\a.dll'},{executable:'C:\\a.exe',args:['a\0b']}] ){
    const e=engine();await assert.rejects(e.session.start(target));assert.equal(e.argv.length,0);
  }
});
test('native process prompt decimal thread ten is not hexadecimal sixteen',async t=>{const e=engine({initial:'0:010> '});t.after(()=>e.session.abort());const promise=e.session.start({pid:1234});await new Promise(r=>setTimeout(r,0));await promise;/* command prompt replaces the startup thread */e.session.receive('0:010> ');assert.equal(e.session.threadIndex,10);});
test('native reads and mutations are serialized, require a current pause, and use typed commands',async t=>{
  const {session,writes}=await started(t);const pauseId=session.pauseId;const results=await Promise.all([session.request('registers',{pauseId}),session.request('threads',{pauseId}),session.request('stack',{pauseId})]);
  assert.equal(results[0].registers.rip,'0x7ff612345678');assert.equal(results[1].threads.length,1);assert.equal(results[2].frames[0].symbol,'fixture!Tick+0x2');
  await session.request('selectThread',{index:0,pauseId});await assert.rejects(session.request('continue',{pauseId}),{code:'STALE_PAUSE'});
  await session.request('continue',{pauseId:session.pauseId});assert.equal(session.state,'running');await assert.rejects(session.request('registers'),{code:'NOT_PAUSED'});
  await session.request('pause');assert.equal(session.state,'paused');assert.ok(writes.includes('g\n'));
});
test('native breakpoint lifecycle verifies installation before reporting success',async t=>{
  const {session,writes}=await started(t);const b=await session.request('setBreakpoint',{location:'fixture!Tick'});assert.equal(b.id,1);
  await session.request('enableBreakpoint',{id:b.id,enabled:false});assert.equal(session.snapshot().breakpoints[0].enabled,false);
  await session.request('removeBreakpoint',{id:b.id});assert.equal(session.snapshot().breakpoints.length,0);
  assert.ok(writes.some(s=>s.startsWith('bu1 fixture!Tick;')));await assert.rejects(session.request('setBreakpoint',{location:'fixture!Tick; .shell x'}));
});
test('native reads use explicit hexadecimal lengths and preserve sparse reads',async t=>{
  const {session,writes}=await started(t,{respond:c=>c.startsWith('db ')?'00000000`00001000  01 ?? 03  ...':undefined});
  const result=await session.request('readMemory',{address:'1000',count:16});assert.equal(result.bytes[1],null);assert.ok(writes.some(s=>s.startsWith('db 0x1000 L0x10;')));
});
test('native writes fail visibly when target memory readback differs',async t=>{
  const {session}=await started(t,{respond:c=>c.startsWith('db ')?'00000000`00001000  01 00  ..':undefined});
  await assert.rejects(session.request('writeMemory',{address:'1000',bytes:[1,2]}),{code:'PARTIAL_WRITE'});
});
test('native command error rejects only the request and does not fake data',async t=>{
  const {session}=await started(t,{respond:c=>c.startsWith('? ')?"Couldn't resolve error at 'unknown'":undefined});
  await assert.rejects(session.request('evaluate',{expression:'unknown'}),{code:'COMMAND_FAILED'});assert.equal(session.state,'paused');assert.equal((await session.request('registers')).registers.rax,'0x1');
});
test('native stdout marker echoed as command text cannot finish a request',async t=>{
  const {session,child,writes}=await started(t,{respond:c=>c==='r'?null:undefined});let finished=false;
  const request=session.request('registers').then(v=>{finished=true;return v;});await new Promise(r=>setTimeout(r,0));const marker=/VB6_[a-f0-9]+/.exec(writes.at(-1))[0];
  child.stdout.write('r; .echo '+marker+'\r\n0:000> ');await new Promise(r=>setTimeout(r,0));assert.equal(finished,false);
  child.stdout.write('\r\nrax=0000000000000001\r\n'+marker+'\r\n0:000> ');assert.equal((await request).registers.rax,'0x1');
});
test('native timeout closes the debugger instead of leaving a queued mutation alive',async t=>{
  const {session,child}=await started(t,{timeout:100,respond:c=>c==='r'?null:undefined});await assert.rejects(session.request('registers'),{code:'TIMEOUT'});assert.equal(child.killed,true);assert.equal(session.state,'closed');
});
test('native detach from a running target breaks and quits with detach, never kill-target',async t=>{
  const {session,writes}=await started(t);await session.request('continue');await session.request('detach');assert.equal(session.state,'closed');assert.ok(writes.includes('qd\n'));assert.equal(writes.some(x=>x==='.kill\n'||x==='q\n'),false);
});
test('native service rejects raw commands even for an authorized session',async t=>{const {session}=await started(t);await assert.rejects(session.request('command',{command:'.shell x'}),{code:'UNKNOWN_OPERATION'});});

class FakeSession extends EventEmitter{
  state='new';pauseId=0;calls=[];aborted=false;
  snapshot(){return {state:this.state,pauseId:this.pauseId,pid:this.pid};}
  async start(options){this.pid=options.pid||42;this.state='paused';this.pauseId=1;this.emit('paused',this.snapshot());}
  async request(method,params){this.calls.push({method,params});if(method==='detach'){this.state='closed';this.emit('closed',{});}if(method==='status')return this.snapshot();return {method,params};}
  async abort(){this.aborted=true;this.state='closed';}
}
function post(bridge,value,{origin='https://ide.example',token=bridge.token,method='POST',headers={},path='/debugger'}={}){
  return new Promise((resolve,reject)=>{const request=http.request(bridge.url.replace('/debugger',path),{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,...(origin===undefined?{}:{Origin:origin}),...headers}},response=>{let text='';response.on('data',c=>text+=c);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:text?JSON.parse(text):null}));});request.on('error',reject);request.end(typeof value==='string'?value:JSON.stringify(value));});
}
async function service(t,options={}){const created=[],bridge=await createNativeDebuggerBridge({port:0,origins:['https://ide.example'],createSession:()=>{const s=new FakeSession();created.push(s);return s;},listProcesses:async()=>[{pid:1234,name:'fixture'}],...options});t.after(()=>bridge.close());return {bridge,created};}

test('native bridge binds only loopback and defaults to refusing target control',async t=>{
  const {bridge,created}=await service(t);assert.equal(bridge.server.address().address,'127.0.0.1');const result=await post(bridge,{method:'attach',params:{pid:1234}});assert.equal(result.status,403);assert.equal(result.body.error.code,'CONSENT_DENIED');assert.equal(created.length,0);
});
test('native bridge rejects wrong origins, tokens and Host without invoking a target',async t=>{
  let approvals=0;const {bridge}=await service(t,{authorize:async()=>{approvals++;return true;}});
  assert.equal((await post(bridge,{method:'attach',params:{pid:1}},{origin:'https://evil.example'})).status,403);
  assert.equal((await post(bridge,{method:'attach',params:{pid:1}},{token:'wrong'})).status,401);
  assert.equal((await post(bridge,{method:'attach',params:{pid:1}},{headers:{Host:'evil.example'}})).status,403);
  assert.equal((await post(bridge,{method:'attach',params:{pid:1}},{origin:'null'})).status,403);assert.equal(approvals,0);
});
test('native bridge CORS preflight is exact, no wildcard or query-token authentication',async t=>{
  const {bridge}=await service(t);const good=await post(bridge,'',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}});assert.equal(good.status,204);assert.equal(good.headers['access-control-allow-origin'],'https://ide.example');
  assert.equal((await post(bridge,'',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'DELETE'}})).status,403);
  assert.equal((await post(bridge,{method:'capabilities'},{path:'/debugger?token='+bridge.token,token:''})).status,404);
});
test('native bridge validates target arguments before per-target approval',async t=>{
  let approvals=0;const {bridge}=await service(t,{authorize:async()=>{approvals++;return true;}});
  for(const params of [{executable:'x.exe'},{executable:'C:\\x.dll'},{executable:'C:\\x.exe',args:['a\nqd']},{executable:'C:\\x.exe',debugChildren:'yes'}])assert.equal((await post(bridge,{method:'launch',params})).status,400);
  assert.equal(approvals,0);assert.equal((await post(bridge,null)).status,400);assert.equal((await post(bridge,'{bad')).status,400);
});
test('native bridge sessions keep independent event cursors and mutation identities',async t=>{
  const approvals=[],{bridge,created}=await service(t,{authorize:async v=>{approvals.push(v);return true;}});
  const first=(await post(bridge,{method:'attach',params:{pid:1234}})).body.result;
  const second=(await post(bridge,{method:'launch',params:{executable:'C:\\fixture.exe',args:['test'],debugChildren:true}})).body.result;
  assert.notEqual(first.id,second.id);assert.deepEqual(approvals.map(x=>x.operation),['attach','launch']);
  created[0].emit('output',{text:'only first'});const events=(await post(bridge,{method:'events',params:{session:first.id,after:0}})).body.result;
  assert.ok(events.events.some(e=>e.data.text==='only first'));
  const other=(await post(bridge,{method:'events',params:{session:second.id,after:0}})).body.result;assert.ok(!other.events.some(e=>e.data.text==='only first'));
  await post(bridge,{method:'writeMemory',params:{session:first.id,address:'1000',bytes:[1],pauseId:7}});assert.deepEqual(created[0].calls.at(-1),{method:'writeMemory',params:{address:'1000',bytes:[1],pauseId:7}});
});
test('native bridge bounded event history reports lost output rather than hiding gaps',async t=>{
  const {bridge,created}=await service(t,{authorize:async()=>true}),s=(await post(bridge,{method:'attach',params:{pid:1}})).body.result;
  for(let n=0;n<300;n++)created[0].emit('output',{text:'entry '+n});const result=(await post(bridge,{method:'events',params:{session:s.id,after:0}})).body.result;assert.equal(result.dropped,true);assert.equal(result.events.length,128);assert.ok(result.cursor>128);
});
test('native bridge enforces four-session limit including pending approvals',async t=>{
  const {bridge}=await service(t,{authorize:async()=>true});for(let i=1;i<=4;i++)assert.equal((await post(bridge,{method:'attach',params:{pid:i}})).status,200);
  const fifth=await post(bridge,{method:'attach',params:{pid:5}});assert.equal(fifth.body.error.code,'SESSION_LIMIT');
});
test('native bridge detach and server closure leave no retained session token capability',async t=>{
  const {bridge,created}=await service(t,{authorize:async()=>true}),s=(await post(bridge,{method:'attach',params:{pid:1}})).body.result;
  assert.equal((await post(bridge,{method:'detach',params:{session:s.id}})).status,200);assert.equal(created[0].aborted,true);assert.equal((await post(bridge,{method:'status',params:{session:s.id}})).body.error.code,'UNKNOWN_SESSION');
});
test('native bridge idle lease detaches a disconnected browser session',async t=>{
  const {bridge,created}=await service(t,{authorize:async()=>true,leaseMilliseconds:1000});await post(bridge,{method:'attach',params:{pid:1}});await new Promise(r=>setTimeout(r,2100));assert.equal(created[0].aborted,true);assert.equal(created[0].calls.filter(c=>c.method==='detach').length,1);
});


test('native hardware data breakpoints share the verified lifecycle and enforce alignment',async t=>{
  const {session,writes}=await started(t);
  const bp=await session.request('setDataBreakpoint',{address:'1000',access:'write',size:4,pauseId:session.pauseId});
  assert.equal(bp.kind,'data');assert.equal(bp.access,'write');assert.equal(bp.size,4);
  assert.ok(writes.some(s=>s.startsWith('ba1 w 4 0x1000;')));
  await session.request('enableBreakpoint',{id:bp.id,enabled:false});
  assert.equal(session.snapshot().breakpoints[0].enabled,false);
  await session.request('removeBreakpoint',{id:bp.id});assert.equal(session.snapshot().breakpoints.length,0);
  for(const params of [{address:'1001',size:4,access:'write'},{address:'1000',size:3,access:'readWrite'},{address:'1000',size:4,access:'io'},{address:'1000',size:2,access:'execute'}]){
    const count=writes.length;await assert.rejects(session.request('setDataBreakpoint',params),{code:'INVALID_ARGUMENT'});assert.equal(writes.length,count);
  }
});
test('native breakpoint metadata and queued request arguments cannot be changed by the caller',async t=>{
  const {session,writes}=await started(t),params={location:'fixture!Tick'};
  const pending=session.request('setBreakpoint',params);params.location='fixture!Changed';
  const bp=await pending;bp.location='forged';session.snapshot().breakpoints[0].enabled=false;
  assert.equal(session.snapshot().breakpoints[0].location,'fixture!Tick');assert.equal(session.snapshot().breakpoints[0].enabled,true);
  assert.ok(writes.some(s=>s.startsWith('bu1 fixture!Tick;')));
});
test('native partial memory writes invalidate the old mutation ticket',async t=>{
  const {session}=await started(t,{respond:c=>c.startsWith('db ')?'00000000`00001000  01 00  ..':undefined}),pause=session.pauseId;
  await assert.rejects(session.request('writeMemory',{address:'1000',bytes:[1,2],pauseId:pause}),{code:'PARTIAL_WRITE'});
  assert.ok(session.pauseId>pause);await assert.rejects(session.request('continue',{pauseId:pause}),{code:'STALE_PAUSE'});
});
test('native write command failure also invalidates the old pause without reporting success',async t=>{
  const {session}=await started(t,{respond:c=>c.startsWith('eb ')?'Memory access error at 00001001':undefined}),pause=session.pauseId;
  await assert.rejects(session.request('writeMemory',{address:'1000',bytes:[1,2],pauseId:pause}),{code:'COMMAND_FAILED'});
  assert.ok(session.pauseId>pause);assert.equal(session.state,'paused');
});

test('native Run to Address reserves its own ID and cancels after an unrelated stop',async t=>{
  const {session,child,writes}=await started(t);
  await session.request('runToAddress',{address:'2000',pauseId:session.pauseId});
  assert.equal(session.snapshot().breakpoints[0].temporary,true);
  assert.ok(writes.some(s=>s.startsWith('bp1 /1 0x2000;')));
  child.stdout.write('Unrelated breakpoint\r\n0:000> ');await session.waitPaused();
  const normal=await session.request('setBreakpoint',{location:'fixture!Tick',pauseId:session.pauseId});
  assert.equal(normal.id,2);assert.ok(writes.some(s=>s.startsWith('bc 1;')));
  assert.deepEqual(session.snapshot().breakpoints.map(b=>b.id),[2]);
});
test('native pending-operation limit does not grow an unbounded command queue',async t=>{
  const {session}=await started(t),pending=Array.from({length:256},()=>session.request('status'));
  await assert.rejects(session.request('status'),{code:'QUEUE_LIMIT'});await Promise.all(pending);
  assert.equal(session.pendingOperations,0);assert.equal((await session.request('status')).state,'paused');
  await assert.rejects(session.request('status',{callback(){}}),{code:'INVALID_ARGUMENT'});
});


test('native bridge requires a pause identity for hardware watchpoints',async t=>{
  const {bridge,created}=await service(t,{authorize:async()=>true}),s=(await post(bridge,{method:'attach',params:{pid:1}})).body.result;
  const args={session:s.id,address:'1000',size:4,access:'write'};
  assert.equal((await post(bridge,{method:'setDataBreakpoint',params:args})).body.error.code,'INVALID_ARGUMENT');
  assert.equal(created[0].calls.length,0);
  assert.equal((await post(bridge,{method:'setDataBreakpoint',params:{...args,pauseId:7}})).status,200);
  assert.deepEqual(created[0].calls.at(-1),{method:'setDataBreakpoint',params:{address:'1000',size:4,access:'write',pauseId:7}});
});

// Network consumers use this monotonic ticket alongside pause IDs to reject a
// delayed running response after observing the next native breakpoint event.
test('native state revisions order running and paused replies across independent transports',async t=>{
  const {session}=await started(t);const initial=session.snapshot();
  const running=await session.request('continue',{pauseId:initial.pauseId});
  const stopped=await session.request('pause');
  assert.equal(running.state,'running');assert.equal(stopped.state,'paused');
  assert.equal(running.pauseId,initial.pauseId);assert.ok(stopped.pauseId>running.pauseId);
  assert.ok(initial.stateRevision<running.stateRevision);assert.ok(running.stateRevision<stopped.stateRevision);
  assert.equal(initial.state,'paused'); // snapshots never change in place
});

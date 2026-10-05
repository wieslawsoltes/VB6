import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpTasks,TASK_EXTENSION} from '../src/mcp/tasks.js';
import {McpError,MCP_META,MCP_VERSION,awaitAbort} from '../src/mcp/protocol.js';
import {newProject,normalizeProject} from '../src/project/model.js';
import {Signal,History,clone} from '../src/core/core.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t,{approve=async()=>true}={}) {
  const ide=new Signal();Object.assign(ide,{project:newProject('McpRefinement'),runState:'design',history:new History(),breakpoints:[],output:[],immediateOutput:[],docs:[],stack:[],savedJSON:'',
    markDirty(){this.dirty=true;},record(before,label){this.history.record(before,this.project,label);this.markDirty();},
    loadProject(p){this.project=normalizeProject(p);this.history.reset();},syncBreakpoints(){},
    async command(name){if(['undo','redo'].includes(name)){const next=this.history[name](this.project);if(next){this.project=normalizeProject(next);this.markDirty();}}}});
  const adapter=createIdeAdapter(ide,{approve}),server=new McpServer(adapter);adapter.setEnabled(true);
  t.after(()=>{server.close();adapter.dispose();});let sequence=0;
  const request=(method,params={},ctx={},tasks=false)=>server.dispatch({jsonrpc:'2.0',id:++sequence,method,params:{...params,_meta:{
    [MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:tasks?{extensions:{[TASK_EXTENSION]:{}}}:{}
  }}},{sessionKey:'s'+sequence,principal:'owner-a',...ctx});
  const call=async(name,args={},ctx={})=>{const response=await request('tools/call',{name:'vb6.'+name,arguments:args},ctx);if(response.error)throw Object.assign(new Error(response.error.message),response.error);assert.equal(response.result.isError,false,JSON.stringify(response));return response.result.structuredContent;};
  const write=(name,args={},ctx={})=>call(name,{...args,expectedRevision:adapter.revision},ctx);
  return {ide,adapter,server,request,call,write};
}
const connection={name:'Local',provider:'sqlite',database:'/customers.sqlite'};
const command={name:'Customers',connection:'Local',type:1,text:'SELECT * FROM customers WHERE id=?',parameters:[{name:'Id',type:3,value:1}]};
async function populate(f) {
  await f.write('data.connection.set',{mode:'create',definition:connection});
  await f.write('data.command.set',{mode:'create',definition:command});
}

test('MCP data: complete scoped inventory, schemas and dedicated resource',async t=>{
  const f=fixture(t);await populate(f);
  assert.equal(f.adapter.tools.filter(tool=>tool.name.startsWith('vb6.data.')).length,10);
  const caps=await f.call('agent.capabilities');assert.ok(caps.scopes.data);assert.ok(caps.tools.filter(t=>t.name.startsWith('vb6.data.')).every(t=>t.scope==='data'));
  const providers=await f.call('data.providers');assert.equal(providers.providers.length,7);assert.equal(providers.providers.find(p=>p.id==='sqlite').network,false);
  const all=await f.call('data.list');assert.equal(all.total,2);assert.equal(all.connections,1);assert.equal(all.commands,1);assert.ok(all.items.every(i=>!Object.hasOwn(i,'text')));
  const page=await f.call('data.list',{kind:'command',offset:0,limit:1});assert.equal(page.items[0].name,'Customers');assert.equal(page.hasMore,false);
  assert.equal((await f.request('resources/read',{uri:'vb6://data'})).result.contents.length,1);
  assert.equal((await f.call('commands.list')).commands.find(c=>c.id==='dataEnvironment')?.tool,'vb6.data.list');
});
test('MCP data: create, replace and case-insensitive read use real project history',async t=>{
  const f=fixture(t);await populate(f);const before=clone(f.ide.project);
  const read=await f.call('data.connection.get',{name:'local'});assert.deepEqual(read.definition,connection);
  read.definition.database='/not-mutated.sqlite';assert.equal(f.ide.project.dataSources.connections[0].database,connection.database);
  await f.write('data.command.set',{mode:'replace',definition:{...command,text:'SELECT 42'}});
  assert.equal((await f.call('data.command.get',{name:'CUSTOMERS'})).definition.text,'SELECT 42');
  await f.write('history.apply',{direction:'undo'});assert.deepEqual(f.ide.project,before);
  await f.write('history.apply',{direction:'redo'});assert.equal(f.ide.project.dataSources.commands[0].text,'SELECT 42');
});
test('MCP data: connection rename updates dependent command references with one undo unit',async t=>{
  const f=fixture(t);await populate(f);const before=clone(f.ide.project),count=f.ide.history.undoStack.length;
  const result=await f.write('data.rename',{kind:'connection',name:'local',newName:'Database'});
  assert.deepEqual(result.updatedCommands,['Customers']);assert.equal(result.sourceAndBindingsUpdated,false);
  assert.equal(f.ide.project.dataSources.commands[0].connection,'Database');assert.equal(f.ide.history.undoStack.length,count+1);
  await f.write('history.apply',{direction:'undo'});assert.deepEqual(f.ide.project,before);
});
test('MCP data: command rename preserves SQL and explicitly leaves code references untouched',async t=>{
  const f=fixture(t);await populate(f);const source=f.ide.project.modules[0].code;
  await f.write('data.rename',{kind:'command',name:'Customers',newName:'LoadCustomers'});
  assert.equal(f.ide.project.dataSources.commands[0].text,command.text);assert.equal(f.ide.project.modules[0].code,source);
});
test('MCP data: cascading deletion is explicit and never removes database files',async t=>{
  const f=fixture(t);await populate(f);await f.write('files.write',{path:'/customers.sqlite',content:'inert'});const before=clone(f.ide.project);
  await assert.rejects(f.write('data.connection.remove',{name:'local'}),/cascade/);assert.deepEqual(f.ide.project,before);
  const result=await f.write('data.connection.remove',{name:'LOCAL',cascade:true});assert.deepEqual(result.removed,['Local','Customers']);
  assert.equal((await f.call('files.read',{path:'/customers.sqlite'})).content,'inert');assert.equal(f.ide.project.dataSources.commands.length,0);
});
test('MCP data: command removal does not delete its connection',async t=>{
  const f=fixture(t);await populate(f);await f.write('data.command.remove',{name:'Customers'});
  assert.equal(f.ide.project.dataSources.connections.length,1);assert.equal(f.ide.project.dataSources.commands.length,0);
});
test('MCP data: new data scope is not implicitly granted by workspace or runtime scopes',async t=>{
  const f=fixture(t,{approve:async()=>false});f.adapter.permissions.allow(f.ide.project.id,['workspace','runtime'],1);
  await assert.rejects(f.write('data.connection.set',{mode:'create',definition:connection}),/declined/);
  f.adapter.permissions.allow(f.ide.project.id,['data'],1);await f.write('data.connection.set',{mode:'create',definition:connection});
  await assert.rejects(f.write('module.write',{module:'Form1',code:'unauthorized'}),/declined/);
});
test('MCP data: pending approval invalidated by intervening project edits',async t=>{
  let resolve;const f=fixture(t,{approve:()=>new Promise(r=>resolve=r)});
  const pending=f.write('data.connection.set',{mode:'create',definition:connection});await tick();const before=clone(f.ide.project);f.ide.markDirty();resolve(true);
  await assert.rejects(pending,/changed/);assert.deepEqual(f.ide.project,before);
});
test('MCP data: principal revocation cancels pending approval without a later commit',async t=>{
  let resolve;const f=fixture(t,{approve:()=>new Promise(r=>resolve=r)});
  const pending=f.write('data.connection.set',{mode:'create',definition:connection});await tick();f.server.revokePrincipal('owner-a');
  await assert.rejects(pending,/cancel/i);resolve(true);await tick();assert.equal(f.ide.project.dataSources?.connections.length||0,0);
});
for(const state of ['paused','running'])test('MCP data: definition changes reject '+state+' runtime',async t=>{
  const f=fixture(t);f.ide.runState=state;await assert.rejects(f.write('data.connection.set',{mode:'create',definition:connection}),/Stop/);
});
for(const definition of [null,[],{...connection,provider:'unknown'},{...connection,password:'secret'},
  {...connection,headers:{Authorization:'Bearer secret'}},{...connection,provider:'rest',url:'https://u:p@example.test'},
  {...connection,provider:'rest',url:'https://example.test/?api_key=secret'},{...connection,name:'SetCredential'},
  {...connection,connectionString:'Provider=SQLite;Password={secret}'},{...connection,description:'x'.repeat(512*1024)}])
  test('MCP data: invalid or credential-bearing definition is rejected atomically '+String(definition?.name||typeof definition)+' '+Object.keys(definition||{}).join(','),async t=>{
    const f=fixture(t),before=clone(f.ide.project);await assert.rejects(f.write('data.connection.set',{mode:'create',definition}));assert.deepEqual(f.ide.project,before);assert.equal(f.ide.history.undoStack.length,0);
  });
for(const [kind,mode,definition] of [['connection','create',connection],['connection','replace',{...connection,name:'Missing'}],
  ['command','create',{...command,connection:'Missing'}],['command','create',{...command,name:'Other',type:128}],
  ['command','create',{...command,name:'Other',text:55}],['command','create',{...command,name:'rsCustomers'}]])
  test('MCP data: replacement and reference validation '+kind+' '+mode+' '+definition.name,async t=>{
    const f=fixture(t);await populate(f);const before=clone(f.ide.project);await assert.rejects(f.write('data.'+kind+'.set',{mode,definition}));assert.deepEqual(f.ide.project,before);
  });
test('MCP data: provider validation is structural, never connects or accesses credentials',async t=>{
  const f=fixture(t);await f.write('data.connection.set',{mode:'create',definition:{name:'API',provider:'rest',url:'https://example.invalid',credentialRef:'LOCAL_ONLY'}});
  const result=await f.call('data.validate');assert.equal(result.valid,true);assert.equal(result.liveConnectionTest,false);
  f.ide.project.dataSources.connections[0].provider='uninstalled';assert.equal((await f.call('data.validate')).valid,false);
});
test('MCP data: sidecar and build export include committed definitions',async t=>{
  const f=fixture(t);await populate(f);const files=await f.call('project.files');assert.ok(files.items.some(f=>f.path.endsWith('.vb6data.json')));
  const build=await f.call('build.create',{target:'project',expectedRevision:f.adapter.revision});const data=await f.call('build.read',{artifactId:build.artifact.artifactId});
  assert.deepEqual(JSON.parse(Buffer.from(data.data,'base64')).dataSources,f.ide.project.dataSources);
});

test('MCP source: bounded UTF-16 chunks reassemble long single-line Unicode source exactly',async t=>{
  const f=fixture(t);const code='a🙂\r\n'+ '漢🙂'.repeat(100000);f.ide.project.modules[0].code=code;
  const revision=f.adapter.revision;let actual='',offset=0;do { const result=await f.call('code.read',{module:'Form1',offset,count:65537,expectedRevision:revision});assert.equal(result.offsetEncoding,'utf-16');assert.ok(result.code.length<=65537);actual+=result.code;offset=result.nextOffset;if(!result.hasMore)break; }while(true);
  assert.equal(actual,code);assert.equal(offset,code.length);
});
test('MCP source: end-of-source is stable and changed revisions are rejected',async t=>{
  const f=fixture(t),revision=f.adapter.revision,code=f.ide.project.modules[0].code;
  const end=await f.call('code.read',{module:'Form1',offset:code.length});assert.equal(end.code,'');assert.equal(end.hasMore,false);
  f.ide.markDirty();await assert.rejects(f.call('code.read',{module:'Form1',expectedRevision:revision}),/changed/);
});
for(const args of [{offset:-1},{count:0},{count:262145},{offset:5000001},{module:'Missing'},{offset:10000}])test('MCP source: invalid range '+JSON.stringify(args),async t=>{
  const f=fixture(t);await assert.rejects(f.call('code.read',{module:'Form1',...args}));
});

for(const action of ['cancel','clear','authority'])test('MCP lifecycle: '+action+' before task callback prevents invocation',async()=>{
  const tasks=new McpTasks(),authority=new AbortController();let called=0;
  const handle=tasks.create(()=>{called++;return{};},{principal:'A'},authority.signal);
  if(action==='cancel')tasks.cancel(handle.taskId,{principal:'A'});else if(action==='clear')tasks.clear();else authority.abort();
  await tick();assert.equal(called,0);tasks.clear();
});
test('MCP lifecycle: local task metadata omits principals, arguments and results; clear only finished tasks',async()=>{
  const tasks=new McpTasks();const a=tasks.create(async()=>({secret:'must-not-appear'}),{principal:'secret-principal'},undefined,{toolName:'vb6.agent.wait'});
  const b=tasks.create(()=>new Promise(()=>{}),{principal:'B'},undefined,{toolName:'vb6.agent.wait'});await tick();
  const list=tasks.inspect();assert.equal(list.length,2);assert.ok(!JSON.stringify(list).includes('secret'));list[0].status='modified';assert.equal(tasks.get(a.taskId,{principal:'secret-principal'}).status,'completed');
  tasks.clearFinished();assert.equal(tasks.inspect().length,1);assert.equal(tasks.inspect()[0].taskId,b.taskId);tasks.cancelLocal(b.taskId);assert.equal(tasks.get(b.taskId,{principal:'B'}).status,'cancelled');tasks.clear();
});
test('MCP lifecycle: failed change listeners do not prevent task cancellation acknowledgement',async()=>{
  const tasks=new McpTasks({changed:()=>{throw Error('observer failed');}});tasks.onChange(()=>Promise.reject(Error('observer rejected')));
  const h=tasks.create(()=>new Promise(()=>{}),{principal:'A'});await tick();assert.deepEqual(tasks.cancel(h.taskId,{principal:'A'}),{});assert.equal(tasks.get(h.taskId,{principal:'A'}).status,'cancelled');tasks.clear();await tick();
});
test('MCP lifecycle: principal revocation stops only matching active calls',async()=>{
  let resolve;const adapter={tools:[{name:'wait',inputSchema:{type:'object'},execute:(_,ctx)=>awaitAbort(new Promise(r=>{resolve=r;}),ctx.signal)}]};
  const server=new McpServer(adapter),call=(id,principal)=>server.dispatch({jsonrpc:'2.0',id,method:'tools/call',params:{name:'wait',_meta:{[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:{}}}},{sessionKey:String(id),principal});
  const a=call(1,'A'),b=call(2,'B');server.revokePrincipal('A');assert.equal((await a).error.code,-32800);assert.equal(server.active.size,1);resolve({ok:true});assert.equal((await b).result.isError,false);server.close();
});
test('MCP lifecycle: closed server cannot resurrect via dispatch',async t=>{
  const f=fixture(t);f.server.close();const response=await f.request('server/discover');assert.match(response.error.message,/closed/);assert.equal(f.server.active.size,0);
});
test('MCP lifecycle: modern tool calls observe additions and removals without tools/list',async t=>{
  const f=fixture(t);const tool={name:'dynamic',inputSchema:{type:'object'},execute:()=>({ok:true})};f.adapter.tools.push(tool);
  assert.equal((await f.request('tools/call',{name:'dynamic'})).result.structuredContent.ok,true);
  f.adapter.tools=f.adapter.tools.filter(t=>t!==tool);assert.ok((await f.request('tools/call',{name:'dynamic'})).error);
});
test('MCP operations: build metadata is local-only and releasing it revokes agent read handles',async t=>{
  const f=fixture(t);let events=0;const off=f.adapter.onArtifactsChange(()=>events++);
  const built=await f.call('build.create',{target:'project',expectedRevision:f.adapter.revision});const id=built.artifact.artifactId;
  const list=f.adapter.inspectArtifacts();assert.equal(list.length,1);assert.equal(list[0].artifactId,id);assert.ok(!Object.hasOwn(list[0],'bytes'));assert.ok(!JSON.stringify(list).includes('owner-a'));list[0].name='not-mutated';
  assert.notEqual(f.adapter.inspectArtifacts()[0].name,'not-mutated');assert.equal(f.adapter.releaseArtifactLocal(id),true);
  await assert.rejects(f.call('build.read',{artifactId:id}),/not found/);assert.ok(events>=2);off();
  const remote=await f.request('tasks/list');assert.equal(remote.error.code,-32601);assert.ok(!f.adapter.tools.some(t=>/inspectArtifacts|cancelLocal|clearFinished|releaseArtifactLocal/.test(t.name)));
});

test('MCP lifecycle: principal revocation clears initialized legacy sessions, not other principals',async t=>{
  const f=fixture(t);
  const initialize=(id,principal)=>f.server.dispatch({jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2025-11-25',clientInfo:{name:'legacy',version:'1'},capabilities:{}}},{sessionKey:id,principal});
  assert.ok((await initialize('one','A')).result);assert.ok((await initialize('two','B')).result);
  f.server.revokePrincipal('A');assert.equal(f.server.sessions.has('one'),false);assert.equal(f.server.sessions.has('two'),true);
  assert.ok([...f.server.listeners].every(listener=>listener.principal==='B'));
});

test('MCP lifecycle: revoked request cleanup cannot erase a reused active request ID',async()=>{
  const server=new McpServer({tools:[{name:'wait',inputSchema:{type:'object'},execute:(_,ctx)=>awaitAbort(new Promise(()=>{}),ctx.signal)}]});
  const message={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'wait',_meta:{[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:{}}}};
  const context={sessionKey:'same-session',principal:'A'};
  const old=server.dispatch(message,context);server.revokePrincipal('A');
  const next=server.dispatch(message,context);
  assert.equal((await old).error.code,-32800);
  assert.equal(server.active.size,1,'The replacement request must remain cancellable');
  server.close();assert.equal((await next).error.code,-32800);
});
test('MCP lifecycle: cancelled legacy subscription cannot recreate a closed listener',async()=>{
  let resolve;
  const server=new McpServer({tools:[],resources:()=>[],readResource:()=>new Promise(r=>{resolve=r;})});
  const context={sessionKey:'legacy',principal:'A'};
  await server.dispatch({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'legacy',version:'1'}}},context);
  await server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'},context);
  const pending=server.dispatch({jsonrpc:'2.0',id:2,method:'resources/subscribe',params:{uri:'vb6://project'}},context);
  server.closeSession(context.sessionKey);assert.equal((await pending).error.code,-32800);
  resolve({contents:[]});await tick();await tick();
  assert.equal(server.listeners.size,0,'Do not register a subscription after cancellation');server.close();
});

test('MCP tasks: local cancellation safely handles expiry before the timer fires',()=>{
  let now=0;
  const tasks=new McpTasks({now:()=>now,ttlMs:100});
  const handle=tasks.create(()=>new Promise(()=>{}),{principal:'A'});
  now=101;
  assert.equal(tasks.cancelLocal(handle.taskId),false);
  assert.equal(tasks.inspect().length,0);
  tasks.clear();
});

// Absolute deadlines must still hold when the event loop has not delivered a timer.
test('MCP tasks: elapsed deadline prevents queued adapter invocation',async()=>{
  let now=0,called=0;
  const tasks=new McpTasks({now:()=>now,ttlMs:100});
  try {
    const handle=tasks.create(()=>{called++;return {};},{principal:'A'});
    now=101;
    await tick();
    assert.equal(called,0);
    assert.equal(tasks.entries.has(handle.taskId),false);
  } finally { tasks.clear(); }
});
test('MCP tasks: elapsed deadline cannot publish a late result or notification',async()=>{
  let now=0,resolve;const changes=[];
  const tasks=new McpTasks({now:()=>now,ttlMs:100,changed:task=>changes.push(task)});
  try {
    const handle=tasks.create(()=>new Promise(r=>{resolve=r;}),{principal:'A'});
    await Promise.resolve();now=101;resolve({secret:'expired result'});
    await tick();
    assert.equal(changes.length,0);
    assert.equal(tasks.entries.has(handle.taskId),false);
  } finally { tasks.clear(); }
});

test('MCP sessions: authenticated identity cannot reuse another principal legacy session',async()=>{
  const server=new McpServer({tools:[],resources:()=>[]});
  const A={sessionKey:'shared',principal:'A'},B={sessionKey:'shared',principal:'B'};
  try {
    await server.dispatch({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'A',version:'1'}}},A);
    await server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'},B);
    assert.equal(server.sessions.get('shared').ready,false);
    await server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'},A);
    const denied=await server.dispatch({jsonrpc:'2.0',id:2,method:'tools/list'},B);
    assert.equal(denied.error?.code,-32001);
    assert.ok((await server.dispatch({jsonrpc:'2.0',id:3,method:'tools/list'},A)).result);
  } finally { server.close(); }
});
test('MCP sessions: one principal cannot cancel another active request with a colliding key',async()=>{
  let signal;
  const server=new McpServer({tools:[{name:'wait',inputSchema:{type:'object'},execute:(_,ctx)=>{signal=ctx.signal;return awaitAbort(new Promise(()=>{}),ctx.signal);}}]});
  const params={name:'wait',_meta:{[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:{}}};
  const pending=server.dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params},{sessionKey:'shared',principal:'A'});
  try {
    await server.dispatch({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:1}},{sessionKey:'shared',principal:'B'});
    assert.equal(signal.aborted,false);
  } finally { server.close();await pending; }
});

test('MCP tasks: cancelled initiating request cannot retain an unpublished task handle',async t=>{
  const f=fixture(t),controller=new AbortController();
  const pending=f.request('tools/call',{name:'vb6.agent.wait',arguments:{afterRevision:f.adapter.revision,timeoutMs:10000}},
    {signal:controller.signal},true);
  controller.abort();
  assert.equal((await pending).error?.code,-32800);
  await tick();
  assert.equal(f.server.tasks.inspect().length,0,'A rejected request did not deliver authority to its task handle');
});

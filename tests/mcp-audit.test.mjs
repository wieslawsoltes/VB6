import {sha256} from '../src/core/sha256.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpTasks, TASK_EXTENSION} from '../src/mcp/tasks.js';
import {McpClient} from './helpers/mcp-client.mjs';
import {LocalTransport} from './helpers/mcp-transports.mjs';
import {MCP_VERSION, MCP_META, MCP_LIMIT, McpError, requestHeaders, parseMessage} from '../src/mcp/protocol.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History, clone} from '../src/core/core.js';
import {readZip} from '../src/project/zip.js';
import {fromBase64} from '../src/project/frx.js';
import {encodeNativeText} from '../src/project/native-text.js';
import {compileWin32} from '../src/native/compiler.js';
import {mergedProject} from '../src/project/import-merge.js';
import {createHash} from 'node:crypto';

function fixture(t,{approve=async()=>true}={}) {
  const ide=new Signal();Object.assign(ide,{project:newProject('AgentTest'),runState:'design',history:new History(),breakpoints:[],watches:[],output:[],immediateOutput:[],stack:[],docs:[],savedJSON:'',
    markDirty(){this.dirty=true;},record(before,label){this.history.record(before,this.project,label);this.markDirty();},loadProject(p){this.project=normalizeProject(p);this.history.reset();},syncBreakpoints(){},updateWatches(){},autosave(){},
    async command(c){if(['undo','redo'].includes(c)){const next=this.history[c](this.project);if(next){this.project=normalizeProject(next);this.markDirty();}}else this.lastCommand=c;},
    openDocument(id,view){this.docs.push({id,view,key:id+':'+view});},requestRuntime:async()=>({value:'42'}),sendRuntime(){}});
  const adapter=createIdeAdapter(ide,{approve}),server=new McpServer(adapter),client=new McpClient(new LocalTransport(server));adapter.setEnabled(true);
  t.after(async()=>{await client.close();server.close();adapter.dispose();});
  const call=async(name,args={})=>{await client.connect();const r=await client.callTool('vb6.'+name,args);if(r.isError)throw new Error(r.content[0].text);return r.structuredContent;};
  const write=(name,args={})=>call(name,{expectedRevision:adapter.revision,...args});
  return {ide,adapter,server,client,call,write};
}

let sequence = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const meta = tasks => ({[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientCapabilities']:tasks?{extensions:{[TASK_EXTENSION]:{}}}:{}});
function modern(f, method, params={}, context={}, tasks=false) {
  return f.server.dispatch({jsonrpc:'2.0',id:++sequence,method,params:{...params,_meta:{...meta(tasks),...params._meta}}}, {sessionKey:'request-'+sequence,principal:'agent-a',...context});
}
async function tool(f, name, args={}, context={}) {
  const r=await modern(f,'tools/call',{name:'vb6.'+name,arguments:args},context);
  assert.equal(r.error,undefined,JSON.stringify(r));assert.equal(r.result.isError,false,JSON.stringify(r));return r.result.structuredContent;
}
const init = (f, key='legacy', notify=()=>{}) => f.server.dispatch({jsonrpc:'2.0',id:++sequence,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}},{sessionKey:key,notify});
const initialized = (f,key='legacy') => f.server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'}, {sessionKey:key});

for(const method of ['server/discover','tools/list','prompts/list','resources/list','resources/templates/list','resources/read'])
test('audit protocol: optional client identity and required cache hints on '+method,async t=>{
 const f=fixture(t),r=await modern(f,method,method==='resources/read'?{uri:'vb6://project'}:{});
 assert.equal(r.error,undefined,JSON.stringify(r));assert.equal(r.result.ttlMs,0);assert.equal(r.result.cacheScope,'private');assert.equal(r.result.resultType,'complete');assert.ok(r.result._meta[MCP_META+'serverInfo']);
});
for(const clientInfo of [null,false,[],{name:3,version:'1'},{name:'missing version'}])
test('audit protocol: malformed optional client identity rejected '+JSON.stringify(clientInfo),async t=>{
 const f=fixture(t),r=await modern(f,'server/discover',{_meta:{[MCP_META+'clientInfo']:clientInfo}});assert.equal(r.error.code,-32602);
});
for(const argumentsValue of [null,false,[],5])
test('audit protocol: invalid tool arguments cannot become empty defaults '+JSON.stringify(argumentsValue),async t=>{
 const f=fixture(t),r=await modern(f,'tools/call',{name:'vb6.project.get',arguments:argumentsValue});assert.equal(r.error.code,-32602);
});
test('audit protocol: output schemas, structured errors and deterministic catalogs',async t=>{
 const f=fixture(t);f.adapter.tools.push({name:'test.invalid',inputSchema:{type:'object'},outputSchema:{type:'object',required:['required']},execute:()=>({other:true})});
 const listed=await modern(f,'tools/list');const names=listed.result.tools.map(x=>x.name);assert.deepEqual(names,[...names].sort());assert.ok(listed.result.tools.every(x=>x.outputSchema));
 assert.equal((await modern(f,'tools/call',{name:'test.invalid',arguments:{}})).error.code,-32603);
 assert.equal((await modern(f,'tools/call',{name:'vb6.module.write',arguments:{module:'Form1',code:'',expectedRevision:999}})).error.code,-32602);
 await init(f);await initialized(f);
 assert.equal((await f.server.dispatch({jsonrpc:'2.0',id:++sequence,method:'resources/read',params:{uri:'vb6://missing'}},{sessionKey:'legacy'})).error.code,-32002);
});
test('audit protocol: prompt value types and completion references are validated',async t=>{
 const f=fixture(t);
 assert.equal((await modern(f,'prompts/get',{name:'explain-module',arguments:{module:'Form1',extra:42}})).error.code,-32602);
 assert.equal((await modern(f,'completion/complete',{ref:{type:'ref/prompt',name:'missing'},argument:{name:'module',value:'F'}})).error.code,-32602);
 const result=await modern(f,'completion/complete',{ref:{type:'ref/resource',uri:'vb6://module/{name}/source'},argument:{name:'name',value:'F'}});assert.deepEqual(result.result.completion.values,['Form1']);
});
test('audit protocol: UTF-8 byte limits apply to string and MessagePort-style requests/results',async t=>{
 const f=fixture(t),large='🙂'.repeat(MCP_LIMIT/4);
 assert.throws(()=>parseMessage(JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',params:{large}})),/limit|large/i);
 assert.equal((await modern(f,'ping',{large})).error.code,-32600);
 f.adapter.tools.push({name:'large',inputSchema:{type:'object'},execute:()=>({large})});await modern(f,'tools/list');
 assert.ok((await modern(f,'tools/call',{name:'large'})).error);
});
test('audit protocol: cancelled initialization leaves no session or subscription',async t=>{
 const f=fixture(t);f.adapter.resources=()=>new Promise(()=>{});const controller=new AbortController();
 const pending=f.server.dispatch({jsonrpc:'2.0',id:++sequence,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'a',version:'1'}}},{sessionKey:'cancelled',signal:controller.signal});
 controller.abort();assert.equal((await pending).error.code,-32800);assert.equal(f.server.sessions.has('cancelled'),false);assert.equal(f.server.listeners.size,0);
});
test('audit notifications: legacy catalog events require initialized but not resources/subscribe; typing is not a list change',async t=>{
 const f=fixture(t),events=[];await init(f,'legacy',m=>events.push(m));
 f.ide.project.modules.push({id:'extra',name:'Extra',kind:'module',code:''});f.server.changed();await tick();assert.equal(events.length,0);
 await initialized(f);f.server.changed();await tick();assert.equal(events.filter(e=>e.method==='notifications/resources/list_changed').length,1);
 events.length=0;f.ide.project.modules[0].code='typing';f.server.changed();await tick();assert.equal(events.length,0);
});
test('audit notifications: modern selected catalog filters, acknowledged first, broken transports isolated',async t=>{
 const f=fixture(t),events=[],controller=new AbortController();
 const pending=modern(f,'subscriptions/listen',{notifications:{toolsListChanged:true,promptsListChanged:true}},{signal:controller.signal,emit:m=>events.push(m)});
 await tick();assert.equal(events[0].method,'notifications/subscriptions/acknowledged');
 f.server.listeners.add({filter:{toolsListChanged:true},emit:()=>{throw Error('closed transport');},stamp:{}});
 f.adapter.tools.push({name:'extra',inputSchema:{type:'object'},execute:()=>({})});f.adapter.prompts.push({name:'extra-prompt',get:()=>({messages:[]})});f.server.changed();await tick();
 assert.ok(events.some(e=>e.method==='notifications/tools/list_changed'));assert.ok(events.some(e=>e.method==='notifications/prompts/list_changed'));assert.ok(!events.some(e=>e.method==='notifications/resources/list_changed'));
 assert.ok(events.every(e=>e.params._meta[MCP_META+'subscriptionId']===events[0].params._meta[MCP_META+'subscriptionId']));controller.abort();await pending;
});
test('audit notifications: progress is correlated/increasing and legacy logging level is honored',async t=>{
 const f=fixture(t),events=[];f.adapter.tools.push({name:'logs',inputSchema:{type:'object'},execute:(_,ctx)=>{ctx.log('debug','hidden');ctx.log('warning','visible');return {};}});await init(f);await initialized(f);await modern(f,'tools/list');
 await f.server.dispatch({jsonrpc:'2.0',id:++sequence,method:'logging/setLevel',params:{level:'warning'}},{sessionKey:'legacy'});
 await f.server.dispatch({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'logs',arguments:{},_meta:{progressToken:'build-1'}}},{sessionKey:'legacy',emit:m=>events.push(m)});
 assert.deepEqual(events.filter(e=>e.method==='notifications/message').map(e=>e.params.data),['visible']);
 const progress=events.filter(e=>e.method==='notifications/progress').map(e=>e.params);assert.deepEqual(progress.map(p=>p.progress),[0,1]);assert.ok(progress.every(p=>p.total===1&&p.progressToken==='build-1'));
});

test('audit tasks: negotiated wait is pollable across requests, independent of initiating HTTP close',async t=>{
 const f=fixture(t),controller=new AbortController();
 const r=await modern(f,'tools/call',{name:'vb6.agent.wait',arguments:{afterRevision:f.adapter.revision,timeoutMs:1000}},{signal:controller.signal},true);
 assert.equal(r.result.resultType,'task');assert.equal(r.result.status,'working');const id=r.result.taskId;controller.abort();
 assert.equal((await modern(f,'tasks/get',{taskId:id},{},true)).result.status,'working');
 f.ide.markDirty();await new Promise(r=>setTimeout(r,65));
 const completed=await modern(f,'tasks/get',{taskId:id},{},true);assert.equal(completed.result.status,'completed');assert.equal(completed.result.result.structuredContent.matched,true);
 const normal=await modern(f,'tools/call',{name:'vb6.agent.wait',arguments:{timeoutMs:0}});assert.equal(normal.result.resultType,'complete');
});
test('audit tasks: owner binding, capability enforcement, cancellation and input cannot approve operations',async t=>{
 const f=fixture(t),r=await modern(f,'tools/call',{name:'vb6.agent.wait',arguments:{afterRevision:f.adapter.revision,timeoutMs:1000}},{},true),taskId=r.result.taskId;
 assert.equal((await modern(f,'tasks/get',{taskId})).error.code,-32021);
 for(const method of ['tasks/get','tasks/update','tasks/cancel'])assert.equal((await modern(f,method,{taskId,inputResponses:{allow:true}},{principal:'other-agent'},true)).error.code,-32602);
 const update=await modern(f,'tasks/update',{taskId,inputResponses:{allow:true}},{},true);assert.equal(update.result.resultType,'complete');assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active,false);
 const cancel=await modern(f,'tasks/cancel',{taskId},{},true);assert.equal(cancel.result.resultType,'complete');assert.equal(cancel.result.status,undefined);
 await tick();assert.equal((await modern(f,'tasks/get',{taskId},{},true)).result.status,'cancelled');
 assert.equal(requestHeaders({jsonrpc:'2.0',id:1,method:'tasks/get',params:{taskId,_meta:meta(true)}},MCP_VERSION)['Mcp-Name'],taskId);
});
test('audit tasks: notifications are opt-in and authority loss makes handles unreadable',async t=>{
 const f=fixture(t),r=await modern(f,'tools/call',{name:'vb6.agent.wait',arguments:{afterRevision:f.adapter.revision,timeoutMs:1000}},{},true),taskId=r.result.taskId;
 const events=[],controller=new AbortController(),pending=modern(f,'subscriptions/listen',{notifications:{taskIds:[taskId]}},{signal:controller.signal,emit:m=>events.push(m)},true);await tick();
 await modern(f,'tasks/cancel',{taskId},{},true);assert.equal(events[0].method,'notifications/subscriptions/acknowledged');assert.equal(events[1].method,'notifications/tasks');assert.equal(events[1].params.status,'cancelled');
 f.ide.loadProject(clone(f.ide.project));assert.equal((await modern(f,'tasks/get',{taskId},{},true)).error.code,-32602);controller.abort();await pending;
});
test('audit tasks: bounded retention, TTL, project revocation and failed-task errors',async t=>{
 let now=0;const authority=new AbortController(),store=new McpTasks({now:()=>now,ttlMs:1000,limit:1}),ctx={principal:'agent'};t.after(()=>store.clear());
 const a=store.create(()=>new Promise(()=>{}),ctx,authority.signal);assert.throws(()=>store.create(()=>({}),ctx),/Too many/);now=1000;assert.throws(()=>store.get(a.taskId,ctx),/expired/);
 const b=store.create(()=>{throw new McpError(-32002,'stale');},ctx,authority.signal);await tick();assert.equal(store.get(b.taskId,ctx).error.code,-32602);authority.abort();assert.equal(store.entries.size,0);
});

for(const target of ['project','html','sources','win32'])test('audit build: immutable checksummed '+target+' bytes and bounded chunk reads',async t=>{
 const f=fixture(t);f.ide.project.modules[0].code='';const original=clone(f.ide.project);
 const result=await tool(f,'build.create',{target,expectedRevision:f.adapter.revision});assert.equal(result.valid,true,JSON.stringify(result));const artifact=result.artifact;
 const blocks=[];let offset=0;do {const part=await tool(f,'build.read',{artifactId:artifact.artifactId,offset,count:262144});blocks.push(Buffer.from(part.data,'base64'));assert.equal(part.offset,offset);offset=part.nextOffset;if(!part.hasMore)break;}while(true);
 const bytes=Buffer.concat(blocks);assert.equal(bytes.length,artifact.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
 if(target==='project')assert.equal(JSON.parse(bytes.toString()).name,original.name);
 if(target==='sources')assert.ok((await readZip(bytes)).size>0);
 if(target==='html')assert.match(bytes.toString(),/<!doctype html>/i);
 if(target==='win32'){assert.equal(bytes.subarray(0,2).toString(),'MZ');assert.deepEqual(bytes,Buffer.from(compileWin32(original).bytes));}
 f.ide.project.modules[0].code="'changed";f.ide.markDirty();const again=await tool(f,'build.read',{artifactId:artifact.artifactId,count:20});assert.equal(again.sha256,artifact.sha256);assert.equal(again.sourceRevision,artifact.sourceRevision);
 await tool(f,'build.release',{artifactId:artifact.artifactId});assert.equal((await modern(f,'tools/call',{name:'vb6.build.read',arguments:{artifactId:artifact.artifactId}})).error.code,-32602);
});
test('audit build: private handles, stale revisions, invalid offsets and project/share revocation',async t=>{
 const f=fixture(t),built=await tool(f,'build.create',{target:'project',expectedRevision:f.adapter.revision}),artifactId=built.artifact.artifactId;
 for(const name of ['vb6.build.read','vb6.build.release'])assert.equal((await modern(f,'tools/call',{name,arguments:{artifactId}},{principal:'other'})).error.code,-32602);
 assert.equal((await modern(f,'tools/call',{name:'vb6.build.read',arguments:{artifactId,offset:built.artifact.size+1}})).error.code,-32602);
 assert.equal((await modern(f,'tools/call',{name:'vb6.build.create',arguments:{target:'project',expectedRevision:999}})).error.code,-32602);
 f.ide.loadProject(clone(f.ide.project));assert.equal((await modern(f,'tools/call',{name:'vb6.build.read',arguments:{artifactId}})).error.code,-32602);
 const other=await tool(f,'build.create',{target:'project',expectedRevision:f.adapter.revision});f.adapter.setEnabled(false);f.adapter.setEnabled(true);
 assert.equal((await modern(f,'tools/call',{name:'vb6.build.read',arguments:{artifactId:other.artifact.artifactId}})).error.code,-32602);
});
test('audit build: unsupported native constructs return diagnostics, not a pretend executable',async t=>{
 const f=fixture(t);f.ide.project.modules[0].code='Private Sub Form_Load()\nDim v As Variant\nv = 1\nEnd Sub';const r=await tool(f,'build.create',{target:'win32',expectedRevision:f.adapter.revision});assert.equal(r.valid,false);assert.ok(r.diagnostics.length);assert.equal(r.artifact,undefined);
});
function groupFiles(){return [
 {path:'both.vbg',content:'VBGROUP 5.0\r\nProject=a.vbp\r\nProject=b.vbp\r\nStartupProject=a.vbp\r\n'},
 {path:'a.vbp',content:'Type=Exe\r\nModule=A; a.bas\r\nName="A"\r\nStartup="Sub Main"\r\n'},
 {path:'b.vbp',content:'Type=Exe\r\nModule=B; b.bas\r\nName="B"\r\nStartup="Sub Main"\r\n'},
 {path:'a.bas',content:'Attribute VB_Name = "A"\r\nSub Main()\r\nEnd Sub\r\n'},
 {path:'b.bas',content:'Attribute VB_Name = "B"\r\nSub Main()\r\nEnd Sub\r\n'}];}
test('audit project: entry discovery, explicit import and native project-group selection/startup preserve peers',async t=>{
 const f=fixture(t),files=groupFiles(),entries=await tool(f,'project.entries',{files});assert.equal(entries.entries.length,3);assert.ok(entries.encodings.includes('windows-1250'));
 await tool(f,'project.import',{files,entryPath:'both.vbg',expectedRevision:f.adapter.revision});const group=await tool(f,'project.group');assert.equal(group.projects.length,2);
 const code=f.ide.project.modules[0].code+"\n' unsaved A";await tool(f,'module.write',{module:'A',code,expectedRevision:f.adapter.revision});
 await tool(f,'project.select',{path:'b.vbp',expectedRevision:f.adapter.revision});assert.equal(f.ide.project.name,'B');
 await tool(f,'project.startup',{path:'b.vbp',expectedRevision:f.adapter.revision});assert.equal((await tool(f,'project.group')).startupPath,'b.vbp');
 await tool(f,'project.select',{path:'a.vbp',expectedRevision:f.adapter.revision});assert.equal(f.ide.project.modules[0].code,code);assert.equal((await tool(f,'project.group')).startupPath,'b.vbp');
 const before=clone(f.ide.project);assert.equal((await modern(f,'tools/call',{name:'vb6.project.select',arguments:{path:'missing.vbp',expectedRevision:f.adapter.revision}})).result.isError,true);assert.deepEqual(f.ide.project,before);
});
test('audit project: selected code page and byte-offset export avoid UTF-16 slicing',async t=>{
 const f=fixture(t),files=groupFiles().filter(x=>['a.vbp','a.bas'].includes(x.path));const text=files[1].content+"' Zażółć gęślą jaźń\r\n";
 files[1]={path:'a.bas',content:Buffer.from(encodeNativeText(text,{encoding:'windows-1250'})).toString('base64'),encoding:'base64'};
 await tool(f,'project.import',{files,entryPath:'a.vbp',encoding:'windows-1250',expectedRevision:f.adapter.revision});assert.match(f.ide.project.modules[0].code,/Zażółć gęślą jaźń/);
 const part=await tool(f,'project.files',{path:'a.bas',byteOffset:2,byteCount:5});assert.equal(part.encoding,'base64');assert.equal(Buffer.from(part.content,'base64').length,5);
});
test('audit project: duplicate supplied paths and conflicting companion assets never overwrite data',async t=>{
 const f=fixture(t);const bad=await modern(f,'tools/call',{name:'vb6.project.entries',arguments:{files:[{path:'a.bas',content:'a'},{path:'A.bas',content:'b'}]}});assert.ok(bad.error||bad.result.isError);
 const current=newProject('Current'),incoming=newProject('Incoming');incoming.modules[0].name='Another';incoming.modules[0].sourcePath='Another.frm';current.assets={'data.bin':{data:'AA=='}};incoming.assets={'DATA.BIN':{data:'AQ=='}};
 const before=clone(current);assert.throws(()=>mergedProject(current,incoming),/Conflicting companion/);assert.deepEqual(current,before);
 incoming.nativeWorkspace={};assert.throws(()=>mergedProject(current,incoming),/project group/);
});

for(const size of [0,1,55,56,63,64,65,127,128,129,1000000])test('audit checksum: portable SHA-256 matches native at '+size+' bytes',async()=>{
 const data=Uint8Array.from({length:size},(_,i)=>i%251),native=createHash('sha256').update(data).digest();
 assert.deepEqual(Buffer.from(await sha256(data,null)),native);assert.deepEqual(Buffer.from(await sha256(data)),native);
});

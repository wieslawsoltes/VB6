import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpClient} from './helpers/mcp-client.mjs';
import {LocalTransport} from './helpers/mcp-transports.mjs';
import {AgentPermissions, AGENT_SCOPES} from '../src/mcp/agent-permissions.js';
import {newProject, normalizeProject, createForm} from '../src/project/model.js';
import {Signal, History, clone} from '../src/core/core.js';
import {compileProject} from '../src/language/compiler.js';
import {readZip} from '../src/project/zip.js';
import {fromBase64} from '../src/project/frx.js';

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

test('agent: all 132 tools have unique deterministic names; pagination includes final tools',async t=>{
 const f=fixture(t);await f.client.connect();const tools=await f.client.listTools();assert.equal(tools.length,132);assert.equal(new Set(tools.map(t=>t.name)).size,132);
 assert.ok(tools.some(t=>t.name==='vb6.runtime.capture'));assert.ok(tools.some(t=>t.name==='vb6.ui.resolveReference'));assert.ok(tools.every(t=>t.inputSchema.additionalProperties===false));
 const capabilities=await f.call('agent.capabilities');assert.equal(capabilities.tools.length,132);assert.equal(capabilities.permissions.active,false);
 const routes=await f.call('commands.list');assert.ok(routes.commands.every(c=>c.tool));assert.ok(!routes.directCommands.includes('mcpAgentAccess'));
});
test('agent: source edits across modules are atomic, use original UTF-16 offsets and one undo unit',async t=>{
 const f=fixture(t);f.ide.project.modules[0].code='a🙂bc';f.ide.project.modules.push({id:'m2',name:'Mod2',kind:'module',code:'12345'});
 await f.write('code.edit',{edits:[{module:'Form1',start:1,end:3,text:'X',expectedText:'🙂'},{module:'Form1',start:4,end:5,text:'Z'},{module:'Mod2',start:0,end:2,text:'hello'}]});
 assert.equal(f.ide.project.modules[0].code,'aXbZ');assert.equal(f.ide.project.modules[1].code,'hello345');assert.equal(f.ide.history.undoStack.length,1);
 await f.write('history.apply',{direction:'undo'});assert.equal(f.ide.project.modules[0].code,'a🙂bc');
 await f.write('history.apply',{direction:'redo'});assert.equal(f.ide.project.modules[1].code,'hello345');
});
for(const edits of [[],[{module:'Form1',start:2,end:1,text:'X'}],[{module:'Form1',start:0,end:10000,text:'X'}],[{module:'Form1',start:0,end:1,text:'X',expectedText:'wrong'}],[{module:'Form1',start:0,end:2,text:'X'},{module:'Form1',start:1,end:3,text:'Z'}],[{module:'Form1',start:0,end:0,text:'X'},{module:'Form1',start:0,end:0,text:'Z'}],[{module:'bad',start:0,end:1,text:'X'}]])test('agent: invalid source edit is all-or-nothing '+JSON.stringify(edits),async t=>{
 const f=fixture(t),old=clone(f.ide.project);await assert.rejects(f.write('code.edit',{edits}));assert.deepEqual(f.ide.project,old);assert.equal(f.ide.history.undoStack.length,0);
});
test('agent: changes while approval pending reject the staged candidate',async t=>{
 let allow;const f=fixture(t,{approve:()=>new Promise(r=>allow=r)});const pending=f.write('code.edit',{edits:[{module:'Form1',start:0,end:0,text:'x'}]});
 while(!allow)await new Promise(r=>setTimeout(r,1));f.ide.markDirty();allow(true);await assert.rejects(pending,/changed/);assert.ok(!f.ide.project.modules[0].code.startsWith('x'));
});
test('agent: paused source edits stage hot reload and reject running edits',async t=>{
 const f=fixture(t);f.ide.runState='paused';await f.write('code.edit',{edits:[{module:'Form1',start:0,end:0,text:"' staging\n"}]});assert.equal(f.ide.pendingEdits,true);assert.equal(f.ide.editRevision,1);
 f.ide.runState='running';await assert.rejects(f.write('code.edit',{edits:[{module:'Form1',start:0,end:0,text:'bad'}]}),/Pause/);
});
test('agent: project metadata, sourcePath, references and archive use real source formats',async t=>{
 const f=fixture(t);await f.write('project.update',{name:'Renamed',description:'Agent',settings:{gridSize:240,tabWidth:2}});await f.write('module.metadata',{module:'Form1',sourcePath:'forms/Main.frm',sourceEncoding:'windows-1252'});
 await f.write('references.set',{references:[{kind:'Reference',value:'*\\G{test}#1.0#0#lib.dll#library'}]});
 const listing=await f.call('project.files');assert.ok(listing.items.some(i=>i.path==='forms/Main.frm'));
 const archive=await f.call('project.archive');const zip=await readZip(fromBase64(archive.data));assert.ok(zip.has('Renamed.vb6web'));assert.ok(zip.has('Renamed.vbp'));
 const details=await f.call('project.details');assert.equal(details.project.settings.gridSize,240);assert.equal(details.project.references.length,1);
});
test('agent: new project revokes delegated authority and replacement remains undoable',async t=>{
 const f=fixture(t);f.adapter.permissions.allow(f.ide.project.id,['project'],5);const old=f.ide.project.id;
 await f.write('project.new',{name:'NewAgent'});assert.notEqual(f.ide.project.id,old);assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active,false);
 await f.write('history.apply',{direction:'undo'});assert.equal(f.ide.project.id,old);
});
test('agent: native file import and add use imported diagnostics and require no disk picker',async t=>{
 const f=fixture(t);const result=await f.write('project.import',{files:[{path:'Test.vbp',content:'Type=Exe\r\nModule=Main; Main.bas\r\nName="NativeAgent"\r\nStartup="Sub Main"'},{path:'Main.bas',content:'Attribute VB_Name = "Main"\r\nSub Main()\r\nDebug.Print 42\r\nEnd Sub'}]});assert.equal(f.ide.project.name,'NativeAgent');assert.equal(result.diagnostics.length,0);
 await f.write('project.import',{files:[{path:'Extra.bas',content:'Attribute VB_Name = "Extra"\nOption Explicit'}],add:true});assert.equal(f.ide.project.modules.length,2);
});
test('agent: control add/rename/reparent/remove preserves source and validates containers',async t=>{
 const f=fixture(t);await f.write('control.edit',{module:'Form1',action:'add',name:'Frame1',type:'Frame'});await f.write('control.edit',{module:'Form1',action:'add',name:'Button1',type:'CommandButton',parent:'Frame1',properties:{Caption:'Go'}});
 await f.write('procedure.event',{module:'Form1',id:'Button1',event:'Click'});assert.ok(compileProject(f.ide.project).valid);
 await f.write('control.edit',{module:'Form1',action:'rename',id:'Button1',name:'GoButton'});assert.match(f.ide.project.modules[0].code,/GoButton_Click/);
 await assert.rejects(f.write('control.edit',{module:'Form1',action:'remove',id:'Frame1'}),/children/);
 await f.write('control.edit',{module:'Form1',action:'remove',id:'Frame1',cascade:true});assert.equal(f.ide.project.modules[0].form.controls.length,0);
});
test('agent: array element selection must use ID and event handler includes Index',async t=>{
 const f=fixture(t);for(const index of [0,1])await f.write('control.edit',{module:'Form1',action:'add',name:'Button1',type:'CommandButton',properties:{Index:index}});
 await assert.rejects(f.write('control.edit',{module:'Form1',action:'update',id:'Button1',properties:{Caption:'ambiguous'}}),/Ambiguous/);
 const id=f.ide.project.modules[0].form.controls[0].id;await f.write('procedure.event',{module:'Form1',id,event:'Click'});assert.match(f.ide.project.modules[0].code,/Button1_Click\(Index As Integer\)/);assert.ok(compileProject(f.ide.project).valid);
});
test('agent: menu tree cycle rejected and remove is explicit',async t=>{
 const f=fixture(t);await f.write('menu.edit',{module:'Form1',action:'add',name:'mFile',properties:{Caption:'File'}});await f.write('menu.edit',{module:'Form1',action:'add',name:'mOpen',parent:'mFile'});
 const old=clone(f.ide.project);await assert.rejects(f.write('menu.edit',{module:'Form1',action:'reparent',id:'mFile',parent:'mOpen'}),/Cyclic/);assert.deepEqual(f.ide.project,old);
 await f.write('menu.edit',{module:'Form1',action:'rename',id:'mFile',name:'mProject'});assert.equal(f.ide.project.modules[0].form.menus[1].parent,'mProject');
});
test('agent: procedures, attributes, symbols, completion and bookmarks use shared editor engines',async t=>{
 const f=fixture(t);await f.write('procedure.add',{module:'Form1',name:'Compute',type:'Function',scope:'Public'});
 await f.write('procedure.attributes',{module:'Form1',name:'Compute',attributes:{description:'Calculation',helpContext:42}});
 const proc=await f.call('procedure.get',{module:'Form1',name:'Compute'});assert.equal(proc.procedures[0].attributes.description,'Calculation');
 const symbols=await f.call('code.symbols',{query:'Compute'});assert.ok(symbols.items.length);
 const completion=await f.call('code.complete',{module:'Form1',offset:0,kind:'resolve',expression:'Compute'});assert.equal(completion.result.name,'Compute');
 await f.write('bookmarks.set',{module:'Form1',lines:[1,2,1]});assert.deepEqual((await f.call('bookmarks.get',{module:'Form1'})).lines,[1,2]);
});
test('agent: virtual file bytes, partial reads, rename/copy and directory safety',async t=>{
 const f=fixture(t);await f.write('files.write',{path:'data.bin',content:'AP+A',encoding:'base64'});assert.equal((await f.call('files.read',{path:'/data.bin',offset:1,count:1})).content,'/w==');
 await f.write('files.manage',{action:'copy',path:'/data.bin',destination:'copy.bin'});await f.write('files.manage',{action:'rename',path:'copy.bin',destination:'renamed.bin'});
 assert.equal((await f.call('files.list')).items.length,2);await f.write('files.manage',{action:'remove',path:'renamed.bin'});assert.equal((await f.call('files.list')).items.length,1);
 await assert.rejects(f.write('files.write',{path:'../../etc/shadow',content:'bad'}));
});
test('agent: native resource bytes and strings retain neighboring IDs',async t=>{
 const f=fixture(t);await f.write('resources.string',{id:42,text:'Hello',language:1063});await f.write('resources.string',{id:43,text:'World',language:1063});assert.equal((await f.call('resources.strings')).total,2);
 await f.write('resources.write',{entry:{type:10,name:101,language:0,data:'AP+A'}});const list=await f.call('resources.list');assert.equal(list.total,2);const key=list.items.find(i=>i.type===10).key;
 assert.equal((await f.call('resources.read',{key})).entry.data,'AP+A');const exported=await f.call('resources.export');await f.write('resources.import',{data:exported.data,fileName:'Test.res'});assert.equal((await f.call('resources.strings')).total,2);
 await f.write('resources.remove',{key});assert.equal((await f.call('resources.list')).total,1);
});
test('agent: assets reject active data and arbitrary URLs',async t=>{
 const f=fixture(t);for(const data of ['https://example.com/a.png','data:text/html;base64,eA==','data:image/svg+xml;base64,eA=='])await assert.rejects(f.write('assets.write',{path:'image.png',data}));
 await f.write('assets.write',{path:'image.png',data:'data:image/png;base64,iVBORw0KGgo='});assert.equal((await f.call('assets.list')).assets.length,1);await f.write('assets.remove',{path:'image.png'});
});
test('agent: app settings do not alter MCP state',async t=>{const f=fixture(t);await f.write('appSettings.set',{settings:{MyApp:{setting:'42'}}});assert.deepEqual((await f.call('appSettings.get')).settings,{MyApp:{setting:'42'}});assert.equal(f.adapter.permissions.grant,null);});
test('agent: wait returns on revision, supports timeout and cancellation',async t=>{
 const f=fixture(t);const wait=f.call('agent.wait',{afterRevision:f.adapter.revision,timeoutMs:500});setTimeout(()=>f.ide.markDirty(),10);assert.equal((await wait).matched,true);
 assert.equal((await f.call('agent.wait',{afterRevision:f.adapter.revision,timeoutMs:1})).matched,false);
 const c=new AbortController();const request=f.adapter.tools.find(t=>t.name==='vb6.agent.wait').execute({afterRevision:f.adapter.revision},{signal:c.signal});c.abort();await assert.rejects(request,/cancelled/);
});
test('agent: unsafe command and permission mutation have no remote route',async t=>{
 const f=fixture(t);for(const command of ['mcpAgentAccess','__proto__','setSharing','eval','open','fullScreen'])await assert.rejects(f.write('commands.execute',{command}));
 await assert.rejects(f.call('agent.permissions',{scopes:['code']}));assert.equal(f.adapter.permissions.grant,null);
 await assert.rejects(f.call('code.edit',{expectedRevision:f.adapter.revision,edits:[],__proto__:null,evil:true}));
});
test('agent: scopes are project-bound, expire and cannot revive when project ID returns',()=>{
 let now=100;const p=new AgentPermissions({now:()=>now});p.allow('p',['code'],1);assert.ok(p.permits('vb6.module.write','p'));assert.ok(!p.permits('vb6.runtime.start','p'));assert.ok(!p.permits('vb6.code.edit','q'));now=60100;assert.ok(!p.permits('vb6.code.edit','p'));p.dispose();
});
test('agent: scope authority bypasses only the matching consent and not revisions or design guards',async t=>{
 let approvals=0;const f=fixture(t,{approve:async()=>{approvals++;return false;}});f.adapter.permissions.allow(f.ide.project.id,['code'],1);
 await f.write('code.edit',{edits:[{module:'Form1',start:0,end:0,text:"' granted\n"}]});assert.equal(approvals,0);
 await assert.rejects(f.write('files.write',{path:'test',content:'no'}),/declined/);assert.equal(approvals,1);
 await assert.rejects(f.write('code.edit',{expectedRevision:1,edits:[{module:'Form1',start:0,end:0,text:'no'}]}),/changed/);
 f.adapter.setEnabled(false);assert.equal(f.adapter.permissions.grant,null);
});
for(const scopes of [[],['unknown'],['constructor'],['code','__proto__']])test('agent: invalid delegated scopes '+JSON.stringify(scopes),()=>{const p=new AgentPermissions();assert.throws(()=>p.allow('p',scopes,5));assert.equal(p.grant,null);});
test('agent: stale debugger pause and missing frames fail before runtime dispatch',async t=>{
 const f=fixture(t);f.ide.runState='paused';f.ide.debuggerWindows={pauseId:2,frameIndex:0};f.ide.stack=[{index:0,module:'Form1'}];
 await assert.rejects(f.call('debug.inspect',{pauseId:1,expression:'x'}),/Stale/);await assert.rejects(f.call('debug.locals',{pauseId:2,frameIndex:3}),/Unknown stack/);
});

test('agent: concurrent same-revision code writes cannot overwrite one another',async t=>{
 const f=fixture(t);await f.client.connect();f.adapter.permissions.allow(f.ide.project.id,['code'],1);const rev=f.adapter.revision;
 const writes=await Promise.allSettled(['a','b'].map(text=>f.call('code.edit',{expectedRevision:rev,edits:[{module:'Form1',start:0,end:0,text}]})));
 assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.ide.history.undoStack.length,1);
});
test('agent: concurrent legacy writes and new project edits share the revision guard',async t=>{
 const f=fixture(t);await f.client.connect();f.adapter.permissions.allow(f.ide.project.id,['code','project'],1);const rev=f.adapter.revision;
 const result=await Promise.allSettled([f.call('module.write',{module:'Form1',code:'Option Explicit',expectedRevision:rev}),f.call('project.update',{description:'racer',expectedRevision:rev})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.ide.history.undoStack.length,1);
});
test('agent: revocation aborts an ongoing delegated evaluation',async t=>{
 const f=fixture(t);await f.client.connect();f.ide.runState='paused';f.ide.runtimeFrame={};f.ide.debuggerWindows={pauseId:3,frameIndex:0};f.ide.stack=[{index:0}];let requested,cancelled=0;
 f.ide.requestRuntime=()=>new Promise(r=>requested=r);f.ide.sendRuntime=cmd=>{if(cmd==='cancelEvaluation')cancelled++;};f.adapter.permissions.allow(f.ide.project.id,['debugger'],1);
 const pending=f.write('debug.evaluate',{expression:'Slow()'});while(!requested)await new Promise(r=>setTimeout(r,1));f.adapter.permissions.revoke();await assert.rejects(pending,/cancel/i);assert.equal(cancelled,1);requested({value:'stale'});
});
test('agent: grant replacement and revocation both abort old authority',()=>{
 const p=new AgentPermissions();p.allow('p',['code'],1);const first=p.signal;p.allow('p',['project'],1);assert.equal(first.aborted,true);const second=p.signal;p.revoke();assert.equal(second.aborted,true);assert.equal(p.permits('vb6.project.new','p'),false);p.dispose();
});
for(const [name,args] of [
 ['module.metadata',{module:'Form1',sourcePath:'../escape.frm'}],['module.metadata',{module:'Form1',sourcePath:'wrong.bas'}],['module.metadata',{module:'Form1',attributes:['Attribute VB_Name = "Escape"']}],['module.metadata',{module:'Form1',attributes:['Attribute VB_Description = "x"\nSub Main()']}],
 ['project.update',{nativeProject:{entries:[{key:'Title',value:'x\nForm=secret.frm'}]}}],['project.update',{nativeProject:{entries:[{key:'Startup',value:'hijack'}]}}],['references.set',{references:[{kind:'Reference',value:'x\nName=NewProject'}]}],['references.set',{references:[{}]}]
])test('agent: native metadata cannot corrupt source exports '+name+' '+JSON.stringify(args),async t=>{
 const f=fixture(t),before=clone(f.ide.project);await assert.rejects(f.write(name,args));assert.deepEqual(f.ide.project,before);assert.equal(f.ide.history.undoStack.length,0);
});
test('agent: runtime output advances eventSequence without invalidating editing revisions',async t=>{
 const ide=new Signal();Object.assign(ide,{project:newProject(),runState:'running',onRuntimeMessage(){},runtimeFrame:{contentWindow:{}},bridgeToken:'test'});const adapter=createIdeAdapter(ide);t.after(()=>adapter.dispose());adapter.setEnabled(true);const rev=adapter.revision,event=adapter.eventSequence;
 ide.onRuntimeMessage({source:ide.runtimeFrame.contentWindow,data:{channel:'vb6-runtime',token:'test',type:'output',text:'tick'}});assert.equal(adapter.revision,rev);assert.equal(adapter.eventSequence,event+1);
 ide.onRuntimeMessage({source:{},data:{channel:'vb6-runtime',token:'test',type:'state'}});assert.equal(adapter.eventSequence,event+1);
});

test('agent: workspace delegation cannot edit source, undo projects or capture virtual files', async t => {
  let approvals=0;const f=fixture(t,{approve:async()=>{approvals++;return false;}});
  f.adapter.permissions.allow(f.ide.project.id,['workspace'],1);
  for(const [name,args] of [['editor.edit',{module:'Form1',command:'insert',text:'unapproved'}],['history.apply',{direction:'undo'}],['runtime.capture',{}]])
    await assert.rejects(f.write(name,args),/declined/);
  assert.equal(approvals,3);
  const scopes=new Map((await f.call('agent.capabilities')).tools.map(t=>[t.name,t.scope]));
  assert.equal(scopes.get('vb6.editor.edit'),'code');assert.equal(scopes.get('vb6.history.apply'),'project');assert.equal(scopes.get('vb6.runtime.capture'),'files');
});
test('agent: caller and approval mutations cannot alter approved argument snapshots', async t => {
  let release;const f=fixture(t,{approve:async request=>{request.arguments.code='changed by callback';return new Promise(r=>release=r);}});
  const args={module:'Form1',code:'Option Explicit\n',expectedRevision:f.adapter.revision};
  const pending=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute(args);
  while(!release)await Promise.resolve();args.code='changed by caller';release(true);await pending;
  assert.equal(f.ide.project.modules[0].code,'Option Explicit\n');
});
test('agent: original descriptors validate direct calls exactly like the wire', async t => {
  const f=fixture(t),write=f.adapter.tools.find(t=>t.name==='vb6.module.write');
  await assert.rejects(write.execute({module:'Form1',code:42,expectedRevision:f.adapter.revision}),/expected string/);
  await assert.rejects(write.execute({module:'Form1',code:'',expectedRevision:f.adapter.revision,evil:true}),/unexpected evil/);
  assert.equal(f.ide.history.undoStack.length,0);
});
test('agent: replacing even the same project ID cancels pending authorization', async t => {
  let release;const f=fixture(t,{approve:()=>new Promise(r=>release=r)});
  const epoch=f.adapter.authorityEpoch,signal=f.adapter.authoritySignal;
  const pending=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute({module:'Form1',code:'not allowed',expectedRevision:f.adapter.revision});
  while(!release)await Promise.resolve();const before=clone(f.ide.project);f.ide.loadProject(before);
  await assert.rejects(pending,/cancel/i);release(true);await new Promise(r=>setTimeout(r,1));
  assert.equal(signal.aborted,true);assert.ok(f.adapter.authorityEpoch>epoch);assert.deepEqual(f.ide.project,before);
});
test('agent: disable and reenable cannot revive a direct pending approval or wait', async t => {
  let release;const f=fixture(t,{approve:()=>new Promise(r=>release=r)});
  const write=f.adapter.tools.find(t=>t.name==='vb6.module.write').execute({module:'Form1',code:'stale',expectedRevision:f.adapter.revision});
  const wait=f.adapter.tools.find(t=>t.name==='vb6.agent.wait').execute({afterRevision:f.adapter.revision,timeoutMs:30000});
  const done=Promise.all([assert.rejects(write,/cancel/i),assert.rejects(wait,/cancel/i)]);
  while(!release)await Promise.resolve();f.adapter.setEnabled(false);f.adapter.setEnabled(true);await done;release(true);
  await new Promise(r=>setTimeout(r,1));assert.notEqual(f.ide.project.modules[0].code,'stale');
});
test('agent: a delegated replacement succeeds while revoking the previous workspace authority', async t => {
  const f=fixture(t);f.adapter.permissions.allow(f.ide.project.id,['project'],1);const grant=f.adapter.permissions.signal,authority=f.adapter.authoritySignal;
  const result=await f.write('project.new',{name:'Replacement'});assert.equal(result.name,'Replacement');
  assert.equal(grant.aborted,true);assert.equal(authority.aborted,true);assert.equal(f.adapter.permissions.grant,null);
});
test('agent: workspace replacement cancels an already approved sandbox evaluation', async t => {
  const f=fixture(t);f.ide.runState='paused';f.ide.runtimeFrame={};f.ide.debuggerWindows={pauseId:3,frameIndex:0};f.ide.stack=[{index:0}];
  let release,cancelled=0;f.ide.requestRuntime=()=>new Promise(r=>release=r);f.ide.sendRuntime=cmd=>{if(cmd==='cancelEvaluation')cancelled++;};
  const pending=f.write('debug.evaluate',{expression:'Slow()'});while(!release)await new Promise(r=>setTimeout(r,1));
  f.ide.loadProject(clone(f.ide.project));await assert.rejects(pending,/cancel/i);assert.equal(cancelled,1);release({value:'stale'});
});
test('agent: same-revision evaluation and breakpoint writes cannot both execute', async t => {
  const f=fixture(t);await f.client.connect();f.ide.runState='paused';f.ide.runtimeFrame={};f.ide.debuggerWindows={pauseId:3,frameIndex:0};f.ide.stack=[{index:0}];
  f.adapter.permissions.allow(f.ide.project.id,['debugger'],1);let release;f.ide.requestRuntime=()=>new Promise(r=>release=r);
  const revision=f.adapter.revision,evaluation=f.call('debug.evaluate',{expression:'Slow()',expectedRevision:revision});
  while(!release)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(f.call('breakpoints.set',{breakpoints:[{module:'Form1',line:1}],expectedRevision:revision}),/changed/);
  assert.deepEqual(f.ide.breakpoints,[]);release({value:'ok'});await evaluation;
});
test('agent: debug step and continue reject running state rather than reporting false success', async t => {
  const f=fixture(t);f.ide.runState='running';
  for(const command of ['continue','run','stepInto','stepOver','stepOut'])await assert.rejects(f.write('debug.command',{command}),/Pause before/);
  assert.equal(f.ide.lastCommand,undefined);await f.write('debug.command',{command:'pause'});assert.equal(f.ide.lastCommand,'pause');
});

test('agent: workspace theme changes retain IDE-only preferences and require normal authority',async t=>{
 const f=fixture(t);let applied=0;f.ide.applyAppearance=()=>{applied++;};
 const project=clone(f.ide.project);
 await f.write('workspace.configure',{appearance:{theme:'macos26-dark',followSystemTheme:true,reduceTransparency:true,reduceMotion:true}});
 assert.equal(f.ide.appearance.theme,'macos26-dark');assert.equal(f.ide.appearance.followSystemTheme,true);
 await f.write('workspace.configure',{appearance:{editorSize:16}});
 assert.equal(f.ide.appearance.theme,'macos26-dark');assert.equal(f.ide.appearance.reduceTransparency,true);assert.equal(f.ide.appearance.reduceMotion,true);assert.equal(applied,2);
 assert.deepEqual(f.ide.project,project);assert.equal(f.adapter.permissions.grant,null);
 await assert.rejects(f.write('workspace.configure',{appearance:{allowAllTools:true}}),/Unknown appearance option/);
 await assert.rejects(f.write('workspace.configure',{appearance:{theme:'fluent'},expectedRevision:999999}),/changed/);
 const denied=fixture(t,{approve:async()=>false});denied.ide.applyAppearance=()=>assert.fail('denied appearance must not be applied');
 await assert.rejects(denied.write('workspace.configure',{appearance:{theme:'x11'}}),/declined/);
});

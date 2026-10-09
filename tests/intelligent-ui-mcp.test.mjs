import test from 'node:test';
import assert from 'node:assert/strict';
import {McpUIService,MCP_UI_URI,MCP_UI_MIME} from '../packages/intelligent-ui/src/mcp.js';
import {McpAppClient,MCP_APP_VERSION} from '../packages/intelligent-ui/src/mcp-app.js';
import {splitUIMessage} from '../packages/intelligent-ui/src/message.js';
import {normalizeAction} from '../packages/intelligent-ui/src/surface.js';
import {UIClient} from '../packages/intelligent-ui/src/client.js';
import {UIRuntime} from '../packages/intelligent-ui/src/runtime.js';
import {createCatalog} from '../packages/intelligent-ui/src/catalog.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {configureIntelligentUIResource} from '../src/intelligent-ui/adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {CodingAgent} from '../src/agents/agent.js';
import {newProject} from '../src/project/model.js';
import {Signal,History} from '../src/core/core.js';
import {UI_EXAMPLES} from '../src/intelligent-ui/examples.js';
const alice={principal:'alice'},bob={principal:'bob'};

test('UI documents, bindings and revisions are private to their authenticated owner',()=>{
 const s=new McpUIService();s.capture('vb6.project.get',{revision:3,name:'Secret project'},alice);
 assert.equal(s.run('catalog',{},bob).bindings.length,0);
 assert.throws(()=>s.run('present',{source:'Hi',dataRefs:{project:'vb6.project.get'}},bob),/Inspect/);
 const a=s.run('present',{source:'<text>{project.name}</text>',dataRefs:{project:'vb6.project.get'}},alice);
 assert.equal(a.ui.data.project.name,'Secret project');assert.equal(a.ui.provenance.project.revision,3);
 assert.throws(()=>s.run('read',{id:a.ui.id},bob),/unavailable/);assert.equal(s.run('list',{},bob).documents.length,0);
 assert.throws(()=>s.run('update',{id:a.ui.id,expectedUIRevision:2,source:'bad'},alice),/UI changed/);
 const b=s.run('update',{id:a.ui.id,expectedUIRevision:1,source:'Updated'},alice);assert.equal(b.ui.revision,2);assert.equal(b.ui.provenance.project.revision,3);
 s.revoke('alice');assert.throws(()=>s.run('read',{id:a.ui.id},alice),/unavailable/);assert.equal(s.run('catalog',{},alice).bindings.length,0);
});
test('UI service rejects malformed data, code-size excess, missing identity and over-allocation',()=>{
 const s=new McpUIService({maxDocuments:2});assert.throws(()=>s.run('list'),/owner/);
 assert.throws(()=>s.run('present',{source:'x'.repeat(32001)},alice),/32,000/);
 assert.throws(()=>s.run('present',{source:'hello',data:[]},alice),/object/);
 assert.throws(()=>s.capture('x',{get bad(){throw Error('invoked')}},alice),/accessors/);
 const controller=new AbortController();controller.abort();assert.throws(()=>s.run('present',{source:'Hi'},{...alice,signal:controller.signal}),/abort/i);
 s.run('present',{source:'One'},alice);s.run('present',{source:'Two'},bob);assert.throws(()=>s.run('present',{source:'Three'},bob),/limit/);
 s.dispose();assert.throws(()=>s.run('list',{},alice),/disposed/);
});
test('service resource exposes MCP App MIME and restrictive domain metadata',()=>{
 const s=new McpUIService({resourceHtml:'<!doctype html><html></html>'});assert.equal(s.resources()[0].uri,MCP_UI_URI);
 const r=s.readResource(MCP_UI_URI)[0];assert.equal(r.mimeType,MCP_UI_MIME);assert.deepEqual(r._meta.ui.csp.connectDomains,[]);assert.throws(()=>s.readResource('ui://other'),/Unknown/);
});
function fixture(t){const ide=new Signal();Object.assign(ide,{project:newProject('UI test'),runState:'design',history:new History(),markDirty(){},loadProject(p){this.project=p;}});const adapter=createIdeAdapter(ide);t.after(()=>adapter.dispose());adapter.setEnabled(true);const call=(name,args={},context=alice)=>adapter.tools.find(t=>t.name===name).execute(args,context);return {ide,adapter,call};}
test('real IDE tools bind inspected data, advertise resource metadata and revoke on same-ID reload',async t=>{
 const {ide,adapter,call}=fixture(t),before=JSON.stringify(ide.project),revision=adapter.revision;const snapshot=await call('vb6.project.get');
 const out=await call('vb6.ui.present',{source:UI_EXAMPLES.project.source,dataRefs:{project:'vb6.project.get'}});
 assert.equal(out.ui.data.project.id,snapshot.id);assert.equal(adapter.revision,revision);assert.equal(JSON.stringify(ide.project),before);
 const tool=adapter.tools.find(t=>t.name==='vb6.ui.present');assert.equal(tool._meta.ui.resourceUri,MCP_UI_URI);assert.equal(tool.annotations.openWorldHint,false);
 configureIntelligentUIResource('<!doctype html><html></html>');assert.equal((await adapter.readResource(MCP_UI_URI))[0].mimeType,MCP_UI_MIME);
 ide.loadProject(ide.project);assert.equal((await call('vb6.ui.list')).documents.length,0);
 adapter.setEnabled(false);await assert.rejects(call('vb6.ui.present',{source:'blocked'}),/disabled/);
});
test('form designer inspection binds the actual vb6.form.get result, not a nonexistent alias',async t=>{
 const {ide,call}=fixture(t),module=ide.project.modules.find(m=>m.form);
 const form=await call('vb6.form.get',{module:module.name});
 const result=await call('vb6.ui.present',{source:'<text>{designer.module}</text>',dataRefs:{designer:'vb6.form.get'}});
 assert.deepEqual(JSON.parse(JSON.stringify(result.ui.data.designer.form)),form.form);
 assert.equal(result.ui.provenance.designer.tool,'vb6.form.get');
 await assert.rejects(call('vb6.ui.present',{source:'<text>Invalid</text>',dataRefs:{designer:'vb6.form.read'}}),/Inspect/);
});
test('MCP server propagates structured UI results without nested or custom RPC envelopes',async t=>{
 const {adapter}=fixture(t),server=new McpServer(adapter);t.after(()=>server.close());const context={sessionKey:'wire',principal:'wire'};
 await server.dispatch({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}},context);
 await server.dispatch({jsonrpc:'2.0',method:'notifications/initialized'},context);
 const result=await server.dispatch({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'vb6.ui.present',arguments:{source:'<text>Bounded view</text>'}}},context);
 assert.equal(result.result.structuredContent.ui.source,'<text>Bounded view</text>');assert.equal(result.result.content[0].type,'text');
 server.revokePrincipal('wire');assert.equal(adapter.intelligentUI.service.owners.size,0);
});
for(const provider of ['openai','anthropic','google'])test(provider+': present UI in readonly agent mode, no project effects, full public view with bounded provider context',async t=>{
 const {adapter,ide}=fixture(t),agent=new CodingAgent(adapter),before=JSON.stringify(ide.project);t.after(()=>agent.stop());let turn=0;
 const source='<text>'+('a'.repeat(14000))+'</text>';
 const result=await agent.run({provider,model:'test',mode:'readonly',prompt:'Show a UI',toolResultBytes:4000,transport:async(body,{receive})=>{
  const defs=provider==='google'?body.tools[0].functionDeclarations:body.tools;assert.ok(defs.some(t=>t.name==='vb6_ui_present'));
  const args={source};const name=++turn===1?'vb6_ui_present':null;
  if(provider==='openai')receive({status:'completed',output:name?[{type:'function_call',call_id:'ui',name,arguments:JSON.stringify(args)}]:[]});
  else if(provider==='anthropic')receive({content:name?[{type:'tool_use',id:'ui',name,input:args}]:[{type:'text',text:'Done.'}],stop_reason:name?'tool_use':'end_turn'});
  else receive({candidates:[{content:{parts:name?[{functionCall:{id:'ui',name,args},thoughtSignature:'test'}]:[{text:'Done.'}]},finishReason:'STOP'}]});
 }});
 assert.equal(result.status,'completed');const entry=agent.thread.entries.find(e=>e.kind==='tool');assert.equal(JSON.parse(entry.result).ui.source,source);assert.equal(JSON.stringify(ide.project),before);
 agent.reset();assert.equal(adapter.intelligentUI.service.owners.size,0);
});
test('message splitter only interprets explicitly labelled UI fences and retains partial streams',()=>{
 const text='Before\n```vb6-ui\n<text>Hello</text>\n```\nAfter';const parts=splitUIMessage(text);assert.deepEqual(parts.map(p=>p.kind),['text','ui','text']);assert.equal(parts[1].partial,false);
 const partial=splitUIMessage('```dil\n<text>Hi');assert.equal(partial[0].partial,true);
 assert.equal(splitUIMessage('````js\n```dil\n<text>Not UI</text>\n```\n````').some(p=>p.kind==='ui'),false);
});
test('UI actions reject script URLs, forged object keys, empty/oversized messages and unsupported capabilities',()=>{
 assert.throws(()=>normalizeAction({type:'link',args:['javascript:alert(1)']}),/HTTP/);
 assert.throws(()=>normalizeAction({type:'tool',args:['bad name',{}]}),/exact/);
 assert.throws(()=>normalizeAction({type:'shell',args:['ls']}),/Unsupported/);
 assert.throws(()=>normalizeAction({type:'message',args:['']}),/characters/);
 assert.equal(normalizeAction({type:'tool',args:['vb6.project.get',{}]}).type,'tool');
});
test('aggregate rendered data is bounded before expanding repeated large props',()=>{
 const r=new UIRuntime();assert.throws(()=>r.update('{#each data.items as item}<text>{data.text}</text>{/each}',{data:{items:Array(100).fill(0),text:'X'.repeat(10000)}}),/aggregate/);
});
test('trusted custom catalogs work in the renderer-neutral runtime and bounded-main client',async()=>{
 const catalog=createCatalog({CustomReadout:{value:'number'}}),client=new UIClient({catalog,window:{}});
 const result=await client.request('update',{source:'<CustomReadout value={42} />'});assert.equal(result.tree[0].type,'CustomReadout');assert.equal(result.tree[0].props.value,42);client.dispose();
});
function appFixture(){const listeners=new Set(),sent=[],parent={postMessage:m=>sent.push(m)},window={parent,addEventListener:(n,fn)=>listeners.add(fn),removeEventListener:(n,fn)=>listeners.delete(fn)};const emit=(data,source=parent,origin='https://host.example')=>{for(const fn of listeners)fn({data,source,origin});};return {window,parent,sent,emit,listeners};}
test('MCP App handshake validates parent identity, expected origin, protocol and lifecycle',async()=>{
 const f=appFixture();let notice=0,teardown=0;const c=new McpAppClient({window:f.window,hostOrigin:'https://host.example',onNotification:()=>notice++,onTeardown:()=>teardown++});
 const connect=c.connect(),request=f.sent[0];assert.equal(request.method,'ui/initialize');assert.ok(request.params.appInfo);assert.equal(request.params.protocolVersion,MCP_APP_VERSION);
 const response={jsonrpc:'2.0',id:request.id,result:{protocolVersion:MCP_APP_VERSION,hostCapabilities:{},hostContext:{theme:'dark'}}};f.emit(response,{});assert.equal(c.ready,false);f.emit(response,f.parent,'https://wrong.example');assert.equal(c.ready,false);f.emit(response);await connect;assert.equal(f.sent.at(-1).method,'ui/notifications/initialized');
 f.emit({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{}}});assert.equal(notice,1);
 f.emit({jsonrpc:'2.0',id:8,method:'ui/resource-teardown',params:{}});assert.equal(teardown,1);assert.equal(c.disposed,true);assert.equal(f.listeners.size,0);
});
test('MCP App rejects unknown methods, cancels pending requests and detects absent hosts',async()=>{
 const f=appFixture(),c=new McpAppClient({window:f.window});c.ready=true;f.emit({jsonrpc:'2.0',id:5,method:'unsafe'});assert.equal(f.sent.at(-1).error.code,-32601);
 const pending=c.request('tools/call',{});c.dispose();await assert.rejects(pending,/closed/);
 const f2=appFixture();f2.window.parent=f2.window;const c2=new McpAppClient({window:f2.window});await assert.rejects(c2.connect(),/host/);c2.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {UIReferenceStore,validateReference} from '../packages/intelligent-ui/src/references.js';
import {McpAppHost,appProxyUrl,normalizeAppCsp} from '../packages/intelligent-ui/src/app-host.js';
import {sandboxCsp} from '../packages/intelligent-ui/src/sandbox.js';
import {appBlockDocument} from '../packages/intelligent-ui/src/app-block.js';
import {McpUIService} from '../packages/intelligent-ui/src/mcp.js';
import {UIRuntime} from '../packages/intelligent-ui/src/runtime.js';
import {createIntelligentUISandboxServer} from '../tools/serve-intelligent-ui-sandbox.mjs';

const provenance={source:'Inspected tool',capturedAt:'2026-10-09T00:00:00Z'};
test('reference records require actual provenance, validate URLs and cannot be mutated through reads',()=>{
 const store=new UIReferenceStore({maxEntries:2});assert.throws(()=>store.put('x',{kind:'entity'}),/source/);assert.throws(()=>store.put('__proto__',{kind:'entity',provenance}),/Unsafe/);
 store.put('x',{kind:'entity',title:'Original',provenance,details:{n:42}});const item=store.get('x');item.title='Changed';item.details.n=1;store.list()[0].provenance.source='Spoofed';assert.equal(store.get('x').title,'Original');assert.equal(store.get('x').details.n,42);assert.equal(store.get('x').provenance.source,'Inspected tool');
 assert.throws(()=>validateReference({kind:'image',src:'javascript:1',provenance}),/HTTP/);assert.throws(()=>validateReference({kind:'images',items:[{src:'https://user:pass@example.com'}],provenance}),/HTTP/);
 store.put('y',{kind:'citation',url:'https://example.com',provenance});assert.throws(()=>store.put('z',{kind:'entity',provenance}),/full/);store.dispose();assert.equal(store.get('x'),null);assert.throws(()=>store.put('z',{kind:'entity',provenance}),/disposed/);
});
test('reference subscriptions identify updates and revocation without fabricating records',()=>{
 const store=new UIReferenceStore(),changes=[];const off=store.subscribe(c=>changes.push(c));store.put('x',{kind:'images',items:[{src:'https://example.com/a.png',alt:'Observed'}],provenance});store.delete('x');store.clear();off();store.put('z',{kind:'entity',provenance});assert.deepEqual(changes.map(c=>c.id),['x','x',null]);assert.equal(store.get('missing'),null);
});
test('MCP references bind exact inspection owners and evaluated fallback contains derived output',()=>{
 const service=new McpUIService(),alice={principal:'alice'},bob={principal:'bob'};service.capture('vb6.project.get',{revision:1,name:'Inspected project'},alice);assert.equal(service.reference('vb6.project.get',bob),null);assert.equal(service.reference('vb6.project.get',alice).title,'Inspected project');
 const result=service.run('present',{source:'{@body const [n,setN] = DIL.useState(7)}<metric value={n*29}/>',data:{}},alice);assert.match(result.fallbackMarkdown,/203/);service.revoke('alice');assert.equal(service.reference('vb6.project.get',alice),null);
});
test('DIL useAppData selectors run through the bounded expression interpreter',()=>{
 const r=new UIRuntime(),out=r.update('{@body const number = DIL.useAppData(d=>d.value)}<metric value={number * 2}/>',{data:{value:21}});assert.equal(out.tree[0].props.value,42);r.dispose();
});
test('app host requires a genuinely different HTTPS or loopback proxy and strict origin CSP',()=>{
 for(const bad of ['https://ide.example/sandbox','javascript:1','http://external.example/sandbox'])assert.throws(()=>appProxyUrl(bad,'https://ide.example'));
 assert.throws(()=>appProxyUrl('https://sandbox.example','null'),/HTTP/);const url=appProxyUrl('https://sandbox.example/proxy','https://ide.example');assert.equal(url.searchParams.get('parentOrigin'),'https://ide.example');
 for(const domain of ['*','https://example.com; script-src *','https://user:secret@example.com','data:','https://example.com/path'])assert.throws(()=>normalizeAppCsp({resourceDomains:[domain]}));
 const csp=normalizeAppCsp({connectDomains:['wss://socket.example'],resourceDomains:['https://images.example']});assert.deepEqual(csp.connectDomains,['wss://socket.example']);const policy=sandboxCsp(csp,{proxy:true,parentOrigin:'https://ide.example'});assert.match(policy,/frame-ancestors https:\/\/ide.example/);assert.match(policy,/worker-src 'none'/);assert.match(sandboxCsp(),/connect-src 'none'/);
});
function hostFixture(options={}){
 const sent=[],listeners=new Set();const win={location:{origin:'https://ide.example'},addEventListener:(n,f)=>listeners.add(f),removeEventListener:(n,f)=>listeners.delete(f)};
 const node=()=>({style:{},classList:{toggle(){},remove(){}},setAttribute(){},append(){},prepend(){},remove(){this.removed=true;},contentWindow:{postMessage:(m,origin)=>sent.push({m,origin})}});const document={defaultView:win,createElement:()=>node()},root={...node(),ownerDocument:document};
 const host=new McpAppHost(root,{proxyUrl:'https://sandbox.example/intelligent-ui-sandbox.html',html:'<h1>Test</h1>',...options});
 const emit=m=>host.receive({source:host.frame.contentWindow,origin:'https://sandbox.example',data:m});
 const init=async()=>{await emit({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}});await emit({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{appInfo:{name:'test',version:'1'},appCapabilities:{tools:{}},protocolVersion:'2026-01-26'}});await emit({jsonrpc:'2.0',method:'ui/notifications/initialized'});};
 return {host,sent,emit,init,listeners};
}
test('MCP host orders initialization, input and results and rejects forged frame sources',async t=>{
 const f=hostFixture();t.after(()=>f.host.dispose());f.host.setToolInput({source:'x'},{partial:true});f.host.setToolInput({source:'done'});f.host.setToolResult({structuredContent:{count:1}});assert.equal(f.sent.length,0);
 await f.host.receive({source:{},origin:'https://sandbox.example',data:{jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready'}});assert.equal(f.sent.length,0);await f.init();
 assert.deepEqual(f.sent.filter(s=>s.m.method).map(s=>s.m.method),['ui/notifications/sandbox-resource-ready','ui/notifications/tool-input','ui/notifications/tool-result']);assert.ok(f.sent.every(s=>s.origin==='https://sandbox.example'));assert.throws(()=>f.host.setToolInput({source:'again'}),/already/);
});
test('MCP host hides model-only tools, blocks unknown connection tools and requires exact approval',async t=>{
 let approvals=0,calls=0;const f=hostFixture({tools:[{name:'read'},{name:'private',_meta:{ui:{visibility:['model']}}}],approve:async()=>{approvals++;return true;},callTool:async()=>{calls++;return {content:[{type:'text',text:'OK'}]};}});t.after(()=>f.host.dispose());await f.init();
 const call=(id,name)=>f.emit({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}});await call(2,'private');await call(3,'other-server.tool');assert.equal(calls,0);assert.equal(approvals,0);await call(4,'read');assert.equal(calls,1);assert.equal(approvals,1);
 await f.emit({jsonrpc:'2.0',method:'tools/call',params:{name:'read'}});assert.equal(calls,1,'Notification cannot request a tool call');
});
test('MCP host does not execute denied or canceled approvals; no project capability is implicit',async t=>{
 let resolve,calls=0;const f=hostFixture({tools:[{name:'write'}],approve:()=>new Promise(r=>resolve=r),callTool:()=>calls++});t.after(()=>f.host.dispose());await f.init();
 const pending=f.emit({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'write',arguments:{}}});f.host.cancel();resolve(true);await pending;assert.equal(calls,0);
 const g=hostFixture({tools:[{name:'write'}],callTool:()=>calls++});t.after(()=>g.host.dispose());await g.init();await g.emit({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'write'}});assert.equal(calls,0);assert.match(g.sent.at(-1).m.error.message,/declined/);
});
test('MCP host validates user-message arrays, links, resources and unadvertised downloads',async t=>{
 let messages=0,reads=0;const f=hostFixture({onMessage:()=>messages++,readResource:()=>{reads++;return {contents:[]};},resourceUris:['ui://allowed'],approve:async()=>true});t.after(()=>f.host.dispose());await f.init();
 for(const [id,method,params] of [[2,'ui/message',{role:'system',content:[]}],[3,'ui/message',{role:'user',content:{type:'text',text:'Bad'}}],[4,'resources/read',{uri:'https://unknown'}],[5,'ui/download-file',{contents:[]}]]){await f.emit({jsonrpc:'2.0',id,method,params});assert.ok(f.sent.at(-1).m.error);}
 assert.equal(messages+reads,0);await f.emit({jsonrpc:'2.0',id:6,method:'ui/message',params:{role:'user',content:[{type:'text',text:'Review'}]}});assert.equal(messages,1);
});
test('MCP host app-exposed tools and teardown use bounded pending requests',async t=>{
 const f=hostFixture();t.after(()=>f.host.dispose());await f.init();const pending=f.host.listAppTools(),request=f.sent.at(-1).m;assert.equal(request.method,'tools/list');await f.emit({jsonrpc:'2.0',id:request.id,result:{tools:[]}});assert.deepEqual(await pending,Object.assign(Object.create(null),{tools:[]}));const tool=f.host.callAppTool('appTool');f.host.dispose();await assert.rejects(tool,/closed/);assert.equal(f.listeners.size,0);
});
test('AppBlock document adds host bootstrap without evaluating source in the host process',()=>{
 const output=appBlockDocument('<script>globalThis.rawAppMarker=42</script>');assert.match(output,/ui\/initialize/);assert.match(output,/rawAppMarker=42/);assert.equal(globalThis.rawAppMarker,undefined);
});
test('sandbox HTTP service enforces real headers, embedding origin, read-only routes and Host validation',async t=>{
 const server=createIntelligentUISandboxServer({parentOrigin:'https://ide.example',html:'<!doctype html><p>Proxy</p>'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/intelligent-ui-sandbox.html?parentOrigin=https%3A%2F%2Fide.example');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors https:\/\/ide.example/);assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(base+'/intelligent-ui-sandbox.html?parentOrigin=https%3A%2F%2Fother.example')).status,403);assert.equal((await fetch(base+'/project.json')).status,404);assert.equal((await fetch(base+'/intelligent-ui-sandbox.html',{method:'POST',body:'no'})).status,405);
});

test('UI documents pin inspected references and do not trust model-provided reference objects',()=>{
 const service=new McpUIService(),owner={principal:'pin-test'};
 service.capture('vb6.module.read',{module:'Before',code:'Original',revision:1},owner);
 const first=service.run('present',{source:'<Cite ref="vb6.module.read"/>',data:{references:{'vb6.module.read':{title:'Fake'}}}},owner);
 service.capture('vb6.module.read',{module:'After',code:'New',revision:2},owner);
 assert.equal(first.ui.references['vb6.module.read'].title,'Before');
 assert.equal(service.run('read',{id:first.ui.id},owner).ui.references['vb6.module.read'].title,'Before');
 const next=service.run('update',{id:first.ui.id,expectedUIRevision:1},owner);
 assert.equal(next.ui.references['vb6.module.read'].title,'After');
 next.ui.references['vb6.module.read'].title='Mutated';
 assert.equal(service.run('read',{id:first.ui.id},owner).ui.references['vb6.module.read'].title,'After');
});
test('MCP host cancellation promptly rejects outstanding host requests',async t=>{
 const f=hostFixture();t.after(()=>f.host.dispose());await f.init();
 const pending=f.host.request('tools/list');f.host.cancel();
 await assert.rejects(pending,/cancelled/);assert.equal(f.host.pending.size,0);
 await assert.rejects(f.host.request('tools/list'));
});
test('MCP host cleans pending request state when serialization fails',async t=>{
 const f=hostFixture();t.after(()=>f.host.dispose());await f.init();
 await assert.rejects(f.host.request('tools/call',{fn(){}}));assert.equal(f.host.pending.size,0);
});

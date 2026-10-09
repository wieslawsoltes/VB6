import test from 'node:test';
import assert from 'node:assert/strict';
import {McpAppHost,normalizeAppCsp} from '../packages/intelligent-ui/src/app-host.js';
import {McpAppClient} from '../packages/intelligent-ui/src/mcp-app.js';
import {AppDisplayController} from '../packages/intelligent-ui/src/display-mode.js';
function fixture(options={}){
 const sent=[],listeners=new Set(),win={location:{origin:'https://ide.example'},innerWidth:1000,innerHeight:700,addEventListener:(n,f)=>listeners.add(f),removeEventListener:(n,f)=>listeners.delete(f)};
 const node=()=>({style:{height:'400px'},classList:{add(){},toggle(){},remove(){}},setAttribute(){},getAttribute(){return null;},removeAttribute(){},append(){},prepend(){},focus(){},remove(){},contentWindow:{postMessage:(m,origin)=>sent.push({m,origin})}});
 const doc={defaultView:win,createElement:()=>node()},root={...node(),ownerDocument:doc};
 const host=new McpAppHost(root,{proxyUrl:'https://sandbox.example/proxy',html:'Hi',...options});
 const emit=m=>host.receive({source:host.frame.contentWindow,origin:'https://sandbox.example',data:m});
 const init=async(modes=['inline','fullscreen','pip'])=>{await emit({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready'});await emit({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{appInfo:{name:'app',version:'1'},appCapabilities:{tools:{listChanged:true},availableDisplayModes:modes},protocolVersion:'2026-01-26'}});await emit({jsonrpc:'2.0',method:'ui/notifications/initialized'});};
 const call=async(method,params)=>{await emit({jsonrpc:'2.0',id:99,method,params});return sent.findLast(s=>s.m.id===99).m;};
 return {sent,listeners,host,emit,init,call};
}
test('host propagates callback isError and rich content without text flattening',async t=>{
 let received;const f=fixture({onMessage:p=>{received=p;return {isError:true,reason:'delivery declined'};},approve:async()=>true});t.after(()=>f.host.dispose());await f.init();
 const content=[{type:'image',mimeType:'image/png',data:'YWJj'}];const response=await f.call('ui/message',{role:'user',content});assert.equal(response.result.isError,true);assert.equal(received.content[0].data,'YWJj');
 assert.ok((await f.call('ui/message',{role:'user',content:[{type:'audio',mimeType:'audio/wav',data:'notbase64'}]})).error);
});
test('host context content and downloads validate before approval and preserve failure results',async t=>{
 let approvals=0,received;const f=fixture({approve:async()=>{approvals++;return true;},onContext:p=>{received=p;return false;},downloadFile:()=>({isError:true}),resourceUris:['memory://a']});t.after(()=>f.host.dispose());await f.init();
 assert.equal((await f.call('ui/update-model-context',{content:[{type:'audio',mimeType:'audio/wav',data:'YWJj'}]})).result.isError,true);assert.equal(received.content[0].type,'audio');
 assert.equal((await f.call('ui/download-file',{contents:[{type:'resource_link',uri:'memory://a',name:'a'}]})).result.isError,true);
 const before=approvals;assert.ok((await f.call('ui/download-file',{contents:[{type:'resource',resource:{uri:'memory://a',blob:'bad'}}]})).error);assert.equal(approvals,before);
});
test('PiP negotiation, normal return and disposal preserve frame identity',async t=>{
 const f=fixture({approve:async()=>true});t.after(()=>f.host.dispose());await f.init();const frame=f.host.frame;
 assert.equal((await f.call('ui/request-display-mode',{mode:'pip'})).result.mode,'pip');assert.equal(f.host.display.mode,'pip');assert.equal(f.host.frame,frame);
 assert.equal((await f.call('ui/request-display-mode',{mode:'fullscreen'})).result.mode,'fullscreen');f.host.setDisplayMode('inline');assert.equal(f.host.frame,frame);f.host.dispose();assert.equal(f.listeners.size,0);
 const g=fixture({approve:async()=>{throw Error('unavailable mode must not request approval');}});t.after(()=>g.host.dispose());await g.init(['inline']);assert.equal((await g.call('ui/request-display-mode',{mode:'pip'})).result.mode,'inline');
});
test('CSP accepts resource subdomain wildcards but never global or connection wildcards',()=>{
 assert.equal(normalizeAppCsp({resourceDomains:['https://*.Example.org:443/']}).resourceDomains[0],'https://*.example.org');
 for(const value of ['*','https://*','https://*.com','https://*.*.example.org','https://*.127.0.0.1','https://*.bad-.org','https://*.example.org; connect-src *'])assert.throws(()=>normalizeAppCsp({resourceDomains:[value]}));
 assert.throws(()=>normalizeAppCsp({connectDomains:['https://*.example.org']}));
});
test('host receives bounded logs and declared app-tool catalog notifications',async t=>{
 let logs=[],changed=0;const f=fixture({onLog:p=>logs.push(p),onToolsChanged:()=>changed++});t.after(()=>f.host.dispose());await f.init();await f.emit({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:'done'}});await f.emit({jsonrpc:'2.0',method:'notifications/tools/list_changed'});assert.equal(logs.length,1);assert.equal(changed,1);
});
test('app client exposes declared tools, rejects unknown tools and aborts active calls',async()=>{
 const sent=[];let release,signal;const parent={postMessage:m=>sent.push(m)},win={parent,addEventListener(){},removeEventListener(){}};
 const client=new McpAppClient({window:win,tools:[{name:'selected',inputSchema:{type:'object'}}],onToolCall:async(n,args,c)=>{signal=c.signal;await new Promise(r=>release=r);return {content:[{type:'text',text:n}]};}});client.ready=true;
 const emit=m=>client.receive({source:parent,origin:'null',data:m});await emit({jsonrpc:'2.0',id:'list',method:'tools/list'});assert.equal(sent.at(-1).result.tools[0].name,'selected');
 await emit({jsonrpc:'2.0',id:'unknown',method:'tools/call',params:{name:'other'}});assert.ok(sent.at(-1).error);
 const pending=emit({jsonrpc:'2.0',id:'call',method:'tools/call',params:{name:'selected',arguments:{}}});await emit({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:'call'}});assert.equal(signal.aborted,true);release();await pending;assert.ok(sent.at(-1).error);client.dispose();
});

test('per-request cancellation revokes pending approval before callback effects',async t=>{
 let allow,entered,effects=0;const ready=new Promise(r=>entered=r);
 const f=fixture({approve:async()=>{entered();return new Promise(r=>allow=r);},onMessage:()=>{effects++;}});t.after(()=>f.host.dispose());await f.init();
 const pending=f.call('ui/message',{role:'user',content:[{type:'text',text:'Do not deliver'}]});await ready;
 await f.emit({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:99}});allow(true);
 assert.ok((await pending).error);assert.equal(effects,0);assert.equal(f.host.active.size,0);
});

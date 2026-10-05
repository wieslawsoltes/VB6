import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {companionURL} from '../src/mcp/companion-url.js';
import {BrowserBridge} from '../src/mcp/bridge-client.js';
import {McpServer} from '../src/mcp/server.js';
import {MCP_VERSION, MCP_META} from '../src/mcp/protocol.js';
import {IdeRelayTransport} from '../tools/mcp-http.mjs';
import {createBridge} from '../tools/mcp-bridge.mjs';
const metadata = {[MCP_META+'protocolVersion']:MCP_VERSION,[MCP_META+'clientInfo']:{name:'external-agent',version:'1'},[MCP_META+'clientCapabilities']:{}};
const call = id => ({jsonrpc:'2.0',id,method:'tools/call',params:{name:'slow',arguments:{},_meta:metadata}});

for (const url of ['https://server.example','http://localhost.evil.test','http://127.0.0.1@evil.test','http://localhost:8766/stdio/echo','http://localhost:8766/?token=secret','http://localhost:8766/#fragment','file:///tmp/app.html','javascript:alert(1)']) {
  test('server-only: browser cannot pair with non-companion URL '+url,()=>assert.throws(()=>new BrowserBridge({}, {url,token:'a'.repeat(64)})));
}
for (const url of ['https://remote.example/mcp','http://localhost:8766/stdio/echo','http://localhost:8766/mcp?key=secret','http://localhost:8766/','http://owner:secret@localhost:8766/mcp']) {
  test('server-only: desktop relay refuses arbitrary endpoint '+url,()=>assert.throws(()=>new IdeRelayTransport(url)));
}
test('server-only: loopback HTTP/HTTPS origins and MCP endpoints are accepted',()=>{
  for(const origin of ['http://127.0.0.1:8766','http://localhost:9000','https://localhost:9443','http://[::1]:8766']) {
    assert.equal(companionURL(origin).origin,origin);assert.equal(companionURL(origin+'/mcp',{endpoint:true}).pathname,'/mcp');
  }
});
test('server-only: outbound modules are absent from source and browser bundles',async()=>{
  for(const file of ['src/mcp/client.js','src/mcp/oauth.js','src/mcp/transports.js','tools/mcp-node.mjs'])await assert.rejects(access(file));
  const source=await readFile('src/mcp/studio.js','utf8'),bundle=await readFile('dist/studio.js','utf8');
  for(const text of ['McpClient','McpOAuth','LegacySseTransport','Browse & invoke','Connect to this IDE','Prepare sign-in','Complete sign-in and connect'])assert.ok(!source.includes(text)&&!bundle.includes(text),text);
  assert.ok(bundle.includes('MCP Agent Access'));
  assert.ok(!source.includes('tests/helpers'));
});
test('server-only: companion rejects removed stdio configuration',async()=>{
  await assert.rejects(createBridge({stdioServers:{}}),/Unsupported companion options/);
  const result=spawnSync(process.execPath,['tools/mcp-bridge.mjs','--config','/file-that-must-not-be-read.json'],{encoding:'utf8',timeout:3000});
  assert.equal(result.status,1);assert.match(result.stderr,/Usage/);assert.ok(!result.stderr.includes('ENOENT'));
});
test('server-only: removed outbound gateway never falls through to static serving',async t=>{
  const bridge=await createBridge({port:0});t.after(()=>bridge.close());
  for(const method of ['GET','POST','DELETE']){
    const response=await fetch(bridge.url+'/stdio/anything',{method,headers:{Authorization:'Bearer '+bridge.ownerToken}});
    assert.equal(response.status,404);assert.match((await response.json()).error,/only exposes the IDE/);
  }
});
test('server-only: closing during a pending bridge attachment cannot resurrect it',async()=>{
  let release,called=false;
  const bridge=new BrowserBridge({closeSession(){}},{url:'http://localhost:8766',token:'a'.repeat(64),fetch:async(url)=>{
    called=true;if(url.endsWith('/bridge/attach'))return new Promise(resolve=>release=resolve);
    return new Response('{}',{headers:{'Content-Type':'application/json'}});
  }});
  const connecting=bridge.connect();while(!called)await Promise.resolve();
  await bridge.close();release(new Response(JSON.stringify({lease:'b'.repeat(64)})));
  await assert.rejects(connecting,/cancelled|closed/i);assert.equal(bridge.connected,false);assert.equal(bridge.token,'');
  await assert.rejects(bridge.connect(),/closed/i);
});
test('server-only: cancelled request cleanup cannot delete a replacement with the same ID',async()=>{
  const waits=[];const server=new McpServer({tools:[{name:'slow',inputSchema:{type:'object'},execute:()=>new Promise(r=>waits.push(r))}]});
  const first=server.dispatch(call(1));server.revoke();const second=server.dispatch(call(1));
  assert.equal((await first).error.code,-32800);assert.equal(server.active.size,1);
  waits[1]({value:2});assert.equal((await second).result.structuredContent.value,2);waits[0]({value:1});server.close();
});

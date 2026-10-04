import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {McpClient} from '../src/mcp/client.js';
import {HttpTransport, LegacySseTransport} from '../src/mcp/transports.js';
import {MCP_VERSION, MCP_META, requestHeaders} from '../src/mcp/protocol.js';
import {McpServer} from '../src/mcp/server.js';
import {BrowserBridge} from '../src/mcp/bridge-client.js';
import {createBridge} from '../tools/mcp-bridge.mjs';
import {NodeStdioTransport} from '../tools/mcp-node.mjs';

async function fixture(t, handler) {
  const server = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({error: error.message})); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }); return 'http://127.0.0.1:' + server.address().port;
}
const read = async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); };
const json = (res, value, status = 200, headers = {}) => { res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(JSON.stringify(value)); };
const sse = (res, message) => res.write('event: message\ndata: ' + JSON.stringify(message) + '\n\n');
const info = {name: 'independent-fixture', version: '1'};
const tools = [{name: 'echo', inputSchema: {type: 'object', properties: {text: {type: 'string', 'x-mcp-header': 'Text'}}}}];
const modernParams = {_meta: {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'test', version: '1'}, 'io.modelcontextprotocol/clientCapabilities': {}}};
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function tinyAdapter() {
  return {tools: [{name: 'echo', inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']}, execute: args => ({text: args.text})}], resources: async () => [{uri: 'vb6://project', name: 'project'}], readResource: async uri => [{uri, text: '{}'}], prompts: []};
}

test('MCP HTTP: independent modern server validates routing headers, CORS-safe auth options and paging', async t => {
  let calls = 0;
  const url = await fixture(t, async (req, res) => {
    const message = await read(req); assert.equal(req.headers.authorization, 'Bearer test-secret'); assert.equal(req.headers['mcp-protocol-version'], '2026-07-28'); assert.equal(req.headers['mcp-method'], message.method);
    assert.equal(message.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28'); let result;
    if (message.method === 'server/discover') result = {supportedVersions: ['2026-07-28'], capabilities: {tools: {}}, _meta: {'io.modelcontextprotocol/serverInfo': info}};
    else if (message.method === 'tools/list') result = message.params.cursor ? {tools: [tools[0]]} : {tools: [], nextCursor: 'second'};
    else { calls++; assert.equal(req.headers['mcp-name'], 'echo'); assert.equal(req.headers['mcp-param-text'], 'hello'); result = {content: [{type: 'text', text: message.params.arguments.text}]}; }
    json(res, {jsonrpc: '2.0', id: message.id, result: {resultType: 'complete', ...result}});
  });
  const realFetch = globalThis.fetch, options = [];
  const client = new McpClient(new HttpTransport(url, {token: 'test-secret', fetch: (url, init) => { options.push(init); return realFetch(url, init); }})); t.after(() => client.close());
  await client.connect(); assert.equal((await client.listTools()).length, 1); assert.equal((await client.callTool('echo', {text: 'hello'})).content[0].text, 'hello'); assert.equal(calls, 1);
  assert.ok(options.every(option => option.credentials === 'omit' && option.redirect === 'error' && option.referrerPolicy === 'no-referrer'));
});
test('MCP HTTP: recognized modern header/version errors do not trigger legacy fallback', async t => {
  let requests = 0;
  const url = await fixture(t, async (req, res) => { requests++; await read(req); json(res, {jsonrpc: '2.0', id: null, error: {code: -32020, message: 'Header mismatch'}}, 400); });
  const client = new McpClient(new HttpTransport(url)); await assert.rejects(client.connect(), error => error.code === -32020); assert.equal(requests, 1);
});
test('MCP HTTP: legacy initialization, negotiated session headers, optional GET and DELETE', async t => {
  const methods = [], sessions = new Set(); let sid = 0;
  const url = await fixture(t, async (req, res) => {
    methods.push(req.method); if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    if (req.method === 'DELETE') { assert.ok(sessions.has(req.headers['mcp-session-id'])); sessions.delete(req.headers['mcp-session-id']); res.end(); return; }
    const message = await read(req);
    if (message.method === 'server/discover') return json(res, {jsonrpc: '2.0', id: message.id, error: {code: -32601, message: 'Legacy server'}}, 400);
    if (message.method === 'initialize') { const id = 'session-' + (++sid); sessions.add(id); return json(res, {jsonrpc: '2.0', id: message.id, result: {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: info}}, 200, {'MCP-Session-Id': id}); }
    assert.ok(sessions.has(req.headers['mcp-session-id'])); assert.equal(req.headers['mcp-protocol-version'], '2025-11-25');
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    json(res, {jsonrpc: '2.0', id: message.id, result: {tools}});
  });
  const client = new McpClient(new HttpTransport(url)); await client.connect(); assert.equal(client.version, '2025-11-25'); assert.equal((await client.listTools()).length, 1); await client.close(); assert.equal(sessions.size, 0); assert.ok(methods.includes('GET')); assert.ok(methods.includes('DELETE'));
});
test('MCP HTTP: expired session is reinitialized without replaying the failed tool call', async t => {
  let initialized = 0, calls = 0;
  const url = await fixture(t, async (req, res) => {
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; } if (req.method === 'DELETE') { res.end(); return; }
    const message = await read(req);
    if (message.method === 'initialize') return json(res, {jsonrpc: '2.0', id: message.id, result: {protocolVersion: '2025-11-25', capabilities: {}, serverInfo: info}}, 200, {'MCP-Session-Id': 's-' + (++initialized)});
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    if (message.method === 'tools/call') { calls++; return json(res, {jsonrpc: '2.0', id: message.id, error: {code: -32000, message: 'Expired'}}, 404); }
    json(res, {jsonrpc: '2.0', id: message.id, result: {tools}});
  });
  const client = new McpClient(new HttpTransport(url), {era: 'legacy'}); t.after(() => client.close()); await client.connect(); await assert.rejects(client.callTool('echo', {text: 'never replay'})); assert.equal(calls, 1); assert.equal(initialized, 2);
});
test('MCP HTTP: SSE can carry progress followed by the correlated result', async t => {
  const url = await fixture(t, async (req, res) => { const message = await read(req); res.writeHead(200, {'Content-Type': 'text/event-stream'}); sse(res, {jsonrpc: '2.0', method: 'notifications/progress', params: {progressToken: 'p', progress: 1}}); sse(res, {jsonrpc: '2.0', id: message.id, result: {resultType: 'complete', content: []}}); res.end(); });
  const events = [], result = await new HttpTransport(url).exchange({jsonrpc: '2.0', id: 'a', method: 'tools/call', params: {...modernParams, name: 'x'}}, {version: MCP_VERSION, onMessage: message => events.push(message)});
  assert.equal(result.id, 'a'); assert.equal(events[0].method, 'notifications/progress');
});
test('MCP HTTP: premature modern SSE closure never replays an operation', async t => {
  let calls = 0;
  const url = await fixture(t, async (req, res) => { calls++; await read(req); res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.end('id: seed\nretry: 0\ndata:\n\n'); });
  await assert.rejects(new HttpTransport(url).exchange({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {...modernParams, name: 'x'}}, {version: MCP_VERSION}), /not replayed/); assert.equal(calls, 1);
});
test('MCP HTTP: legacy resumable SSE uses GET Last-Event-ID, not another POST', async t => {
  const methods = []; let id;
  const url = await fixture(t, async (req, res) => { methods.push(req.method); res.writeHead(200, {'Content-Type': 'text/event-stream'});
    if (req.method === 'POST') { id = (await read(req)).id; res.end('id: seed\nretry: 1\ndata:\n\n'); }
    else { assert.equal(req.headers['last-event-id'], 'seed'); sse(res, {jsonrpc: '2.0', id, result: {content: []}}); res.end(); }
  });
  const result = await new HttpTransport(url).exchange({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'x'}}, {version: '2025-11-25'}); assert.equal(result.id, 1); assert.deepEqual(methods, ['POST','GET']);
});
test('MCP HTTP: old SSE endpoint discovery and JSON-RPC request multiplexing', async t => {
  let output;
  const url = await fixture(t, async (req, res) => {
    if (req.method === 'GET') { output = res; res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.write('event: endpoint\ndata: /messages?session=old\n\n'); return; }
    assert.equal(req.url, '/messages?session=old'); const message = await read(req); res.writeHead(202); res.end(); if (message.id === undefined) return;
    const result = message.method === 'initialize' ? {protocolVersion: '2024-11-05', capabilities: {tools: {}}, serverInfo: info} : {tools}; sse(output, {jsonrpc: '2.0', id: message.id, result});
  });
  const client = new McpClient(new LegacySseTransport(url)); await client.connect(); assert.equal((await client.listTools()).length, 1); await client.close();
});
test('MCP HTTP: legacy SSE will not send credentials to a different origin', async () => {
  let calls = 0;
  const transport = new LegacySseTransport('https://safe.test/sse', {token: 'secret', fetch: async () => { calls++; return new Response('event: endpoint\ndata: https://evil.test/post\n\n', {headers: {'Content-Type': 'text/event-stream'}}); }});
  await assert.rejects(transport.exchange({jsonrpc: '2.0', id: 1, method: 'initialize'}, {signal: AbortSignal.timeout(1000)}), /Cross-origin/); assert.equal(calls, 1); await transport.close();
});
test('MCP HTTP: redirects cannot forward authorization to another endpoint', async t => {
  let stolen = false;
  const target = await fixture(t, (req, res) => { stolen = true; res.end(); });
  const url = await fixture(t, (req, res) => { res.writeHead(307, {Location: target}); res.end(); });
  await assert.rejects(new HttpTransport(url, {token: 'never-forward'}).exchange({jsonrpc: '2.0', id: 1, method: 'ping', params: modernParams}, {version: MCP_VERSION}), /Redirects/); assert.equal(stolen, false);
});
for (const era of ['modern','legacy']) test('MCP bridge: real HTTP ↔ browser dispatcher roundtrip (' + era + ')', async t => {
  const bridge = await createBridge({port: 0}), server = new McpServer(tinyAdapter()), browser = new BrowserBridge(server, {url: bridge.url, token: bridge.ownerToken}), client = new McpClient(new HttpTransport(bridge.url + '/mcp', {token: bridge.clientToken}), {era});
  t.after(async () => { await client.close(); await browser.close(); server.close(); await bridge.close(); });
  await browser.connect(); await client.connect(); assert.equal((await client.callTool('echo', {text: 'through browser'})).structuredContent.text, 'through browser');
});
test('MCP bridge: auth, exact Origins, file opt-in, Host validation and lease ownership', async t => {
  const bridge = await createBridge({port: 0, origins: ['https://app.example'], allowFile: false}); t.after(() => bridge.close());
  assert.equal((await fetch(bridge.url + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401);
  for (const origin of ['null','https://evil.example','https://app.example.evil']) assert.equal((await fetch(bridge.url + '/mcp', {method: 'OPTIONS', headers: {Origin: origin, 'Access-Control-Request-Headers': 'authorization,content-type'}})).status, 403);
  const preflight = await fetch(bridge.url + '/mcp', {method: 'OPTIONS', headers: {Origin: 'https://app.example', 'Access-Control-Request-Headers': 'authorization,content-type,mcp-method,mcp-param-test', 'Access-Control-Request-Private-Network': 'true'}});
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://app.example'); assert.equal(preflight.headers.get('Access-Control-Allow-Private-Network'), 'true'); assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
  const post = (path, token, data = {}, lease) => fetch(bridge.url + path, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(lease ? {'X-VB6-Lease': lease} : {})}, body: JSON.stringify(data)});
  assert.equal((await post('/bridge/attach', bridge.clientToken, {id: 'not-owner'})).status, 401);
  const attach = await post('/bridge/attach', bridge.ownerToken, {id: 'browser'}); assert.equal(attach.status, 200); const {lease} = await attach.json();
  assert.equal((await post('/bridge/attach', bridge.ownerToken, {id: 'other-browser'})).status, 409); assert.equal((await post('/bridge/poll', bridge.ownerToken)).status, 409);
  assert.equal((await post('/bridge/detach', bridge.ownerToken, {}, lease)).status, 200);
  assert.equal((await post('/mcp?token=bad', bridge.clientToken)).status, 400);
  const response = await new Promise((resolve, reject) => { const req = http.get(bridge.url, {headers: {Host: 'attacker.test'}}, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); }); assert.equal(response, 403);
});
test('MCP bridge: file origin is allowed only with explicit flag and never wildcarded', async t => {
  const bridge = await createBridge({port: 0, allowFile: true}); t.after(() => bridge.close());
  const result = await fetch(bridge.url + '/bridge/attach', {method: 'OPTIONS', headers: {Origin: 'null', 'Access-Control-Request-Headers': 'authorization,content-type'}}); assert.equal(result.status, 204); assert.equal(result.headers.get('Access-Control-Allow-Origin'), 'null');
});
test('MCP bridge: subscription cancellation tears down browser work and detaching rejects requests', async t => {
  const bridge = await createBridge({port: 0}), server = new McpServer(tinyAdapter()), browser = new BrowserBridge(server, {url: bridge.url, token: bridge.ownerToken}), client = new McpClient(new HttpTransport(bridge.url + '/mcp', {token: bridge.clientToken}), {era: 'modern'});
  t.after(async () => { await client.close(); await browser.close(); server.close(); await bridge.close(); }); await browser.connect(); await client.connect(); const controller = new AbortController(), notifications = [];
  const pending = client.subscribe({resourceSubscriptions: ['vb6://project']}, {signal: controller.signal, onNotification: message => notifications.push(message)}); await tick(); await tick(); assert.equal(notifications[0].method, 'notifications/subscriptions/acknowledged');
  controller.abort(); await assert.rejects(pending); await tick(); assert.equal(server.listeners.size, 0); await browser.close(); await assert.rejects(client.listTools(), error => error.status === 503);
});
for (const modern of [false,true]) test('MCP stdio: independent child server interoperability ' + (modern ? 'modern' : 'legacy'), async t => {
  const transport = new NodeStdioTransport({command: process.execPath, args: [path.resolve('tests/fixtures/mcp/stdio-server.mjs'), ...(modern ? ['--modern'] : [])]}), client = new McpClient(transport); t.after(() => client.close());
  await client.connect(); assert.equal(client.version, modern ? '2026-07-28' : '2025-11-25'); assert.equal((await client.callTool('echo', {text: 'stdio'})).structuredContent.text, 'stdio');
});
for (const modern of [false,true]) test('MCP bridge: allowlisted stdio gateway ' + (modern ? 'modern' : 'legacy'), async t => {
  const bridge = await createBridge({port: 0, stdioServers: {echo: {command: process.execPath, args: [path.resolve('tests/fixtures/mcp/stdio-server.mjs'), ...(modern ? ['--modern'] : [])]}}});
  const client = new McpClient(new HttpTransport(bridge.url + '/stdio/echo', {token: bridge.ownerToken})); t.after(async () => { await client.close(); await bridge.close(); });
  await client.connect(); assert.equal((await client.callTool('echo', {text: 'gateway'})).structuredContent.text, 'gateway');
  assert.equal((await fetch(bridge.url + '/stdio/not-configured', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + bridge.ownerToken}, body: '{}'})).status, 404);
});
test('MCP bridge: desktop stdio relay reaches the live browser project server', async t => {
  const bridge = await createBridge({port: 0}), server = new McpServer(tinyAdapter()), browser = new BrowserBridge(server, {url: bridge.url, token: bridge.ownerToken});
  const transport = new NodeStdioTransport({command: process.execPath, args: [path.resolve('tools/mcp-stdio.mjs'), '--url', bridge.url + '/mcp'], env: {VB6_MCP_TOKEN: bridge.clientToken}}), client = new McpClient(transport);
  t.after(async () => { await client.close(); await browser.close(); server.close(); await bridge.close(); }); await browser.connect(); await client.connect(); assert.equal((await client.callTool('echo', {text: 'desktop'})).structuredContent.text, 'desktop');
});
test('MCP stdio: companion credentials are excluded from inherited process environments', async t => {
  const previousOwner = process.env.VB6_MCP_OWNER_TOKEN, previousClient = process.env.VB6_MCP_TOKEN;
  process.env.VB6_MCP_OWNER_TOKEN = 'parent-owner-secret'; process.env.VB6_MCP_TOKEN = 'parent-client-secret';
  t.after(() => { for (const [key, value] of [['VB6_MCP_OWNER_TOKEN', previousOwner], ['VB6_MCP_TOKEN', previousClient]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const source = `process.stdin.once('data', text => { const request = JSON.parse(text); console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{owner:!!process.env.VB6_MCP_OWNER_TOKEN,client:!!process.env.VB6_MCP_TOKEN,custom:process.env.MCP_TEST_VALUE}})); });`;
  const transport = new NodeStdioTransport({command: process.execPath, args: ['-e', source], env: {MCP_TEST_VALUE: 'allowed'}}); t.after(() => transport.close());
  const reply = await transport.exchange({jsonrpc: '2.0', id: 1, method: 'ping'}); assert.deepEqual(reply.result, {owner: false, client: false, custom: 'allowed'});
});
test('MCP stdio: a child stdin error rejects pending requests without an unhandled event', async t => {
  const transport = new NodeStdioTransport({command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)']}); t.after(() => transport.close());
  const pending = transport.exchange({jsonrpc: '2.0', id: 1, method: 'ping'}); const rejected = assert.rejects(pending, /stdin|write/i);
  transport.child.stdin.emit('error', Object.assign(new Error('pipe closed'), {code: 'EPIPE'})); await rejected; assert.equal(transport.closed, true); assert.equal(transport.pending.size, 0);
});
test('MCP companion: invalid UTF-8 is rejected rather than silently rewritten', async t => {
  const bridge = await createBridge({port: 0}); t.after(() => bridge.close());
  const bytes = Buffer.concat([Buffer.from('{"id":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  const response = await fetch(bridge.url + '/bridge/attach', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + bridge.ownerToken}, body: bytes});
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, -32700);
});

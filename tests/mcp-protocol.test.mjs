import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {MCP_VERSION, MCP_META, McpError, checkMessage, parseMessage, encodeHeader, decodeHeader, headerAnnotations, requestHeaders, validateHeaders, validateArguments, httpURL, pageItems, awaitAbort} from '../src/mcp/protocol.js';
import {McpClient} from '../src/mcp/client.js';
import {McpServer, bindMcpPort} from '../src/mcp/server.js';
import {LocalTransport, PortTransport, HttpTransport, LegacySseTransport, SseParser, readJsonResponse, readSseResponse} from '../src/mcp/transports.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {History, Signal} from '../src/core/core.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
export function makeIde() {
  const ide = new Signal(); Object.assign(ide, {project: newProject('McpProject'), history: new History(), runState: 'design', breakpoints: [], savedJSON: '',
    markDirty() { this.dirty = true; }, record(before, label) { this.history.record(before, this.project, label); this.markDirty(); },
    loadProject(project) { this.project = normalizeProject(project); this.history.reset(); this.savedJSON = JSON.stringify(this.project); },
    syncBreakpoints() {}, openDocument(id, view, line) { this.opened = {id, view, line}; }, run() { this.runState = 'running'; this.emit('run'); }, async stop() { this.runState = 'design'; this.emit('stop'); },
    async command(command) { this.lastCommand = command; }, async requestRuntime(command, args) { this.requested = {command, args}; return {value: '42'}; }, sendRuntime(command) { this.sent = command; }});
  return ide;
}
function setup(t, {approve = async () => true, era = 'auto'} = {}) {
  const ide = makeIde(), adapter = createIdeAdapter(ide, {approve}), server = new McpServer(adapter), client = new McpClient(new LocalTransport(server), {era});
  t.after(async () => { await client.close(); server.close(); adapter.dispose(); }); return {ide, adapter, server, client};
}
const modern = (id, method, params = {}) => ({jsonrpc: '2.0', id, method, params: {...params, _meta: {[MCP_META + 'protocolVersion']: MCP_VERSION, [MCP_META + 'clientInfo']: {name: 'test', version: '1'}, [MCP_META + 'clientCapabilities']: {}}}});

test('MCP: validates requests, notifications, errors and rejects malformed/batched messages', () => {
  assert.equal(checkMessage({jsonrpc: '2.0', id: 0, method: 'ping'}), 'request'); assert.equal(checkMessage({jsonrpc: '2.0', method: 'ping'}), 'notification');
  assert.equal(checkMessage({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'bad'}}), 'response');
  assert.equal(checkMessage({jsonrpc: '2.0', error: {code: -32600, message: 'bad'}}), 'response');
  for (const value of [[], null, {jsonrpc: '1.0', id: 1, method: 'ping'}, {jsonrpc: '2.0', id: null, method: 'ping'}, {jsonrpc: '2.0', id: 1, result: {}, error: {}}, {jsonrpc: '2.0', id: 1, error: null}]) assert.throws(() => checkMessage(value));
  assert.throws(() => parseMessage('{'), error => error.code === -32700); assert.throws(() => parseMessage('x'.repeat(20), 5));
});
for (const text of ['abc', '', 'a,b', ' padded ', '你好世界', '\r\n', '=?base64?YWJj?=', '🙂']) test('MCP: header roundtrip ' + JSON.stringify(text), () => assert.equal(decodeHeader(encodeHeader(text)), text));
test('MCP: mirrored routing and nested annotated headers are validated', () => {
  const schema = {type: 'object', properties: {workspace: {type: 'object', properties: {id: {type: 'string', 'x-mcp-header': 'Workspace'}}}, count: {type: 'integer', 'x-mcp-header': 'Count'}}};
  const message = modern(1, 'tools/call', {name: '你好', arguments: {workspace: {id: ' padded '}, count: 3}}), headers = requestHeaders(message, MCP_VERSION, schema);
  assert.equal(headers['Mcp-Method'], 'tools/call'); assert.equal(decodeHeader(headers['Mcp-Name']), '你好'); assert.equal(decodeHeader(headers['Mcp-Param-Workspace']), ' padded '); assert.equal(headers['Mcp-Param-Count'], '3'); validateHeaders(message, headers, schema);
  assert.throws(() => validateHeaders(message, {...headers, 'Mcp-Method': 'tools/list'}, schema), error => error.code === -32020);
  assert.throws(() => requestHeaders(modern(1, 'tools/call', {name: 'x', arguments: {count: 1.2}}), MCP_VERSION, schema));
});
test('MCP: invalid schema header annotations are excluded, not silently interpreted', () => {
  for (const schema of [{type: 'object', 'x-mcp-header': 'Bad'}, {properties: {x: {type: 'array', 'x-mcp-header': 'A'}}}, {allOf: [{properties: {x: {type: 'string', 'x-mcp-header': 'A'}}}]}, {properties: {x: {type: 'string', 'x-mcp-header': 'A'}, y: {type: 'string', 'x-mcp-header': 'a'}}}, {properties: {x: {type: 'string', 'x-mcp-header': 'bad header'}}}]) assert.throws(() => headerAnnotations(schema));
});
test('MCP: URLs reject credentials, unsafe protocols, cleartext non-loopback and fragments', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/x', 'https://u:p@example.test/mcp', 'http://example.test/mcp', 'https://example.test/mcp#secret', 'http://127.0.0.1.evil.test']) assert.throws(() => httpURL(url));
  assert.equal(httpURL('http://127.0.0.1:8766/mcp').hostname, '127.0.0.1'); assert.equal(httpURL('https://x.test/sub/mcp').pathname, '/sub/mcp');
});
test('MCP: bounded argument validation rejects unsafe keys recursively', () => {
  const schema = {type: 'object', properties: {x: {type: 'object'}}, additionalProperties: false};
  assert.throws(() => validateArguments(JSON.parse('{"x":{"nested":{"__proto__":{"polluted":true}}}}'), schema));
  assert.throws(() => validateArguments({extra: 1}, schema)); assert.throws(() => validateArguments({a: 3}, {type: 'object', required: ['b']}));
  assert.throws(() => validateArguments({x: NaN}, {type: 'object', properties: {x: {type: 'integer'}}}));
  assert.throws(() => validateArguments([1,2], {type: 'array', maxItems: 1}));
});
test('MCP: pagination validates malformed and expired cursors', () => {
  assert.equal(pageItems(Array.from({length: 101}, (_, i) => i)).nextCursor, 'page:100'); assert.deepEqual(pageItems([1,2], 'page:2').items, []);
  for (const cursor of [0, '-1', 'page:4', 'page:1.5']) assert.throws(() => pageItems([1,2], cursor));
});
test('MCP: host callbacks cannot prevent cancellation', async () => {
  const controller = new AbortController(), result = awaitAbort(new Promise(() => {}), controller.signal); controller.abort(); await assert.rejects(result, error => error.code === -32800);
});
test('MCP: SSE handles split UTF-8, BOM, CRLF, multiline data, comments, empty data and retry', async () => {
  const bytes = new TextEncoder().encode('\ufeff: comment\r\nid: seed\r\nretry: 1\r\ndata:\r\n\r\nevent: message\ndata: {"x":\ndata: "你好"}\n\n'); let offset = 0;
  const response = new Response(new ReadableStream({pull(c) { if (offset === bytes.length) c.close(); else c.enqueue(bytes.slice(offset, ++offset)); }}));
  const events = []; await readSseResponse(response, event => events.push(event)); assert.equal(events.length, 2); assert.equal(events[0].id, 'seed'); assert.equal(events[0].retry, 1); assert.equal(JSON.parse(events[1].data).x, '你好');
  assert.throws(() => new SseParser(() => {}, 2).feed('data: longer'));
});
test('MCP: JSON response reader bounds payload bytes and validates envelopes', async () => {
  await assert.rejects(readJsonResponse(new Response('x'.repeat(20)), 10));
  assert.equal((await readJsonResponse(Response.json({jsonrpc: '2.0', id: 1, result: {}}))).id, 1);
});
for (const era of ['modern','legacy']) test('MCP: ' + era + ' discovery, tools, resources, prompts and completion', async t => {
  const {adapter, client} = setup(t, {era}); await client.connect(); assert.equal(adapter.enabled, false); await assert.rejects(client.listTools(), error => error.code === -32001); adapter.setEnabled(true);
  assert.equal((await client.listTools()).length, 18); assert.equal((await client.listResources()).length, 6); assert.equal((await client.listResourceTemplates()).length, 2); assert.equal((await client.listPrompts()).length, 2);
  assert.match((await client.readResource('vb6://module/Form1/source')).contents[0].text, /Option Explicit/);
  assert.ok((await client.getPrompt('explain-module', {module: 'Form1'})).messages[0].content.text.includes('Option Explicit'));
  assert.deepEqual((await client.complete({type: 'ref/prompt', name: 'explain-module'}, {name: 'module', value: 'Fo'})).completion.values, ['Form1']);
  assert.equal((await client.callTool('vb6.project.compile')).structuredContent.valid, true);
});
test('MCP: approved edits use revision checks, real project model and undo', async t => {
  const {ide, adapter, client} = setup(t); adapter.setEnabled(true); await client.connect();
  const revision = (await client.callTool('vb6.project.get')).structuredContent.revision, before = ide.project.modules[0].code;
  const result = await client.callTool('vb6.module.write', {module: 'Form1', code: 'Option Explicit\n\' updated', expectedRevision: revision});
  assert.ok(result.structuredContent.revision > revision); assert.notEqual(ide.project.modules[0].code, before); assert.equal(ide.history.undoStack.length, 1); assert.equal(JSON.parse(ide.history.undoStack[0].before).modules[0].code, before);
  await assert.rejects(client.callTool('vb6.module.write', {module: 'Form1', code: '', expectedRevision: revision}), error => error.code === -32002);
});
test('MCP: denial never edits or executes', async t => {
  const {ide, adapter, client} = setup(t, {approve: async () => false}); adapter.setEnabled(true); await client.connect(); const before = JSON.stringify(ide.project);
  await assert.rejects(client.callTool('vb6.module.write', {module: 'Form1', code: '', expectedRevision: adapter.revision}), error => error.code === -32001);
  await assert.rejects(client.callTool('vb6.runtime.start', {expectedRevision: adapter.revision}), error => error.code === -32001);
  assert.equal(JSON.stringify(ide.project), before); assert.equal(ide.runState, 'design');
});
test('MCP: project changes while approval is pending invalidate the operation', async t => {
  let approve; const {ide, adapter, client} = setup(t, {approve: () => new Promise(resolve => { approve = resolve; })}); adapter.setEnabled(true); await client.connect();
  const pending = client.callTool('vb6.module.write', {module: 'Form1', code: '', expectedRevision: adapter.revision}); await tick(); ide.markDirty(); approve(true);
  await assert.rejects(pending, error => error.code === -32002); assert.notEqual(ide.project.modules[0].code, '');
});
test('MCP: cancellation releases an uncooperative approval and revocation aborts active work', async t => {
  const {adapter, client, server} = setup(t, {approve: () => new Promise(() => {})}); adapter.setEnabled(true); await client.connect();
  const controller = new AbortController(), pending = client.callTool('vb6.module.write', {module: 'Form1', code: '', expectedRevision: adapter.revision}, {signal: controller.signal}); await tick(); controller.abort(); await assert.rejects(pending, error => error.code === -32800); await tick(); assert.equal(server.active.size, 0);
  const next = client.callTool('vb6.module.write', {module: 'Form1', code: '', expectedRevision: adapter.revision}); await tick(); server.revoke(); await assert.rejects(next, error => error.code === -32800);
});
test('MCP: add/remove forms, validated designer changes, literal search, exports and workspace replacement', async t => {
  const {ide, adapter, client} = setup(t); adapter.setEnabled(true); await client.connect();
  await client.callTool('vb6.module.add', {name: 'Module2', kind: 'module', code: 'Option Explicit\nPublic value As Long', expectedRevision: adapter.revision}); assert.equal(ide.project.modules.length, 2);
  assert.equal((await client.callTool('vb6.workspace.search', {query: 'PUBLIC', caseSensitive: false})).structuredContent.matches.length, 1);
  const form = structuredClone(ide.project.modules[0].form); form.properties.Caption = 'MCP form'; await client.callTool('vb6.form.update', {module: 'Form1', form, expectedRevision: adapter.revision}); assert.equal(ide.project.modules[0].form.properties.Caption, 'MCP form');
  const invalid = structuredClone(form); invalid.properties.Width = -3; const error = await client.callTool('vb6.form.update', {module: 'Form1', form: invalid, expectedRevision: adapter.revision}); assert.equal(error.isError, true); assert.equal(ide.project.modules[0].form.properties.Width, form.properties.Width);
  await client.callTool('vb6.module.remove', {module: 'Module2', expectedRevision: adapter.revision}); assert.equal(ide.project.modules.length, 1);
  assert.match((await client.callTool('vb6.project.export', {format: 'html'})).structuredContent.content, /<!DOCTYPE html>/i);
  await client.callTool('vb6.project.replace', {project: newProject('Replacement'), expectedRevision: adapter.revision}); assert.equal(ide.project.name, 'Replacement'); assert.equal(ide.history.undoStack.length, 1);
});
test('MCP: no arbitrary command/tool/resource escape and exact argument types', async t => {
  const {adapter, client} = setup(t); adapter.setEnabled(true); await client.connect();
  for (const name of ['eval','shell','vb6.debugger.exec']) await assert.rejects(client.request('tools/call', {name, arguments: {}}));
  for (const uri of ['file:///etc/passwd', 'https://example.test/secret', 'vb6://module/%ff/source']) await assert.rejects(client.readResource(uri));
  await assert.rejects(client.callTool('vb6.debug.command', {command: 'make', expectedRevision: adapter.revision}));
  await assert.rejects(client.callTool('vb6.module.write', {module: 'Form1', code: 123, expectedRevision: adapter.revision}));
});
test('MCP: runtime uses existing command/evaluation API with bounded evaluation, not JS eval', async t => {
  const {ide, adapter, client} = setup(t); adapter.setEnabled(true); await client.connect(); await client.callTool('vb6.runtime.start', {expectedRevision: adapter.revision}); assert.equal(ide.runState, 'running');
  ide.runState = 'paused'; ide.debuggerWindows = {pauseId: 2, frameIndex: 0};
  await client.callTool('vb6.debug.evaluate', {expression: '21 * 2', expectedRevision: adapter.revision}); assert.equal(ide.requested.command, 'debugEvaluate'); assert.equal(ide.requested.args.pauseId, 2); assert.equal(ide.requested.args.timeLimit, 5000);
  await client.callTool('vb6.runtime.stop', {expectedRevision: adapter.revision}); assert.equal(ide.runState, 'design');
});
test('MCP: modern subscriptions acknowledge and tag resource events, then cancel cleanly', async t => {
  const {adapter, client, server} = setup(t); adapter.setEnabled(true); await client.connect(); const messages = [], controller = new AbortController();
  const pending = client.subscribe({resourcesListChanged: true, resourceSubscriptions: ['vb6://project']}, {signal: controller.signal, onNotification: message => messages.push(message)}); await tick();
  assert.equal(messages[0].method, 'notifications/subscriptions/acknowledged'); const id = messages[0].params._meta[MCP_META + 'subscriptionId']; assert.ok(id);
  server.changed({uris: ['vb6://project']}); assert.equal(messages.at(-1).method, 'notifications/resources/updated'); assert.equal(messages.at(-1).params._meta[MCP_META + 'subscriptionId'], id);
  controller.abort(); await assert.rejects(pending, error => error.code === -32800); assert.equal(server.listeners.size, 0);
});
test('MCP: legacy resource subscriptions deliver notifications without an open request', async t => {
  const {adapter, client, server} = setup(t, {era: 'legacy'}); adapter.setEnabled(true); const messages = []; client.onNotification = message => messages.push(message); await client.connect(); await client.subscribeResource('vb6://project');
  server.changed({uris: ['vb6://project']}); assert.equal(messages.at(-1).params.uri, 'vb6://project'); await client.unsubscribeResource('vb6://project'); const count = messages.length; server.changed(); assert.equal(messages.length, count);
});
test('MCP: private MessagePort transport supports requests and cancellation', async t => {
  const {adapter, server} = setup(t); adapter.setEnabled(true); const channel = new MessageChannel(), unbind = bindMcpPort(channel.port1, server, {sessionKey: 'private-test'}), client = new McpClient(new PortTransport(channel.port2)); t.after(async () => { unbind(); await client.close(); });
  await client.connect(); assert.equal((await client.listTools()).length, 18); const controller = new AbortController(), pending = client.subscribe({}, {signal: controller.signal}); await tick(); controller.abort(); await assert.rejects(pending, error => error.code === -32800); await tick(); assert.equal(server.listeners.size, 0);
});
test('MCP: unsupported version and mismatched modern headers return prescribed errors', async t => {
  const {server} = setup(t); const message = modern(1, 'server/discover'); message.params._meta[MCP_META + 'protocolVersion'] = '2099-01-01'; assert.equal((await server.dispatch(message)).error.code, -32022);
  const good = modern(2, 'server/discover'); assert.equal((await server.dispatch(good, {headers: {}})).error.code, -32020);
});
test('MCP: multi-round input preserves opaque requestState and creates fresh request IDs', async () => {
  const requests = [], client = new McpClient({exchange: async message => { requests.push(structuredClone(message));
    const result = message.method === 'server/discover' ? {supportedVersions: [MCP_VERSION], capabilities: {}} : requests.length === 2 ? {resultType: 'input_required', requestState: 'opaque/not-json', inputRequests: {q: {method: 'elicitation/create', params: {message: 'Confirm'}}}} : {resultType: 'complete', content: [{type: 'text', text: 'done'}]};
    return {jsonrpc: '2.0', id: message.id, result: {resultType: 'complete', ...result}}; }}, {handlers: {'elicitation/create': async () => ({action: 'accept', content: {answer: true}})}});
  await client.connect(); await client.request('tools/call', {name: 'external', arguments: {x: 1}});
  assert.equal(requests[2].params.requestState, 'opaque/not-json'); assert.deepEqual(requests[2].params.arguments, {x: 1}); assert.equal(requests[2].params.inputResponses.q.action, 'accept'); assert.notEqual(requests[1].id, requests[2].id); await client.close();
});
test('MCP: pagination cycles fail, invalid tool annotations are isolated, explicit tool denial makes no call', async () => {
  let calls = 0; const client = new McpClient({exchange: async message => { calls++; return {jsonrpc: '2.0', id: message.id, result: {resultType: 'complete', tools: [], nextCursor: 'same'}}; }}, {approveTool: async () => false}); client.connected = true;
  await assert.rejects(client.listTools(), /pagination/); const count = calls; await assert.rejects(client.callTool('x'), /declined/); assert.equal(calls, count); await client.close();
});

test('MCP: closing an in-flight discovery cannot resurrect a connection', async () => {
  let release; const client = new McpClient({exchange: message => new Promise(resolve => { release = () => resolve({jsonrpc: '2.0', id: message.id, result: {resultType: 'complete', supportedVersions: [MCP_VERSION], capabilities: {}}}); })});
  const connecting = client.connect(); const cancelled = assert.rejects(connecting, error => error.code === -32800);
  await client.close(); release(); await cancelled; assert.equal(client.connected, false); assert.equal(client.controllers.size, 0);
});
test('MCP: a cancelled request rejects promptly even when its transport ignores cancellation', async () => {
  let release; const client = new McpClient({exchange: message => new Promise(resolve => { release = () => resolve({jsonrpc: '2.0', id: message.id, result: {resultType: 'complete'}}); })}); client.connected = true;
  const controller = new AbortController(), request = client.request('ping', {}, {signal: controller.signal}); controller.abort();
  const result = await Promise.race([request.then(() => 'accepted', error => error.code), new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
  release(); await request.catch(() => {}); await client.close(); assert.equal(result, -32800);
});
test('MCP: cancellation can dismiss an uncooperative remote-tool consent handler', async () => {
  const client = new McpClient({exchange: () => { throw new Error('Must not contact server'); }}, {approveTool: () => new Promise(() => {})}); client.connected = true;
  const controller = new AbortController(), request = client.callTool('test', {}, {signal: controller.signal}); controller.abort();
  const result = await Promise.race([request.then(() => 'accepted', error => error.code), new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
  await client.close(); assert.equal(result, -32800);
});
test('MCP: mirrored headers reject metadata downgrade and absent recognized parameters', () => {
  assert.throws(() => validateHeaders({jsonrpc: '2.0', id: 1, method: 'ping'}, {'MCP-Protocol-Version': MCP_VERSION, 'Mcp-Method': 'ping'}), error => error.code === -32020);
  assert.throws(() => validateHeaders({jsonrpc: '2.0', id: 1, method: 'ping'}, {'MCP-Protocol-Version': '2099-01-01'}), error => error.code === -32022);
  const message = modern(1, 'tools/call', {name: 'test', arguments: {}}), schema = {type: 'object', properties: {tenant: {type: 'string', 'x-mcp-header': 'Tenant'}}};
  const headers = requestHeaders(message, MCP_VERSION, schema); headers['Mcp-Param-Tenant'] = 'not-in-body';
  assert.throws(() => validateHeaders(message, headers, schema), error => error.code === -32020);
  delete headers['Mcp-Param-Tenant']; headers['Mcp-Param-Unknown'] = 'forward-compatible'; validateHeaders(message, headers, schema);
});

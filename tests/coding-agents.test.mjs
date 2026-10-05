import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {exportApplication} from '../src/exporter/exporter.js';
import assert from 'node:assert/strict';
import {PROVIDERS, providerInfo, modelId, relayURL, nativeRequest, providerHeaders, readEvents, createTransport, listModels, toolCatalog, requestBody, responseCollector, appendTurn, userMessage} from '../src/agents/providers.js';
import {operationReview} from '../src/agents/review.js';
import {CodingAgent} from '../src/agents/agent.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';

const providers = Object.keys(PROVIDERS);
function response(provider, calls = [], text = 'Complete.', extra = {}) {
  if (provider === 'openai') return {type: 'response.completed', response: {status: 'completed', output: [...calls.map((call, i) => ({type: 'function_call', call_id: 'call' + i, name: call.name, arguments: JSON.stringify(call.arguments || {})})), ...(text ? [{type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}] : [])], usage: {total_tokens: 123}, ...extra}};
  if (provider === 'anthropic') return {role: 'assistant', content: [...calls.map((call, i) => ({type: 'tool_use', id: 'call' + i, name: call.name, input: call.arguments || {}})), ...(text ? [{type: 'text', text}] : [])], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: 100, output_tokens: 23}, ...extra};
  return {candidates: [{content: {role: 'model', parts: [...calls.map((call, i) => ({functionCall: {id: 'call' + i, name: call.name, args: call.arguments || {}}})), ...(text ? [{text}] : [])]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 123}, ...extra};
}
function fixture(t, {approve = async () => true, onEvent} = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('CodingTest'), runState: 'design', history: new History(), breakpoints: [], watches: [], output: [], immediateOutput: [], stack: [], docs: [], savedJSON: '',
    markDirty() { this.dirty = true; }, record(before, label) { this.history.record(before, this.project, label); this.markDirty(); },
    loadProject(project) { this.project = normalizeProject(project); this.history.reset(); }, syncBreakpoints() {}, updateWatches() {}, autosave() {},
    async command(id) { if (['undo', 'redo'].includes(id)) { const next = this.history[id](this.project); if (next) { this.project = normalizeProject(next); this.markDirty(); } } },
    openDocument(id, view) { this.docs.push({id, view, key: id + ':' + view}); }, requestRuntime: async () => ({value: '42'}), sendRuntime() {}});
  const adapter = createIdeAdapter(ide, {approve}), agent = new CodingAgent(adapter, {onEvent});
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {ide, adapter, agent};
}
const run = (agent, transport, config = {}) => agent.run({provider: 'openai', model: 'test-model', prompt: 'Test this project.', transport, ...config});
const once = (provider = 'openai', calls = [], text) => async (_, {receive}) => receive(response(provider, calls, text));
function byteStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); }}), {headers: {'Content-Type': 'text/event-stream'}});
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('agents: provider/model/relay validation forbids arbitrary destinations and query keys', () => {
  assert.equal(modelId('models/gemini-test-1'), 'gemini-test-1');
  for (const bad of ['', '../../key', 'https://example.com', 'x?key=secret', 'x/y', 'x\n']) assert.throws(() => modelId(bad));
  for (const bad of ['__proto__', 'toString', 'example']) assert.throws(() => providerInfo(bad));
  for (const bad of ['https://relay.example', 'http://127.0.0.2', 'http://user@127.0.0.1', 'http://localhost/agent', 'http://localhost?key=x', 'http://localhost#x']) assert.throws(() => relayURL(bad));
  assert.equal(relayURL('http://127.0.0.1:4892'), 'http://127.0.0.1:4892');
  assert.equal(relayURL('http://[::1]:4892'), 'http://[::1]:4892');
  for (const p of providers) {
    assert.throws(() => providerHeaders(p, '')); assert.throws(() => providerHeaders(p, 'x\r\ninjected:y'));
    const request = nativeRequest(p, {model: 'test-model', content: []});
    assert.ok(request.url.startsWith(PROVIDERS[p].origin + '/')); assert.ok(!request.url.includes('secret'));
  }
  assert.equal(providerHeaders('google', 'secret')['x-goog-api-key'], 'secret');
  assert.equal(providerHeaders('anthropic', 'secret', false)['anthropic-dangerous-direct-browser-access'], undefined);
  assert.equal(providerHeaders('anthropic', 'secret', true)['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(JSON.parse(nativeRequest('google', {model: 'test-model', contents: []}).body).model, undefined);
});
test('agents: SSE handles every byte boundary, Unicode, split CRLF, comments, multiline JSON and DONE', async () => {
  const received = [];
  await readEvents(byteStream(': ping\r\ndata: {"text":\r\ndata: "Zażółć 🙂"}\r\n\r\ndata: {"n":2}\r\n\r\ndata: [DONE]\r\n\r\n'), value => received.push(value));
  assert.deepEqual(received, [{text: 'Zażółć 🙂'}, {n: 2}]);
});
test('agents: JSON fallback, byte cap and malformed streams fail without running tools', async () => {
  let value; await readEvents(new Response('{"ok":true}', {headers: {'content-type': 'application/json'}}), data => { value = data; }); assert.deepEqual(value, {ok: true});
  await assert.rejects(readEvents(byteStream('data: {"long":"abcd"}\n\n'), () => {}, {maxBytes: 10}), /size limit/);
  await assert.rejects(readEvents(byteStream('data: not-json\n\n'), () => {}));
  assert.throws(() => responseCollector('openai').result(), /before completion/);
});
test('agents: abort cancels a pending SSE reader', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({cancel() { cancelled = true; }}), {headers: {'content-type': 'text/event-stream'}});
  const controller = new AbortController(), pending = readEvents(response, () => {}, {signal: controller.signal});
  controller.abort(); await assert.rejects(pending, {name: 'AbortError'}); assert.equal(cancelled, true);
});
for (const provider of providers) test('agents: ' + provider + ' native body/auth/tool continuation roundtrip', async () => {
  const source = {name: 'vb6.module.read', description: 'Read module', inputSchema: {type: 'object', properties: {module: {type: 'string'}}, required: ['module'], additionalProperties: false}};
  const catalog = toolCatalog([source]); assert.equal(catalog.names.get('vb6_module_read'), source);
  const history = [userMessage(provider, 'Read it')];
  const body = requestBody(provider, 'test-model', history, catalog.definitions, 'instructions', 1024);
  assert.equal(body.model, 'test-model');
  if (provider === 'openai') { assert.equal(body.store, false); assert.equal(body.tools[0].strict, false); assert.ok(body.include.includes('reasoning.encrypted_content')); }
  if (provider === 'anthropic') assert.deepEqual(body.tools[0].input_schema, source.inputSchema);
  if (provider === 'google') assert.deepEqual(body.tools[0].functionDeclarations[0].parametersJsonSchema, source.inputSchema);
  let request;
  const transport = createTransport({provider, apiKey: 'unit-secret', fetchImpl: async (url, options) => { request = {url, options}; return byteStream('data: ' + JSON.stringify(response(provider, [{name: 'vb6_module_read', arguments: {module: 'Form1'}}])) + '\n\n'); }});
  const collector = responseCollector(provider); await transport(body, {receive: collector.receive});
  const result = collector.result(); assert.equal(result.calls.length, 1); assert.equal(result.tokens, 123); assert.deepEqual(result.calls[0].arguments, {module: 'Form1'});
  appendTurn(provider, history, result, [{call: result.calls[0], result: {code: 'Option Explicit'}}]);
  assert.ok(JSON.stringify(history).includes('Option Explicit')); assert.ok(JSON.stringify(history).includes('call0'));
  assert.equal(request.options.redirect, 'error'); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.cache, 'no-store');
  assert.ok(!request.url.includes('unit-secret')); assert.ok(!JSON.stringify(history).includes('unit-secret'));
});
test('agents: relay transport sends only the local token and fixed envelope, never browser provider key', async () => {
  let request;
  const transport = createTransport({provider: 'google', apiKey: 'cloud-secret', relay: 'http://127.0.0.1:4892', relayToken: 'local-token', fetchImpl: async (url, options) => { request = {url, options}; return new Response('{}'); }});
  await transport({model: 'test-model', contents: []});
  assert.equal(request.url, 'http://127.0.0.1:4892/agent'); assert.equal(request.options.headers.Authorization, 'Bearer local-token');
  assert.ok(!JSON.stringify(request).includes('cloud-secret')); assert.equal(JSON.parse(request.options.body).provider, 'google');
});
for (const status of [400, 401, 403, 429, 500]) test('agents: HTTP ' + status + ' does not disclose provider response bodies', async () => {
  const transport = createTransport({provider: 'openai', apiKey: 'secret', fetchImpl: async () => new Response('secret key and confidential prompt', {status})});
  await assert.rejects(transport({model: 'test-model'}), error => error.message.includes('HTTP ' + status) && !error.message.includes('secret') && !error.message.includes('confidential'));
});
test('agents: transport failure is generic; timeout/cancel retains AbortError', async () => {
  const transport = createTransport({provider: 'openai', apiKey: 'secret', fetchImpl: async (_, {signal}) => { signal.throwIfAborted(); throw new Error('secret upstream error'); }});
  await assert.rejects(transport({model: 'test-model'}), /Provider connection failed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport({model: 'test-model'}, {signal: controller.signal}), {name: 'AbortError'});
});
test('agents: model list pagination and Google generation filtering', async () => {
  const seen = [];
  const ids = await listModels(async (_, {cursor, receive}) => { seen.push(cursor); receive(cursor ? {models: [{name: 'models/b', supportedGenerationMethods: ['generateContent']}, {name: 'models/embedding', supportedGenerationMethods: ['embedContent']}]} : {models: [{name: 'models/a', supportedGenerationMethods: ['generateContent']}], nextPageToken: 'next'}); }, 'google');
  assert.deepEqual(ids, ['a', 'b']); assert.deepEqual(seen, ['', 'next']);
  let pages = 0;
  const claude = await listModels(async (_, {receive}) => { pages++; receive({data: [{id: 'claude-model'}], has_more: true, last_id: 'same'}); }, 'anthropic');
  assert.deepEqual(claude, ['claude-model']); assert.equal(pages, 2);
});
test('agents: tool aliases reject collisions and do not mutate source schemas', () => {
  assert.throws(() => toolCatalog([{name: 'a.b'}, {name: 'a_b'}]), /duplicate/);
  const tool = {name: 'a.b', inputSchema: {type: 'object'}}; const catalog = toolCatalog([tool]); catalog.definitions[0].parameters.type = 'null'; assert.equal(tool.inputSchema.type, 'object');
});
test('agents: OpenAI retains encrypted reasoning and function output call IDs', () => {
  const collector = responseCollector('openai');
  const packet = response('openai', [{name: 'read', arguments: {}}]); packet.response.output.unshift({type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque'});
  collector.receive(packet); const result = collector.result(), history = [];
  appendTurn('openai', history, result, [{call: result.calls[0], result: {ok: true}}]);
  assert.equal(history[0].encrypted_content, 'opaque'); assert.equal(history.at(-1).call_id, 'call0');
});
test('agents: Anthropic streams and preserves signed thinking, complete partial JSON and usage', () => {
  const shown = [], collector = responseCollector('anthropic', text => shown.push(text));
  const events = [{type: 'message_start', message: {usage: {input_tokens: 10, cache_read_input_tokens: 2}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: '', signature: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: 'private reasoning'}},
    {type: 'content_block_delta', index: 0, delta: {type: 'signature_delta', signature: 'opaque'}},
    {type: 'content_block_start', index: 1, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 1, delta: {type: 'text_delta', text: 'Public'}},
    {type: 'content_block_start', index: 2, content_block: {type: 'tool_use', id: 'tool-1', name: 'read', input: {}}},
    {type: 'content_block_delta', index: 2, delta: {type: 'input_json_delta', partial_json: '{"mod'}},
    {type: 'content_block_delta', index: 2, delta: {type: 'input_json_delta', partial_json: 'ule":"Main"}'}},
    {type: 'message_delta', delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 20}}, {type: 'message_stop'}];
  for (const event of events) collector.receive(event);
  const result = collector.result(); assert.equal(result.message.content[0].signature, 'opaque'); assert.equal(result.message.content[0].thinking, 'private reasoning');
  assert.deepEqual(shown, ['Public']); assert.deepEqual(result.calls[0].arguments, {module: 'Main'}); assert.equal(result.tokens, 32);
  const history = []; appendTurn('anthropic', history, result, [{call: result.calls[0], result: {error: 'denied'}}]); assert.equal(history.at(-1).content[0].is_error, true);
});
test('agents: Gemini retains thought signatures, public text and function call IDs', () => {
  const shown = [], collector = responseCollector('google', text => shown.push(text));
  collector.receive({candidates: [{content: {parts: [{thought: true, text: 'private'}, {functionCall: {id: 'native-1', name: 'read', args: {module: 'Main'}}, thoughtSignature: 'opaque'}, {text: 'Public'}]}, finishReason: 'STOP'}]});
  const result = collector.result(); assert.deepEqual(shown, ['Public']); assert.equal(result.message.parts[1].thoughtSignature, 'opaque');
  const history = []; appendTurn('google', history, result, [{call: result.calls[0], result: {ok: true}}]); assert.equal(history.at(-1).parts[0].functionResponse.id, 'native-1');
});
for (const provider of providers) test('agents: ' + provider + ' incomplete/invalid turns never yield partial calls', () => {
  const collector = responseCollector(provider);
  if (provider === 'openai') assert.throws(() => collector.receive({type: 'response.incomplete'}), /partial tools/);
  else { collector.receive(response(provider, [{name: 'write'}], '', provider === 'anthropic' ? {stop_reason: 'max_tokens'} : {candidates: [{content: {parts: [{functionCall: {name: 'write', args: {}}}]}, finishReason: 'MAX_TOKENS'}]})); assert.throws(() => collector.result(), /did not finish/); }
  const duplicate = responseCollector(provider), packet = response(provider, [{name: 'read'}, {name: 'read'}]);
  if (provider === 'openai') packet.response.output[1].call_id = 'call0'; else if (provider === 'anthropic') packet.content[1].id = 'call0'; else packet.candidates[0].content.parts[1].functionCall.id = 'call0';
  duplicate.receive(packet); assert.throws(() => duplicate.result(), /duplicate/);
});
for (const provider of providers) test('agents: ' + provider + ' executes real code edit, compile, continuation and Undo', async t => {
  let approvals = 0, requests = 0;
  const f = fixture(t, {approve: async () => { approvals++; return true; }}), original = f.ide.project.modules[0].code;
  const transport = async (body, {receive}) => {
    requests++;
    if (requests === 1) receive(response(provider, [{name: 'vb6_code_edit', arguments: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, text: "' AI test\n", expectedText: ''}]}}], 'Editing.'));
    else if (requests === 2) { assert.ok(JSON.stringify(body).includes('function_call_output') || JSON.stringify(body).includes('tool_result') || JSON.stringify(body).includes('functionResponse')); receive(response(provider, [{name: 'vb6_project_compile'}], 'Compiling.')); }
    else receive(response(provider, [], 'Compiled.'));
  };
  const result = await run(f.agent, transport, {provider});
  assert.equal(result.status, 'completed'); assert.equal(result.calls, 2); assert.equal(requests, 3); assert.equal(approvals, 1);
  assert.equal(f.ide.project.modules[0].code, "' AI test\n" + original); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
  await f.ide.command('undo'); assert.equal(f.ide.project.modules[0].code, original);
});
test('agents: read-only mode removes mutators and rejects hallucinated write tools', async t => {
  const f = fixture(t); let requests = 0; const original = f.ide.project.modules[0].code;
  await run(f.agent, async (body, {receive}) => {
    assert.ok(!body.tools.some(tool => tool.name === 'vb6_module_write')); assert.ok(body.tools.some(tool => tool.name === 'vb6_module_read'));
    requests++; receive(response('openai', requests === 1 ? [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}] : []));
  }, {mode: 'readonly'});
  assert.equal(f.ide.project.modules[0].code, original); assert.ok(f.agent.transcript.some(event => event.text.includes('unavailable tool')));
});
test('agents: denied write stops immediately without alternative execution or continuation', async t => {
  let approvals = 0, requests = 0;
  const f = fixture(t, {approve: async () => { approvals++; return false; }}), original = f.ide.project.modules[0].code;
  await assert.rejects(run(f.agent, async (_, {receive}) => { requests++; receive(response('openai', [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}, {name: 'vb6_project_get'}])); }), /denied/);
  assert.equal(requests, 1); assert.equal(approvals, 1); assert.equal(f.ide.project.modules[0].code, original); assert.equal(f.agent.blocked, true);
  await assert.rejects(run(f.agent, once()), /new task/); f.agent.reset(); assert.equal((await run(f.agent, once())).status, 'completed');
});
test('agents: revision changed during approval rejects edit and returns error to model', async t => {
  let approve;
  const f = fixture(t, {approve: () => new Promise(resolve => { approve = resolve; })}); const original = f.ide.project.modules[0].code; let requests = 0;
  const pending = run(f.agent, async (body, {receive}) => {
    requests++; if (requests === 1) receive(response('openai', [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}]));
    else { assert.match(JSON.stringify(body.input), /changed/); receive(response('openai')); }
  });
  while (!approve) await tick(); f.ide.markDirty(); approve(true); await pending;
  assert.equal(f.ide.project.modules[0].code, original); assert.equal(f.ide.history.undoStack.length, 0);
});
test('agents: scoped code permission is local, run-only and not an MCP sharing grant', async t => {
  let approvals = 0; const f = fixture(t, {approve: async () => { approvals++; return false; }});
  const other = createIdeAdapter(f.ide); t.after(() => other.dispose());
  await run(f.agent, async (_, {receive}) => receive(response('openai', [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'Option Explicit', expectedRevision: f.adapter.revision}}])), {mode: 'scoped', scopes: ['code'], maxTurns: 1});
  assert.equal(approvals, 0); assert.equal(f.ide.project.modules[0].code, 'Option Explicit');
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false); assert.equal(other.permissions.snapshot(f.ide.project.id).active, false);
  await assert.rejects(other.tools.find(tool => tool.name === 'vb6.project.get').execute({}), /sharing|enable|disabled/i);
});
test('agents: Stop aborts request, blocks unsafe replay, disallows parallel runs and revokes authority', async t => {
  const f = fixture(t); let ready;
  const pending = run(f.agent, async (_, {signal}) => { ready = true; await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true})); });
  while (!ready) await tick(); await assert.rejects(run(f.agent, once()), /already running/); assert.throws(() => f.agent.reset(), /Stop/);
  f.agent.stop(); await assert.rejects(pending, {name: 'AbortError'}); assert.equal(f.agent.busy, false); assert.equal(f.agent.blocked, true);
});
test('agents: same-ID project reload aborts old task before any late tool executes', async t => {
  const f = fixture(t), original = f.ide.project.modules[0].code; let release;
  const pending = run(f.agent, async (_, {receive}) => { await new Promise(resolve => { release = resolve; }); receive(response('openai', [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}])); });
  while (!release) await tick(); f.ide.loadProject(structuredClone(f.ide.project)); release(); await assert.rejects(pending);
  assert.equal(f.ide.project.modules[0].code, original); assert.equal(f.ide.history.undoStack.length, 0);
});
test('agents: Stop cancels pending approval; late approval cannot apply', async t => {
  let allow; const f = fixture(t, {approve: () => new Promise(resolve => { allow = resolve; })}); const original = f.ide.project.modules[0].code;
  const pending = run(f.agent, async (_, {receive}) => receive(response('openai', [{name: 'vb6_module_write', arguments: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}])));
  while (!allow) await tick(); f.agent.stop(); allow(true); await assert.rejects(pending); assert.equal(f.ide.project.modules[0].code, original);
});
test('agents: tool batch/request/token/context limits are explicit and enforced', async t => {
  const f = fixture(t); await assert.rejects(run(f.agent, once('openai', [{name: 'vb6_project_get'}, {name: 'vb6_project_get'}]), {maxCalls: 1}), /Tool-call limit/);
  assert.equal(f.agent.transcript.some(event => event.type === 'tool'), false); f.agent.reset();
  assert.equal((await run(f.agent, once('openai', [{name: 'vb6_project_get'}]), {maxTurns: 1})).status, 'limit'); f.agent.reset();
  const tokens = await run(f.agent, async (_, {receive}) => { const packet = response('openai', [{name: 'vb6_project_get'}]); packet.response.usage.total_tokens = 2000; receive(packet); }, {tokenBudget: 1024}); assert.equal(tokens.status, 'limit'); f.agent.reset();
  for (const option of [{maxCalls: 0}, {maxTurns: 1.5}, {maxTokens: 10}, {tokenBudget: 1}]) await assert.rejects(run(f.agent, once(), option), /Invalid agent limit/);
  f.agent.history = [{role: 'user', content: 'x'.repeat(1600000)}]; f.agent.provider = 'openai'; f.agent.model = 'test-model'; f.agent.projectId = f.ide.project.id; f.agent.epoch = f.adapter.authorityEpoch;
  await assert.rejects(run(f.agent, once()), /context limit/);
});
test('agents: provider/model/project changes require a new native conversation', async t => {
  const f = fixture(t); await run(f.agent, once());
  await assert.rejects(run(f.agent, once(), {provider: 'google'}), /new task/); await assert.rejects(run(f.agent, once(), {model: 'other'}), /new task/);
  f.ide.loadProject(newProject('Other')); await assert.rejects(run(f.agent, once()), /new task/);
});
test('agents: observer failures cannot interrupt execution or cleanup', async t => {
  const f = fixture(t, {onEvent: () => { throw new Error('observer error'); }});
  assert.equal((await run(f.agent, once())).status, 'completed'); assert.equal(f.agent.busy, false);
});

test('agents: malformed provider JSON never reflects confidential response contents', async () => {
  await assert.rejects(readEvents(new Response('private-provider-secret'), () => {}), error => !error.message.includes('private-provider-secret') && /Malformed/.test(error.message));
  const c = responseCollector('openai'), packet = response('openai', [{name: 'read'}]);
  packet.response.output[0].arguments = 'private-provider-secret'; c.receive(packet);
  assert.throws(() => c.result(), error => !error.message.includes('private-provider-secret') && /Malformed/.test(error.message));
});

test('agents: review shows exact atomic before/after for every changed module without mutation', () => {
  const p = newProject('Review'); p.modules[0].code = 'a🙂bc'; p.modules.push({id:'m2', name:'Main', kind:'module', code:'12345'});
  const snapshot = structuredClone(p);
  const review = operationReview(p, {name:'vb6.code.edit', arguments:{edits:[{module:'Form1',start:1,end:3,text:'X',expectedText:'🙂'},{module:'Main',start:0,end:2,text:'ab'}]}});
  assert.deepEqual(p, snapshot); assert.equal(review.changes.length,2); assert.equal(review.changes[0].after,'aXbc'); assert.equal(review.changes[1].after,'ab345');
  assert.throws(() => operationReview(p, {name:'vb6.code.edit', arguments:{edits:[{module:'Main',start:0,end:2,text:'ab',expectedText:'bad'}]}}));
  assert.deepEqual(operationReview(p,{name:'vb6.module.write',arguments:{module:'Main',code:'new'}}).changes,[{module:'Main',before:'12345',after:'new'}]);
});

test('agents: completed conversation cannot silently resume after same-ID project reload', async t => {
  const f = fixture(t); await run(f.agent, once()); f.ide.loadProject(structuredClone(f.ide.project));
  await assert.rejects(run(f.agent, once()), /new task/);
});

test('agents: generated IDE parses, while exported apps contain no agent UI or credential fields', async () => {
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(new URL('../dist/studio.js', import.meta.url), 'utf8')));
  const html = await exportApplication(newProject('Shipped'));
  assert.ok(!html.includes('Provider API key')); assert.ok(!html.includes('api.openai.com')); assert.ok(!html.includes('class CodingAgent'));
  const runtime = fs.readFileSync(new URL('../dist/vb6-runtime.js', import.meta.url), 'utf8');
  assert.ok(!runtime.includes('class CodingAgent'));
});

// Corrupt UTF-8 must not silently replace source characters and then run a tool.
test('agents: invalid UTF-8 in JSON or SSE fails before a corrupted tool can run', async () => {
  for (const sse of [false, true]) {
    const prefix = sse ? 'data: {"text":"' : '{"text":"';
    const suffix = sse ? '"}\n\n' : '"}';
    const bytes = new Uint8Array([...new TextEncoder().encode(prefix), 0xc3, 0x28, ...new TextEncoder().encode(suffix)]);
    let received = false;
    await assert.rejects(readEvents(new Response(bytes, {headers: {'content-type': sse ? 'text/event-stream' : 'application/json'}}), () => { received = true; }));
    assert.equal(received, false);
  }
});

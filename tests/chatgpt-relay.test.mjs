import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './helpers/chatgpt-fixture.mjs';
import {createAgentRelay} from '../tools/agent-relay.mjs';
import {chatGPTRequest, chatGPTModels, validateChatGPTEvent} from '../src/agents/chatgpt-protocol.js';
import {createTransport, listModels, requestBody, responseCollector, providerFailure, appendTurn} from '../src/agents/providers.js';
import {CodingAgent} from '../src/agents/agent.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';
const origin = 'http://127.0.0.1:8080', token = 'relay-only-secret-'.repeat(3);
const body = () => requestBody('openai', 'model-z', [{role: 'user', content: 'Hello'}], [{name: 'ide_project_get', description: 'Read project', parameters: {type: 'object', properties: {}}}], 'VB6 instructions', 1000);
async function relayFixture(t, {login = true, ...options} = {}) {
  const f = fixture(options); const id = login ? await f.login() : '';
  const server = createAgentRelay({token, origins: [origin], keys: {openai: 'api-key-never-fallback'}, fetchImpl: f.fetchImpl, chatgpt: f.auth});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const relay = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await f.auth.close(); });
  const request = (data, path = '/agent', headers = {}) => new Promise((resolve, reject) => {
    const req = http.request(relay + path, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer ' + token, ...headers}}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode, headers: res.headers})));
    }); req.on('error', reject); req.end(JSON.stringify(data));
  });
  const transport = createTransport({provider: 'openai', relay, relayToken: token, authMode: 'chatgpt', accountId: id || 'not-logged-in', fetchImpl: (url, init) => fetch(url, {...init, headers: {...init.headers, Origin: origin}})});
  return {...f, id, relay, request, transport};
}
test('ChatGPT request profile strips unsupported fields and namespaces local functions', () => {
  const source = {...body(), metadata: {secret: 'omitted'}, temperature: 1, top_p: 1, previous_response_id: 'previous', background: true, conversation: 'server-side'};
  const result = chatGPTRequest(source);
  assert.equal(result.store, false); assert.equal(result.stream, true); assert.equal(result.tools[0].type, 'namespace'); assert.equal(result.tools[0].name, 'vb6');
  assert.equal(result.tools[0].tools[0].name, 'ide_project_get');
  for (const unsupported of ['max_output_tokens', 'metadata', 'temperature', 'top_p', 'previous_response_id', 'background', 'conversation']) assert.equal(unsupported in result, false);
  assert.equal(source.max_output_tokens, 1000); assert.equal(source.tools[0].type, 'function');
  assert.throws(() => chatGPTRequest({...source, input: [{role: 'system', content: 'wrong'}]}));
  assert.throws(() => chatGPTRequest({...source, tools: [{type: 'mcp', server_url: 'https://evil.invalid'}]}));
  assert.throws(() => chatGPTRequest({...source, input: 'string'}));
});
test('ChatGPT namespace validation rejects foreign and unqualified calls', () => {
  for (const namespace of [undefined, '', 'shell', 'VB6', 'vb6.bad']) assert.throws(() => validateChatGPTEvent({type: 'response.completed', response: {output: [{type: 'function_call', namespace}]}}));
  const e = {type: 'response.completed', response: {output: [{type: 'function_call', namespace: 'vb6'}]}}; assert.equal(validateChatGPTEvent(e), e);
});
test('ChatGPT models preserve provider ordering, labels, hidden filtering and unique slugs', () => {
  assert.deepEqual(chatGPTModels({models: [{slug: 'z', display_name: 'Zed', visibility: 'list'}, {slug: 'hidden', visibility: 'hide'}, {slug: 'a', visibility: 'list'}, {slug: 'z', visibility: 'list'}, {slug: '../bad', visibility: 'list'}]}), [{id: 'z', label: 'Zed'}, {id: 'a', label: 'a'}]);
  assert.throws(() => chatGPTModels({data: []}));
});
test('ChatGPT transport requires OpenAI + relay + explicit account; never accepts a key instead', () => {
  for (const options of [{provider: 'openai', apiKey: 'key'}, {provider: 'anthropic', relay: 'http://127.0.0.1:1', accountId: 'a'}, {provider: 'openai', relay: 'http://127.0.0.1:1'}]) assert.throws(() => createTransport({...options, authMode: 'chatgpt', relayToken: token}));
});
test('ChatGPT relay routes models and inference with OAuth and no API-key fallback', async t => {
  const f = await relayFixture(t); assert.deepEqual(await listModels(f.transport, 'openai'), ['model-z', 'model-a']);
  assert.deepEqual(await listModels(f.transport, 'openai', undefined, {details: true}), [{id: 'model-z', label: 'Model Z'}, {id: 'model-a', label: 'Model A'}]);
  const collector = responseCollector('openai'); await f.transport(body(), {receive: collector.receive}); assert.equal(collector.result().text, 'Done');
  const req = f.calls.find(x => x.url.endsWith('/responses')); assert.equal(req.headers.Authorization, 'Bearer secret-access-1');
  assert.equal(JSON.parse(req.body).tools[0].name, 'vb6'); assert.equal(JSON.parse(req.body).max_output_tokens, undefined); assert.doesNotMatch(JSON.stringify(req), /api-key-never-fallback|relay-only-secret/);
});
test('ChatGPT relay unauthorized status/login/logout cannot leak identity or trigger OAuth', async t => {
  const f = await relayFixture(t, {login: false});
  for (const op of ['status', 'login', 'logout', 'cancel']) {
    for (const headers of [{Authorization: 'Bearer wrong'}, {Origin: 'https://evil.invalid'}, {Origin: 'null'}, {Host: 'evil.invalid'}]) {
      const r = await f.request({operation: op}, '/agent/chatgpt', headers); assert.ok([401, 403].includes(r.status), JSON.stringify({op, headers, status:r.status})); await r.text();
    }
  }
  assert.equal(f.calls.length, 0);
});
test('ChatGPT relay authenticated status contains no OAuth tokens', async t => {
  const f = await relayFixture(t); const r = await f.request({operation: 'status'}, '/agent/chatgpt'); assert.equal(r.status, 200);
  const text = await r.text(); assert.doesNotMatch(text, /secret-access|secret-refresh|id_token|nonce|verifier/); assert.equal(JSON.parse(text).accounts[0].id, f.id);
});
test('ChatGPT relay unknown account and signed-out session fail closed even with API key', async t => {
  const f = await relayFixture(t); await f.auth.logout(f.id);
  const r = await f.request({provider: 'openai', authMode: 'chatgpt', accountId: f.id, operation: 'generate', body: body()}); assert.equal(r.status, 401);
  assert.equal(f.calls.filter(x => x.url.endsWith('/responses')).length, 0); await assert.rejects(f.transport(body()), /Sign in/);
});
test('ChatGPT relay rejects unsupported provider/auth mode and unsafe control operations', async t => {
  const f = await relayFixture(t);
  for (const data of [{provider: 'openai', authMode: 'invalid', operation: 'models'}, {provider: 'anthropic', authMode: 'chatgpt', accountId: f.id, operation: 'models'}]) { const r = await f.request(data); assert.equal(r.status, 400); await r.text(); }
  const r = await f.request({operation: 'fetch', url: 'https://evil.invalid'}, '/agent/chatgpt'); assert.equal(r.status, 400);
  assert.ok(f.calls.every(x => x.url.startsWith('https://auth.openai.com/')));
});
test('ChatGPT subscription-specific quota pauses instead of auto retry/API fallback', async t => {
  const f = await relayFixture(t); f.state.inference = () => Response.json({error: {code: 'subscription_sharing_usage_limit_exceeded', message: 'secret-provider-error'}}, {status: 429});
  await assert.rejects(f.transport(body()), e => e.kind === 'quota' && e.retryable === false && /ChatGPT/.test(e.message) && !/secret-provider/.test(e.message));
  assert.equal(f.calls.filter(x => x.url.endsWith('/responses')).length, 1);
});
for (const [code, kind, retry] of [['subscription_sharing_user_not_eligible', 'access', false], ['subscription_sharing_unsupported_capability', 'request', false], ['subscription_sharing_usage_unavailable', 'provider', true], ['chatgpt_session_expired', 'access', false]]) test('ChatGPT recovery classifies ' + code, () => {
  const e = providerFailure({error: {code}}, retry ? 503 : 403); assert.equal(e.kind, kind); assert.equal(e.retryable, retry);
});
test('ChatGPT SSE completed tool calls continue with native namespace and outputs', async t => {
  const f = await relayFixture(t); let n = 0;
  f.state.inference = init => { n++; const data = n === 1 ? {type: 'response.completed', response: {status: 'completed', output: [{type: 'function_call', call_id: 'call-one', namespace: 'vb6', name: 'ide_project_get', arguments: '{}'}], usage: {total_tokens: 9}}} : {type: 'response.completed', response: {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Project read.'}]}], usage: {total_tokens: 10}}};
    if (n === 2) { const b = JSON.parse(init.body); assert.equal(b.input.at(-2).namespace, 'vb6'); assert.equal(b.input.at(-1).call_id, 'call-one'); }
    return new Response('data: ' + JSON.stringify(data) + '\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  };
  const history = [{role: 'user', content: 'Read'}], first = responseCollector('openai'); await f.transport({...body(), input: history}, {receive: first.receive});
  const result = first.result(); assert.equal(result.calls[0].name, 'ide_project_get'); appendTurn('openai', history, result, [{call: result.calls[0], result: {name: 'Demo'}}]);
  const second = responseCollector('openai'); await f.transport({...body(), input: history}, {receive: second.receive}); assert.equal(second.result().text, 'Project read.');
});
test('ChatGPT SSE incomplete stream never executes a partial tool', async t => {
  const f = await relayFixture(t); f.state.inference = () => new Response('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  const c = responseCollector('openai'); await f.transport(body(), {receive: c.receive}); assert.throws(c.result, /before completion/);
});
test('ChatGPT mode uses the real permission-gated IDE agent tool loop', async t => {
  const f = await relayFixture(t); const ide = new Signal();
  Object.assign(ide, {project: newProject('PlanAuth'), runState: 'design', history: new History(), breakpoints: [], watches: [], output: [], immediateOutput: [], stack: [], docs: [],
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); }, loadProject(project) { this.project = normalizeProject(project); }, syncBreakpoints() {}, updateWatches() {}, autosave() {}, openDocument() {}, command() {}});
  let approvals = 0; const adapter = createIdeAdapter(ide, {approve: async () => { approvals++; return true; }}), agent = new CodingAgent(adapter);
  t.after(() => { agent.stop(); adapter.dispose(); }); let step = 0;
  f.state.inference = init => {
    const b = JSON.parse(init.body); assert.equal(b.tools[0].type, 'namespace'); assert.equal(b.max_output_tokens, undefined);
    const output = step++ === 0 ? [{type: 'function_call', call_id: 'read', namespace: 'vb6', name: 'ide_project_get', arguments: '{}'}] : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'The project was inspected.'}]}];
    return new Response('data: ' + JSON.stringify({type: 'response.completed', response: {status: 'completed', output, usage: {total_tokens: 8}}}) + '\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  };
  await agent.run({provider: 'openai', model: 'model-z', prompt: 'Read project', transport: f.transport, mode: 'readonly'});
  assert.equal(agent.state, 'completed'); assert.equal(step, 2); assert.equal(approvals, 0); assert.equal(agent.budgetUsed, 16);
});

test('ChatGPT provider output truncation pauses without demanding an unsupported larger cap', async t => {
  const f = await relayFixture(t), ide = new Signal();
  Object.assign(ide, {project: newProject('PlanTruncation'), runState: 'design', history: new History(), breakpoints: [], watches: [], output: [], immediateOutput: [], stack: [], docs: [],
    markDirty() {}, record() {}, loadProject(project) { this.project = normalizeProject(project); }, syncBreakpoints() {}, updateWatches() {}, autosave() {}, openDocument() {}, command() {}});
  const adapter = createIdeAdapter(ide), agent = new CodingAgent(adapter);
  t.after(() => { agent.stop(); adapter.dispose(); }); let step = 0;
  f.state.inference = () => {
    const data = step++ === 0 ? {type: 'response.incomplete', response: {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}, output: [], usage: {total_tokens: 12}}}
      : {type: 'response.completed', response: {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Complete after explicit retry.'}]}], usage: {total_tokens: 8}}};
    return new Response('data: ' + JSON.stringify(data) + '\n\n', {headers: {'Content-Type': 'text/event-stream'}});
  };
  assert.equal(f.transport.capabilities.outputTokenLimit, false);
  await agent.run({provider: 'openai', model: 'model-z', prompt: 'Read project', transport: f.transport, mode: 'readonly', maxTokens: 1024});
  assert.equal(agent.limit.kind, 'output'); assert.equal(agent.usage.calls, 0); assert.equal(step, 1);
  assert.match(agent.limit.message, /does not support increasing/);
  await agent.resume({transport: f.transport, mode: 'readonly', maxTokens: 1024});
  assert.equal(agent.state, 'completed'); assert.equal(agent.budgetUsed, 20); assert.equal(step, 2);
  assert.equal(createTransport({provider: 'openai', apiKey: 'test-only-api-key'}).capabilities.outputTokenLimit, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CodingAgent} from '../src/agents/agent.js';
import {responseCollector} from '../src/agents/providers.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';

const providers = ['openai', 'anthropic', 'google'];
function packet(provider, calls = [], text = 'Done.') {
  if (provider === 'openai') return {status: 'completed', output: [
    {type: 'reasoning', encrypted_content: 'PRIVATE'},
    ...calls.map((c, i) => ({type: 'function_call', call_id: 'c' + i, name: c.name, arguments: JSON.stringify(c.args || {})})),
    {type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}], usage: {total_tokens: 10}};
  if (provider === 'anthropic') return {content: [
    {type: 'thinking', thinking: 'PRIVATE', signature: 'SIGNATURE'},
    ...calls.map((c, i) => ({type: 'tool_use', id: 'c' + i, name: c.name, input: c.args || {}})),
    {type: 'text', text}], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: 8, output_tokens: 2}};
  return {candidates: [{content: {parts: [
    {text: 'PRIVATE', thought: true}, ...calls.map((c, i) => ({functionCall: {id: 'c' + i, name: c.name, args: c.args || {}}, thoughtSignature: 'SIGNATURE'})), {text}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 10}};
}
function truncated(provider) {
  const response = packet(provider, [{name: 'vb6_project_get'}], 'Partial answer.');
  if (provider === 'openai') { response.status = 'incomplete'; response.incomplete_details = {reason: 'max_output_tokens'}; }
  else if (provider === 'anthropic') response.stop_reason = 'max_tokens';
  else response.candidates[0].finishReason = 'MAX_TOKENS';
  return response;
}
function fixture(t, approve = async () => true) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('Recovery'), runState: 'design', docs: [], history: new History(),
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); },
    loadProject(project) { this.project = normalizeProject(project); this.history.reset(); }});
  const adapter = createIdeAdapter(ide, {approve}), agent = new CodingAgent(adapter);
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {ide, adapter, agent};
}
const run = (agent, provider, transport, options = {}) => agent.run({provider, model: 'test-model', prompt: 'Fix this project.', transport, ...options});
const publicState = agent => JSON.stringify({thread: agent.thread.snapshot(), transcript: agent.transcript});
const edit = (f, text = "' one edit\n") => ({name: 'vb6_code_edit', args: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, text, expectedText: ''}]}});

for (const provider of providers) test(`recovery: ${provider} a deferred batch is executed once without requesting the batch again`, async t => {
  let approvals = 0;
  const f = fixture(t, async () => { approvals++; return true; }), before = f.ide.project.modules[0].code;
  const result = await run(f.agent, provider, async (_, {receive}) => receive(packet(provider, [{name: 'vb6_project_get'}, {name: 'vb6_project_get'}])), {maxCalls: 1});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.canResume, true); assert.equal(f.agent.limit.kind, 'calls');
  assert.equal(f.agent.pendingTurn.result.calls.length, 2); assert.equal(f.agent.usage.calls, 0); assert.equal(approvals, 0);
  assert.equal(f.ide.project.modules[0].code, before); assert.ok(!publicState(f.agent).includes('PRIVATE'));
  await assert.rejects(run(f.agent, provider, async () => assert.fail('must not request')), /Continue/);
  let requests = 0;
  await f.agent.resume({maxCalls: 3, transport: async (body, {receive}) => {
    requests++; assert.ok(JSON.stringify(body).includes('PRIVATE')); receive(packet(provider));
  }});
  assert.equal(requests, 1); assert.equal(f.agent.usage.requests, 2); assert.equal(f.agent.usage.tokens, 20);
  assert.equal(f.agent.usage.calls, 2); assert.equal(f.agent.pendingTurn, null); assert.equal(approvals, 0);
  assert.equal(f.ide.project.modules[0].code, before); assert.equal(f.ide.history.undoStack.length, 0);
  assert.equal(f.agent.thread.entries.filter(x => x.kind === 'tool').length, 2);
  assert.equal(f.agent.transcript.filter(x => x.type === 'user').length, 1);
});
for (const provider of providers) test(`recovery: ${provider} token-truncated turns retain public text but never execute partial tools`, async t => {
  const f = fixture(t); let requests = 0;
  const result = await run(f.agent, provider, async (_, {receive}) => { requests++; receive(truncated(provider)); }, {maxTokens: 512});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.limit.kind, 'output'); assert.equal(f.agent.limit.attemptedOutput, 512);
  assert.equal(f.agent.canResume, true); assert.equal(f.agent.usage.tokens, 10); assert.equal(f.agent.usage.calls, 0);
  assert.equal(f.agent.pendingTurn, null); assert.equal(f.agent.history.length, 1);
  assert.ok(publicState(f.agent).includes('Partial answer.')); assert.ok(!publicState(f.agent).includes('PRIVATE'));
  const partial = f.agent.thread.entries.find(x => x.kind === 'assistant'); assert.equal(partial.status, 'interrupted');
  await assert.rejects(f.agent.resume({transport: async () => assert.fail('same cap must not retry')}), /Increase.*output/i);
  await f.agent.resume({maxTokens: 1024, transport: async (body, {receive}) => { requests++; assert.ok(!JSON.stringify(body).includes('Partial answer.')); receive(packet(provider)); }});
  assert.equal(requests, 2); assert.equal(f.agent.usage.tokens, 20); assert.equal(f.agent.state, 'completed');
  assert.equal(f.agent.transcript.filter(x => x.type === 'user').length, 1); assert.equal(partial.status, 'interrupted');
});
test('recovery: context cap before a request is resumable without losing the prompt or billing an attempt', async t => {
  const f = fixture(t); f.ide.project.modules[0].name = 'X'.repeat(100000);
  const result = await run(f.agent, 'openai', async () => assert.fail('oversized request'), {maxContextBytes: 65536});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.limit.kind, 'context'); assert.ok(f.agent.limit.required > 65536);
  assert.equal(f.agent.usage.requests, 0); assert.equal(f.agent.history.length, 1); assert.equal(f.agent.canResume, true);
  await f.agent.resume({maxContextBytes: 1000000, transport: async (body, {receive}) => { assert.equal(body.input.length, 1); receive(packet('openai')); }});
  assert.equal(f.agent.usage.requests, 1); assert.equal(f.agent.transcript.filter(x => x.type === 'user').length, 1);
});
test('recovery: final answer needs no tool-result reservation even when the next request would exceed context', async t => {
  const f = fixture(t);
  const result = await run(f.agent, 'openai', async (_, {receive}) => { const response = packet('openai'); response.output[0].encrypted_content = 'X'.repeat(1500000); receive(response); }, {maxContextBytes: 1500000});
  assert.equal(result.status, 'completed'); assert.equal(f.agent.blocked, false); assert.ok(f.agent.historyBytes > 1500000);
  const next = await run(f.agent, 'openai', async () => assert.fail('oversized follow-up'), {prompt: 'Explain more.'});
  assert.equal(next.status, 'limit'); assert.equal(f.agent.canResume, true);
});
test('recovery: context-limited batch retains native signatures and no calls execute before explicit expansion', async t => {
  const f = fixture(t);
  await run(f.agent, 'openai', async (_, {receive}) => { const response = packet('openai', [{name: 'vb6_project_get'}]); response.output[0].encrypted_content = 'X'.repeat(1500000); receive(response); }, {maxContextBytes: 1500000});
  assert.equal(f.agent.limit.kind, 'context'); assert.equal(f.agent.usage.calls, 0); assert.equal(f.agent.canResume, true);
  const pending = f.agent.pendingTurn; assert.ok(pending); assert.equal(f.agent.history.length, 1);
  const again = await f.agent.resume({transport: async () => assert.fail('must not repeat response')});
  assert.equal(again.status, 'limit'); assert.equal(f.agent.pendingTurn, pending); assert.equal(f.agent.usage.requests, 1);
  await f.agent.resume({maxContextBytes: 4000000, transport: async (body, {receive}) => { assert.equal(body.input[1].encrypted_content.length, 1500000); receive(packet('openai')); }});
  assert.equal(f.agent.usage.calls, 1); assert.equal(f.agent.usage.requests, 2); assert.equal(f.agent.state, 'completed');
});
test('recovery: deferred edits recheck live revisions and do not overwrite intervening work', async t => {
  const f = fixture(t);
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), {name: 'vb6_project_get'}])), {maxCalls: 1});
  f.ide.project.modules[0].code = "' user changed this\n"; f.ide.markDirty();
  await f.agent.resume({maxCalls: 3, transport: async (_, {receive}) => receive(packet('openai'))});
  assert.equal(f.ide.project.modules[0].code, "' user changed this\n"); assert.equal(f.ide.history.undoStack.length, 0);
  assert.ok(f.agent.transcript.some(e => e.type === 'error' && /revision|stale/i.test(e.text)));
});
test('recovery: a denied deferred edit stops the batch permanently rather than granting retry authority', async t => {
  let approvals = 0, requests = 0;
  const f = fixture(t, async () => { approvals++; return false; });
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), {name: 'vb6_project_get'}])), {maxCalls: 1});
  await assert.rejects(f.agent.resume({maxCalls: 5, transport: async (_, {receive}) => {
    assert.equal(++requests, 1); // The old revision fails closed; the next fresh edit must still ask.
    receive(packet('openai', [edit(f)]));
  }}), /Operation denied/);
  assert.equal(approvals, 1); assert.equal(requests, 1);
  assert.equal(f.agent.pendingTurn, null); assert.equal(f.agent.canResume, false); assert.equal(f.ide.history.undoStack.length, 0);
});
test('recovery: a same-ID project replacement invalidates deferred operations', async t => {
  const f = fixture(t);
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), {name: 'vb6_project_get'}])), {maxCalls: 1});
  f.ide.loadProject(structuredClone(f.ide.project)); assert.equal(f.agent.canResume, false);
  await assert.rejects(f.agent.resume({maxCalls: 3, transport: async () => assert.fail('old project')}));
  assert.equal(f.ide.history.undoStack.length, 0); f.agent.reset(); assert.equal(f.agent.pendingTurn, null);
});
test('recovery: unknown tools count against the run limit instead of consuming unbounded attempts', async t => {
  const f = fixture(t);
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [{name: 'nonexistent_tool'}])), {maxCalls: 1});
  assert.equal(f.agent.usage.calls, 1); assert.equal(f.agent.usage.requests, 1); assert.equal(f.agent.limit.kind, 'calls');
});
for (const [block, delta] of [
  [{type: 'thinking', thinking: '', signature: 'SIGNATURE'}, {type: 'text_delta', text: 'PRIVATE'}],
  [{type: 'tool_use', id: 'c', name: 'write', input: {}}, {type: 'text_delta', text: 'NOT-PUBLIC'}],
  [{type: 'text', text: ''}, {type: 'input_json_delta', partial_json: '{}'}]
]) test(`protocol: Anthropic rejects ${delta.type} for a ${block.type} block before rendering`, () => {
  const text = [], collector = responseCollector('anthropic', value => text.push(value));
  collector.receive({type: 'content_block_start', index: 0, content_block: block});
  assert.throws(() => collector.receive({type: 'content_block_delta', index: 0, delta}), /block|stream/i); assert.deepEqual(text, []);
});

for (const provider of providers) test(`recovery: ${provider} completed edits are not replayed when a subsequent batch is deferred`, async t => {
  const f = fixture(t), original = f.ide.project.modules[0].code; let requests = 0;
  await run(f.agent, provider, async (_, {receive}) => receive(packet(provider, ++requests === 1 ? [edit(f)] : [{name: 'vb6_project_get'}, {name: 'vb6_project_get'}])), {maxCalls: 2});
  assert.equal(requests, 2); assert.equal(f.agent.limit.kind, 'calls'); assert.equal(f.agent.usage.calls, 1);
  assert.equal(f.ide.project.modules[0].code, "' one edit\n" + original);
  const history = structuredClone(f.agent.history);
  await f.agent.resume({maxCalls: 3, transport: async (body, {receive}) => {
    requests++; assert.deepEqual((body.input || body.messages || body.contents).slice(0, history.length), history);
    receive(packet(provider));
  }});
  assert.equal(requests, 3); assert.equal(f.ide.history.undoStack.length, 1); assert.equal(f.agent.usage.tokens, 30);
  assert.equal(f.agent.usage.calls, 3); assert.equal(f.agent.pendingTurn, null); assert.equal(f.agent.state, 'completed');
});

for (const index of [-1, 2, 1.5, '0', '__proto__', 4294967294]) test(`protocol: Anthropic rejects non-sequential block index ${index} before allocation or rendering`, () => {
  const text = [], collector = responseCollector('anthropic', value => text.push(value));
  assert.throws(() => collector.receive({type: 'content_block_start', index, content_block: {type: 'text', text: 'not displayed'}}), /block index/);
  assert.deepEqual(text, []);
});
test('recovery: permission changes on Continue cannot restore a deferred write in read-only mode', async t => {
  let approvals = 0;
  const f = fixture(t, async () => { approvals++; return true; }), original = f.ide.project.modules[0].code;
  await run(f.agent, 'openai', async (_, {receive}) => receive(packet('openai', [edit(f), {name: 'vb6_project_get'}])), {maxCalls: 1, mode: 'scoped', scopes: ['code']});
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
  await f.agent.resume({maxCalls: 4, mode: 'readonly', transport: async (body, {receive}) => {
    const results = body.input.filter(item => item.type === 'function_call_output');
    assert.match(JSON.parse(results[0].output).error, /unavailable/); receive(packet('openai'));
  }});
  assert.equal(approvals, 0); assert.equal(f.ide.project.modules[0].code, original); assert.equal(f.agent.usage.calls, 2);
});
test('recovery: an output cap clamped by remaining session budget requires sufficient allowance before retry', async t => {
  const f = fixture(t); f.agent.usage.tokens = 700;
  await run(f.agent, 'openai', async (body, {receive}) => { assert.equal(body.max_output_tokens, 324); receive(truncated('openai')); }, {maxTokens: 512, tokenBudget: 1024});
  assert.equal(f.agent.limit.attemptedOutput, 324);
  await assert.rejects(f.agent.resume({maxTokens: 1024, transport: async () => assert.fail('budget still clamps below old attempt')}), /Increase.*output/i);
  await f.agent.resume({tokenBudget: 2048, transport: async (_, {receive}) => receive(packet('openai'))});
  assert.equal(f.agent.usage.tokens, 720); assert.equal(f.agent.state, 'completed');
});

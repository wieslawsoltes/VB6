import test from 'node:test';
import assert from 'node:assert/strict';
import {CodingAgent} from '../src/agents/agent.js';
import {responseCollector, providerFailure, createTransport, ProviderTransportError} from '../src/agents/providers.js';
import {publicHistory, contextBytes, compactionPrompt} from '../src/agents/context.js';
import {abortableDelay, retryDelay} from '../src/agents/recovery.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';
const providers = ['openai', 'anthropic', 'google'];
const tick = () => new Promise(resolve => setImmediate(resolve));
function packet(provider, calls = [], text = 'Done.', input = 8) {
  if (provider === 'openai') return {status: 'completed', output: [
    {type: 'reasoning', encrypted_content: 'PRIVATE-' + text.length},
    ...calls.map((c, i) => ({type: 'function_call', call_id: 'c' + i, name: c.name, arguments: JSON.stringify(c.args || {})})),
    {type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}], usage: {input_tokens: input, output_tokens: 2, total_tokens: input + 2}};
  if (provider === 'anthropic') return {content: [{type: 'thinking', thinking: 'PRIVATE', signature: 'SECRET-SIGNATURE'},
    ...calls.map((c, i) => ({type: 'tool_use', id: 'c' + i, name: c.name, input: c.args || {}})), {type: 'text', text}], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: input, output_tokens: 2}};
  return {candidates: [{content: {parts: [{text: 'PRIVATE', thought: true},
    ...calls.map((c, i) => ({functionCall: {id: 'c' + i, name: c.name, args: c.args || {}}, thoughtSignature: 'SECRET-SIGNATURE'})), {text}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: input, totalTokenCount: input + 2}};
}
function fixture(t, options = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('Resilience'), runState: 'design', docs: [], history: new History(), markDirty() {},
    record(before, label) { this.history.record(before, this.project, label); }, loadProject(project) { this.project = normalizeProject(project); this.history.reset(); }});
  const adapter = createIdeAdapter(ide, {approve: async () => true}), waits = [];
  const agent = new CodingAgent(adapter, {random: () => 0.5, wait: async (ms, signal) => { waits.push(ms); signal.throwIfAborted(); }, ...options});
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {agent, adapter, ide, waits};
}
const run = (f, provider, transport, options = {}) => f.agent.run({provider, model: 'test-model', prompt: 'Keep the original goal and preserve user edits.', transport, ...options});
const isSummary = body => !body.tools?.length;
const native = body => body.input || body.messages || body.contents;
const visible = agent => JSON.stringify({thread: agent.thread.snapshot(), log: agent.transcript});
const get = {name: 'vb6_project_get'};
const edit = f => ({name: 'vb6_code_edit', args: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, expectedText: '', text: "' exactly once\n"}]}});
async function prepare(f, provider, turns = 4) {
  let n = 0;
  await run(f, provider, async (_, {receive}) => receive(packet(provider, [get], 'Historical report ' + (++n) + '\n' + 'confirmed evidence '.repeat(1600))), {maxTurns: turns, autoCompactTokens: 0});
  assert.equal(f.agent.completeTurns.length, turns);
}
for (const provider of providers) test(`compaction: ${provider} atomic tool-free checkpoint retains native complete pairs, goal, usage and public thread`, async t => {
  const f = fixture(t); await prepare(f, provider);
  const history = structuredClone(f.agent.history), oldTurns = structuredClone(f.agent.completeTurns), before = f.agent.historyBytes;
  const entries = f.agent.thread.snapshot().entries, plan = structuredClone(f.agent.plan), usage = {...f.agent.usage};
  let n = 0;
  await f.agent.compact({transport: async (body, {receive}) => {
    n++; assert.equal(isSummary(body), true); assert.ok(!body.tool_choice);
    assert.ok(!JSON.stringify(body).includes('PRIVATE')); assert.ok(!JSON.stringify(body).includes('SECRET-SIGNATURE'));
    assert.ok(JSON.stringify(body).includes('original goal')); receive(packet(provider, [], 'Confirmed: inspected project. No writes. Next: inspect Form1 and validate the requested change.'));
  }});
  assert.equal(n, 1); assert.equal(f.agent.compactions, 1); assert.ok(f.agent.historyBytes < before);
  assert.equal(f.agent.usage.requests, usage.requests + 1); assert.equal(f.agent.usage.tokens, usage.tokens + 10); assert.equal(f.agent.usage.calls, usage.calls);
  assert.deepEqual(f.agent.plan, plan); assert.deepEqual(f.agent.thread.snapshot().entries.slice(0, entries.length), entries);
  assert.deepEqual(f.agent.history.slice(1), history.slice(oldTurns.at(-3).end));
  assert.ok(JSON.stringify(f.agent.history[0]).includes('original goal')); assert.ok(!visible(f.agent).includes('PRIVATE'));
  assert.equal(f.agent.canResume, true); assert.equal(f.adapter.enabled, false); assert.equal(f.agent.permissionSession.active, false);
});
for (const provider of providers) test(`compaction: ${provider} automatically compacts growing active input, never cumulative session usage`, async t => {
  const f = fixture(t); let normal = 0, summaries = 0;
  await run(f, provider, async (body, {receive}) => {
    if (isSummary(body)) { summaries++; receive(packet(provider, [], 'Inspected project; continue with the user goal.')); }
    else { normal++; receive(packet(provider, normal === 1 ? [get] : [], normal === 1 ? 'Confirmed report. '.repeat(8500) : 'Finished.')); }
  }, {autoCompactTokens: 40000});
  assert.equal(normal, 2); assert.equal(summaries, 1); assert.equal(f.agent.usage.requests, 3); assert.equal(f.agent.usage.calls, 1);
  f.agent.usage.tokens = 1000000;
  await run(f, provider, async (body, {receive}) => { assert.ok(!isSummary(body)); receive(packet(provider)); });
  assert.equal(f.agent.compactions, 1); assert.equal(f.agent.usage.tokens, 1000010);
});
for (const provider of providers) test(`compaction: ${provider} rejected/empty checkpoint leaves native state unchanged and cannot call a tool`, async t => {
  const f = fixture(t); await prepare(f, provider, 1);
  const history = structuredClone(f.agent.history), calls = f.agent.usage.calls;
  for (const bad of [packet(provider, [edit(f)], 'Do this tool.'), packet(provider, [], ''), null]) {
    await f.agent.compact({transport: async (_, {receive}) => { if (bad) receive(bad); else throw new Error('bad checkpoint'); }});
    assert.deepEqual(f.agent.history, history); assert.equal(f.agent.usage.calls, calls); assert.equal(f.agent.compactions, 0);
    assert.equal(f.agent.canResume, true); assert.equal(f.ide.history.undoStack.length, 0);
  }
});
for (const provider of providers) test(`compaction: ${provider} deferred edits remain unexecuted and are not double billed during manual compaction`, async t => {
  const f = fixture(t); await prepare(f, provider, 1);
  await f.agent.resume({maxCalls: 1, transport: async (_, {receive}) => receive(packet(provider, [edit(f), get]))});
  const pending = f.agent.pendingTurn, calls = f.agent.usage.calls; assert.ok(pending);
  await f.agent.compact({transport: async (_, {receive}) => receive(packet(provider, [], 'Read project only. Continue pending work after revision checks.'))});
  assert.equal(f.agent.pendingTurn, pending); assert.equal(f.agent.usage.calls, calls); assert.equal(f.ide.history.undoStack.length, 0);
  let n = 0;
  await f.agent.resume({maxCalls: 3, transport: async (_, {receive}) => { n++; receive(packet(provider)); }});
  assert.equal(n, 1); assert.equal(f.agent.usage.calls, calls + 2); assert.equal(f.agent.pendingTurn, null);
  // The original expectedRevision may now be stale after run authority changes: it must not be silently rewritten.
  assert.ok(f.ide.history.undoStack.length <= 1);
});
for (const provider of providers) test(`retries: ${provider} interrupted streams retry only generation, preserving partial public text without executing partial tools`, async t => {
  const f = fixture(t); let n = 0;
  await run(f, provider, async (_, {receive}) => {
    if (++n > 1) { receive(packet(provider)); return; }
    if (provider === 'openai') receive({type: 'response.output_text.delta', delta: 'Partial public text'});
    else if (provider === 'anthropic') { receive({type: 'content_block_start', index: 0, content_block: {type: 'text', text: 'Partial public text'}}); receive({type: 'content_block_start', index: 1, content_block: {type: 'tool_use', id: 'c', name: 'vb6_code_edit', input: edit(f).args}}); }
    else receive({candidates: [{content: {parts: [{text: 'Partial public text'}, {functionCall: {name: 'vb6_code_edit', args: edit(f).args}}]}}]});
  });
  assert.equal(n, 2); assert.equal(f.agent.usage.calls, 0); assert.equal(f.ide.history.undoStack.length, 0);
  assert.equal(f.waits.length, 1); assert.ok(f.waits[0] >= 750); assert.equal(f.agent.unreportedRequests, 1);
  const assistants = f.agent.thread.entries.filter(e => e.kind === 'assistant');
  assert.equal(assistants.length, 2); assert.equal(assistants[0].status, 'interrupted'); assert.equal(assistants[1].status, 'complete');
  assert.match(assistants[0].text, /Partial public/); assert.ok(!assistants[1].text.includes('Partial'));
});
test('retries: completed mutation followed by server failure is never replayed; each attempt counts once', async t => {
  const f = fixture(t), original = f.ide.project.modules[0].code; let n = 0;
  await run(f, 'openai', async (_, {receive}) => {
    n++; if (n === 1) receive(packet('openai', [edit(f)]));
    else if (n === 2) receive({type: 'response.failed', response: {status: 'failed', error: {code: 'server_error', message: 'PRIVATE-SECRET'}, usage: {total_tokens: 7}}});
    else receive(packet('openai'));
  });
  assert.equal(n, 3); assert.equal(f.ide.project.modules[0].code, "' exactly once\n" + original); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.agent.usage.calls, 1); assert.equal(f.agent.usage.tokens, 27); assert.ok(!visible(f.agent).includes('PRIVATE-SECRET'));
});
test('retries: bounded exhaustion offers Continue, preserves history, and honors Retry-After on that fresh run', async t => {
  // Model elapsed time explicitly. A real scheduler need not resume this test
  // within 10 ms when the full repository suite is running concurrently.
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture(t); let n = 0;
  await assert.rejects(run(f, 'openai', async () => { n++; throw new ProviderTransportError('Unavailable', {retryable: true, retryAfterMs: 5000}); }, {maxRetries: 2}));
  assert.equal(n, 3); assert.equal(f.agent.canResume, true); assert.equal(f.agent.blocked, false);
  assert.equal(f.agent.history.length, 1); assert.equal(f.agent.usage.requests, 3); assert.equal(f.agent.unreportedRequests, 3);
  assert.deepEqual(f.waits, [5000, 5000]);
  now += 1250; // A manually confirmed Continue must honor only the remaining cooldown.
  await f.agent.resume({transport: async (_, {receive}) => receive(packet('openai'))});
  assert.equal(f.waits.length, 3); assert.equal(f.waits[2], 3750); assert.equal(f.agent.usage.requests, 4); assert.equal(f.agent.history.filter(x => x.role === 'user').length, 1);
});
test('retries: per-run request cap wins over retry count and a missing usage attempt is accounted', async t => {
  const f = fixture(t); let n = 0;
  const result = await run(f, 'openai', async () => { n++; throw new ProviderTransportError('Unavailable', {retryable: true}); }, {maxTurns: 2, maxRetries: 10});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.limit.kind, 'requests'); assert.equal(n, 2);
  assert.equal(f.agent.usage.requests, 2); assert.equal(f.agent.unreportedRequests, 2); assert.ok(f.agent.estimatedTokens > 0);
});
for (const action of ['stop', 'reload', 'expire']) test(`retries: ${action} during backoff cancels promptly without another request or permission renewal`, async t => {
  let waiting; const f = fixture(t, {wait: (ms, signal) => { waiting = true; return abortableDelay(ms, signal); }}); let n = 0;
  const pending = run(f, 'openai', async () => { n++; throw new ProviderTransportError('Unavailable', {retryable: true, retryAfterMs: 60000}); });
  while (!waiting) await tick();
  if (action === 'stop') f.agent.stop(); else if (action === 'reload') f.ide.loadProject(structuredClone(f.ide.project)); else f.agent.permissionSession.revoke('Permission lease expired.');
  await assert.rejects(pending); assert.equal(n, 1); assert.equal(f.agent.busy, false); assert.equal(f.agent.canResume, false); assert.equal(f.agent.permissionSession.active, false);
});
test('compaction: provider context overflow triggers one staged recovery, repeated overflow pauses without looping', async t => {
  const f = fixture(t); await prepare(f, 'openai', 1); let normals = 0, summaries = 0;
  const result = await f.agent.resume({maxTurns: 8, autoCompactTokens: 1000000, transport: async (body, {receive}) => {
    if (isSummary(body)) { summaries++; receive(packet('openai', [], 'Project inspected. Continue remaining task; verify current revisions.')); }
    else { normals++; receive({type: 'response.failed', response: {status: 'failed', error: {code: 'context_length_exceeded'}, usage: {total_tokens: 1}}}); }
  }});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.limit.kind, 'context'); assert.equal(normals, 2); assert.equal(summaries, 1); assert.equal(f.agent.usage.calls, 1);
});
test('compaction: failed checkpoint preserves a validated deferred batch exactly', async t => {
  const f = fixture(t); await prepare(f, 'openai', 1);
  await f.agent.resume({maxCalls: 1, transport: async (_, {receive}) => receive(packet('openai', [get, get]))});
  const pending = f.agent.pendingTurn, history = structuredClone(f.agent.history);
  await f.agent.compact({maxRetries: 0, transport: async () => { throw new ProviderTransportError('Offline', {retryable: true}); }});
  assert.equal(f.agent.pendingTurn, pending); assert.deepEqual(f.agent.history, history); assert.equal(f.agent.canResume, true);
});
test('compaction: Stop during a summary retains original context and ignores a late checkpoint', async t => {
  const f = fixture(t); await prepare(f, 'openai', 1); const before = structuredClone(f.agent.history); let release;
  const pending = f.agent.compact({transport: async (_, {receive}) => { await new Promise(resolve => { release = resolve; }); receive(packet('openai', [], 'Too late.')); }});
  while (!release) await tick(); f.agent.stop(); release(); await assert.rejects(pending);
  assert.deepEqual(f.agent.history, before); assert.equal(f.agent.compactions, 0); assert.equal(f.agent.permissionSession.active, false);
});
test('compaction: no history or a changed project cannot be compacted; Full access is reconfirmed', async t => {
  const f = fixture(t); await assert.rejects(f.agent.compact({transport: async () => assert.fail('no request')}));
  await prepare(f, 'openai', 1);
  await assert.rejects(f.agent.compact({mode: 'full', transport: async () => assert.fail('no unconfirmed request')}), /confirmation/);
  f.ide.loadProject(structuredClone(f.ide.project)); assert.equal(f.agent.canCompact, false);
  await assert.rejects(f.agent.compact({transport: async () => assert.fail('wrong project')}));
});
for (const [code, expected, retryable] of [['server_error', 'server', true], ['overloaded_error', 'server', true], ['UNAVAILABLE', 'server', true], ['rate_limit_error', 'rate', true], ['insufficient_quota', 'quota', false], ['authentication_error', 'access', false], ['content_policy_violation', 'safety', false], ['context_length_exceeded', 'context', false]])
  test(`provider errors: ${code} is classified without echoing upstream data`, () => {
    const e = providerFailure({error: {code, message: 'PRIVATE-SECRET', request_id: 'PRIVATE-SECRET'}});
    assert.equal(e.kind, expected); assert.equal(e.retryable, retryable); assert.ok(!JSON.stringify(e).includes('PRIVATE')); assert.ok(!e.message.includes('PRIVATE'));
  });
test('provider errors: quota HTTP 429 does not auto-retry, transient HTTP 429 retries, and Anthropic context wording is recognized safely', async () => {
  for (const code of ['insufficient_quota', 'rate_limit_exceeded']) {
    const transport = createTransport({provider: 'openai', apiKey: 'SECRET', fetchImpl: async () => new Response(JSON.stringify({error: {code, message: 'SECRET'}}), {status: 429, headers: {'retry-after': '3'}})});
    await assert.rejects(transport({model: 'test-model'}), error => error.status === 429 && error.retryable === (code === 'rate_limit_exceeded') && error.retryAfterMs === 3000 && !error.message.includes('SECRET'));
  }
  assert.equal(providerFailure({error: {type: 'invalid_request_error', message: 'prompt is too long: PRIVATE'}}).kind, 'context');
});
test('provider errors: an unclassified valid response.failed remains manually recoverable, not an automatic retry loop', async t => {
  const f = fixture(t); let n = 0;
  await assert.rejects(run(f, 'openai', async (_, {receive}) => { n++; receive({type: 'response.failed', response: {status: 'failed', error: {code: 'unexpected_provider_condition'}}}); }));
  assert.equal(n, 1); assert.equal(f.agent.canResume, true); assert.equal(f.agent.blocked, false);
});
test('provider errors: malformed JSON is not reclassified as an interrupted transport', async () => {
  const transport = createTransport({provider: 'openai', apiKey: 'SECRET', fetchImpl: async () => new Response('data: {bad-json}\n\n', {headers: {'content-type': 'text/event-stream'}})});
  await assert.rejects(transport({model: 'test-model'}), error => !(error instanceof ProviderTransportError) && /Malformed/.test(error.message));
});
test('provider errors: a read-side network failure has safe retryable metadata', async () => {
  const transport = createTransport({provider: 'openai', apiKey: 'SECRET', fetchImpl: async () => new Response(new ReadableStream({start(controller) { controller.error(new Error('SECRET')); }}), {headers: {'content-type': 'text/event-stream'}})});
  await assert.rejects(transport({model: 'test-model'}), error => error.retryable && error.kind === 'stream' && !error.message.includes('SECRET'));
});
test('context estimates: provider input usage is separate from output and cumulative totals', () => {
  for (const provider of providers) { const c = responseCollector(provider); c.receive(packet(provider, [], 'Done.', 120)); assert.equal(c.usage().inputTokens, 120); assert.equal(c.usage().tokens, 122); }
});
test('context projection and prompt byte bound are Unicode safe and exclude native reasoning recursively', () => {
  const history = [{role: 'user', content: 'Goal'}, {type: 'reasoning', encrypted_content: 'PRIVATE'}, {type: 'message', role: 'assistant', content: [{type: 'output_text', text: '😀'.repeat(100000)}]}];
  const records = publicHistory('openai', history); assert.ok(!JSON.stringify(records).includes('PRIVATE'));
  const prompt = compactionPrompt('openai', history, {goal: 'Goal', latestPrompt: 'Next', plan: {}}, 4096);
  assert.ok(contextBytes(prompt) < 5000); assert.ok(prompt.includes('omittedRecords'));
});
test('retry delay is bounded, jittered, and never shorter than Retry-After; aborted delay does not allocate a wait', async () => {
  assert.equal(retryDelay(0, 0, () => 0), 750); assert.equal(retryDelay(0, 5000, () => 1), 5000);
  assert.ok(retryDelay(100, 0, () => 1) <= 37500);
  const controller = new AbortController(); controller.abort(); await assert.rejects(async () => abortableDelay(60000, controller.signal));
});
for (const code of ['invalid_api_key', 'insufficient_quota', 'invalid_request_error']) test(`recovery: ${code} retains task for manual configuration repair without automatic retries`, async t => {
  const f = fixture(t); let n = 0;
  await assert.rejects(run(f, 'openai', async (_, {receive}) => { n++; receive({error: {code, message: 'SECRET'}}); }));
  assert.equal(n, 1); assert.equal(f.agent.canResume, true); assert.equal(f.waits.length, 0); const history = structuredClone(f.agent.history);
  await f.agent.resume({transport: async (body, {receive}) => { assert.deepEqual(native(body), history); receive(packet('openai')); }});
  assert.equal(f.agent.state, 'completed'); assert.ok(!visible(f.agent).includes('SECRET'));
});
test('recovery: provider safety rejection remains blocked without alternative attempts', async t => {
  const f = fixture(t); let n = 0;
  await assert.rejects(run(f, 'openai', async (_, {receive}) => { n++; receive({error: {code: 'content_policy_violation'}}); }));
  assert.equal(n, 1); assert.equal(f.agent.canResume, false);
});
test('recovery: long Retry-After is not shortened by the bounded display advice or a new permission lease', async t => {
  const f = fixture(t); let n = 0;
  const transport = createTransport({provider: 'openai', apiKey: 'SECRET', fetchImpl: async () => { n++; return new Response('{}', {status: 429, headers: {'retry-after': '3600'}}); }});
  await assert.rejects(run(f, 'openai', transport)); assert.equal(n, 1); assert.equal(f.agent.canResume, true);
  assert.ok(f.agent.retryAt > Date.now() + 3500000); assert.equal(f.waits.length, 0);
  const result = await f.agent.resume({transport: async () => assert.fail('cooldown not elapsed')});
  assert.equal(result.status, 'limit'); assert.equal(f.agent.limit.kind, 'cooldown'); assert.equal(f.agent.permissionSession.active, false);
});
test('recovery: retry attempts keep the same permission session and its original expiry', async t => {
  const f = fixture(t); let lease, expiry, n = 0;
  await run(f, 'openai', async (_, {receive}) => {
    if (++n === 1) { lease = f.agent.permissionSession; expiry = lease.expiresAt; throw new ProviderTransportError('Offline', {retryable: true}); }
    assert.equal(f.agent.permissionSession, lease); assert.equal(lease.expiresAt, expiry); receive(packet('openai'));
  });
  assert.equal(n, 2); assert.equal(lease.active, false);
});
test('compaction: checkpoint does not clear a previous output-truncation safety floor', async t => {
  const f = fixture(t); await prepare(f, 'openai', 1);
  await f.agent.resume({maxTokens: 512, transport: async (_, {receive}) => receive({status: 'incomplete', output: [], incomplete_details: {reason: 'max_output_tokens'}, usage: {total_tokens: 10}})});
  assert.equal(f.agent.limit.kind, 'output');
  await f.agent.compact({transport: async (_, {receive}) => receive(packet('openai', [], 'Inspected project. The last request was truncated, not executed.'))});
  assert.equal(f.agent.compactions, 1);
  await assert.rejects(f.agent.resume({transport: async () => assert.fail('must raise output cap first')}), /Increase the output/);
});
test('provider output: non-public OpenAI message parts cannot leak through the final text collector', () => {
  const c = responseCollector('openai'); const value = packet('openai');
  value.output.at(-1).content.push({type: 'reasoning', text: 'PRIVATE'}); c.receive(value);
  assert.ok(!c.result().text.includes('PRIVATE'));
});

test('compaction: a safety rejection stops the task, retains old context and cannot auto-retry', async t => {
  const f = fixture(t); await prepare(f, 'openai', 1); const before = structuredClone(f.agent.history); let n = 0;
  await assert.rejects(f.agent.compact({transport: async (_, {receive}) => { n++; receive({error: {code: 'content_policy_violation'}}); }}));
  assert.equal(n, 1); assert.equal(f.agent.canResume, false); assert.equal(f.agent.canCompact, false);
  assert.deepEqual(f.agent.history, before); assert.equal(f.agent.permissionSession.active, false);
});

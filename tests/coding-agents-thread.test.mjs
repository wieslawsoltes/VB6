import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentThread} from '../src/agents/thread.js';
import {AGENT_LIMIT_FIELDS, DEFAULT_AGENT_LIMITS, AGENT_LIMIT_PRESETS, normalizeAgentLimits, loadAgentLimits, saveAgentLimits} from '../src/agents/limits.js';
import {responseCollector, createTransport, ProviderTransportError} from '../src/agents/providers.js';
const event = (thread, type, text = '', extra = {}) => thread.apply({type, text, requestId: 'r1', time: '2026-10-05T00:00:00Z', ...extra});

test('thread: a waiting request is visible before text, then deltas reconcile into one authoritative reply', () => {
  const thread = new AgentThread(); event(thread, 'user', 'Inspect Form1'); event(thread, 'status', 'Request 1');
  assert.equal(thread.entries.at(-1).status, 'waiting');
  event(thread, 'delta', 'Reading '); const item = thread.entries.at(-1);
  event(thread, 'delta', 'the source.'); assert.equal(item.text, 'Reading the source.');
  event(thread, 'assistant', 'Reading the source.'); event(thread, 'idle');
  assert.equal(thread.entries.filter(x => x.kind === 'assistant').length, 1);
  assert.equal(thread.entries.at(-1), item); assert.equal(item.status, 'complete');
});
test('thread: tool-only turns, approval, result and reused provider IDs are paired per request', () => {
  const thread = new AgentThread(); event(thread, 'status'); event(thread, 'response', 'Prepared 1 tool operation.');
  event(thread, 'tool', 'vb6.project.get', {callId: 'c1', arguments: {module: 'Form1'}});
  const tool = thread.entries.at(-1); assert.equal(tool.status, 'running');
  event(thread, 'approval', 'Review this operation', {callId: 'c1'}); assert.equal(tool.status, 'approval');
  event(thread, 'approval-result', 'Allowed once', {callId: 'c1', allowed: true});
  event(thread, 'result', 'Completed', {callId: 'c1', result: {revision: 3}}); assert.equal(tool.status, 'complete');
  event(thread, 'status', '', {requestId: 'r2'});
  event(thread, 'tool', 'vb6.project.compile', {requestId: 'r2', callId: 'c1'});
  assert.equal(thread.entries.filter(x => x.kind === 'tool').length, 2); assert.equal(tool.status, 'complete');
  assert.equal(JSON.parse(tool.result).revision, 3);
});
test('thread: stop and retry preserve partial public replies without treating them as final answers', () => {
  const thread = new AgentThread(); event(thread, 'status'); event(thread, 'delta', 'Partial answer');
  event(thread, 'error', 'Connection lost'); event(thread, 'retry', 'Retry available'); event(thread, 'idle');
  const partial = thread.entries.find(x => x.kind === 'assistant'); assert.equal(partial.text, 'Partial answer'); assert.equal(partial.status, 'interrupted');
  event(thread, 'status', '', {requestId: 'r2'}); event(thread, 'assistant', 'Final answer', {requestId: 'r2'});
  assert.equal(thread.entries.filter(x => x.kind === 'assistant').length, 2); assert.equal(partial.text, 'Partial answer');
  assert.equal(thread.snapshot().entries.find(x => x.text === 'Partial answer').status, 'interrupted');
});
test('thread: denied and interrupted tools cannot be displayed as completed', () => {
  const thread = new AgentThread(); event(thread, 'tool', 'write', {callId: 'c1'});
  event(thread, 'approval-result', 'Denied', {callId: 'c1', allowed: false}); event(thread, 'error', 'Operation denied', {callId: 'c1'}); event(thread, 'idle');
  assert.equal(thread.entries.find(x => x.kind === 'tool').status, 'denied');
  event(thread, 'tool', 'read', {callId: 'c2'}); event(thread, 'idle');
  assert.equal(thread.entries.at(-1).status, 'interrupted');
});
test('thread: public plans and question/answer order are visible but not authorization', () => {
  const thread = new AgentThread(); event(thread, 'question', 'Which form?'); event(thread, 'answer', 'Customer');
  event(thread, 'plan', 'Updated plan', {plan: {steps: [{status: 'in_progress', title: 'Inspect source'}]}});
  assert.equal(thread.entries[0].kind, 'question'); assert.equal(thread.entries[1].label, 'Your answer');
  assert.match(thread.entries[2].text, /in_progress: Inspect source/); assert.match(thread.entries[2].note, /not independent validation/);
});
test('thread: entry, text and aggregate memory bounds hold even for adversarial detail strings', () => {
  const thread = new AgentThread({maxEntries: 4, maxCharacters: 2000, maxMessageCharacters: 1000});
  for (let i = 0; i < 20; i++) event(thread, 'user', 'x'.repeat(800));
  assert.ok(thread.entries.length <= 4); assert.ok(thread.characters <= 2000); assert.ok(thread.omitted > 0);
  event(thread, 'tool', 'x'.repeat(9999), {arguments: {data: 'y'.repeat(9999)}});
  event(thread, 'result', 'z'.repeat(9999), {result: {data: 'q'.repeat(9999)}});
  assert.ok(thread.characters <= 2000); assert.ok(thread.entries.at(-1).truncated);
  assert.equal(thread.characters, thread.entries.reduce((n, item) => n + item.size, 0));
  const tiny = new AgentThread({maxEntries: 1, maxCharacters: 1, maxMessageCharacters: 1}); event(tiny, 'user', 'large'); assert.equal(tiny.characters, 1);
});
test('thread: saturated deltas and large final replies retain explicit truncation, without native data', () => {
  const thread = new AgentThread({maxMessageCharacters: 10}); event(thread, 'status'); event(thread, 'delta', 'hello world!');
  event(thread, 'delta', 'extra'); event(thread, 'assistant', 'hello world!');
  assert.equal(thread.entries.at(-1).text, 'hello worl'); assert.ok(thread.entries.at(-1).truncated);
  event(thread, 'reasoning', 'PRIVATE'); event(thread, 'signature', 'SECRET');
  assert.ok(!JSON.stringify(thread.snapshot()).includes('PRIVATE')); assert.ok(!JSON.stringify(thread.snapshot()).includes('SECRET'));
});
test('limits: extended defaults and large preset raise budgets independently from model output limits', () => {
  assert.equal(DEFAULT_AGENT_LIMITS.tokenBudget, 200000 * 20); assert.equal(DEFAULT_AGENT_LIMITS.maxTurns, 128);
  assert.equal(DEFAULT_AGENT_LIMITS.maxTokens, 32768); assert.equal(DEFAULT_AGENT_LIMITS.maxContextBytes, 6000000);
  assert.equal(DEFAULT_AGENT_LIMITS.requestTimeoutMs, 600000);
  assert.equal(AGENT_LIMIT_PRESETS.large.limits.tokenBudget, 20000000);
  assert.equal(normalizeAgentLimits({tokenBudget: 100000000}).maxTokens, 32768);
  assert.deepEqual(normalizeAgentLimits({}), DEFAULT_AGENT_LIMITS);
});
for (const [key, field] of Object.entries(AGENT_LIMIT_FIELDS)) test('limits: ' + key + ' validates every public bound and integer input', () => {
  for (const value of [field.min, field.max]) assert.equal(normalizeAgentLimits({[key]: value})[key], value);
  for (const value of [field.min - 1, field.max + 1, NaN, Infinity, '9999', false, 1.5]) assert.throws(() => normalizeAgentLimits({[key]: value}), /Invalid agent limit/);
});
test('limits: persistence saves only numeric preferences, survives denial, and rejects corrupt storage', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  let stored;
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {setItem(key, value) { assert.equal(key, 'vb6.codingAgents.limits.v1'); stored = value; }, getItem() { return stored; }}});
  const limits = saveAgentLimits({...DEFAULT_AGENT_LIMITS, tokenBudget: 9999999, apiKey: 'PRIVATE', history: 'SECRET', permissions: ['write']});
  assert.deepEqual(loadAgentLimits(), limits); assert.ok(!stored.includes('PRIVATE')); assert.ok(!stored.includes('SECRET')); assert.ok(!stored.includes('permissions'));
  for (const bad of ['bad-json', '{"version":2}', '{"version":1,"limits":{"tokenBudget":-1}}']) { stored = bad; assert.deepEqual(loadAgentLimits(), DEFAULT_AGENT_LIMITS); }
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('Denied'); }});
  assert.deepEqual(loadAgentLimits(), DEFAULT_AGENT_LIMITS); assert.deepEqual(saveAgentLimits({}), DEFAULT_AGENT_LIMITS);
});
test('usage: incomplete OpenAI response usage is captured before failure and private data never streams', () => {
  const text = [], collector = responseCollector('openai', delta => text.push(delta));
  assert.throws(() => collector.receive({type: 'response.incomplete', response: {status: 'incomplete', usage: {total_tokens: 456}, output: [{type: 'reasoning', encrypted_content: 'PRIVATE'}]}}), /could not complete/);
  assert.deepEqual(collector.usage(), {tokens: 456, usageReported: true}); assert.deepEqual(text, []);
});
test('usage: Anthropic initial public text and cumulative usage include cache tokens without exposing thinking', () => {
  const text = [], collector = responseCollector('anthropic', delta => text.push(delta));
  collector.receive({type: 'message_start', message: {usage: {input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30}}});
  collector.receive({type: 'content_block_start', index: 0, content_block: {type: 'text', text: 'Hello'}});
  collector.receive({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: ' world'}});
  collector.receive({type: 'content_block_start', index: 1, content_block: {type: 'thinking', thinking: 'PRIVATE', signature: 'SECRET'}});
  collector.receive({type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 5}});
  collector.receive({type: 'message_stop'});
  assert.equal(text.join(''), 'Hello world'); assert.equal(collector.result().text, 'Hello world'); assert.equal(collector.usage().tokens, 65);
});
test('usage: Google thought tokens count once and missing usage remains explicitly unknown', () => {
  const collector = responseCollector('google'); assert.deepEqual(collector.usage(), {tokens: 0, usageReported: false});
  collector.receive({candidates: [{content: {parts: [{text: 'Hello'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3, cachedContentTokenCount: 5}});
  assert.equal(collector.result().tokens, 15);
});
test('transport: configured generation timeout and relay envelope are distinct from catalog timeout and native body', async t => {
  const durations = [], requests = [];
  t.mock.method(AbortSignal, 'timeout', ms => { durations.push(ms); return new AbortController().signal; });
  const transport = createTransport({provider: 'openai', relay: 'http://127.0.0.1:4892', relayToken: 'local-token', requestTimeoutMs: 900000, fetchImpl: async (_, options) => { requests.push(JSON.parse(options.body)); return new Response('{}'); }});
  await transport({model: 'test-model'}, {}); await transport(null, {models: true});
  assert.deepEqual(durations, [900000, 120000]); assert.equal(requests[0].requestTimeoutMs, 900000); assert.equal(requests[0].body.requestTimeoutMs, undefined);
  assert.equal(requests[1].requestTimeoutMs, 120000);
});
test('transport: timeout after a public delta is retryable and cancels the stream without dropping text', async t => {
  const timer = new AbortController(); t.mock.method(AbortSignal, 'timeout', () => timer.signal);
  let cancelled = false; const text = [];
  const transport = createTransport({provider: 'openai', apiKey: 'test-key', fetchImpl: async () => new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')); }, cancel() { cancelled = true; }}), {headers: {'content-type': 'text/event-stream'}})});
  await assert.rejects(transport({model: 'test-model'}, {receive(data) { text.push(data.delta); timer.abort(new DOMException('Timeout', 'TimeoutError')); }}), error => error instanceof ProviderTransportError && error.retryable);
  assert.deepEqual(text, ['Partial']); assert.ok(cancelled);
});
test('thread: stopping at the history bound marks every retained operation interrupted', () => {
  const thread = new AgentThread({maxCharacters: 920});
  event(thread, 'user', 'old'.repeat(40)); event(thread, 'status', 'waiting');
  event(thread, 'delta', 'stream text'); event(thread, 'tool', 'some.tool', {callId: 'c', arguments: {}});
  event(thread, 'idle');
  assert.ok(thread.omitted > 0); assert.equal(thread.entries.length, 2);
  assert.ok(thread.entries.every(item => item.status === 'interrupted'));
  assert.equal(thread.characters, thread.entries.reduce((sum, item) => sum + item.size, 0));
});

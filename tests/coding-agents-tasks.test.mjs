import test from 'node:test';
import assert from 'node:assert/strict';
import {CodingAgent} from '../src/agents/agent.js';
import {AgentConversations} from '../src/agents/conversations.js';
import {ProviderTransportError, createTransport, retryAfter} from '../src/agents/providers.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, normalizeProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';

const providers = ['openai', 'anthropic', 'google'];
const tick = () => new Promise(resolve => setImmediate(resolve));
function packet(provider, calls = [], text = 'Done.') {
  if (provider === 'openai') return {status: 'completed', output: [...calls.map((c, i) => ({type: 'function_call', call_id: 'call' + i, name: c.name, arguments: JSON.stringify(c.args || {})})), {type: 'reasoning', encrypted_content: 'private-signature', summary: []}, {type: 'message', role: 'assistant', phase: 'final_answer', content: [{type: 'output_text', text}]}], usage: {total_tokens: 10}};
  if (provider === 'anthropic') return {content: [{type: 'thinking', thinking: 'private-thought', signature: 'private-signature'}, ...calls.map((c, i) => ({type: 'tool_use', id: 'call' + i, name: c.name, input: c.args || {}})), {type: 'text', text}], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: 8, output_tokens: 2}};
  return {candidates: [{content: {parts: [...calls.map((c, i) => ({functionCall: {id: 'call' + i, name: c.name, args: c.args || {}}, thoughtSignature: 'private-signature'})), {text, thoughtSignature: 'private-text-signature'}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 10}};
}
function fixture(t, options = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('TaskTests'), runState: 'design', docs: [], history: new History(),
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); },
    loadProject(project) { this.project = normalizeProject(project); this.history.reset(); }});
  let approvals = 0;
  const adapter = createIdeAdapter(ide, {approve: async () => { approvals++; return options.approve !== false; }});
  const conversations = new AgentConversations(adapter, options);
  t.after(() => { conversations.agent.stop(); adapter.dispose(); });
  return {ide, adapter, conversations, get agent() { return conversations.agent; }, approvals: () => approvals};
}
const run = (agent, transport, provider = 'openai', rest = {}) => agent.run({provider, model: 'test-model', prompt: 'Implement the task.', transport, ...rest});
const reply = provider => async (_, {receive}) => receive(packet(provider));
const output = (provider, body) => provider === 'openai' ? JSON.parse(body.input.at(-1).output) : provider === 'anthropic' ? JSON.parse(body.messages.at(-1).content[0].content) : body.contents.at(-1).parts[0].functionResponse.response;

for (const provider of providers) test(`tasks: ${provider} resumes a limited task without a duplicate prompt or applied edit`, async t => {
  const f = fixture(t), original = f.ide.project.modules[0].code;
  await run(f.agent, async (_, {receive}) => receive(packet(provider, [{name: 'vb6_code_edit', args: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, text: "' once\n", expectedText: ''}]}}])), provider, {maxTurns: 1});
  assert.equal(f.agent.state, 'limit'); assert.equal(f.agent.canResume, true);
  const before = structuredClone(f.agent.history);
  await f.agent.resume({transport: async (body, {receive}) => {
    const history = body.input || body.messages || body.contents;
    assert.deepEqual(history, before); assert.equal(output(provider, body).revision > 0, true);
    assert.ok(JSON.stringify(history).includes('private-signature'));
    receive(packet(provider));
  }});
  assert.equal(f.ide.project.modules[0].code, "' once\n" + original); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.agent.transcript.filter(e => e.type === 'user').length, 1);
  assert.deepEqual(f.agent.usage, {requests: 2, tokens: 20, calls: 1}); assert.equal(f.approvals(), 1);
  assert.equal(f.agent.canResume, false); assert.equal(f.agent.state, 'completed');
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
});
for (const provider of providers) test(`tasks: ${provider} explicit retry keeps native tool results and does not auto-retry`, async t => {
  const f = fixture(t), original = f.ide.project.modules[0].code; let requests = 0;
  const transport = async (_, {receive}) => {
    requests++;
    if (requests === 1) receive(packet(provider, [{name: 'vb6_module_write', args: {module: 'Form1', code: "' once\n" + original, expectedRevision: f.adapter.revision}}]));
    else throw new ProviderTransportError('Provider HTTP 429.', {status: 429, retryable: true, retryAfterMs: 2000});
  };
  await assert.rejects(run(f.agent, transport, provider), /429/);
  assert.equal(requests, 2); assert.equal(f.agent.state, 'retry'); assert.equal(f.agent.blocked, false);
  assert.equal(f.agent.canResume, true); assert.equal(f.agent.failure.retryAfterMs, 2000);
  assert.equal(f.adapter.enabled, false); assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
  await f.agent.resume({transport: async (body, {receive}) => { assert.ok(output(provider, body).revision); receive(packet(provider)); }});
  assert.equal(f.ide.project.modules[0].code, "' once\n" + original); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.approvals(), 1);
});
for (const provider of providers) test(`tasks: ${provider} switch preserves signed context but not workspace grants`, async t => {
  const f = fixture(t), first = f.conversations.activeId;
  await run(f.agent, reply(provider), provider, {mode: 'scoped', scopes: ['code']});
  const native = structuredClone(f.agent.history), beforeEpoch = f.adapter.workspaceEpoch;
  const second = f.conversations.create('Other task'); await run(f.agent, reply(provider), provider);
  assert.notEqual(first, second.id); assert.equal(f.adapter.workspaceEpoch, beforeEpoch);
  f.conversations.select(first); assert.deepEqual(f.agent.history, native); assert.equal(f.agent.matchesWorkspace(), true);
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
  await run(f.agent, async (body, {receive}) => { assert.ok(JSON.stringify(body).includes('private-')); receive(packet(provider)); }, provider, {prompt: 'Follow up.'});
  assert.equal(f.conversations.tasks.get(second.id).agent.transcript.filter(e => e.type === 'user').length, 1);
  assert.notEqual(f.agent.sessionKey, second.agent.sessionKey);
  const handoff = f.conversations.handoff(); assert.ok(handoff.includes('Follow up.'));
  assert.ok(!handoff.includes('private-signature')); assert.ok(!handoff.includes('private-thought')); assert.ok(!handoff.includes('final_answer'));
});

test('tasks: same-ID project reload invalidates every archived native conversation', async t => {
  const f = fixture(t), first = f.conversations.activeId;
  await run(f.agent, reply('openai')); f.conversations.create('Second'); await run(f.agent, reply('openai'));
  f.ide.loadProject(structuredClone(f.ide.project));
  for (const task of f.conversations.list()) assert.equal(task.currentWorkspace, false);
  f.conversations.select(first); assert.equal(f.agent.canResume, false);
  await assert.rejects(run(f.agent, reply('openai')), /new task/);
  const fresh = f.conversations.create(); await run(fresh.agent, reply('openai'));
});
test('tasks: concurrent agents sharing one adapter cannot revoke each other or switch tasks', async t => {
  const f = fixture(t); let release;
  const first = f.agent, second = f.conversations.create('Second');
  f.conversations.select([...f.conversations.tasks.keys()][0]);
  const pending = run(first, (_, {receive}) => new Promise(resolve => { release = () => { receive(packet('openai')); resolve(); }; }));
  while (!release) await tick();
  for (const action of [() => f.conversations.create(), () => f.conversations.select(second.id), () => f.conversations.remove(second.id), () => f.conversations.rename(second.id, 'Changed'), () => f.conversations.handoff(), () => f.conversations.clear()]) assert.throws(action, /Stop/);
  await assert.rejects(run(second.agent, reply('openai')), /already running/); assert.equal(f.adapter.enabled, true);
  release(); await pending;
  await run(second.agent, reply('openai'));
});
test('tasks: denial and cancellation never become resumable retries', async t => {
  const f = fixture(t, {approve: false});
  await assert.rejects(run(f.agent, async (_, {receive}) => receive(packet('openai', [{name: 'vb6_module_write', args: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}]))), /denied/);
  assert.equal(f.agent.canResume, false); await assert.rejects(f.agent.resume({transport: reply('openai')}), /new task/);
  f.conversations.create();
  const pending = run(f.agent, (_, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true})));
  f.agent.stop(); await assert.rejects(pending); assert.equal(f.agent.canResume, false);
});
test('tasks: malformed provider response stays blocked even when a previous batch succeeded', async t => {
  const f = fixture(t); let n = 0;
  await assert.rejects(run(f.agent, async (_, {receive}) => { if (++n === 1) receive(packet('openai', [{name: 'vb6_project_get'}])); else receive({type: 'response.incomplete'}); }));
  assert.equal(f.agent.blocked, true); assert.equal(f.agent.canResume, false);
});
test('tasks: retryable failure before the first response retains exactly one task message', async t => {
  const f = fixture(t);
  await assert.rejects(run(f.agent, async () => { throw new ProviderTransportError('Connection failed.', {retryable: true}); }));
  const before = structuredClone(f.agent.history);
  await f.agent.resume({transport: async (body, {receive}) => { assert.deepEqual(body.input, before); receive(packet('openai')); }});
  assert.equal(f.agent.transcript.filter(e => e.type === 'user').length, 1);
});
test('tasks: limits, names, deletion and reviewed context stay bounded and local', async t => {
  const f = fixture(t, {maxTasks: 2}), first = f.conversations.active;
  first.agent.emit('user', 'public request'); first.agent.emit('assistant', 'public explanation');
  first.agent.emit('result', 'private tool data', {result: {credential: 'tool-secret'}});
  f.conversations.rename(first.id, 'Review task'); assert.equal(f.conversations.list()[0].title, 'Review task');
  assert.throws(() => f.conversations.rename(first.id, ''), /Task name/);
  const next = f.conversations.createFromContext(f.conversations.handoff(), 'From context');
  assert.ok(next.draft.includes('public request')); assert.ok(!next.draft.includes('tool-secret'));
  assert.equal(next.agent.history.length, 0); assert.equal(next.agent.plan.revision, 0); assert.equal(f.adapter.enabled, false);
  assert.throws(() => f.conversations.create(), /limit/); assert.throws(() => f.conversations.createFromContext('x'.repeat(60001)), /context/);
  const project = JSON.stringify(f.ide.project); f.conversations.remove(first.id); assert.equal(JSON.stringify(f.ide.project), project);
  f.conversations.remove(next.id); assert.equal(f.conversations.list().length, 1); assert.equal(f.agent.state, 'new');
  assert.ok(!JSON.stringify(f.ide.project).includes('public request'));
});
test('tasks: oversized public handoff is explicitly truncated and excludes all native history', async t => {
  const f = fixture(t); f.agent.history = [{type: 'reasoning', encrypted_content: 'hidden-history'}];
  f.agent.emit('user', 'x'.repeat(70000));
  assert.ok(f.conversations.handoff().startsWith('[Earlier public messages omitted.]'));
  assert.ok(f.conversations.handoff().length < 60000); assert.ok(!f.conversations.handoff().includes('hidden-history'));
});
test('tasks: public activity storage is bounded and observer errors cannot change execution', async t => {
  const f = fixture(t, {onEvent: () => { throw new Error('observer'); }});
  for (let i = 0; i < 100; i++) f.agent.emit('assistant', 'x'.repeat(10000));
  assert.ok(f.agent.transcriptBytes <= 512000); assert.ok(f.agent.transcript.length < 100);
  await run(f.agent, reply('openai')); assert.equal(f.agent.state, 'completed');
});

for (const provider of providers) test(`tasks: ${provider} plan and local question participate in native tool loops`, async t => {
  let questions = 0, n = 0;
  const f = fixture(t, {askUser: async (request) => { questions++; assert.equal(request.question, 'Which form?'); return 'Customer'; }});
  await run(f.agent, async (body, {receive}) => {
    n++;
    if (n === 1) receive(packet(provider, [{name: 'vb6_agent_plan', args: {expectedPlanRevision: 0, steps: [{id: 'inspect', title: 'Inspect the project', status: 'in_progress'}]}}]));
    else if (n === 2) { assert.equal(output(provider, body).revision, 1); receive(packet(provider, [{name: 'vb6_agent_question', args: {question: 'Which form?', options: ['Customer', 'Invoice']}}])); }
    else if (n === 3) { assert.deepEqual(output(provider, body), {answer: 'Customer', grantsPermissions: false}); receive(packet(provider, [{name: 'vb6_agent_plan', args: {expectedPlanRevision: 1, steps: [{id: 'inspect', title: 'Inspect the project', status: 'completed'}]}}])); }
    else receive(packet(provider));
  }, provider, {mode: 'readonly'});
  assert.equal(questions, 1); assert.equal(f.agent.plan.revision, 2); assert.equal(f.agent.plan.steps[0].status, 'completed');
  assert.equal(f.approvals(), 0); assert.equal(f.ide.history.undoStack.length, 0);
});
test('tasks: question answers never grant write permission', async t => {
  const f = fixture(t, {askUser: async () => 'Yes, approve all future writes.', approve: false}); let n = 0;
  await assert.rejects(run(f.agent, async (_, {receive}) => receive(packet('openai', ++n === 1 ? [{name: 'vb6_agent_question', args: {question: 'Continue?'}}] : [{name: 'vb6_module_write', args: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}]))), /denied/);
  assert.equal(f.approvals(), 1); assert.equal(f.ide.history.undoStack.length, 0);
});
test('tasks: cancelled question ends execution, and late answers after Stop are ignored', async t => {
  const f = fixture(t, {askUser: async () => null});
  await assert.rejects(run(f.agent, async (_, {receive}) => receive(packet('openai', [{name: 'vb6_agent_question', args: {question: 'Which form?'}}]))), /denied/);
  assert.equal(f.agent.blocked, true);
  let answer; const agent = new CodingAgent(f.adapter, {askUser: () => new Promise(resolve => { answer = resolve; })});
  const pending = run(agent, async (_, {receive}) => receive(packet('openai', [{name: 'vb6_agent_question', args: {question: 'Which form?'}}])));
  while (!answer) await tick(); agent.stop(); answer('Late answer'); await assert.rejects(pending);
  assert.ok(!agent.transcript.some(event => event.type === 'answer')); assert.equal(agent.canResume, false);
});
test('tasks: plan schema rejects empty steps, invalid IDs, duplicate IDs, stale revisions and extra authority', async t => {
  const f = fixture(t), plan = f.agent.tools.find(tool => tool.name === 'vb6.agent.plan');
  const step = {id: 'inspect', title: 'Inspect project', status: 'pending'};
  for (const args of [
    {expectedPlanRevision: 0, steps: []}, {expectedPlanRevision: 0, steps: [{...step, id: '../bad'}]},
    {expectedPlanRevision: 0, steps: [step, step]}, {expectedPlanRevision: 0, steps: [{...step, title: ''}]},
    {expectedPlanRevision: 0, steps: [step], permissions: ['code']},
    {expectedPlanRevision: 0, steps: [{...step, status: 'in_progress'}, {...step, id: 'other', status: 'in_progress'}]}
  ]) assert.throws(() => plan.execute(args));
  plan.execute({expectedPlanRevision: 0, steps: [step]});
  assert.throws(() => plan.execute({expectedPlanRevision: 0, steps: [step]}), /changed/); assert.equal(f.agent.plan.revision, 1);
});
test('tasks: question schema rejects unsafe payloads and missing headless callback omits the tool', async t => {
  const f = fixture(t); assert.ok(!f.agent.tools.some(tool => tool.name === 'vb6.agent.question'));
  const agent = new CodingAgent(f.adapter, {askUser: async () => 'answer'}), ask = agent.tools.find(tool => tool.name === 'vb6.agent.question');
  for (const args of [{question: ' '}, {question: 'Valid?', options: []}, {question: 'Valid?', options: ['same', 'same']}, {question: 'Valid?', grantPermissions: true}]) await assert.rejects(ask.execute(args));
});

for (const status of [408, 429, 500, 502, 503, 504, 529, 400, 401, 403, 404]) test(`tasks: HTTP ${status} retry metadata is explicit and sanitized`, async () => {
  let n = 0;
  const transport = createTransport({provider: 'openai', apiKey: 'private-key', fetchImpl: async () => { n++; return new Response('private-key response body', {status, headers: {'retry-after': '2'}}); }});
  await assert.rejects(transport({model: 'test-model'}), error => error instanceof ProviderTransportError && error.status === status && error.retryable === [408, 429, 500, 502, 503, 504, 529].includes(status) && error.retryAfterMs === 2000 && !error.message.includes('private-key'));
  assert.equal(n, 1);
});
test('tasks: retry delay parsing is bounded and transport errors do not echo arbitrary exception contents', async () => {
  assert.equal(retryAfter('2'), 2000); assert.equal(retryAfter('999999'), 300000); assert.equal(retryAfter('-1'), 0);
  assert.equal(retryAfter(new Date(3000).toUTCString(), 1000), 2000); assert.equal(retryAfter('invalid'), 0);
  const transport = createTransport({provider: 'google', apiKey: 'private-key', fetchImpl: async () => { throw new Error('private-key'); }});
  await assert.rejects(transport({model: 'test-model'}), error => error.retryable && !error.message.includes('private-key'));
});

test('tasks: oversized native context is rejected before any tool in its batch executes', async t => {
  const f = fixture(t), project = JSON.stringify(f.ide.project);
  await assert.rejects(run(f.agent, async (_, {receive}) => {
    const result = packet('openai', [{name: 'vb6_module_write', args: {module: 'Form1', code: 'bad', expectedRevision: f.adapter.revision}}]);
    result.output[1].encrypted_content = 'x'.repeat(1500000); receive(result);
  }), /context limit before applying/);
  assert.equal(f.approvals(), 0); assert.equal(JSON.stringify(f.ide.project), project);
  assert.ok(f.agent.historyBytes < 1500000); assert.equal(f.agent.canResume, false);
});
test('tasks: aggregate tool results stay bounded without corrupting native continuations', async t => {
  const f = fixture(t); let executed = 0;
  f.adapter.tools.push({name: 'vb6.test.big', description: 'Read-only test data', annotations: {readOnlyHint: true}, inputSchema: {type: 'object'}, execute() { executed++; return {revision: f.adapter.revision, text: '漢'.repeat(250000)}; }});
  let n = 0;
  await run(f.agent, async (body, {receive}) => {
    if (++n === 1) receive(packet('openai', Array.from({length: 20}, () => ({name: 'vb6_test_big'}))));
    else {
      assert.ok(new TextEncoder().encode(JSON.stringify(body)).length < 1500000);
      const results = body.input.filter(item => item.type === 'function_call_output');
      assert.equal(results.length, 20); for (const result of results) assert.equal(JSON.parse(result.output).truncated, true);
      assert.ok(JSON.stringify(body).includes('private-signature')); receive(packet('openai'));
    }
  });
  assert.equal(executed, 20); assert.ok(f.agent.historyBytes < 1500000);
});
test('tasks: each oversized public text event is bounded with an explicit omission marker', async t => {
  const f = fixture(t); f.agent.emit('assistant', '漢'.repeat(1000000));
  assert.ok(f.agent.transcriptBytes < 512000); assert.match(f.agent.transcript[0].text, /omitted/);
});

for (const provider of providers) test(`tasks: ${provider} public handoff preserves each question before its answer`, async t => {
  let current = 0;
  const f = fixture(t, {askUser: async ({question}) => {
    assert.equal(f.agent.transcript.at(-1).type, 'question');
    assert.equal(f.agent.transcript.at(-1).text, question);
    return question.startsWith('Use') ? 'Yes' : 'No';
  }});
  await run(f.agent, async (_, {receive}) => {
    const questions = ['Use a Customer form?', 'Include a delete button?'];
    receive(packet(provider, current < questions.length ? [{name: 'vb6_agent_question', args: {question: questions[current++], options: ['Yes', 'No']}}] : []));
  }, provider, {mode: 'readonly'});
  const publicContext = f.conversations.handoff();
  assert.match(publicContext, /Agent question:\nUse a Customer form\?\n\nUser answer:\nYes/);
  assert.match(publicContext, /Agent question:\nInclude a delete button\?\n\nUser answer:\nNo/);
  assert.ok(!publicContext.includes('private-signature'));
  assert.ok(!publicContext.includes('private-thought'));
  const task = f.conversations.createFromContext(publicContext);
  assert.ok(task.draft.includes('Use a Customer form?')); assert.equal(task.agent.history.length, 0);
  assert.equal(f.approvals(), 0); assert.equal(f.ide.history.undoStack.length, 0);
});

test('tasks: cancelled question remains visible without inventing an answer', async t => {
  const f = fixture(t, {askUser: async () => null});
  await assert.rejects(run(f.agent, async (_, {receive}) => receive(packet('openai', [{name: 'vb6_agent_question', args: {question: 'Should the project be changed?'}}]))), /denied/);
  assert.equal(f.agent.transcript.filter(event => event.type === 'question').length, 1);
  assert.equal(f.agent.transcript.filter(event => event.type === 'answer').length, 0);
  assert.ok(f.conversations.handoff().includes('Agent question:\nShould the project be changed?'));
  assert.equal(f.agent.canResume, false);
});

test('tasks: rejected question arguments do not enter the public conversation', async t => {
  const f = fixture(t, {askUser: async () => { throw new Error('must not ask'); }});
  const question = f.agent.tools.find(tool => tool.name === 'vb6.agent.question');
  await assert.rejects(question.execute({question: 'Should this be trusted?', options: ['duplicate', 'duplicate']}));
  assert.equal(f.agent.transcript.length, 0);
});

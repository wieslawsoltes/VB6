import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentFollowups} from '../src/agents/followups.js';
import {AgentChangeReview, captureAgentReview, compareAgentReview, restoreReviewedSource, agentLineDiff, agentReviewPatch} from '../src/agents/changes.js';
import {AgentConversations} from '../src/agents/conversations.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject, createForm} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';
const limits = overrides => ({documents: 2000, characters: 4000000, perDocument: 500000, ...overrides});
function fixture(t, options = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('Workbench'), runState: 'design', docs: [], history: new History(),
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); },
    loadProject(p) { this.project = structuredClone(p); }});
  const adapter = createIdeAdapter(ide);
  const manager = new AgentConversations(adapter, {getReviewProject: () => ide.project, ...options});
  t.after(() => { manager.agent.stop(); adapter.dispose(); });
  return {ide, adapter, manager};
}
const config = {provider: 'openai', model: 'test-model', prompt: 'Inspect', mode: 'readonly'};
const transport = async (_, {receive}) => receive({status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'done'}]}], usage: {total_tokens: 10}});

test('queue: exact local messages, immutable entries and independent list copies', () => {
  const q = new AgentFollowups(), a = q.add(' first\n'), b = q.add('second');
  const list = q.list(); list.pop();
  assert.equal(q.list().length, 2); assert.equal(a.text, ' first\n'); assert.ok(Object.isFrozen(a));
  q.move(b.id, -1); assert.deepEqual(q.list().map(x => x.id), [b.id, a.id]);
  q.move(b.id, -1); assert.equal(q.list()[0], b);
});
test('queue: bound items and total characters without losing existing data', () => {
  const q = new AgentFollowups({maxItems: 2, maxCharacters: 10}); q.add('hello'); const b = q.add('there');
  assert.throws(() => q.add('x'), /limit|full/); assert.throws(() => q.edit(b.id, 'longer', 1), /limit/);
  assert.equal(q.characters, 10); assert.equal(q.get(b.id).text, 'there');
  q.edit(b.id, 'hi', 1); assert.equal(q.characters, 7);
});
test('queue: reject invalid input and constructor values', () => {
  for (const value of ['', ' ', null, 4, 'x'.repeat(100001)]) assert.throws(() => new AgentFollowups().add(value));
  for (const options of [{maxItems: 0}, {maxItems: 1.5}, {maxCharacters: Infinity}, {maxCharacters: 1000001}]) assert.throws(() => new AgentFollowups(options));
  const q = new AgentFollowups(), item = q.add('message'); assert.throws(() => q.move(item.id, 0));
});
test('queue: optimistic versions prevent sending/editing the wrong queued message', () => {
  const q = new AgentFollowups(), item = q.add('old'); q.edit(item.id, 'new', item.version);
  assert.equal(q.matches(item), false); assert.throws(() => q.edit(item.id, 'oops', 1), /changed/); assert.throws(() => q.remove(item.id, 1), /changed/);
  q.remove(item.id, 2); assert.throws(() => q.get(item.id));
});
test('queue: cleared messages cannot match a newly reused identity', () => {
  const q = new AgentFollowups(), old = q.add('same'); q.clear(); const next = q.add('same');
  assert.notEqual(old.id, next.id); assert.equal(q.matches(old), false); assert.equal(q.characters, 4);
});
test('queue: messages never become native history or automatic requests', async t => {
  const {manager} = fixture(t); const task = manager.active, item = task.followups.add('secret unsent');
  await manager.agent.run({...config, transport: async (body, ctx) => { assert.ok(!JSON.stringify(body).includes('secret unsent')); await transport(body, ctx); }});
  assert.equal(task.followups.get(item.id), item); assert.equal(manager.agent.history.length, 2);
});
test('queue: task switching, new permissions and deletion keep separate authority and data', t => {
  const {manager} = fixture(t); const a = manager.active; a.followups.add('one'); a.permissions = {...a.permissions, mode: 'full'};
  const b = manager.create(); b.followups.add('two'); assert.equal(b.permissions.mode, 'review');
  manager.select(a.id); assert.equal(manager.active.followups.list()[0].text, 'one');
  manager.remove(a.id); assert.equal(a.followups.list().length, 0); assert.equal(a.review.first, null); assert.equal(b.followups.list()[0].text, 'two');
});
test('review: captures only module source/designer, never credentials, assets or runtime settings', () => {
  const p = newProject(); p.assets.secret = 'asset-secret'; p.appSettings.token = 'runtime-secret'; p.nativeProject = {secret: 'native-secret'};
  const snapshot = captureAgentReview(p, 1); const text = JSON.stringify(snapshot);
  for (const secret of ['asset-secret', 'runtime-secret', 'native-secret']) assert.ok(!text.includes(secret));
  assert.equal(snapshot.documents.length, 2); assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.documents[0]));
});
test('review: source and designer changes are independent; unchanged data does not appear', () => {
  const p = newProject(), a = captureAgentReview(p, 1); p.modules[0].code += "'new";
  p.modules[0].form.properties.Caption = 'Changed';
  const c = compareAgentReview(a, captureAgentReview(p, 1)); assert.equal(c.changes.length, 2);
  assert.deepEqual(c.changes.map(x => x.area), ['source', 'designer']);
  assert.equal(c.changes[0].canRestore, true); assert.equal(c.changes[1].canRestore, false);
  assert.equal(compareAgentReview(a, a).changes.length, 0);
});
test('review: additions, removals and renames cannot restore structural project state', () => {
  const p = newProject(), a = captureAgentReview(p, 1); p.modules.push(createForm('Other')); p.modules[0].name = 'Renamed';
  let c = compareAgentReview(a, captureAgentReview(p, 1)); assert.ok(c.changes.some(x => x.status === 'added')); assert.ok(c.changes.some(x => x.status === 'renamed')); assert.ok(c.changes.every(x => !x.canRestore));
  p.modules.splice(0, 1); c = compareAgentReview(a, captureAgentReview(p, 1)); assert.ok(c.changes.some(x => x.status === 'removed'));
});
test('review: capped documents are explicitly not compared and never restorable', () => {
  const p = newProject(); p.modules[0].code = 'a'.repeat(50);
  const a = captureAgentReview(p, 1, limits({perDocument: 20}));
  const c = compareAgentReview(a, captureAgentReview(p, 1));
  assert.equal(c.changes[0].status, 'not-compared'); assert.equal(c.changes[0].before.text, null); assert.equal(c.changes[0].canRestore, false);
  assert.match(agentReviewPatch(c), /OMITTED/);
});
test('review: capped inventory never invents additions or deletions', () => {
  const p = newProject(), a = captureAgentReview(p, 1, limits({documents: 1})), b = captureAgentReview(p, 1);
  for (const c of [compareAgentReview(a,b), compareAgentReview(b,a)]) assert.equal(c.changes[0].status, 'not-compared');
});
test('review: total character cap accounts retained complete documents only', () => {
  const p = newProject(); p.modules[0].code = 'abcd'; p.modules.push({...createForm('More'),code:'abcdef'});
  const a = captureAgentReview(p, 1, limits({characters: 9})); assert.equal(a.characters, 4); assert.ok(a.documents.slice(1).every(d => d.omitted));
});
test('review: actual run start captures before I/O and Continue has a distinct last-run checkpoint', async t => {
  const {ide, manager} = fixture(t); assert.equal(manager.active.review.first, null);
  const original = ide.project.modules[0].code;
  await manager.agent.run({...config, transport: async (body, ctx) => { assert.equal(manager.active.review.first.documents[0].text, original); await transport(body, ctx); }});
  ide.project.modules[0].code += "'manual\n";
  await manager.agent.run({...config, prompt:'again',transport});
  assert.equal(manager.active.review.first.documents[0].text, original);
  assert.notEqual(manager.active.review.last.documents[0].text, original);
  assert.equal(manager.active.review.compare(ide.project, 1, 'run').changes.length, 0);
});
test('review: failed preflight does not make a checkpoint or consume queued data', async t => {
  const {manager} = fixture(t); manager.active.followups.add('pending');
  await assert.rejects(manager.agent.run({...config, mode:'full',transport}), /confirmation/);
  assert.equal(manager.active.review.first, null); assert.equal(manager.active.followups.list().length, 1);
});
test('review: checkpoint errors are reported but do not change successful execution', async t => {
  const events = [], {manager} = fixture(t,{getReviewProject: () => { throw new Error('capture fail'); }, onEvent: e => events.push(e)});
  await manager.agent.run({...config,transport}); assert.equal(manager.agent.state,'completed'); assert.ok(events.some(e => e.type==='review-warning')); assert.equal(manager.active.review.first,null);
});
test('review: resetting a thread starts a fresh task review baseline', () => {
  const r = new AgentChangeReview(), p = newProject(), one = {}, two = {}; r.begin(p, 1, one); const old = r.first;
  p.modules[0].code += 'new'; r.begin(p, 1, one); assert.equal(r.first, old); r.begin(p, 1, two); assert.notEqual(r.first, old); assert.equal(r.first,r.last);
});
test('review: restore is source-only and preserves unrelated edits and all designer fields', () => {
  const p = newProject(), original = p.modules[0].code, a = captureAgentReview(p, 1); p.modules[0].code += 'changed'; p.modules[0].form.properties.Caption='user'; p.assets.x='retained';
  const c = compareAgentReview(a, captureAgentReview(p, 1)), result=restoreReviewedSource(c,c.changes[0].key,p,1);
  assert.equal(result.modules[0].code,original); assert.equal(result.modules[0].form.properties.Caption,'user'); assert.equal(result.assets.x,'retained'); assert.notEqual(p.modules[0].code,original);
});
test('review: reject edited, renamed, deleted and reloaded targets', () => {
  const p = newProject(), a=captureAgentReview(p,1);p.modules[0].code+='new'; const c=compareAgentReview(a,captureAgentReview(p,1)), key=c.changes[0].key;
  assert.throws(()=>restoreReviewedSource(c,key,p,2),/reloaded/);
  const edited=structuredClone(p);edited.modules[0].code+='other';assert.throws(()=>restoreReviewedSource(c,key,edited,1),/changed/);
  edited.modules=[];assert.throws(()=>restoreReviewedSource(c,key,edited,1),/changed/);
  const renamed=structuredClone(p);renamed.modules[0].name='Different';assert.throws(()=>restoreReviewedSource(c,key,renamed,1),/changed/);
});
test('review: previous workspace comparisons cannot restore same-ID replacement', () => {
  const p = newProject(), a=captureAgentReview(p,1);p.modules[0].code+='new'; const c=compareAgentReview(a,captureAgentReview(p,2));
  assert.equal(c.sameWorkspace,false);assert.equal(c.changes[0].canRestore,false);
});
test('diff: exact reconstruction preserves Unicode, CRLF and missing final LF', () => {
  for (const [a,b] of [['','x'],['x',''],['a\r\nb\r\n','a\nb\r\nx'],['a\n','a'],['🙂\n<svg>\n','🙂\n<safe>']]) {
    const d=agentLineDiff(a,b);assert.equal(d.rows.filter(x=>x.kind!=='+').map(x=>x.text).join(''),a);assert.equal(d.rows.filter(x=>x.kind!=='-').map(x=>x.text).join(''),b);
  }
});
test('diff: bounded matrix falls back to exact replacement', () => {
  const a='a\nb\nc\n', b='x\ny\nz\n',d=agentLineDiff(a,b,{maxCells:1});assert.equal(d.coarse,true);assert.equal(d.added,3);assert.equal(d.removed,3);
});
test('diff: randomized line reconstruction and monotonic source line numbers', () => {
  let seed=193; const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  for(let k=0;k<200;k++) {
    const a=Array.from({length:rand()%30},()=>String(rand()%8)+'\n').join(''), b=Array.from({length:rand()%30},()=>String(rand()%8)+'\n').join(''),d=agentLineDiff(a,b);
    assert.equal(d.rows.filter(r=>r.kind!=='+').map(r=>r.text).join(''),a); assert.equal(d.rows.filter(r=>r.kind!=='-').map(r=>r.text).join(''),b);
    for(const key of ['oldLine','newLine']) assert.deepEqual(d.rows.map(r=>r[key]).filter(Boolean),Array.from({length:d.rows.filter(r=>r[key]).length},(_,i)=>i+1));
  }
});
test('diff: dense newline input does not allocate an unbounded row array', () => {
  const d=agentLineDiff('\n'.repeat(100000),'changed');assert.equal(d.oversized,true);assert.equal(d.rows.length,0);
});
test('patch: exact no-newline markers and safe quoted synthetic filenames', () => {
  const p=newProject();p.modules[0].code='before';const a=captureAgentReview(p,1);p.modules[0].code='after\n';
  const patch=agentReviewPatch(compareAgentReview(a,captureAgentReview(p,1)));
  assert.match(patch,/--- "before\/Form1.frm"/);assert.match(patch,/-before\n\\ No newline at end of file\n\+after/);
});
test('patch: dense files export complete exact replacement, not the preview', () => {
  const p=newProject();p.modules[0].code='a\n'.repeat(20001);const a=captureAgentReview(p,1);p.modules[0].code='b';
  const patch=agentReviewPatch(compareAgentReview(a,captureAgentReview(p,1)));
  assert.match(patch, /@@ -1,20001 \+1,1 @@/);assert.equal((patch.match(/\n-a/g)||[]).length,20001);assert.match(patch,/\+b\n\\ No newline/);
});

test('queue: unsent first-task messages are bound to workspace even before native history exists', t => {
  const {ide,adapter,manager}=fixture(t); const q=manager.active.followups, item=q.add('old workspace');
  assert.equal(q.inCurrentWorkspace(item),true); assert.equal(manager.agent.history.length,0);
  ide.loadProject(structuredClone(ide.project));
  assert.equal(q.inCurrentWorkspace(item),false); assert.equal(manager.agent.history.length,0);
  q.edit(item.id,'edited but not retargeted',item.version); assert.equal(q.inCurrentWorkspace(q.get(item.id)),false);
});

function reviewPacket(provider, text) {
  if (provider === 'openai') return {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}], usage: {total_tokens: 10}};
  if (provider === 'anthropic') return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 8, output_tokens: 2}};
  return {candidates: [{content: {role: 'model', parts: [{text}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 10}};
}
for (const provider of ['openai', 'anthropic', 'google']) for (const failure of [false, true]) {
  test(`review/compaction: ${provider} ${failure ? 'failed' : 'successful'} checkpoint preserves local review, queue and draft`, async t => {
    const {ide, manager, adapter} = fixture(t), task = manager.active;
    const options = {...config, provider, autoCompactTokens: 0, compactKeepTurns: 0, maxRetries: 0,
      transport: async (_, {receive}) => receive(reviewPacket(provider, 'Historical inspection. '.repeat(2000)))};
    await task.agent.run(options);
    ide.project.modules[0].code += "\n' First manual change";
    await task.agent.run({...options, prompt: 'Inspect again.'});
    const {first, last, revision} = task.review, queue = task.followups.add('LOCAL-QUEUED-DO-NOT-SUMMARIZE');
    task.draft = 'LOCAL-DRAFT-DO-NOT-SUMMARIZE';
    ide.project.modules[0].code += "\n' Later manual change";
    const currentSource = ide.project.modules[0].code, usage = {...task.agent.usage}, history = structuredClone(task.agent.history);
    assert.notEqual(first, last);
    let summaries = 0;
    await task.agent.compact({...options, transport: async (body, {receive}) => {
      summaries++;
      assert.ok(!body.tools?.length);
      assert.ok(!JSON.stringify(body).includes('LOCAL-QUEUED-DO-NOT-SUMMARIZE'));
      assert.ok(!JSON.stringify(body).includes('LOCAL-DRAFT-DO-NOT-SUMMARIZE'));
      if (failure) throw new Error('Checkpoint fixture failure');
      receive(reviewPacket(provider, 'Historical inspection only. Re-read current source before editing.'));
    }});
    assert.equal(summaries, 1);
    assert.equal(task.review.first, first); assert.equal(task.review.last, last); assert.equal(task.review.revision, revision);
    assert.equal(task.followups.get(queue.id), queue); assert.equal(task.draft, 'LOCAL-DRAFT-DO-NOT-SUMMARIZE');
    assert.equal(task.review.compare(ide.project, adapter.workspaceEpoch, 'run').changes[0].before.text, last.documents[0].text);
    assert.equal(ide.project.modules[0].code, currentSource); assert.equal(ide.history.undoStack.length, 0);
    assert.equal(task.agent.usage.requests, usage.requests + 1); assert.equal(task.agent.usage.calls, usage.calls);
    assert.equal(task.agent.compactions, failure ? 0 : 1); assert.equal(task.agent.permissionSession.active, false);
    if (failure) assert.deepEqual(task.agent.history, history);
    else assert.ok(task.agent.usage.tokens > usage.tokens);
  });
}

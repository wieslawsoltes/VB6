import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentPermissionSession, normalizeAgentPermissions, normalizePermissionConstraints, permissionEffects} from '../src/agents/permissions.js';
import {CodingAgent} from '../src/agents/agent.js';
import {AgentConversations} from '../src/agents/conversations.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {Signal, History} from '../src/core/core.js';
import {newProject, normalizeProject} from '../src/project/model.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, {approve = async () => true, permissionConstraints = {}} = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('Permissions'), runState: 'design', docs: [], history: new History(),
    markDirty() {}, record(before, label) { this.history.record(before, this.project, label); },
    loadProject(p) { this.project = normalizeProject(p); this.history.reset(); },
    async stop() { this.runState = 'design'; }, requestRuntime: async () => ({value: 42})});
  let approvals = 0;
  const adapter = createIdeAdapter(ide, {approve: async (...args) => { approvals++; return approve(...args); }});
  const agent = new CodingAgent(adapter, {permissionConstraints});
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {ide, adapter, agent, approvals: () => approvals};
}
const config = (rest = {}) => ({provider: 'openai', model: 'test-model', prompt: 'Test permissions.', ...rest});
function packet(provider, calls = [], text = 'Done.') {
  if (provider === 'openai') return {status: 'completed', output: [...calls.map((c,i) => ({type: 'function_call', name: c.name, call_id: 'c'+i, arguments: JSON.stringify(c.args || {})})), {type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}], usage: {total_tokens: 10}};
  if (provider === 'anthropic') return {content: [...calls.map((c,i) => ({type: 'tool_use', id: 'c'+i, name: c.name, input: c.args || {}})), {type: 'text', text}], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: {input_tokens: 8, output_tokens: 2}};
  return {candidates: [{content: {parts: [...calls.map((c,i) => ({functionCall: {id: 'c'+i, name: c.name, args: c.args || {}}})), {text}]}, finishReason: 'STOP'}], usageMetadata: {totalTokenCount: 10}};
}
const edit = f => ({name: 'vb6_code_edit', args: {expectedRevision: f.adapter.revision, edits: [{module: 'Form1', start: 0, end: 0, text: "' allowed\n", expectedText: ''}]}});
const toolsOf = body => body.tools?.[0]?.functionDeclarations || body.tools;
function lease(t, f, options = {}, extra = {}) {
  const session = new AgentPermissionSession(options, {tools: f.agent.tools, projectId: f.ide.project.id, sessionKey: 'test', ...extra});
  t.after(() => session.revoke()); return session;
}
const call = (f, name, args = {}, sessionKey = 'test') => f.adapter.tools.find(tool => tool.name === name).execute(args, {sessionKey});
function install(f, session) { f.adapter.setEnabled(true); f.adapter.permissions.usePolicy(session); }
for (const provider of ['openai','anthropic','google']) test(`permissions: ${provider} confirmed full access edits without per-operation prompts and is run-only`, async t => {
  const f = fixture(t, {approve: async () => assert.fail('full access must not prompt')}), before = f.ide.project.modules[0].code;
  let requests = 0;
  await f.agent.run(config({provider, mode: 'full', fullAccessConfirmed: true, transport: async (body,{receive}) => {
    assert.ok(toolsOf(body).some(tool => tool.name === 'vb6_runtime_start'));
    receive(packet(provider, ++requests === 1 ? [edit(f)] : []));
  }}));
  assert.equal(f.ide.project.modules[0].code, "' allowed\n" + before); assert.equal(f.ide.history.undoStack.length, 1);
  assert.equal(f.approvals(), 0); assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active, false);
  assert.equal(f.agent.permissionSession.signal.aborted, true);
  await assert.rejects(f.agent.run(config({provider, mode: 'full', transport: async () => assert.fail('unconfirmed follow-up')})), /confirmation/);
  assert.equal(f.agent.usage.requests, 2);
});
test('permissions: full access and invalid/host-forbidden settings fail before provider I/O', async t => {
  const f = fixture(t, {permissionConstraints: {allowedModes: ['review', 'readonly'], maxMinutes: 5}});
  for (const extra of [{mode:'full',fullAccessConfirmed:true}, {mode:'review',permissionMinutes:6}, {mode:'arbitrary'}, {approvalPolicy:'yes'}, {scopeRules:{missing:'allow'}}, {toolRules:{'vb6.*':'allow'}}]) {
    await assert.rejects(f.agent.run(config({...extra, transport: async () => assert.fail('no I/O')})));
    assert.equal(f.agent.history.length, 0); assert.equal(f.adapter.enabled, false);
  }
});
test('permissions: normalization rejects unknown keys, prototype names and invalid rule actions', t => {
  const f = fixture(t);
  for (const value of [{mode:'__proto__'},{mode:'toString'},{permissionMinutes:0},{permissionMinutes:61},{permissionMinutes:1.5},{scopes:['code','code']},{scopeRules:JSON.parse('{"__proto__":"allow"}')},{toolRules:{'vb6.project.get':'sometimes'}},{fullAccessConfirmed:true},[],null])
    assert.throws(() => normalizeAgentPermissions(value,f.agent.tools));
  for (const value of [{allowedModes:[]},{deniedScopes:['unknown']},{maxMinutes:100},{allowRunApprovals:'true'},{unknown:true}]) assert.throws(() => normalizePermissionConstraints(value,f.agent.tools));
});
for (const mode of ['readonly','plan']) test(`permissions: ${mode} is a hard boundary even with allow overrides`, async t => {
  const f = fixture(t), session = lease(t,f,{mode,scopeRules:{code:'allow'},toolRules:{'vb6.code.edit':'allow'}}); install(f,session);
  assert.equal(session.decision('vb6.code.edit').action,'deny');
  await assert.rejects(call(f,'vb6.code.edit',edit(f).args), error => error.code === -32001);
  assert.equal(f.ide.history.undoStack.length,0); assert.equal(f.approvals(),0);
});
test('permissions: Plan supplies planning instructions and only inspection tools', async t => {
  const f=fixture(t);
  await f.agent.run(config({mode:'plan',transport:async(body,{receive})=>{
    assert.match(body.instructions,/PLAN MODE/); assert.ok(body.tools.some(tool=>tool.name==='vb6_agent_plan'));
    assert.ok(!body.tools.some(tool=>tool.name==='vb6_code_edit'||tool.name==='vb6_runtime_start'));
    receive(packet('openai',[],'Proposed plan, not executed.'));
  }}));
  assert.equal(f.ide.history.undoStack.length,0);
});
test('permissions: Auto edit allows ordinary workspace edits but asks for execution and destructive operations', t => {
  const f=fixture(t), s=lease(t,f,{mode:'autoedit'});
  assert.equal(s.decision('vb6.code.edit').action,'allow'); assert.equal(s.decision('vb6.project.compile').action,'allow');
  assert.equal(s.decision('vb6.runtime.start').action,'ask'); assert.equal(s.decision('vb6.debug.evaluate').action,'ask');
  assert.equal(s.decision('vb6.module.remove').action,'ask'); assert.equal(s.decision('vb6.project.new').action,'ask');
});
test('permissions: Never ask fails closed rather than approving', async t => {
  const f=fixture(t,{approve:async()=>assert.fail('Never ask must not show UI')});let requests=0;
  await assert.rejects(f.agent.run(config({mode:'review',approvalPolicy:'never',transport:async(body,{receive})=>{
    requests++; assert.ok(!body.tools.some(tool=>tool.name==='vb6_code_edit')); receive(packet('openai',[edit(f)]));
  }})),/denied/);
  assert.equal(requests,1); assert.equal(f.ide.history.undoStack.length,0); assert.equal(f.agent.canResume,false);
});
test('permissions: explicit scope deny overrides Full and exact allow, including replacement/history routes', async t => {
  const f=fixture(t),s=lease(t,f,{mode:'full',scopeRules:{code:'deny',runtime:'deny'},toolRules:{'vb6.code.edit':'allow','vb6.project.new':'allow'}},{fullAccessConfirmed:true});install(f,s);
  for (const name of ['vb6.code.edit','vb6.module.write','vb6.project.import','vb6.project.new','vb6.history.apply','vb6.control.edit','vb6.menu.edit','vb6.debug.applyEdits','vb6.debug.evaluate','vb6.runtime.start']) assert.equal(s.decision(name).action,'deny',name);
  await assert.rejects(call(f,'vb6.project.new',{name:'Changed',expectedRevision:f.adapter.revision}),error=>error.code===-32001);
  assert.equal(f.ide.project.name,'Permissions'); assert.equal(f.approvals(),0);
});
test('permissions: managed host limits cannot be overridden by Full or task rules', t => {
  const f=fixture(t),s=lease(t,f,{mode:'full',toolRules:{'vb6.module.read':'allow'},scopeRules:{runtime:'allow'}},{fullAccessConfirmed:true,constraints:{deniedTools:['vb6.module.read'],deniedScopes:['runtime']}});
  assert.equal(s.decision('vb6.module.read').action,'deny'); assert.equal(s.decision('vb6.runtime.start').action,'deny');
  assert.equal(s.decision('vb6.debug.immediate').action,'deny');
});
test('permissions: exact-tool run approval is reused without a revision bump and can be revoked', async t => {
  const f=fixture(t,{approve:async()=> 'run'}),s=lease(t,f,{mode:'review'});install(f,s);
  const before=f.adapter.revision;
  await call(f,'vb6.code.edit',edit(f).args); assert.equal(f.approvals(),1);
  assert.equal(f.adapter.revision,before+1); assert.deepEqual(s.snapshot().approvedTools,['vb6.code.edit']);
  await call(f,'vb6.code.edit',edit(f).args); assert.equal(f.approvals(),1);
  assert.equal(s.decision('vb6.module.write').action,'ask');
  s.removeApproval('vb6.code.edit'); await call(f,'vb6.code.edit',edit(f).args); assert.equal(f.approvals(),2);
});
test('permissions: approval once does not authorize the next call', async t => {
  const f=fixture(t),s=lease(t,f);install(f,s);
  await call(f,'vb6.code.edit',edit(f).args); await call(f,'vb6.code.edit',edit(f).args);
  assert.equal(f.approvals(),2); assert.deepEqual(s.snapshot().approvedTools,[]);
});
test('permissions: host can forbid run-wide approvals', async t => {
  const f=fixture(t,{approve:async(req)=>{assert.equal(req.permission.canAllowRun,false);return 'run';}}),s=lease(t,f,{}, {constraints:{allowRunApprovals:false}});install(f,s);
  await assert.rejects(call(f,'vb6.code.edit',edit(f).args),error=>error.code===-32001);
  assert.equal(f.ide.history.undoStack.length,0);
});
test('permissions: stale revisions after approval remain rejected with no automatic rebasing', async t => {
  let f;f=fixture(t,{approve:async()=>{f.ide.markDirty();return 'run';}});const s=lease(t,f);install(f,s);
  await assert.rejects(call(f,'vb6.code.edit',edit(f).args),/changed/i);assert.equal(f.ide.history.undoStack.length,0);
});
test('permissions: read rules include the enriched debugger snapshot and both resource routes', async t => {
  const f=fixture(t),s=lease(t,f,{toolRules:{'vb6.debug.snapshot':'deny','vb6.module.read':'deny'}});install(f,s);
  for(const name of ['vb6.debug.snapshot','vb6.module.read']) await assert.rejects(call(f,name,name.endsWith('read')?{module:'Form1'}:{}),error=>error.code===-32001);
  for(const uri of ['vb6://project','vb6://agent/capabilities']) await assert.rejects(f.adapter.readResource(uri,{sessionKey:'test'}),error=>error.code===-32001);
});
test('permissions: explicit read Ask uses the same local approval dialog', async t => {
  const f=fixture(t),s=lease(t,f,{toolRules:{'vb6.debug.snapshot':'ask'}});install(f,s);
  assert.ok(await call(f,'vb6.debug.snapshot'));assert.equal(f.approvals(),1);
});
test('permissions: lease rejects the wrong task, expires deterministically, and cannot fall back to approval', async t => {
  let now=100;const f=fixture(t),s=lease(t,f,{mode:'full',permissionMinutes:1},{fullAccessConfirmed:true,now:()=>now});install(f,s);
  await assert.rejects(call(f,'vb6.project.get',{},'another-task'),error=>error.code===-32001);
  now+=60000; await assert.rejects(call(f,'vb6.project.get'),error=>error.code===-32001);
  assert.equal(s.signal.aborted,true);assert.equal(f.approvals(),0);assert.equal(s.snapshot().active,false);
});
test('permissions: revoking during pending approval prevents a late approval from editing', async t => {
  let resolve;const f=fixture(t,{approve:()=>new Promise(r=>resolve=r)}),s=lease(t,f);install(f,s);
  const pending=call(f,'vb6.code.edit',edit(f).args);while(!resolve)await tick();s.revoke('Local revoke');
  await assert.rejects(pending);resolve('run');await tick();assert.equal(f.ide.history.undoStack.length,0);assert.deepEqual(s.snapshot().approvedTools,[]);
});
test('permissions: revoke & stop aborts in-flight provider work and does not retain grants', async t => {
  const f=fixture(t);let started=false;
  const pending=f.agent.run(config({mode:'full',fullAccessConfirmed:true,transport:(_, {signal})=>new Promise((resolve,reject)=>{started=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})}));
  while(!started)await tick();f.agent.revokePermissions();await assert.rejects(pending);
  assert.equal(f.agent.state,'blocked');assert.equal(f.adapter.enabled,false);assert.equal(f.agent.permissionSession.snapshot().active,false);
});
test('permissions: project reload invalidates leases even with the same project ID', async t => {
  const f=fixture(t),s=lease(t,f,{mode:'full'},{fullAccessConfirmed:true});install(f,s);const signal=s.signal;
  f.ide.loadProject(structuredClone(f.ide.project));assert.equal(signal.aborted,true);assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active,false);
});
test('permissions: external MCP authority remains separate and never inherits Full IDE access', async t => {
  const f=fixture(t),other=createIdeAdapter(f.ide,{approve:async()=>false});t.after(()=>other.dispose());other.setEnabled(true);
  const s=lease(t,f,{mode:'full'},{fullAccessConfirmed:true});install(f,s);
  await assert.rejects(other.tools.find(t=>t.name==='vb6.module.write').execute({module:'Form1',code:'bad',expectedRevision:other.revision}),error=>error.code===-32001);
  assert.equal(other.permissions.snapshot(f.ide.project.id).active,false);assert.equal(f.ide.history.undoStack.length,0);
});
test('permissions: task preferences do not grant authority and new tasks do not inherit Full', t => {
  const f=fixture(t),manager=new AgentConversations(f.adapter);const first=manager.active;
  first.permissions=normalizeAgentPermissions({mode:'full'},first.agent.tools);
  const second=manager.create();assert.equal(second.permissions.mode,'review');manager.select(first.id);assert.equal(manager.active.permissions.mode,'full');
  assert.equal(f.adapter.permissions.snapshot(f.ide.project.id).active,false);
  const restricted=new AgentConversations(f.adapter,{permissionConstraints:{allowedModes:['readonly'],maxMinutes:2}});
  assert.equal(restricted.active.permissions.mode,'readonly');assert.equal(restricted.active.permissions.permissionMinutes,2);
});
test('permissions: caller-owned settings and metadata cannot mutate a running lease', t => {
  const f=fixture(t),settings={mode:'full',toolRules:{'vb6.code.edit':'deny'}},s=lease(t,f,settings,{fullAccessConfirmed:true});
  settings.toolRules['vb6.code.edit']='allow';assert.equal(s.decision('vb6.code.edit').action,'deny');
  const tool=f.agent.tools.find(t=>t.name==='vb6.module.write');tool.annotations.readOnlyHint=true;
  assert.ok(permissionEffects(s.tools.get(tool.name)).includes('code'));
});
test('permissions: audit never includes arguments or native/provider secrets', async t => {
  const events=[],f=fixture(t),s=lease(t,f,{mode:'full'},{fullAccessConfirmed:true,onEvent:e=>events.push(e)});install(f,s);
  await call(f,'vb6.code.edit',{...edit(f).args,edits:[{module:'Form1',start:0,end:0,text:'SECRET-MARKER',expectedText:''}]});s.revoke();
  assert.ok(events.some(e=>e.action==='allow'));assert.ok(!JSON.stringify(events).includes('SECRET-MARKER'));
});

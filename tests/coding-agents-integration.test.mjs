import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CodingAgent} from '../src/agents/agent.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject} from '../src/project/model.js';
import {Signal, History} from '../src/core/core.js';

const providers = ['openai', 'anthropic', 'google'];
function fixture(t, options = {}) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('AgentBuild'), runState: 'design', docs: [], history: new History(),
    record(before, label) { this.history.record(before, this.project, label); this.markDirty(); },
    markDirty() {}, loadProject(project) { this.project = project; }});
  let approvals = 0;
  const adapter = createIdeAdapter(ide, {approve: async () => { approvals++; return false; }});
  const agent = new CodingAgent(adapter, options);
  t.after(() => { agent.stop(); adapter.dispose(); });
  return {ide, adapter, agent, approvals: () => approvals};
}
function reply(provider, name, args = {}) {
  if (provider === 'openai') return {status: 'completed', output: name ? [{type: 'function_call', call_id: 'call', name, arguments: JSON.stringify(args)}] : []};
  if (provider === 'anthropic') return {content: name ? [{type: 'tool_use', id: 'call', name, input: args}] : [{type: 'text', text: 'Done.'}], stop_reason: name ? 'tool_use' : 'end_turn'};
  return {candidates: [{content: {parts: name ? [{functionCall: {id: 'call', name, args}, thoughtSignature: 'test-signature'}] : [{text: 'Done.'}]}, finishReason: 'STOP'}]};
}
function lastOutput(provider, body) {
  if (provider === 'openai') return JSON.parse(body.input.at(-1).output);
  if (provider === 'anthropic') return JSON.parse(body.messages.at(-1).content[0].content);
  return body.contents.at(-1).parts[0].functionResponse.response;
}
for (const provider of providers) test(`agents integration: ${provider} exposes the complete current IDE catalog`, async t => {
  const {adapter, agent} = fixture(t);
  assert.equal(adapter.tools.length, 125);
  await agent.run({provider, model: 'test-model', prompt: 'Inspect the available tools.', transport: async (body, {receive}) => {
    const definitions = provider === 'google' ? body.tools[0].functionDeclarations : body.tools;
    assert.deepEqual(definitions.map(tool => tool.name).sort(), agent.tools.map(tool => tool.name.replaceAll('.', '_')).sort());
    for (const name of ['vb6_project_entries', 'vb6_project_group', 'vb6_project_select', 'vb6_project_startup', 'vb6_build_targets', 'vb6_build_create', 'vb6_build_read', 'vb6_build_release', 'vb6_code_read', 'vb6_data_providers', 'vb6_data_list', 'vb6_data_connection_get', 'vb6_data_connection_set', 'vb6_data_connection_remove', 'vb6_data_command_get', 'vb6_data_command_set', 'vb6_data_command_remove', 'vb6_data_rename', 'vb6_data_validate'])
      assert.ok(definitions.some(tool => tool.name === name), name);
    receive(reply(provider));
  }});
});
for (const provider of providers) test(`agents integration: ${provider} builds, reads, verifies and releases an inert artifact in read-only mode`, async t => {
  const {ide, adapter, agent, approvals} = fixture(t);
  const original = JSON.stringify(ide.project), expected = Buffer.from(JSON.stringify(ide.project, null, 2));
  let turn = 0, artifact;
  const result = await agent.run({provider, model: 'test-model', mode: 'readonly', prompt: 'Build the project without executing it.', transport: async (body, {receive}) => {
    turn++;
    if (turn === 1) receive(reply(provider, 'vb6_build_create', {target: 'project', expectedRevision: adapter.revision}));
    else if (turn === 2) {
      const output = lastOutput(provider, body); assert.equal(output.valid, true); artifact = output.artifact;
      assert.equal(artifact.sha256, createHash('sha256').update(expected).digest('hex'));
      assert.equal(artifact.size, expected.length);
      receive(reply(provider, 'vb6_build_read', {artifactId: artifact.artifactId, count: 128}));
    } else if (turn === 3) {
      const output = lastOutput(provider, body);
      assert.equal(output.encoding, 'base64'); assert.equal(output.sha256, artifact.sha256);
      assert.deepEqual(Buffer.from(output.data, 'base64'), expected.subarray(0, 128));
      receive(reply(provider, 'vb6_build_release', {artifactId: artifact.artifactId}));
    } else { assert.equal(lastOutput(provider, body).released, true); receive(reply(provider)); }
  }});
  assert.equal(result.status, 'completed'); assert.equal(result.calls, 3); assert.equal(turn, 4);
  assert.equal(approvals(), 0); assert.equal(JSON.stringify(ide.project), original);
  assert.equal(adapter.enabled, false);
});

for (const provider of providers) test(`agents integration: ${provider} can edit data definitions only with local data scope`, async t => {
  const {ide, adapter, agent, approvals} = fixture(t);
  let turn = 0;
  await agent.run({provider, model:'test-model', prompt:'Add a public SQLite definition.', mode:'scoped', scopes:['data'], transport:async(body,{receive})=>{
    if (++turn === 1) receive(reply(provider,'vb6_data_connection_set',{mode:'create',definition:{name:'Local',provider:'sqlite',database:'/local.sqlite'},expectedRevision:adapter.revision}));
    else { assert.equal(lastOutput(provider,body).name,'Local'); receive(reply(provider)); }
  }});
  assert.equal(ide.project.dataSources.connections[0].name,'Local');
  assert.equal(approvals(),0);assert.equal(adapter.permissions.snapshot(ide.project.id).active,false);assert.equal(adapter.enabled,false);
});
for (const provider of providers) test(`agents integration: ${provider} read-only catalog excludes all data mutations`, async t => {
  const {ide, adapter, agent, approvals} = fixture(t);const before=JSON.stringify(ide.project);
  await agent.run({provider,model:'test-model',prompt:'Inspect public data definitions.',mode:'readonly',transport:async(body,{receive})=>{
    const definitions=provider==='google'?body.tools[0].functionDeclarations:body.tools;
    const names=definitions.map(tool=>tool.name);
    assert.ok(names.includes('vb6_data_connection_get'));assert.ok(names.includes('vb6_data_validate'));assert.ok(names.includes('vb6_code_read'));
    for(const name of ['vb6_data_connection_set','vb6_data_connection_remove','vb6_data_command_set','vb6_data_command_remove','vb6_data_rename'])assert.ok(!names.includes(name),name);
    receive(reply(provider));
  }});
  assert.equal(JSON.stringify(ide.project),before);assert.equal(approvals(),0);assert.equal(adapter.enabled,false);
});
for (const provider of providers) test(`agents integration: ${provider} code scope cannot authorize data writes`, async t => {
  const {ide,adapter,agent,approvals}=fixture(t);const before=JSON.stringify(ide.project);
  await assert.rejects(agent.run({provider,model:'test-model',prompt:'Add a public data connection.',mode:'scoped',scopes:['code'],transport:async(body,{receive})=>{
    receive(reply(provider,'vb6_data_connection_set',{mode:'create',definition:{name:'Local',provider:'sqlite',database:'/local.sqlite'},expectedRevision:adapter.revision}));
  }}),/denied/);
  assert.equal(JSON.stringify(ide.project),before);assert.equal(approvals(),1);assert.equal(adapter.enabled,false);
});

for (const provider of providers) test(`agents integration: ${provider} preserves local planning tools without exposing them through MCP`, async t => {
  let questions = 0;
  const {adapter, agent} = fixture(t, {askUser: async () => { questions++; return 'Local answer'; }});
  assert.equal(adapter.tools.length, 125);
  assert.equal(agent.tools.length, 127);
  for (const name of ['vb6.agent.plan', 'vb6.agent.question']) {
    assert.ok(agent.tools.some(tool => tool.name === name));
    assert.ok(!adapter.tools.some(tool => tool.name === name), 'Local tool leaked into external MCP: ' + name);
  }
  await agent.run({provider, model: 'test-model', prompt: 'Inspect the combined catalog.', transport: async (body, {receive}) => {
    const definitions = provider === 'google' ? body.tools[0].functionDeclarations : body.tools;
    assert.equal(definitions.length, 127);
    assert.equal(new Set(definitions.map(tool => tool.name)).size, 127);
    for (const name of ['vb6_agent_plan', 'vb6_agent_question', 'vb6_data_connection_set', 'vb6_code_read'])
      assert.ok(definitions.some(tool => tool.name === name), name);
    receive(reply(provider));
  }});
  assert.equal(questions, 0, 'Catalog discovery must not open a question dialog');
  assert.equal(adapter.enabled, false);
});

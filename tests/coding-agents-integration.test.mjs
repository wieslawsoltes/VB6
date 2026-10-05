import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CodingAgent} from '../src/agents/agent.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject} from '../src/project/model.js';
import {Signal} from '../src/core/core.js';

const providers = ['openai', 'anthropic', 'google'];
function fixture(t) {
  const ide = new Signal();
  Object.assign(ide, {project: newProject('AgentBuild'), runState: 'design', docs: [],
    markDirty() {}, loadProject(project) { this.project = project; }});
  let approvals = 0;
  const adapter = createIdeAdapter(ide, {approve: async () => { approvals++; return false; }});
  const agent = new CodingAgent(adapter);
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
  assert.equal(adapter.tools.length, 114);
  await agent.run({provider, model: 'test-model', prompt: 'Inspect the available tools.', transport: async (body, {receive}) => {
    const definitions = provider === 'google' ? body.tools[0].functionDeclarations : body.tools;
    assert.deepEqual(definitions.map(tool => tool.name).sort(), adapter.tools.map(tool => tool.name.replaceAll('.', '_')).sort());
    for (const name of ['vb6_project_entries', 'vb6_project_group', 'vb6_project_select', 'vb6_project_startup', 'vb6_build_targets', 'vb6_build_create', 'vb6_build_read', 'vb6_build_release'])
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

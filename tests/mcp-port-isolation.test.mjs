import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {McpServer, bindMcpPort} from '../src/mcp/server.js';
import {MCP_VERSION, MCP_META} from '../src/mcp/protocol.js';
import {TASK_EXTENSION} from '../src/mcp/tasks.js';

function fixture(t) {
  const authority = new AbortController();
  const server = new McpServer({tools: [{name: 'vb6.agent.wait', inputSchema: {type: 'object'},
    execute: (_args, context) => new Promise(resolve => context.signal.addEventListener('abort', () => resolve({cancelled: true}), {once: true}))}],
    resources: async () => [], authoritySignal: authority.signal});
  const connections = [0, 1].map(() => {
    const {port1, port2} = new MessageChannel();
    const unbind = bindMcpPort(port1, server);
    let sequence = 0;
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { port2.off('message', receive); reject(new Error('MCP reply timed out')); }, 2000);
      function receive(message) {
        if (message.id !== id) return;
        clearTimeout(timer); port2.off('message', receive); resolve(message);
      }
      port2.on('message', receive); port2.postMessage({jsonrpc: '2.0', id, method, params});
    });
    return {call, unbind, port: port2};
  });
  t.after(() => { for (const item of connections) { item.unbind(); item.port.close(); } server.close(); });
  return {server, connections};
}

test('MCP private ports have independent default legacy sessions', async t => {
  const {server, connections: [a, b]} = fixture(t);
  for (const peer of [a, b]) {
    const reply = await peer.call('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
    assert.ok(reply.result, JSON.stringify(reply));
    peer.port.postMessage({jsonrpc: '2.0', method: 'notifications/initialized'});
    assert.deepEqual((await peer.call('tools/list')).result.tools.map(tool => tool.name), ['vb6.agent.wait']);
  }
  assert.equal(server.sessions.size, 2);
  a.unbind();
  assert.equal(server.sessions.size, 1);
  assert.ok((await b.call('tools/list')).result);
});

test('MCP private ports cannot read or revoke another default port task', async t => {
  const {server, connections: [a, b]} = fixture(t);
  const _meta = {[MCP_META + 'protocolVersion']: MCP_VERSION, [MCP_META + 'clientCapabilities']: {extensions: {[TASK_EXTENSION]: {}}}};
  const created = await a.call('tools/call', {name: 'vb6.agent.wait', arguments: {}, _meta});
  assert.equal(created.result.resultType, 'task');
  const taskId = created.result.taskId;
  assert.equal((await b.call('tasks/get', {taskId, _meta})).error.code, -32602);
  assert.equal((await b.call('tasks/cancel', {taskId, _meta})).error.code, -32602);
  b.unbind();
  assert.equal((await a.call('tasks/get', {taskId, _meta})).result.status, 'working');
  a.unbind();
  assert.equal(server.tasks.entries.size, 0);
});

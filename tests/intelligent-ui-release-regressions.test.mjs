import test from 'node:test';
import assert from 'node:assert/strict';
import {McpAppClient} from '../packages/intelligent-ui/src/mcp-app.js';
import {richUserMessage} from '../src/agents/content.js';

function app() {
  const sent = [], listeners = new Set();
  const parent = {postMessage: message => sent.push(message)};
  const client = new McpAppClient({window: {parent,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener)}, timeout: 100});
  client.ready = true;
  const emit = message => client.receive({source: parent, origin: 'null', data: {jsonrpc: '2.0', ...message}});
  return {client, sent, listeners, emit};
}

test('cancelled MCP App rejects pending and future requests without sending new actions', async t => {
  const {client, sent, emit} = app(); t.after(() => client.dispose());
  const pending = client.sendMessage([{type:'text', text:'pending review'}]);
  const rejected = assert.rejects(pending, error => error.code === 'cancelled');
  await emit({method:'ui/notifications/tool-cancelled', params:{reason:'User stopped'}});
  await rejected;
  const count = sent.length;
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.sendMessage([{type:'text',text:'late'}]), error => error.code === 'cancelled');
  await assert.rejects(client.updateModelContext({structuredContent:{late:true}}), error => error.code === 'cancelled');
  assert.equal(sent.length, count);
  await emit({id:sent[0].id,result:{}}); // Late success cannot revive a cancelled promise.
  assert.equal(client.pending.size, 0);
});

test('MCP App teardown callback failure reports an error and still disposes transport', async () => {
  const {client, sent, listeners, emit} = app();
  client.onTeardown = async () => { throw new Error('Failed to save local view'); };
  await assert.doesNotReject(emit({method:'ui/resource-teardown', id:'teardown'}));
  assert.equal(client.disposed, true);
  assert.equal(listeners.size, 0);
  const response = sent.find(message => message.id === 'teardown');
  assert.match(response.error.message, /Failed to save local view/);
  assert.equal(response.result, undefined);
});

test('teardown drains pending requests before awaiting an embedder callback', async () => {
  const {client, sent, emit} = app();
  let release; client.onTeardown = () => new Promise(resolve => { release = resolve; });
  const pending = client.sendMessage([{type:'text',text:'waiting'}]);
  const rejected = assert.rejects(pending, error => ['cancelled','disposed'].includes(error.code));
  const closing = emit({method:'ui/resource-teardown', id:'close'});
  try {
    assert.equal(client.pending.size, 0);
    await rejected;
    assert.equal(client.disposed, false);
  } finally { release(); await closing; }
  assert.equal(sent.find(message => message.id === 'close').result != null, true);
  assert.equal(client.disposed, true);
});

test('Gemini MIME routing rejects GIF and accepts HEIC/HEIF as inline image data', () => {
  const image = {type:'image', mimeType:'image/gif', data:'AQID'};
  assert.throws(() => richUserMessage('google','Review',[image]), /not supported/);
  for (const mimeType of ['image/png','image/jpeg','image/webp','image/heic','image/heif']) {
    const message = richUserMessage('google','Review',[{...image,mimeType}]);
    assert.deepEqual(message.parts[1], {inlineData:{mimeType,data:'AQID'}});
    assert.equal(message.parts.some(part => part.type === 'image'), false);
  }
  for (const provider of ['openai','anthropic']) {
    assert.throws(() => richUserMessage(provider,'Review',[{...image,mimeType:'image/heic'}]), /not supported/);
    assert.doesNotThrow(() => richUserMessage(provider,'Review',[image]));
  }
});

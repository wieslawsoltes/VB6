/** Test-only mock OpenAI endpoints, reached only through the real protected relay. Never used by the product. */
import {fixture} from '../tests/helpers/chatgpt-fixture.mjs';
import {createAgentRelay} from './agent-relay.mjs';
const f = fixture(); let turn = 0;
f.state.inference = init => {
  const request = JSON.parse(init.body);
  if (request.store !== false || request.stream !== true || request.max_output_tokens !== undefined || (request.tools.length && request.tools[0].type !== 'namespace') || !init.headers.Authorization.startsWith('Bearer secret-access-')) return Response.json({error: {code: 'invalid_request_error'}}, {status: 400});
  const output = turn++ % 2 === 0 && request.tools.length ? [{type: 'function_call', call_id: 'fixture-' + turn, namespace: 'vb6', name: 'ide_project_get', arguments: '{}'}] : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'ChatGPT fixture inspected the VB6 project with permission-gated tools.'}]}];
  return new Response('data: ' + JSON.stringify({type: 'response.completed', response: {status: 'completed', output, usage: {total_tokens: 25}}}) + '\n\n', {headers: {'Content-Type': 'text/event-stream'}});
};
const server = createAgentRelay({token: 'chatgpt-browser-fixture-token-123456789', origins: [process.env.VB6_TEST_ORIGIN], keys: {}, chatgpt: f.auth, fetchImpl: f.fetchImpl});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({relay: 'http://127.0.0.1:' + server.address().port})));
const close = async () => { server.close(); server.closeAllConnections(); await f.auth.close(); };
process.once('SIGTERM', close); process.once('SIGINT', close);

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAgentRelay} from '../tools/agent-relay.mjs';
const token = 'local-token-'.repeat(4), origin = 'http://127.0.0.1:8080';
async function fixture(t, fetchImpl = async () => new Response('{"ok":true}'), keys = {openai: 'cloud-openai', anthropic: 'cloud-anthropic', google: 'cloud-google'}) {
  const server = createAgentRelay({token, origins: [origin], keys, fetchImpl});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  function request({path = '/agent', method = 'POST', headers = {}, body = {provider: 'openai', operation: 'generate', body: {model: 'test-model', input: []}}} = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({hostname: '127.0.0.1', port, path, method, headers: {Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers}}, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString()})); res.on('error', reject);
      }); req.on('error', reject); req.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  return {server, port, request};
}
test('relay: configuration rejects weak tokens, opaque/wildcard/untrusted origin forms', () => {
  for (const bad of ['', 'short', 'a'.repeat(31), 'x'.repeat(32) + '\n']) assert.throws(() => createAgentRelay({token: bad, origins: [origin]}));
  for (const origins of [[], ['*'], ['null'], ['file://'], ['https://example.com/path'], ['https://user@example.com']]) assert.throws(() => createAgentRelay({token, origins}));
});
for (const [name, options, status] of [
  ['missing/wrong token', {headers: {Authorization: 'Bearer bad'}}, 401],
  ['foreign origin', {headers: {Origin: 'https://attacker.example'}}, 403],
  ['opaque origin', {headers: {Origin: 'null'}}, 403],
  ['DNS rebinding host', {headers: {Host: 'attacker.example'}}, 403],
  ['non-loopback host', {headers: {Host: '192.168.0.1'}}, 403],
  ['extra path', {path: '/agent/evil'}, 404],
  ['query string', {path: '/agent?key=x'}, 404],
  ['unsafe method', {method: 'GET'}, 405],
  ['wrong content type', {headers: {'Content-Type': 'text/plain'}}, 415],
  ['invalid JSON', {body: 'malformed-secret-json'}, 400],
  ['unknown provider', {body: {provider: '__proto__', operation: 'generate', body: {}}}, 400],
  ['unknown operation', {body: {provider: 'openai', operation: 'delete'}}, 400],
  ['array body', {body: {provider: 'openai', operation: 'generate', body: []}}, 400],
  ['invalid cursor', {body: {provider: 'openai', operation: 'models', cursor: {url: 'https://evil'}}}, 400],
  ['request size cap', {body: 'x'.repeat(1600001)}, 413]
]) test('relay: rejects ' + name, async t => {
  let called = false; const f = await fixture(t, async () => { called = true; return new Response('{}'); });
  const response = await f.request(options); assert.equal(response.status, status); assert.equal(called, false);
  assert.ok(!response.text.includes('secret')); assert.equal(response.headers['cache-control'], 'no-store');
});
test('relay: exact-origin preflight allows only required headers/method and no credential cookies', async t => {
  const f = await fixture(t); const response = await f.request({method: 'OPTIONS', body: ''});
  assert.equal(response.status, 204); assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers['access-control-allow-methods'], 'POST'); assert.equal(response.headers['access-control-allow-headers'], 'content-type, authorization'); assert.equal(response.headers['access-control-allow-credentials'], undefined);
});
for (const provider of ['openai', 'anthropic', 'google']) test('relay: ' + provider + ' forwards native body to official fixed endpoint with server-side key only', async t => {
  let request; const f = await fixture(t, async (url, options) => { request = {url, options}; return new Response('data: {"ok":true}\n\n', {headers: {'content-type': 'text/event-stream'}}); });
  const response = await f.request({body: {provider, operation: 'generate', body: {model: 'test-model', input: [], contents: []}, url: 'https://attacker.example', headers: {Authorization: 'evil'}}});
  assert.equal(response.status, 200); assert.equal(response.text, 'data: {"ok":true}\n\n'); assert.equal(response.headers['content-type'], 'text/event-stream');
  const expected = {openai: 'https://api.openai.com/v1/responses', anthropic: 'https://api.anthropic.com/v1/messages', google: 'https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse'};
  assert.equal(request.url, expected[provider]); assert.equal(request.options.redirect, 'error');
  const headers = request.options.headers; assert.ok(Object.values(headers).some(value => value.includes('cloud-' + provider))); assert.ok(!JSON.stringify(headers).includes(token)); assert.equal(headers['anthropic-dangerous-direct-browser-access'], undefined);
  assert.ok(!response.text.includes('cloud-')); assert.ok(!request.options.body.includes('attacker.example'));
});
test('relay: model catalogs use GET with fixed path and encoded cursor, not prompt upload', async t => {
  let request; const f = await fixture(t, async (url, options) => { request = {url, options}; return new Response('{"models":[]}'); });
  const response = await f.request({body: {provider: 'google', operation: 'models', cursor: 'x?key=secret'}});
  assert.equal(response.status, 200); assert.equal(request.options.method, 'GET'); assert.equal(request.options.body, undefined);
  assert.equal(new URL(request.url).searchParams.get('pageToken'), 'x?key=secret'); assert.equal(new URL(request.url).searchParams.has('key'), false);
});
test('relay: missing server-side key fails closed and ignores browser key', async t => {
  let called = false; const f = await fixture(t, async () => { called = true; }, {});
  const response = await f.request({body: {provider: 'openai', operation: 'generate', body: {model: 'test-model'}, apiKey: 'browser-secret'}});
  assert.equal(response.status, 503); assert.equal(called, false); assert.ok(!response.text.includes('browser-secret'));
});
for (const status of [401, 429, 500]) test('relay: upstream HTTP ' + status + ' body is not exposed', async t => {
  const f = await fixture(t, async () => new Response('cloud-openai confidential-error', {status}));
  const response = await f.request(); assert.equal(response.status, status); assert.equal(response.text, '');
});
test('relay: upstream exceptions are sanitized', async t => {
  const f = await fixture(t, async () => { throw new Error('cloud-openai confidential-error'); });
  const response = await f.request(); assert.equal(response.status, 400); assert.equal(response.text, '{"error":"Relay request failed."}');
});
test('relay: client disconnect cancels pending upstream request', async t => {
  let signal, entered; const ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async (_, options) => { signal = options.signal; entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true})); });
  const req = http.request({hostname: '127.0.0.1', port: f.port, path: '/agent', method: 'POST', headers: {Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}});
  req.on('error', () => {}); req.end(JSON.stringify({provider: 'openai', operation: 'generate', body: {model: 'test-model'}}));
  await ready; req.destroy(); await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); assert.equal(signal.aborted, true);
});
test('relay: at most four upstream requests can be active', async t => {
  let count = 0; const release = [];
  const f = await fixture(t, async () => { count++; await new Promise(resolve => release.push(resolve)); return new Response('{}'); });
  const pending = Array.from({length: 4}, () => f.request());
  while (count < 4) await new Promise(resolve => setImmediate(resolve));
  const response = await f.request(); assert.equal(response.status, 429); assert.equal(count, 4);
  release.forEach(resolve => resolve()); await Promise.all(pending);
  assert.equal((await f.request({method: 'OPTIONS', body: ''})).status, 204);
});

for (const [value, expected] of [['2.5', '3'], ['9000', '300'], ['private-secret-not-a-date', undefined]]) test('relay: retry delay is bounded and sanitized: ' + value, async t => {
  const f = await fixture(t, async () => new Response('private-error-body', {status: 429, headers: {'retry-after': value, 'x-provider-secret': 'private-secret'}}));
  const response = await f.request();
  assert.equal(response.status, 429); assert.equal(response.text, '');
  assert.equal(response.headers['retry-after'], expected);
  assert.equal(response.headers['access-control-expose-headers'], 'Retry-After');
  assert.equal(response.headers['x-provider-secret'], undefined);
  assert.ok(!JSON.stringify(response).includes('private-secret'));
});

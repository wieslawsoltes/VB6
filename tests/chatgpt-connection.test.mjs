import test from 'node:test';
import assert from 'node:assert/strict';
import {chatGPTControl, chatGPTSetup, chatGPTAuthorizationURL} from '../src/agents/chatgpt-connection.js';

const config = {relay: 'http://127.0.0.1:4892', relayToken: 'local-relay-not-an-openai-key', operation: 'status'};
const valid = {accounts: [], login: 'idle'};

test('ChatGPT setup uses the current exact origin, never an IDE query or fragment', () => {
  const setup = chatGPTSetup('https://wieslawsoltes.github.io/VB6/?private=secret#password');
  assert.equal(setup.origin, 'https://wieslawsoltes.github.io');
  assert.equal(setup.posix, "VB6_AGENT_ORIGINS='https://wieslawsoltes.github.io' npm run agent:relay");
  assert.equal(setup.powershell, "$env:VB6_AGENT_ORIGINS = 'https://wieslawsoltes.github.io'; npm run agent:relay");
  assert.doesNotMatch(JSON.stringify(setup), /secret|private|password/);
  assert.equal(chatGPTSetup('http://localhost:8080/x').origin, 'http://localhost:8080');
});

test('ChatGPT setup quotes unusual hostname characters safely in both shells', () => {
  const setup = chatGPTSetup("https://o'hare.example/"), dollar = chatGPTSetup('https://a$HOME.example/');
  assert.equal(setup.posix, "VB6_AGENT_ORIGINS='https://o'\"'\"'hare.example' npm run agent:relay");
  assert.equal(setup.powershell, "$env:VB6_AGENT_ORIGINS = 'https://o''hare.example'; npm run agent:relay");
  assert.ok(dollar.posix.includes("'https://a$home.example'"));
});

test('file and packaged native origins give local HTTP setup rather than a null allowlist', () => {
  for (const href of ['file:///tmp/secret/VB6.html', 'vb6://app/index.html']) {
    const setup = chatGPTSetup(href);
    assert.equal(setup.unsupported, true);
    assert.equal(setup.origin, 'http://127.0.0.1:8080');
    assert.doesNotMatch(setup.posix, /null|secret/);
  }
});

test('only the fixed OpenAI authorization destination is accepted, without retained tokens', () => {
  const url = 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=test';
  assert.equal(chatGPTAuthorizationURL(url), url);
  for (const value of ['', null, {}, 'javascript:alert(1)', url + '#secret', url.replace('https:', 'http:'), url.replace('auth.openai.com', 'auth.openai.com.evil.invalid'), url.replace('auth.openai.com', 'user:pass@auth.openai.com'), url.replace('/api/accounts/authorize', '/other'), 'x'.repeat(17000)]) assert.throws(() => chatGPTAuthorizationURL(value), /invalid sign-in address/);
  for (const key of ['access_token', 'refresh_token', 'id_token', 'id_token_hint', 'client_secret']) assert.throws(() => chatGPTAuthorizationURL(url + '&' + key + '=secret'), /invalid sign-in address/);
});

test('missing relay token or invalid destination fails before making any request', async () => {
  let calls = 0; const fetchImpl = () => { calls++; throw new Error('must not fetch'); };
  for (const relayToken of ['', '  ', 'a\r\nb', '\0']) await assert.rejects(chatGPTControl({...config, relayToken, fetchImpl}), /local access token/);
  for (const relay of ['', 'https://evil.invalid', 'http://127.0.0.1:4892?secret=yes']) await assert.rejects(chatGPTControl({...config, relay, fetchImpl}), /loopback Relay URL/);
  assert.equal(calls, 0);
});

test('pasted token edge whitespace is trimmed, secrets remain in the header only', async () => {
  let request;
  assert.deepEqual(await chatGPTControl({...config, relayToken: ' \nlocal-token\t ', fetchImpl: async (url, init) => { request = {url, ...init}; return Response.json(valid); }}), valid);
  assert.equal(request.headers.Authorization, 'Bearer local-token');
  assert.doesNotMatch(request.url + request.body, /local-token/);
  assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store');
});

for (const [status, hint] of [[401, /currently running relay/], [403, /exact-origin/], [404, /updated source/], [429, /relay is busy/], [503, /operation failed/]]) {
  test('ChatGPT management HTTP ' + status + ' is actionable without echoing error bodies', async () => {
    await assert.rejects(chatGPTControl({...config, fetchImpl: async () => Response.json({error: {message: 'secret-token-credential', code: 'unrecognized'}}, {status})}), error => hint.test(error.message) && !error.message.includes('secret-token'));
  });
}

test('prototype property error codes cannot become UI messages', async () => {
  for (const code of ['__proto__', 'constructor', 'toString']) await assert.rejects(chatGPTControl({...config, fetchImpl: async () => Response.json({error: {code}}, {status: 400})}), /operation failed/);
});

test('outdated/disabled relay and OpenAI discovery errors retain distinct safe hints', async () => {
  for (const [code, hint] of [['chatgpt_relay_disabled', /VB6_CHATGPT_ENABLED/], ['chatgpt_invalid_discovery', /OpenAI sign-in configuration/], ['chatgpt_connection_failed', /OpenAI from the relay/]])
    await assert.rejects(chatGPTControl({...config, fetchImpl: async () => Response.json({error: {code, message: 'secret'}}, {status: 503})}), hint);
});

test('network errors explain local relay, exact origin and browser permission, not raw errors', async () => {
  await assert.rejects(chatGPTControl({...config, fetchImpl: async () => { throw new TypeError('private proxy error'); }}), error => /local ChatGPT relay/.test(error.message) && /exact IDE origin/.test(error.message) && /local-network/.test(error.message) && !error.message.includes('private proxy'));
});

test('malformed, empty and oversized relay response bodies fail with a safe visible explanation', async () => {
  for (const body of ['', '<script>secret</script>', 'x'.repeat(262145)])
    await assert.rejects(chatGPTControl({...config, fetchImpl: async () => new Response(body)}), /invalid or interrupted status/);
});

test('request deadline covers the entire stalled body after HTTP headers, and cancels the reader', async t => {
  // Keep a referenced timer: AbortSignal.timeout deliberately does not hold Node open.
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  let cancelled = false, fetchSignal;
  await assert.rejects(chatGPTControl({...config, timeoutMs: 20, fetchImpl: async (_url, init) => {
    fetchSignal = init.signal;
    return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('{"accounts":')); }, cancel() { cancelled = true; }}));
  }}), /did not finish responding in time/);
  assert.equal(fetchSignal.aborted, true); assert.equal(cancelled, true);
});

test('request timeout before headers releases waiting controls rather than disguising a cancellation', async t => {
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await assert.rejects(chatGPTControl({...config, timeoutMs: 20, fetchImpl: async (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))}), /did not finish responding in time/);
});

test('caller cancellation is preserved before fetch and during a streamed status response', async () => {
  const stopped = new AbortController(); stopped.abort(); let calls = 0;
  await assert.rejects(chatGPTControl({...config, signal: stopped.signal, fetchImpl: async () => { calls++; }}), {name: 'AbortError'});
  assert.equal(calls, 0);
  const controller = new AbortController(); let cancelled = false;
  const operation = chatGPTControl({...config, signal: controller.signal, fetchImpl: async () => new Response(new ReadableStream({cancel() { cancelled = true; }}))});
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(operation, {name: 'AbortError'}); assert.equal(cancelled, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {chatGPTBrowserCommand, openChatGPTBrowser} from '../tools/chatgpt-browser.mjs';
import {chatGPTControl} from '../tools/chatgpt-relay.mjs';
import {createAgentRelay} from '../tools/agent-relay.mjs';
import {fixture} from './helpers/chatgpt-fixture.mjs';
const url = 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=fixture&response_type=code';
const origin = 'http://127.0.0.1:8080', token = 'local-browser-launch-token-123456789';

for (const [platform, file, args] of [
  ['darwin', '/usr/bin/open', [url]], ['linux', 'xdg-open', [url]],
  ['win32', 'C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]
]) test('system browser uses argument vectors, never a shell: ' + platform, () => {
  assert.deepEqual(chatGPTBrowserCommand(url, platform, {}), {file, args});
});
test('native browser launcher refuses foreign URLs, schemes, credentials and token hints', () => {
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://auth.openai.com.evil.invalid/api/accounts/authorize',
    url + '#fragment', url.replace('https://', 'https://user:password@'), url.replace('/api/accounts/authorize', '/other'),
    url + '&access_token=secret', url + '&refresh_token=secret', url + '&id_token_hint=secret', url + '&x="bad"', url + '\n'])
    assert.throws(() => chatGPTBrowserCommand(value));
  assert.equal(chatGPTBrowserCommand(url, 'unsupported'), null);
});
test('Windows launcher uses the trusted system directory and rejects malformed paths', () => {
  assert.equal(chatGPTBrowserCommand(url, 'win32', {SystemRoot: 'D:\\Windows'}).file, 'D:\\Windows\\System32\\rundll32.exe');
  for (const SystemRoot of ['relative', 'C:\\Windows" & command', '\\server\\share', 'C:\\Windows\n'])
    assert.throws(() => chatGPTBrowserCommand(url, 'win32', {SystemRoot}));
});
for (const scenario of ['success', 'exit-error', 'spawn-error', 'throws', 'timeout', 'abort']) test('launcher settles safely on ' + scenario, async () => {
  let invocation, child; const controller = new AbortController();
  const result = await openChatGPTBrowser(url, {platform: 'linux', signal: controller.signal, timeoutMs: 20,
    spawnImpl(file, args, options) {
      invocation = {file, args, options};
      if (scenario === 'throws') throw new Error('private');
      child = new EventEmitter(); child.unref = () => {};
      queueMicrotask(() => {
        if (scenario === 'spawn-error') child.emit('error', new Error('private'));
        if (scenario === 'success' || scenario === 'exit-error') child.emit('exit', scenario === 'success' ? 0 : 1);
        if (scenario === 'abort') controller.abort();
      }); return child;
    }});
  assert.equal(result, scenario === 'success');
  assert.deepEqual(invocation.options, {shell: false, stdio: 'ignore', windowsHide: true});
  assert.deepEqual(invocation.args, [url]);
});
test('launcher exercises actual subprocess completion without opening a real account', async () => {
  assert.equal(await openChatGPTBrowser(url, {platform: 'linux', spawnImpl: (_file, _args, options) => spawn(process.execPath, ['-e', 'process.exit(0)'], options)}), true);
});
test('already cancelled requests never create a process', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(openChatGPTBrowser(url, {signal: controller.signal, spawnImpl() { calls++; }}), {name: 'AbortError'});
  assert.equal(calls, 0);
});
for (const outcome of [true, false, 'throws', 'missing']) test('relay preserves the validated manual URL when launcher outcome is ' + outcome, async t => {
  const f = fixture(); t.after(() => f.auth.close()); let launched;
  const result = await chatGPTControl(f.auth, {operation: 'login', openBrowser: true, authorizationUrl: 'https://evil.invalid'}, {
    openBrowser: outcome === 'missing' ? null : async value => { launched = value; if (outcome === 'throws') throw new Error('private-launcher'); return outcome; }
  });
  assert.equal(result.browser, outcome === true ? 'launched' : outcome === 'missing' ? 'unavailable' : 'failed');
  assert.equal(result.login, 'pending');
  assert.equal(new URL(result.authorizationUrl).origin, 'https://auth.openai.com');
  if (launched) assert.equal(launched, result.authorizationUrl);
  assert.doesNotMatch(JSON.stringify(result), /private-launcher|evil.invalid|access_token|refresh_token/);
});
test('status refresh does not open a browser, and duplicate login cannot open another', async t => {
  const f = fixture(); t.after(() => f.auth.close()); let calls = 0;
  const options = {openBrowser: async () => { calls++; return true; }};
  await chatGPTControl(f.auth, {operation: 'status', openBrowser: true}, options); assert.equal(calls, 0);
  await chatGPTControl(f.auth, {operation: 'login', openBrowser: true}, options);
  await assert.rejects(chatGPTControl(f.auth, {operation: 'login', openBrowser: true}, options)); assert.equal(calls, 1);
});
test('legacy relay login without launch opt-in retains its original response and behavior', async t => {
  const f = fixture(); t.after(() => f.auth.close()); let calls = 0;
  const result = await chatGPTControl(f.auth, {operation: 'login'}, {openBrowser: async () => { calls++; return true; }});
  assert.equal(calls, 0); assert.equal(result.browser, undefined); assert.equal(result.login, 'pending');
});
test('nonboolean launch input is rejected before starting an attempt', async t => {
  const f = fixture(); t.after(() => f.auth.close());
  await assert.rejects(chatGPTControl(f.auth, {operation: 'login', openBrowser: 'https://evil.invalid'}));
  assert.equal(f.auth.status().login, 'idle');
});
test('disconnect/cancel suppresses a late OS launch after authorization setup', async () => {
  const controller = new AbortController(); let calls = 0;
  const auth = {start: async () => { controller.abort(); return {authorizationUrl: url, loginId: 'pending'}; }, status: () => ({loginId: 'pending'})};
  const result = await chatGPTControl(auth, {operation: 'login', openBrowser: true}, {signal: controller.signal, openBrowser: async () => { calls++; return true; }});
  assert.equal(calls, 0); assert.equal(result.browser, 'unavailable');
});
test('actual HTTP relay requires token and exact Origin/Host before any OS launch', async t => {
  const f = fixture(); let calls = 0;
  const server = createAgentRelay({token, origins: [origin], chatgpt: f.auth, openBrowser: async value => { assert.equal(new URL(value).origin, 'https://auth.openai.com'); calls++; return true; }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await f.auth.close(); });
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/agent/chatgpt';
  const request = headers => new Promise((resolve, reject) => {
    const req = http.request(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer ' + token, ...headers}}, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode}))); res.on('error', reject);
    }); req.on('error', reject); req.end(JSON.stringify({operation: 'login', openBrowser: true}));
  });
  assert.equal((await request({Authorization: 'Bearer invalid'})).status, 401);
  assert.equal((await request({Origin: 'https://evil.invalid'})).status, 403);
  assert.equal((await request({Origin: 'null'})).status, 403);
  assert.equal((await request({Host: 'evil.invalid'})).status, 403);
  assert.equal(calls, 0);
  const response = await request({}); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.browser, 'launched'); assert.equal(calls, 1);
  const again = await request({}); assert.equal(again.status, 409); assert.equal(calls, 1);
});

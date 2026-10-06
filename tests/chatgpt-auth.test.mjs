import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, chmod, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fixture, jwt, jwk} from './helpers/chatgpt-fixture.mjs';
import {createChatGPTStore, verifyIdentity, CHATGPT_ISSUER, CHATGPT_SCOPE} from '../tools/chatgpt-auth.mjs';
const authTest = (name, fn) => test('ChatGPT auth: ' + name, async t => { const f = fixture(); t.after(() => f.auth.close()); await fn(f, t); });

authTest('dynamic registration + PKCE + verified scopes; never exposes tokens', async f => {
  const start = await f.start(), u = new URL(start.authorizationUrl);
  assert.equal(u.origin, CHATGPT_ISSUER); assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(u.searchParams.get('agent_name_hint'), 'VB6 Studio Web'); assert.equal(u.searchParams.get('scope'), CHATGPT_SCOPE);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('resource'), 'https://api.openai.com/v1');
  assert.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.ok(!u.searchParams.has('code_verifier')); assert.ok(!u.searchParams.has('id_token_hint'));
  assert.equal((await f.callback()).status, 200);
  const status = f.auth.status(); assert.equal(status.login, 'complete'); assert.equal(status.accounts.length, 1); assert.equal(status.accounts[0].planEnabled, true);
  assert.doesNotMatch(JSON.stringify(status), /secret-access|secret-refresh|idToken|clientId|nonce|verifier/);
  const call = f.calls.find(x => x.url.endsWith('/oauth/token')), params = new URLSearchParams(call.body);
  assert.equal(params.get('client_id'), 'oaiapp_fixture'); assert.equal(params.has('client_secret'), false);
  assert.equal((await f.auth.authorize(status.accounts[0].id)).accessToken, 'secret-access-1');
});
authTest('wrong/duplicate state cannot consume the legitimate transaction', async f => {
  await f.start(); assert.equal((await f.callback({state: 'attacker'})).status, 400); assert.equal(f.auth.status().login, 'pending');
  const u = new URL(f.transaction.searchParams.get('redirect_uri')); u.searchParams.append('state', f.transaction.searchParams.get('state')); u.searchParams.append('state', f.transaction.searchParams.get('state'));
  assert.equal((await fetch(u)).status, 400); assert.equal(f.calls.filter(x => x.url.endsWith('/oauth/token')).length, 0);
  assert.equal((await f.callback()).status, 200);
});
authTest('callback errors and cancellation do not exchange codes', async f => {
  await f.start(); assert.equal((await f.callback({error: 'access_denied'})).status, 400); assert.equal(f.auth.status().login, 'declined');
  await f.start(); const old = f.transaction; f.auth.cancel(); assert.equal(f.auth.status().login, 'cancelled');
  await f.start(); assert.notEqual(old.searchParams.get('state'), f.transaction.searchParams.get('state')); assert.equal(f.calls.filter(x => x.url.endsWith('/oauth/token')).length, 0);
});
authTest('missing issued client ID fails first registration', async f => {
  await f.start(); assert.equal((await f.callback({client_id: 'dynamic_agent_client'})).status, 400); assert.equal(f.auth.status().accounts.length, 0);
});
authTest('returning client ID is reused; callback substitution is rejected', async f => {
  const id = await f.login(); await f.start({accountId: id});
  assert.equal(f.transaction.searchParams.get('client_id'), 'oaiapp_fixture'); assert.equal(f.transaction.searchParams.has('agent_name_hint'), false);
  assert.equal((await f.callback({client_id: 'oaiapp_other'})).status, 400); assert.equal((await f.auth.authorize(id)).accessToken, 'secret-access-1');
});
authTest('identity-only consent cannot run inference; explicit reconsent works', async f => {
  f.state.scope = 'openid email offline_access'; const id = await f.login(); assert.equal(f.auth.status().accounts[0].planEnabled, false);
  await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_consent_required'});
  f.state.scope = CHATGPT_SCOPE; await f.start({accountId: id, consent: true}); assert.equal(f.transaction.searchParams.get('prompt'), 'consent'); await f.callback();
  assert.equal(f.auth.status().accounts[0].planEnabled, true);
});
authTest('failed account switch preserves the previous account and tokens', async f => {
  const id = await f.login(); f.state.subject = 'subject-B'; await f.start({accountId: id}); assert.equal((await f.callback()).status, 400);
  assert.equal((await f.auth.authorize(id)).accessToken, 'secret-access-1'); assert.equal(f.auth.status().accounts.length, 1);
});
authTest('multiple identities retain separate registrations and credentials', async f => {
  const idA = await f.login(); f.state.subject = 'subject-B'; f.state.client = 'oaiapp_second'; const idB = await f.login();
  assert.notEqual(idA, idB); assert.equal((await f.auth.authorize(idA)).accessToken, 'secret-access-1'); assert.equal((await f.auth.authorize(idB)).accessToken, 'secret-access-2');
  await f.auth.logout(idB); assert.equal((await f.auth.authorize(idA)).accessToken, 'secret-access-1');
});
authTest('refresh is single-flight, rotates tokens and omits scope', async f => {
  const id = await f.login(), prior = await f.auth.authorize(id); f.advance(3550000);
  const results = await Promise.all(Array.from({length: 12}, () => f.auth.authorize(id)));
  assert.ok(results.every(x => x.accessToken === 'secret-access-2')); assert.equal(prior.signal.aborted, false);
  const calls = f.calls.filter(x => x.url.endsWith('/oauth/token')); assert.equal(calls.length, 2);
  const params = new URLSearchParams(calls[1].body); assert.equal(params.get('refresh_token'), 'secret-refresh-1'); assert.equal(params.has('scope'), false);
  assert.equal(f.writes.at(-1).accounts[0].tokens.refreshToken, 'secret-refresh-2');
});
authTest('earliest refresh timestamp prevents early refresh and expired use', async f => {
  f.state.tokenFields = {earliest_refresh_at: f.now() / 1000 + 4000}; const id = await f.login(); f.advance(3550000);
  assert.equal((await f.auth.authorize(id)).accessToken, 'secret-access-1'); f.advance(100000);
  await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_refresh_not_ready'}); assert.equal(f.calls.filter(x => x.url.endsWith('/oauth/token')).length, 1);
});
for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) authTest('terminal refresh ' + code + ' clears tokens but not registration', async f => {
  const id = await f.login(); f.advance(3600000); f.state.refreshError = code;
  await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_session_expired'}); assert.equal(f.auth.status().accounts.length, 1); assert.equal(f.auth.status().accounts[0].signedIn, false); assert.equal(f.writes.at(-1).accounts[0].tokens, undefined);
});
authTest('temporary refresh failure retains credentials', async f => {
  const id = await f.login(); f.advance(3600000); f.state.networkError = true; await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_connection_failed'});
  assert.equal(f.auth.status().accounts[0].signedIn, true); f.state.networkError = false; assert.equal((await f.auth.authorize(id)).accessToken, 'secret-access-2');
});
authTest('logout aborts generation, revokes latest token, retains client ID', async f => {
  const id = await f.login(), credential = await f.auth.authorize(id); const result = await f.auth.logout(id);
  assert.equal(credential.signal.aborted, true); assert.equal(result.revoked, true); assert.equal(result.accounts[0].signedIn, false);
  const params = new URLSearchParams(f.calls.find(x => x.url.endsWith('/oauth/revoke')).body); assert.equal(params.get('token'), 'secret-refresh-1'); assert.equal(params.get('client_id'), 'oaiapp_fixture');
  await assert.rejects(f.auth.authorize(id)); await f.start({accountId: id}); assert.equal(f.transaction.searchParams.get('client_id'), 'oaiapp_fixture');
});
authTest('failed remote revocation is reported, not misrepresented', async f => {
  const id = await f.login(); f.state.revokeStatus = 503; const result = await f.auth.logout(id); assert.equal(result.revoked, false); assert.equal(result.accounts[0].signedIn, false);
  assert.equal(f.calls.filter(x => x.url.endsWith('/oauth/revoke')).length, 2);
});
authTest('logout stops requests immediately during a pending rotation', async f => {
  const id = await f.login(), credential = await f.auth.authorize(id); let finish, started;
  const begun = new Promise(r => { started = r; }); f.state.beforeRefresh = () => { started(); return new Promise(r => { finish = r; }); };
  f.advance(3550000); const renewing = f.auth.authorize(id); await begun;
  const leaving = f.auth.logout(id); assert.equal(credential.signal.aborted, true); await assert.rejects(f.auth.authorize(id)); finish(); await renewing.catch(() => {}); await leaving;
  assert.equal(new URLSearchParams(f.calls.find(x => x.url.endsWith('/oauth/revoke')).body).get('token'), 'secret-refresh-2');
});
authTest('discovery cannot redirect credentials to arbitrary endpoints', async f => {
  f.state.discovery = {jwks_uri: 'https://evil.invalid/jwks'}; await assert.rejects(f.start()); assert.ok(f.calls.every(c => c.url.startsWith(CHATGPT_ISSUER + '/')));
});
const now = Date.now(), claims = {iss: CHATGPT_ISSUER, aud: 'oaiapp_test', sub: 'test-sub', nonce: 'nonce-value', exp: now / 1000 + 100, iat: now / 1000};
for (const [name, patch] of Object.entries({issuer: {iss: 'https://evil.invalid'}, audience: {aud: 'other'}, expiry: {exp: now / 1000 - 30}, nonce: {nonce: 'wrong'}, future: {iat: now / 1000 + 60}, nbf: {nbf: now / 1000 + 60}, subject: {sub: ''}, authorizedParty: {aud: ['oaiapp_test', 'other'], azp: 'other'}})) {
  test('ChatGPT identity rejects wrong ' + name, () => assert.throws(() => verifyIdentity(jwt({...claims, ...patch}), [jwk], {client: 'oaiapp_test', nonce: 'nonce-value', now})));
}
test('ChatGPT identity verifies signature, prevents algorithm/key confusion', () => {
  assert.equal(verifyIdentity(jwt(claims), [jwk], {client: 'oaiapp_test', nonce: 'nonce-value', now}).sub, 'test-sub');
  for (const header of [{alg: 'none'}, {alg: 'HS256'}, {kid: 'unknown'}, {jku: 'https://evil.invalid/jwks'}, {crit: ['exp']}]) assert.throws(() => verifyIdentity(jwt(claims, header), [jwk], {client: 'oaiapp_test', nonce: 'nonce-value', now}));
  const parts = jwt(claims).split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1); assert.throws(() => verifyIdentity(parts.join('.'), [jwk], {client: 'oaiapp_test', nonce: 'nonce-value', now}));
});
test('ChatGPT store: private atomic records, stable host, exclusive lock, default no tokens', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vb6-chatgpt-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const store = await createChatGPTStore({directory: dir}); const host = store.data.hostId;
  await assert.rejects(createChatGPTStore({directory: dir}), /locked/);
  await store.save({...store.data, accounts: [{id: randomUUID(), issuer: CHATGPT_ISSUER, sub: 'S', clientId: 'oaiapp_C', tokens: {accessToken: 'DO-NOT-PERSIST'}}]});
  assert.doesNotMatch(await readFile(path.join(dir, 'accounts.json'), 'utf8'), /DO-NOT-PERSIST|tokens/);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(dir, 'accounts.json'))).mode & 0o777, 0o600);
  await store.close(); const again = await createChatGPTStore({directory: dir}); assert.equal(again.data.hostId, host); await again.close();
});
test('ChatGPT store rejects permissive Unix credential files', {skip: process.platform === 'win32'}, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vb6-chatgpt-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const store = await createChatGPTStore({directory: dir}); await store.close(); await chmod(path.join(dir, 'accounts.json'), 0o644);
  await assert.rejects(createChatGPTStore({directory: dir}), /Unsafe/);
});
authTest('late cancel cannot cancel a newer login transaction', async f => {
  const first = await f.start(); f.auth.cancel(first.loginId); const second = await f.start();
  assert.notEqual(first.loginId, second.loginId); f.auth.cancel(first.loginId); assert.equal(f.auth.status().login, 'pending');
  assert.equal((await f.callback()).status, 200);
});
authTest('identity-only result without access/refresh tokens retains identity, not inference access', async f => {
  f.state.scope = 'openid profile email'; f.state.tokenFields = {access_token: undefined, refresh_token: undefined, token_type: undefined, expires_in: undefined};
  const id = await f.login(); assert.equal(f.auth.status().accounts[0].signedIn, true); assert.equal(f.auth.status().accounts[0].planEnabled, false);
  await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_consent_required'}); assert.equal((await f.auth.logout(id)).revoked, true);
});
authTest('refresh cannot silently reuse an old rotating refresh token', async f => {
  const id = await f.login(); f.advance(3550000); f.state.tokenFields = {refresh_token: undefined};
  await assert.rejects(f.auth.authorize(id), {code: 'chatgpt_invalid_response'});
  assert.equal(f.writes.at(-1).accounts[0].tokens.refreshToken, 'secret-refresh-1');
});

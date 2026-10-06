/** OpenAI's documented public-client Sign in with ChatGPT flow. No Codex credentials or client secrets.
 * https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 * Network destinations are fixed; tokens never cross the loopback relay boundary.
 */
import http from 'node:http';
import {randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual} from 'node:crypto';
import {mkdir, open, lstat, readFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const permission = 'chatgpt.tokens.use.direct';
const opaque = () => randomBytes(32).toString('base64url');
const text = (value, max = 16384) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\0]/.test(value);
const equal = (a, b) => text(a) && text(b) && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clientId = value => text(value, 256) && /^[A-Za-z0-9_.-]+$/.test(value) && value !== 'dynamic_agent_client';
const safeEndpoint = value => { const u = new URL(value); if (u.origin !== CHATGPT_ISSUER || u.username || u.password || u.search || u.hash) throw new Error('Untrusted OpenAI discovery endpoint.'); return u.href; };
export class ChatGPTAuthError extends Error {
  constructor(code = 'chatgpt_sign_in_required', status = 401) { super(code); this.name = 'ChatGPTAuthError'; this.code = code; this.status = status; }
}
/** Strict, bounded JSON, including error bodies; response contents are never used as UI messages. */
async function json(response) {
  const reader = response.body?.getReader(); if (!reader) throw new ChatGPTAuthError('chatgpt_invalid_response', 502);
  let bytes = 0; const chunks = [];
  try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; if (bytes > 262144) throw new Error(); chunks.push(Buffer.from(item.value)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new ChatGPTAuthError('chatgpt_invalid_response', 502); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Intentionally narrow JWS verifier: asymmetric RS256/ES256 only, no JWT-selected URLs or algorithms. */
export function verifyIdentity(jwt, keys, {client, nonce, subject, now = Date.now()} = {}) {
  const invalid = () => { throw new ChatGPTAuthError('chatgpt_invalid_identity'); };
  try {
    if (!text(jwt) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) return invalid();
    const [head, body, signature] = jwt.split('.'), h = JSON.parse(Buffer.from(head, 'base64url')), p = JSON.parse(Buffer.from(body, 'base64url'));
    if (!['RS256', 'ES256'].includes(h.alg) || !text(h.kid, 256) || h.crit || h.jku || h.jwk || h.x5u || h.b64 === false) return invalid();
    const matches = keys.filter(k => k.kid === h.kid && (!k.alg || k.alg === h.alg) && (!k.use || k.use === 'sig') && (!k.key_ops || k.key_ops.includes('verify')) && (h.alg === 'RS256' ? k.kty === 'RSA' && Buffer.from(k.n || '', 'base64url').length >= 256 : k.kty === 'EC' && k.crv === 'P-256'));
    if (matches.length !== 1) return invalid();
    const key = createPublicKey({key: matches[0], format: 'jwk'});
    if (!verify('sha256', Buffer.from(head + '.' + body), {key, ...(h.alg === 'ES256' ? {dsaEncoding: 'ieee-p1363'} : {})}, Buffer.from(signature, 'base64url'))) return invalid();
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud], seconds = now / 1000;
    if (p.iss !== CHATGPT_ISSUER || !aud.includes(client) || (aud.length > 1 && p.azp !== client) || (p.azp && p.azp !== client) || !text(p.sub, 512) || !Number.isFinite(p.exp) || p.exp <= seconds - 5 || !Number.isFinite(p.iat) || p.iat > seconds + 5 || (p.nbf !== undefined && (!Number.isFinite(p.nbf) || p.nbf > seconds + 5)) || (nonce !== undefined && !equal(p.nonce, nonce)) || (subject && p.sub !== subject)) return invalid();
    return {sub: p.sub, email: text(p.email, 256) ? p.email : '', name: text(p.name, 256) ? p.name : ''};
  } catch { return invalid(); }
}
/** Owner-only Unix files; credentials are memory-only by default, including on Windows.
 * Only non-secret registration/host identifiers are persisted unless explicit Unix remember mode is selected.
 * An exclusive lifetime lock serializes all processes, including rotating refresh-token writes.
 */
export async function createChatGPTStore({directory = path.join(homedir(), '.vb6-agent', 'chatgpt'), remember = false} = {}) {
  if (remember && process.platform === 'win32') throw new Error('Persistent ChatGPT tokens require an OS-protected credential-store adapter on Windows. Use the default memory-only mode.');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (process.platform !== 'win32' && ((dir.mode & 0o077) || dir.uid !== process.getuid()))) throw new Error('ChatGPT directory must be owned by this user with mode 0700.');
  const filename = path.join(directory, 'accounts.json'), lock = path.join(directory, 'session.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); await handle.close(); }
  catch { throw new Error('ChatGPT store is locked. Stop the other relay first. After a crash, remove session.lock only after confirming no relay is running.'); }
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await unlink(lock).catch(() => {}); } };
  try {
    let data = {version: 1, hostId: 'urn:uuid:' + randomUUID(), accounts: []};
    try {
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw new Error('Unsafe ChatGPT registration file.');
      data = JSON.parse(await readFile(filename, 'utf8'));
      if (data.version !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId) || !Array.isArray(data.accounts) || data.accounts.length > 16 || data.accounts.some(a => !text(a.id, 128) || !clientId(a.clientId) || !text(a.sub, 512) || a.issuer !== CHATGPT_ISSUER)) throw new Error('Invalid ChatGPT registration file.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const save = async value => {
      if (closed) throw new Error('ChatGPT store closed.');
      const copy = structuredClone(value);
      if (!remember) for (const account of copy.accounts) delete account.tokens;
      const temp = filename + '.' + randomUUID() + '.tmp';
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(copy)); await file.sync(); await file.close(); await rename(temp, filename); }
      finally { await file.close().catch(() => {}); await unlink(temp).catch(() => {}); }
    };
    if (!remember) for (const account of data.accounts) delete account.tokens;
    await save(data); // Persist host ID before the first authorization; also remove old tokens in memory-only mode.
    return {data, save, close, remember};
  } catch (error) { await close(); throw error; }
}
export function createChatGPTAuth({store, fetchImpl = globalThis.fetch, now = Date.now, loginTimeoutMs = 600000} = {}) {
  if (!store?.data) throw new Error('ChatGPT registration store required.');
  let data = structuredClone(store.data), pending = null, lastLogin = 'idle', discovery, keys, keysAt = 0, closed = false;
  const refreshes = new Map(), sessions = new Map(), serial = {promise: Promise.resolve()};
  for (const a of data.accounts) if (a.tokens) sessions.set(a.id, {tokens: a.tokens, controller: new AbortController(), refreshController: new AbortController(), signingOut: false});
  const change = action => { const result = serial.promise.then(action); serial.promise = result.catch(() => {}); return result; };
  const account = id => data.accounts.find(a => a.id === id);
  const fail = (code, status) => { throw new ChatGPTAuthError(code, status); };
  const network = async (url, options = {}) => {
    try { return await fetchImpl(url, {...options, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([options.signal, AbortSignal.timeout(30000)].filter(Boolean))}); }
    catch { return fail('chatgpt_connection_failed', 503); }
  };
  const discover = async () => {
    if (!discovery) {
      const r = await network(CHATGPT_ISSUER + '/.well-known/openid-configuration'), d = await json(r);
      if (!r.ok || d.issuer !== CHATGPT_ISSUER || d.authorization_endpoint !== CHATGPT_ISSUER + '/api/accounts/authorize' || d.token_endpoint !== CHATGPT_ISSUER + '/api/accounts/oauth/token') return fail('chatgpt_invalid_discovery', 502);
      discovery = {issuer: d.issuer, authorization: safeEndpoint(d.authorization_endpoint), token: safeEndpoint(d.token_endpoint), jwks: safeEndpoint(d.jwks_uri), revoke: d.revocation_endpoint ? safeEndpoint(d.revocation_endpoint) : ''};
    }
    return discovery;
  };
  const identity = async (jwt, options) => {
    const d = await discover();
    const load = async () => { const r = await network(d.jwks), value = await json(r); if (!r.ok || !Array.isArray(value.keys) || value.keys.length > 64) return fail('chatgpt_invalid_identity'); keys = value.keys; keysAt = now(); };
    if (!keys || now() - keysAt > 3600000) await load();
    try { return verifyIdentity(jwt, keys, {...options, now: now()}); }
    catch { // Key rotation: one refetch, never accept an unverified token.
      await load(); return verifyIdentity(jwt, keys, {...options, now: now()});
    }
  };
  const status = () => ({enabled: true, storage: store.remember ? 'owner-only-file' : 'memory-only', login: pending ? 'pending' : lastLogin, loginId: pending?.id || '',
    accounts: data.accounts.map(a => ({id: a.id, label: (a.email || a.name || 'ChatGPT account') + ' · ' + a.id.slice(0, 8), signedIn: sessions.has(a.id), planEnabled: !!sessions.get(a.id)?.tokens.scope.split(/\s+/).includes(permission), expiresAt: sessions.get(a.id)?.tokens.expiresAt || 0}))});
  const persist = async next => { await store.save(next); data = next; };
  const stopPending = state => {
    const p = pending; if (!p) return;
    pending = null; lastLogin = state; clearTimeout(p.timer); p.controller.abort(); p.server?.close(); p.server?.closeAllConnections();
  };
  const tokens = (value, previous) => {
    const scope = value.scope === undefined && previous ? previous.scope : value.scope;
    if (typeof scope !== 'string' || scope.length > 4096) return fail('chatgpt_invalid_response', 502);
    const granted = scope.split(/\s+/), plan = granted.includes(permission);
    if (plan && (!text(value.access_token) || String(value.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.expires_in > 86400 || (granted.includes('offline_access') && !text(value.refresh_token)))) return fail('chatgpt_invalid_response', 502);
    if (previous && !text(value.refresh_token)) return fail('chatgpt_invalid_response', 502); // Rotation must replace, never silently reuse.
    if (value.refresh_token !== undefined && !text(value.refresh_token)) return fail('chatgpt_invalid_response', 502);
    const earliest = value.earliest_refresh_at;
    const refreshAt = earliest === undefined ? 0 : typeof earliest === 'number' ? earliest * 1000 : Date.parse(earliest);
    if (!Number.isFinite(refreshAt)) return fail('chatgpt_invalid_response', 502);
    return {accessToken: text(value.access_token) ? value.access_token : '', refreshToken: value.refresh_token || '', idToken: value.id_token || previous?.idToken, scope, expiresAt: now() + (Number.isFinite(value.expires_in) ? value.expires_in : 0) * 1000, earliestRefreshAt: refreshAt};
  };
  const exchange = async (params, signal) => {
    const d = await discover();
    const r = await network(d.token, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams({...params, resource: CHATGPT_RESOURCE}).toString(), signal});
    const value = await json(r);
    if (!r.ok) {
      const code = typeof value.error === 'string' ? value.error : value.error?.code;
      const terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
      return fail(terminal ? 'chatgpt_session_expired' : code === 'invalid_client' ? 'chatgpt_invalid_client' : 'chatgpt_exchange_failed', r.status >= 500 ? 503 : 401);
    }
    return value;
  };
  const saveSession = async (a, t, valid = () => !closed) => {
    const previous = structuredClone(data), next = structuredClone(data), found = next.accounts.find(x => x.id === a.id);
    if (found) Object.assign(found, a, {tokens: t}); else { if (next.accounts.length >= 16) return fail('chatgpt_account_limit', 400); next.accounts.push({...a, tokens: t}); }
    await persist(next);
    if (!valid()) { await persist(previous); return fail('chatgpt_login_cancelled', 409); }
    sessions.get(a.id)?.controller.abort(); sessions.get(a.id)?.refreshController.abort(); sessions.set(a.id, {tokens: t, controller: new AbortController(), refreshController: new AbortController(), signingOut: false});
  };
  async function start({accountId = '', consent = false, loginId = opaque()} = {}) {
    if (closed || pending) return fail('chatgpt_login_in_progress', 409);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(loginId)) return fail('chatgpt_invalid_login_id', 400);
    const selected = accountId ? account(accountId) : null;
    if (accountId && !selected) return fail('chatgpt_unknown_account', 400);
    const p = {id: loginId, state: opaque(), nonce: opaque(), verifier: opaque(), selected, controller: new AbortController(), consumed: false};
    pending = p; lastLogin = 'pending'; p.timer = setTimeout(() => { if (pending === p) stopPending('expired'); }, loginTimeoutMs); p.timer.unref?.();
    try {
      const d = await discover(); if (pending !== p) return fail('chatgpt_login_cancelled', 409);
      p.server = http.createServer(async (req, res) => {
        const send = (code, message) => { if (!res.destroyed) { res.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff'}); res.end(message); } };
        try {
          if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + p.server.address()?.port || !req.url || req.url.length > 16384) { send(400, 'Invalid callback.'); return; }
          const url = new URL(req.url, p.redirect);
          if (url.pathname !== '/auth/callback' || pending !== p || p.consumed || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state'), p.state)) { send(400, 'Invalid or expired sign-in state.'); return; }
          p.consumed = true;
          if (url.searchParams.has('error')) { send(400, 'Sign-in was declined or unavailable. Return to VB6.'); setImmediate(() => { if (pending === p) stopPending('declined'); }); return; }
          const code = url.searchParams.get('code'), returned = url.searchParams.get('client_id'), client = p.selected?.clientId || returned;
          if (url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1 || !text(code, 8192) || !clientId(client) || (returned && p.selected && returned !== client)) return fail('chatgpt_invalid_callback');
          const value = await exchange({grant_type: 'authorization_code', client_id: client, code, code_verifier: p.verifier, redirect_uri: p.redirect}, p.controller.signal);
          const who = await identity(value.id_token, {client, nonce: p.nonce, subject: p.selected?.sub});
          const t = tokens(value);
          await change(async () => {
            if (pending !== p || closed) return fail('chatgpt_login_cancelled', 409);
            const old = data.accounts.find(a => a.issuer === CHATGPT_ISSUER && a.sub === who.sub && a.clientId === client);
            await saveSession({id: old?.id || randomUUID(), issuer: CHATGPT_ISSUER, clientId: client, ...who}, t, () => pending === p && !closed);
          });
          send(200, 'ChatGPT sign-in complete. Return to VB6 Studio. This window can be closed.');
          setImmediate(() => { if (pending === p) stopPending(t.scope.split(/\s+/).includes(permission) ? 'complete' : 'consent-required'); });
        } catch { send(400, 'ChatGPT sign-in could not be verified. Return to VB6 and try again.'); setImmediate(() => { if (pending === p) stopPending('failed'); }); }
      });
      p.server.requestTimeout = 15000; p.server.headersTimeout = 10000;
      await new Promise((resolve, reject) => { p.server.once('error', reject); p.server.listen(0, '127.0.0.1', resolve); });
      if (pending !== p) { p.server.close(); return fail('chatgpt_login_cancelled', 409); }
      p.redirect = 'http://127.0.0.1:' + p.server.address().port + '/auth/callback';
      const url = new URL(d.authorization);
      url.search = new URLSearchParams({client_id: selected?.clientId || 'dynamic_agent_client', ...(!selected ? {agent_name_hint: 'VB6 Studio Web'} : {}), ext_agent_host_id: data.hostId,
        response_type: 'code', redirect_uri: p.redirect, scope: CHATGPT_SCOPE, resource: CHATGPT_RESOURCE, state: p.state, nonce: p.nonce,
        code_challenge_method: 'S256', code_challenge: createHash('sha256').update(p.verifier).digest('base64url'), ...(consent ? {prompt: 'consent'} : {})}).toString();
      // No id_token_hint: the only URL sent to browser JS contains no retained tokens.
      return {authorizationUrl: url.href, ...status()};
    } catch (error) { if (pending === p) stopPending('failed'); throw error; }
  }
  async function refresh(id, session) {
    const a = account(id); if (!a || sessions.get(id) !== session) return fail('chatgpt_sign_in_required');
    try {
      const value = await exchange({grant_type: 'refresh_token', client_id: a.clientId, refresh_token: session.tokens.refreshToken}, session.refreshController.signal);
      if (value.id_token) await identity(value.id_token, {client: a.clientId, subject: a.sub});
      const t = tokens(value, session.tokens);
      await change(async () => {
        if (closed || sessions.get(id) !== session) return fail('chatgpt_sign_in_required');
        const next = structuredClone(data); next.accounts.find(x => x.id === id).tokens = t;
        await persist(next); session.tokens = t; // Do not abort other requests on routine refresh.
      });
    } catch (error) {
      if (error.code === 'chatgpt_session_expired') await change(async () => { if (sessions.get(id) === session) { sessions.delete(id); session.controller.abort(); const next = structuredClone(data); delete next.accounts.find(x => x.id === id).tokens; await persist(next); } });
      throw error;
    }
  }
  async function authorize(id) {
    const session = sessions.get(id); if (closed || !session || session.signingOut) return fail('chatgpt_sign_in_required');
    const t = session.tokens;
    if (!t.scope.split(/\s+/).includes(permission)) return fail('chatgpt_consent_required', 403);
    if (!t.refreshToken && t.expiresAt <= now()) return fail('chatgpt_sign_in_required');
    if (t.refreshToken && now() >= t.expiresAt - 60000 && now() >= t.earliestRefreshAt) {
      if (!refreshes.has(id)) { const job = refresh(id, session).finally(() => refreshes.delete(id)); refreshes.set(id, job); }
      await refreshes.get(id);
    }
    if (sessions.get(id) !== session) return fail('chatgpt_sign_in_required');
    if (session.tokens.expiresAt <= now()) return fail('chatgpt_refresh_not_ready', 503);
    if (!session.tokens.scope.split(/\s+/).includes(permission)) return fail('chatgpt_consent_required', 403);
    return {accessToken: session.tokens.accessToken, signal: session.controller.signal};
  }
  async function logout(id) {
    // Stop generation immediately. Let an already-started rotation finish so we revoke its newest token.
    const leaving = sessions.get(id); if (leaving) { leaving.signingOut = true; leaving.controller.abort(); }
    await refreshes.get(id)?.catch(() => {});
    let a, session;
    await change(async () => {
      a = account(id); if (!a) return fail('chatgpt_unknown_account', 400);
      session = sessions.get(id); sessions.delete(id); session?.controller.abort();
      if (pending?.selected?.id === id) stopPending('cancelled');
      const next = structuredClone(data); delete next.accounts.find(x => x.id === id).tokens; await persist(next);
    });
    let revoked = !session?.tokens.refreshToken;
    if (session?.tokens.refreshToken) {
      for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
        try { const d = await discover(); if (!d.revoke) break;
          const r = await network(d.revoke, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: session.tokens.refreshToken, token_type_hint: 'refresh_token', client_id: a.clientId}).toString()});
          await r.body?.cancel(); revoked = r.ok; if (!r.ok && r.status < 500) break;
        } catch {}
        if (!revoked && attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return {...status(), revoked};
  }
  return {status, start, authorize, logout, cancel(id = pending?.id) { if (pending?.id === id) stopPending('cancelled'); return status(); },
    async close() { closed = true; stopPending('cancelled'); for (const s of sessions.values()) { s.controller.abort(); s.refreshController.abort(); } await Promise.allSettled([...refreshes.values()]); await serial.promise; sessions.clear(); await store.close(); }};
}

#!/usr/bin/env node
/** Optional local, token-authenticated relay. Keys stay in environment variables. */
import http from 'node:http';
import {createChatGPTAuth, createChatGPTStore, ChatGPTAuthError} from './chatgpt-auth.mjs';
import {chatGPTControl, chatGPTUpstream} from './chatgpt-relay.mjs';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {nativeRequest, providerHeaders, providerInfo, responseFailure} from '../src/agents/providers.js';
import {AGENT_LIMIT_FIELDS, normalizeAgentLimits} from '../src/agents/limits.js';
const KEY_NAMES = {openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY'};
// Return only a canonical classification, never the upstream body/message/request ID.
const ERROR_CODES = Object.freeze({context: 'context_length_exceeded', quota: 'insufficient_quota', access: 'authentication_error', request: 'invalid_request_error', safety: 'content_policy_violation', rate: 'rate_limit_exceeded', server: 'server_error', cooldown: 'rate_limit_exceeded', provider: 'provider_error'});
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createAgentRelay({token, origins, keys = {}, fetchImpl = globalThis.fetch, chatgpt = null} = {}) {
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) throw new Error('Relay token must contain at least 32 characters.');
  if (!Array.isArray(origins) || !origins.length || origins.some(origin => { try { const u = new URL(origin); return !['http:', 'https:'].includes(u.protocol) || u.origin !== origin; } catch { return true; } })) throw new Error('Specify exact allowed HTTP(S) IDE origins.');
  const allowed = new Set(origins); let active = 0, managementActive = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host, origin = req.headers.origin;
    if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || !allowed.has(origin)) { res.writeHead(403).end(); return; }
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After'); res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    if (!['/agent', '/agent/chatgpt'].includes(req.url)) { res.writeHead(404).end(); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204).end(); return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!equal(req.headers.authorization, 'Bearer ' + token)) { res.writeHead(401).end(); return; }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { res.writeHead(415).end(); return; }
    const management = req.url === '/agent/chatgpt';
    if (management ? managementActive >= 8 : active >= 4) { res.writeHead(429).end(); return; }
    if (management) managementActive++; else active++; const controller = new AbortController(); let upstreamStarted = false, timeout = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort(); req.on('aborted', abort); res.on('close', abort);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > (management ? 16384 : AGENT_LIMIT_FIELDS.maxContextBytes.max + 4096)) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/agent/chatgpt') {
        const result = await chatGPTControl(chatgpt, data);
        res.setHeader('Content-Type', 'application/json'); res.writeHead(200).end(JSON.stringify(result)); return;
      }
      providerInfo(data.provider);
      if (data.authMode !== undefined && !['api-key', 'chatgpt'].includes(data.authMode)) throw new Error('Invalid authentication mode.');
      const {requestTimeoutMs} = normalizeAgentLimits({requestTimeoutMs: data.requestTimeoutMs});
      clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), data.operation === 'models' ? Math.min(requestTimeoutMs, 120000) : requestTimeoutMs);
      if (!['models', 'generate'].includes(data.operation)) throw new Error('Invalid operation.');
      if (data.operation === 'generate' && (!data.body || typeof data.body !== 'object' || Array.isArray(data.body))) throw new Error('Invalid request.');
      if (typeof (data.cursor ?? '') !== 'string' || (data.cursor || '').length > 2000) throw new Error('Invalid cursor.');
      if (data.authMode !== 'chatgpt' && !keys[data.provider]) { res.writeHead(503).end(JSON.stringify({error: {code: 'invalid_api_key'}})); return; }
      // The browser cannot select another destination or supply authorization headers.
      const request = nativeRequest(data.provider, data.body, {models: data.operation === 'models', cursor: data.cursor});
      upstreamStarted = true;
      const upstream = data.authMode === 'chatgpt' ? await chatGPTUpstream(chatgpt, data, {fetchImpl, signal: controller.signal}) : await fetchImpl(request.url, {method: request.method, body: request.body, headers: providerHeaders(data.provider, keys[data.provider], false), redirect: 'error', signal: controller.signal});
      if (!upstream.ok) {
        const failure = await responseFailure(upstream, controller.signal);
        const delay = failure.retryAt ? Math.max(0, failure.retryAt - Date.now()) : failure.retryAfterMs;
        if (delay) res.setHeader('Retry-After', String(Math.ceil(delay / 1000)));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502).end(JSON.stringify({error: {code: data.authMode === 'chatgpt' && failure.kind === 'quota' ? 'subscription_sharing_usage_limit_exceeded' : ERROR_CODES[failure.kind] || 'provider_error'}}));
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type')?.includes('text/event-stream') ? 'text/event-stream' : 'application/json');
      res.writeHead(200); let bytes = 0;
      for await (const chunk of upstream.body) {
        bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error('Response limit.');
        if (res.destroyed) break;
        if (!res.write(chunk)) await new Promise((resolve, reject) => {
          const done = () => { cleanup(); resolve(); }, stop = () => { cleanup(); reject(new Error('Disconnected.')); };
          const cleanup = () => { res.off('drain', done); res.off('close', stop); controller.signal.removeEventListener('abort', stop); };
          res.once('drain', done); res.once('close', stop); controller.signal.addEventListener('abort', stop, {once: true});
          if (controller.signal.aborted) stop();
        });
      }
      res.end();
    } catch (error) { if (error instanceof ChatGPTAuthError && !res.headersSent) { res.setHeader('Content-Type', 'application/json'); res.writeHead(error.status).end(JSON.stringify({error: {code: error.code}})); } else if (!res.headersSent) res.writeHead(upstreamStarted ? 502 : 400).end(JSON.stringify({error: {code: upstreamStarted ? 'server_error' : 'invalid_request_error'}})); else res.destroy(); }
    finally { clearTimeout(timeout); controller.abort(); if (management) managementActive--; else active--; req.off('aborted', abort); res.off('close', abort); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.VB6_AGENT_PORT || 4892);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid VB6_AGENT_PORT.');
  const token = process.env.VB6_AGENT_TOKEN || randomBytes(32).toString('hex');
  const origins = (process.env.VB6_AGENT_ORIGINS || 'http://127.0.0.1:8080').split(',').map(value => value.trim());
  const keys = Object.fromEntries(Object.entries(KEY_NAMES).map(([provider, name]) => [provider, process.env[name] || '']));
  const chatgpt = process.env.VB6_CHATGPT_ENABLED === '0' ? null : createChatGPTAuth({store: await createChatGPTStore({...(process.env.VB6_CHATGPT_HOME ? {directory: process.env.VB6_CHATGPT_HOME} : {}), remember: process.env.VB6_CHATGPT_REMEMBER === '1'})});
  const server = createAgentRelay({token, origins, keys, chatgpt});
  const shutdown = async () => { server.close(); server.closeAllConnections(); await chatgpt?.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); server.requestTimeout = 120000; server.headersTimeout = 15000;
  server.listen(port, '127.0.0.1', () => console.log('VB6 agent relay: http://127.0.0.1:' + port + '\nAllowed origins: ' + origins.join(', ') + '\nLocal access token (keep private): ' + token));
}

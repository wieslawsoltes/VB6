#!/usr/bin/env node
/** Optional local, token-authenticated relay. Keys stay in environment variables. */
import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {nativeRequest, providerHeaders, providerInfo, retryAfter} from '../src/agents/providers.js';
const KEY_NAMES = {openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY'};
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createAgentRelay({token, origins, keys = {}, fetchImpl = globalThis.fetch} = {}) {
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) throw new Error('Relay token must contain at least 32 characters.');
  if (!Array.isArray(origins) || !origins.length || origins.some(origin => { try { const u = new URL(origin); return !['http:', 'https:'].includes(u.protocol) || u.origin !== origin; } catch { return true; } })) throw new Error('Specify exact allowed HTTP(S) IDE origins.');
  const allowed = new Set(origins); let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host, origin = req.headers.origin;
    if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || !allowed.has(origin)) { res.writeHead(403).end(); return; }
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After'); res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    if (req.url !== '/agent') { res.writeHead(404).end(); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204).end(); return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!equal(req.headers.authorization, 'Bearer ' + token)) { res.writeHead(401).end(); return; }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { res.writeHead(415).end(); return; }
    if (active >= 4) { res.writeHead(429).end(); return; }
    active++; const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort(); req.on('aborted', abort); res.on('close', abort);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 1600000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      providerInfo(data.provider);
      if (!['models', 'generate'].includes(data.operation)) throw new Error('Invalid operation.');
      if (data.operation === 'generate' && (!data.body || typeof data.body !== 'object' || Array.isArray(data.body))) throw new Error('Invalid request.');
      if (typeof (data.cursor ?? '') !== 'string' || (data.cursor || '').length > 2000) throw new Error('Invalid cursor.');
      if (!keys[data.provider]) { res.writeHead(503).end(JSON.stringify({error: 'Provider API key is not configured on the relay.'})); return; }
      // The browser cannot select another destination or supply authorization headers.
      const request = nativeRequest(data.provider, data.body, {models: data.operation === 'models', cursor: data.cursor});
      const upstream = await fetchImpl(request.url, {method: request.method, body: request.body, headers: providerHeaders(data.provider, keys[data.provider], false), redirect: 'error', signal: controller.signal});
      if (!upstream.ok) { const delay = retryAfter(upstream.headers.get('retry-after')); if (delay) res.setHeader('Retry-After', String(Math.ceil(delay / 1000))); await upstream.body?.cancel(); res.writeHead(upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502).end(); return; }
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
    } catch { if (!res.headersSent) res.writeHead(400).end(JSON.stringify({error: 'Relay request failed.'})); else res.destroy(); }
    finally { clearTimeout(timeout); controller.abort(); active--; req.off('aborted', abort); res.off('close', abort); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.VB6_AGENT_PORT || 4892);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid VB6_AGENT_PORT.');
  const token = process.env.VB6_AGENT_TOKEN || randomBytes(32).toString('hex');
  const origins = (process.env.VB6_AGENT_ORIGINS || 'http://127.0.0.1:8080').split(',').map(value => value.trim());
  const keys = Object.fromEntries(Object.entries(KEY_NAMES).map(([provider, name]) => [provider, process.env[name] || '']));
  const server = createAgentRelay({token, origins, keys}); server.requestTimeout = 120000; server.headersTimeout = 15000;
  server.listen(port, '127.0.0.1', () => console.log('VB6 agent relay: http://127.0.0.1:' + port + '\nAllowed origins: ' + origins.join(', ') + '\nLocal access token (keep private): ' + token));
}

#!/usr/bin/env node
import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {MCP_VERSION, MCP_META, MCP_LIMIT, McpError, randomToken, parseMessage, checkMessage, errorResponse, validateHeaders} from '../src/mcp/protocol.js';
import {NodeStdioTransport} from './mcp-node.mjs';

const sameSecret = (actual, expected) => typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
const tokenOK = token => typeof token === 'string' && /^[A-Za-z0-9._~-]{32,512}$/.test(token);
const allowedHeader = name => /^(authorization|content-type|accept|mcp-session-id|mcp-protocol-version|mcp-method|mcp-name|last-event-id|x-vb6-lease)$/i.test(name) || /^mcp-param-[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name);
function json(res, status, value) { if (res.writableEnded || res.destroyed) return; res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(value === undefined ? '' : JSON.stringify(value)); }
function stream(res) { if (res.headersSent) return; res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'}); res.write(': connected\n\n'); }
function event(res, value) { if (res.destroyed || res.writableEnded) return; const data = JSON.stringify(value); if (data.length > MCP_LIMIT || res.writableLength > MCP_LIMIT) { res.destroy(); return; } stream(res); res.write('event: message\ndata: ' + data + '\n\n'); }
async function body(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Use application/json.'), {status: 415});
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MCP_LIMIT) throw Object.assign(new Error('Request is too large.'), {status: 413}); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw new McpError(-32700, 'Invalid JSON.'); }
}

/** Loopback-only authenticated relay. The browser remains the owner of project state and consent. */
export async function createBridge({port = 8766, origins = [], allowFile = false, serve = null, ownerToken = randomToken(), clientToken = randomToken(), stdioServers = {}, requestTimeout = 60000} = {}) {
  if (!tokenOK(ownerToken) || !tokenOK(clientToken) || ownerToken === clientToken) throw new Error('Use distinct random owner and client tokens of at least 32 characters.');
  const allowedOrigins = new Set(origins.map(origin => { const url = new URL(origin); if (!['http:','https:'].includes(url.protocol) || url.origin !== origin) throw new Error('--origin must be an exact HTTP(S) origin without a path or trailing slash.'); return origin; }));
  if (allowFile) allowedOrigins.add('null');
  const root = serve ? await realpath(serve) : null;
  const requests = new Map(), sessions = new Map(), gateways = new Map(); let owner = null, actualPort;
  function enqueue(value) {
    if (!owner) throw Object.assign(new Error('No browser is attached. Enable sharing and connect in Tools → MCP Connections.'), {status: 503});
    const size = JSON.stringify(value).length;
    if (owner.queue.length >= 128 || owner.bytes + size > MCP_LIMIT * 4) throw Object.assign(new Error('Browser queue is full.'), {status: 503});
    owner.queue.push(value); owner.bytes += size;
    if (owner.poll) { const res = owner.poll; owner.poll = null; clearTimeout(owner.pollTimer); const events = owner.queue.splice(0); owner.bytes = 0; json(res, 200, {events}); }
  }
  function closeSession(id) {
    const session = sessions.get(id); if (!session) return; sessions.delete(id); session.get?.end();
    for (const [key, pending] of requests) if (pending.sessionKey === id) { clearTimeout(pending.timer); pending.res.destroy(); requests.delete(key); }
    if (owner) { try { enqueue({type: 'closeSession', sessionKey: id}); } catch {} }
  }
  async function detach() {
    if (owner?.poll) json(owner.poll, 410, {error: 'Detached.'}); clearTimeout(owner?.pollTimer); owner = null;
    for (const pending of requests.values()) { clearTimeout(pending.timer); if (!pending.res.headersSent) json(pending.res, 503, errorResponse(pending.id, new McpError(-32000, 'Browser disconnected.'))); else pending.res.destroy(); }
    requests.clear(); for (const session of sessions.values()) session.get?.end(); sessions.clear();
    for (const gateway of gateways.values()) await gateway.transport.close(); gateways.clear();
  }
  function authorize(req, token) { if (!sameSecret(req.headers.authorization, 'Bearer ' + token)) throw Object.assign(new Error('Invalid companion token.'), {status: 401}); }
  function lease(req) { authorize(req, ownerToken); if (!owner || !sameSecret(req.headers['x-vb6-lease'], owner.lease)) throw Object.assign(new Error('Browser lease expired.'), {status: 409}); owner.seen = Date.now(); }
  function cleanup(key, cancelled = false) {
    const pending = requests.get(key); if (!pending) return; requests.delete(key); clearTimeout(pending.timer);
    if (cancelled && owner) { try { enqueue({type: 'cancel', key}); } catch {} }
  }
  async function gatewayRequest(req, res, alias, url) {
    authorize(req, ownerToken);
    const config = Object.hasOwn(stdioServers, alias) ? stdioServers[alias] : null;
    if (!config) return json(res, 404, {error: 'No such explicitly configured stdio server.'});
    const sessionId = req.headers['mcp-session-id']; let gateway;
    if (req.method === 'DELETE') { gateway = gateways.get(sessionId); if (!gateway || gateway.alias !== alias) return json(res, 404, {}); await gateway.transport.close(); gateway.get?.end(); gateways.delete(sessionId); return json(res, 200, {}); }
    if (req.method === 'GET') {
      gateway = gateways.get(sessionId); if (!gateway || gateway.alias !== alias) return json(res, 404, {});
      if (gateway.get) return json(res, 409, {error: 'A notification stream is already open.'}); stream(res); gateway.get = res; res.on('close', () => { if (gateway.get === res) gateway.get = null; }); return;
    }
    if (req.method !== 'POST') return json(res, 405, {});
    const message = await body(req), kind = checkMessage(message), modern = message.params?._meta?.[MCP_META + 'protocolVersion'] !== undefined;
    validateHeaders(message, req.headers);
    if (modern && kind === 'response') return json(res, 400, errorResponse(message.id, new McpError(-32600, 'Modern HTTP clients cannot send JSON-RPC responses.')));
    const key = modern ? 'modern:' + alias : sessionId || (message.method === 'initialize' ? randomToken() : null);
    if (!key) return json(res, 400, errorResponse(message.id, new McpError(-32000, 'Initialize this stdio gateway first.')));
    gateway = gateways.get(key);
    if (!gateway) {
      if (!modern && message.method !== 'initialize') return json(res, 404, {});
      if (gateways.size >= 32) return json(res, 503, {error: 'Too many configured server sessions.'});
      const transport = new NodeStdioTransport(config); gateway = {alias, transport, streams: new Set(), requestStreams: new Map(), seen: Date.now()}; gateways.set(key, gateway);
      transport.onMessage = value => { const subscriptionId = value.params?._meta?.[MCP_META + 'subscriptionId']; const target = subscriptionId !== undefined ? gateway.requestStreams.get(subscriptionId) : gateway.get || gateway.streams.values().next().value; if (target) event(target, value); };
    }
    if (gateway.alias !== alias) return json(res, 404, {}); gateway.seen = Date.now();
    if (message.method === 'initialize') res.setHeader('MCP-Session-Id', key);
    if (kind !== 'request') { await gateway.transport.exchange(message); return json(res, 202); }
    const controller = new AbortController(); res.on('close', () => controller.abort()); gateway.streams.add(res); gateway.requestStreams.set(message.id, res);
    const timer = message.method === 'subscriptions/listen' ? null : setTimeout(() => controller.abort(), requestTimeout);
    try { const reply = await gateway.transport.exchange(message, {signal: controller.signal}); event(res, reply); res.end(); if (modern && message.method === 'server/discover' && reply?.error) { await gateway.transport.close(); gateways.delete(key); } }
    catch (error) { if (!res.destroyed) { if (res.headersSent) { event(res, errorResponse(message.id, error)); res.end(); } else json(res, 502, errorResponse(message.id, error)); } }
    finally { clearTimeout(timer); gateway.streams.delete(res); gateway.requestStreams.delete(message.id); }
  }
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['127.0.0.1:' + actualPort, 'localhost:' + actualPort].includes(req.headers.host)) return json(res, 403, {error: 'Host is not allowed.'});
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return json(res, 403, {error: 'Origin is not allowed. Configure its exact origin, or --allow-file for local HTML.'});
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version, WWW-Authenticate'); }
    if (req.method === 'OPTIONS') {
      const headers = String(req.headers['access-control-request-headers'] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!origin || headers.some(name => !allowedHeader(name))) return json(res, 403, {error: 'Preflight is not allowed.'});
      res.setHeader('Access-Control-Allow-Headers', headers.join(', ')); res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      return json(res, 204);
    }
    const url = new URL(req.url, 'http://127.0.0.1:' + actualPort), route = url.pathname;
    if ((route.startsWith('/bridge/') || route === '/mcp' || route.startsWith('/stdio/')) && url.search) return json(res, 400, {error: 'Protocol endpoints do not accept URL query parameters. Use authorization headers.'});
    if (route.startsWith('/stdio/')) return gatewayRequest(req, res, decodeURIComponent(route.slice(7)), url);
    if (route.startsWith('/bridge/')) {
      if (req.method !== 'POST') return json(res, 405, {});
      authorize(req, ownerToken);
      if (route === '/bridge/attach') {
        const data = await body(req); if (owner) return json(res, 409, {error: 'Another browser owns this bridge. Detach it before attaching another.'});
        if (typeof data.id !== 'string' || data.id.length > 100) return json(res, 400, {});
        owner = {id: data.id, lease: randomToken(), seen: Date.now(), queue: [], bytes: 0}; return json(res, 200, {lease: owner.lease});
      }
      lease(req); const data = await body(req);
      if (route === '/bridge/poll') {
        if (owner.poll) return json(res, 409, {error: 'Only one poll may be outstanding.'});
        if (owner.queue.length) { const events = owner.queue.splice(0); owner.bytes = 0; return json(res, 200, {events}); }
        owner.poll = res; const attached = owner;
        attached.pollTimer = setTimeout(() => { if (attached.poll === res) { attached.poll = null; json(res, 200, {events: []}); } }, 20000);
        res.on('close', () => { if (attached.poll === res) { attached.poll = null; clearTimeout(attached.pollTimer); } }); return;
      }
      if (route === '/bridge/detach') { await detach(); return json(res, 200, {}); }
      if (route === '/bridge/notify') {
        if (checkMessage(data.message) !== 'notification') return json(res, 400, {});
        const session = sessions.get(data.sessionKey); if (session?.get) event(session.get, data.message); return json(res, 200, {});
      }
      if (route === '/bridge/reply') {
        const pending = requests.get(data.key); if (!pending || pending.sessionKey !== data.sessionKey) return json(res, 200, {expired: true});
        if (data.message !== undefined) {
          const kind = checkMessage(data.message);
          if (kind === 'request' || kind === 'response' && data.message.id !== pending.id || data.done && kind !== 'response') return json(res, 400, {error: 'Invalid browser response.'});
          if (kind === 'response' && !data.done) return json(res, 400, {});
          if (!pending.res.headersSent && data.message.error) {
            const status = [-32020,-32022,-32600,-32602,-32700].includes(data.message.error.code) ? 400 : data.message.error.code === -32601 ? 404 : 200;
            json(pending.res, status, data.message);
          } else event(pending.res, data.message);
        }
        if (data.done) { if (!pending.res.headersSent) json(pending.res, 202); else pending.res.end(); cleanup(data.key); }
        return json(res, 200, {});
      }
      return json(res, 404, {});
    }
    if (route === '/mcp') {
      authorize(req, clientToken); if (!owner) return json(res, 503, {error: 'Attach a browser in Tools → MCP Connections first.'});
      const sid = req.headers['mcp-session-id']; let session = sid ? sessions.get(sid) : null;
      if (req.method === 'DELETE') { if (!session) return json(res, 404, {}); closeSession(sid); return json(res, 200, {}); }
      if (req.method === 'GET') {
        if (!session) return json(res, 405, {}); if (session.get) return json(res, 409, {}); stream(res); session.get = res; session.seen = Date.now(); res.on('close', () => { if (session.get === res) session.get = null; }); return;
      }
      if (req.method !== 'POST') return json(res, 405, {});
      const message = await body(req), kind = checkMessage(message), modern = message.params?._meta?.[MCP_META + 'protocolVersion'] !== undefined;
      validateHeaders(message, req.headers);
    if (modern && kind === 'response') return json(res, 400, errorResponse(message.id, new McpError(-32600, 'Modern HTTP clients cannot send JSON-RPC responses.')));
      if (!modern && sid && !session) return json(res, 404, errorResponse(message.id, new McpError(-32000, 'MCP session expired.')));
      if (!modern && message.method === 'initialize' && !sid) {
        if (sessions.size >= 64) return json(res, 503, {}); const id = randomToken(); session = {id, seen: Date.now()}; sessions.set(id, session); res.setHeader('MCP-Session-Id', id);
      }
      if (!modern && !session) return json(res, 400, errorResponse(message.id, new McpError(-32000, 'Initialize an MCP session first.')));
      if (session) session.seen = Date.now();
      if (requests.size >= 64) return json(res, 503, {error: 'Too many pending requests.'});
      const key = randomToken(16), sessionKey = modern ? 'request:' + key : session.id;
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => name.startsWith('mcp-')));
      const pending = {id: message.id, sessionKey, res, timer: null}; requests.set(key, pending);
      if (message.method !== 'subscriptions/listen') pending.timer = setTimeout(() => { if (!res.headersSent) json(res, 504, errorResponse(message.id, new McpError(-32000, 'Browser response timed out.'))); else res.destroy(); cleanup(key, true); }, requestTimeout);
      res.on('close', () => cleanup(key, true));
      try { enqueue({type: 'message', key, sessionKey, ephemeral: modern, message, headers}); }
      catch (error) { cleanup(key); throw error; }
      // Notifications get an immediate 202 once queued; their delivery is kept ordered by the browser poll.
      if (kind !== 'request') { json(res, 202); cleanup(key); }
      return;
    }
    if (req.method === 'GET' && root) {
      const requested = path.resolve(root, '.' + decodeURIComponent(route === '/' ? '/index.html' : route));
      if (requested !== root && !requested.startsWith(root + path.sep)) return json(res, 403, {});
      let target; try { target = await realpath(requested); if (!target.startsWith(root + path.sep) || !(await stat(target)).isFile()) return json(res, 404, {}); } catch { return json(res, 404, {}); }
      const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[path.extname(target)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type': mime}); res.end(await readFile(target)); return;
    }
    json(res, 404, {error: 'Use /mcp for MCP clients, /stdio/<configured-name> for configured stdio servers.'});
  }
  const server = http.createServer((req, res) => { handle(req, res).catch(error => { if (!res.headersSent) json(res, error.status || 400, error instanceof McpError ? errorResponse(null, error) : {error: error.status ? error.message : 'Invalid request.'}); else res.destroy(); }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 100;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); actualPort = server.address().port;
  allowedOrigins.add('http://127.0.0.1:' + actualPort); allowedOrigins.add('http://localhost:' + actualPort);
  const maintenance = setInterval(() => {
    if (owner && Date.now() - owner.seen > 45000) detach().catch(() => {});
    for (const [id, session] of sessions) if (Date.now() - session.seen > 1800000) closeSession(id);
    for (const [id, gateway] of gateways) if (!gateway.streams.size && !gateway.get && Date.now() - gateway.seen > 1800000) { gateway.transport.close(); gateways.delete(id); }
  }, 10000); maintenance.unref();
  return {server, port: actualPort, url: 'http://127.0.0.1:' + actualPort, ownerToken, clientToken, async close() { clearInterval(maintenance); await detach(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}

async function main() {
  const args = process.argv.slice(2), options = {origins: []};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]; if (arg === '--allow-file') options.allowFile = true;
    else if (arg === '--origin') options.origins.push(args[++i]);
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--serve') options.serve = args[++i];
    else if (arg === '--config') { const data = JSON.parse(await readFile(args[++i], 'utf8')); options.stdioServers = data.mcpServers || data; }
    else throw new Error('Usage: node tools/mcp-bridge.mjs [--port 8766] [--serve dist] [--origin https://wieslawsoltes.github.io] [--allow-file] [--config mcp-servers.json]');
  }
  if (process.env.VB6_MCP_OWNER_TOKEN) options.ownerToken = process.env.VB6_MCP_OWNER_TOKEN;
  if (process.env.VB6_MCP_TOKEN) options.clientToken = process.env.VB6_MCP_TOKEN;
  const bridge = await createBridge(options);
  console.error('VB6 MCP companion: ' + bridge.url + '\nOwner token (IDE only): ' + bridge.ownerToken + '\nClient token (MCP client only): ' + bridge.clientToken + '\nEnter the owner token in Tools → MCP Connections. Keep these local credentials private.');
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => bridge.close().then(() => process.exit(0)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });

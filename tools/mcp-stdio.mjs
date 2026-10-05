#!/usr/bin/env node
/** Desktop MCP configuration entry: newline JSON on stdin/stdout, diagnostics on stderr only. */
import {MCP_VERSION, MCP_META, MCP_LIMIT, utf8Length, parseMessage, checkMessage, errorResponse, McpError} from '../src/mcp/protocol.js';
import {IdeRelayTransport} from './mcp-http.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--url')) throw new Error('Usage: node tools/mcp-stdio.mjs [--url http://127.0.0.1:8766/mcp]');
if (!process.env.VB6_MCP_TOKEN) throw new Error('Set VB6_MCP_TOKEN to the companion client token.');
const transport = new IdeRelayTransport(args[1] || 'http://127.0.0.1:8766/mcp', {token: process.env.VB6_MCP_TOKEN});
const active = new Map(), lifetime = new AbortController(); let version = '2025-11-25', buffer = '', listener, writes = Promise.resolve();
function send(message) {
  if (!message) return;
  const text = JSON.stringify(message); if (utf8Length(text) > MCP_LIMIT) { const failure=errorResponse(message.id,new McpError(-32600,'Response is too large.')); if(utf8Length(JSON.stringify(failure))>MCP_LIMIT)failure.id=null; return send(failure); }
  writes = writes.then(() => new Promise((resolve, reject) => process.stdout.write(text + '\n', error => error ? reject(error) : resolve()))); writes.catch(() => lifetime.abort());
}
async function receive(message) {
  const kind = checkMessage(message), modernVersion = message.params?._meta?.[MCP_META + 'protocolVersion'];
  if (modernVersion) version = modernVersion;
  if (message.method === 'notifications/cancelled') { active.get(message.params?.requestId)?.abort(); if (version === MCP_VERSION) return; }
  if (kind !== 'request') {
    await transport.exchange(message, {version, signal: lifetime.signal, onMessage: send});
    if (message.method === 'notifications/initialized' && !listener) { listener = new AbortController(); transport.listen(send, {version, signal: listener.signal, onError: () => {}}); }
    return;
  }
  if (active.size >= 128 || active.has(message.id)) { send(errorResponse(message.id, new McpError(-32600, 'Duplicate or excessive request.'))); return; }
  const controller = new AbortController(); active.set(message.id, controller);
  const timer = message.method === 'subscriptions/listen' ? null : setTimeout(() => controller.abort(), 60000);
  try {
    const reply = await transport.exchange(message, {version, signal: AbortSignal.any([controller.signal, lifetime.signal]), onMessage: send});
    if (message.method === 'initialize' && reply?.result?.protocolVersion) version = reply.result.protocolVersion;
    send(reply);
  } catch (error) { send(errorResponse(message.id, error)); }
  finally { clearTimeout(timer); active.delete(message.id); }
}
const decoder = new TextDecoder('utf-8', {fatal:true});
process.stdin.on('data', bytes => {
  try { buffer += decoder.decode(bytes, {stream:true}); }
  catch { send(errorResponse(null,new McpError(-32700,'Invalid UTF-8 input.'))); process.stdin.destroy(new Error('Invalid UTF-8 input.')); return; }
  if (utf8Length(buffer) > MCP_LIMIT * 2) { send(errorResponse(null, new McpError(-32600, 'Input is too large.'))); process.stdin.destroy(); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
    try { const message = parseMessage(line); receive(message).catch(error => { if (Object.hasOwn(message, 'id')) send(errorResponse(message.id, error)); }); }
    catch (error) { send(errorResponse(null, error)); }
  }
  if (utf8Length(buffer) > MCP_LIMIT) { send(errorResponse(null, new McpError(-32600, 'Input is too large.'))); process.stdin.destroy(); }
});
async function close() { lifetime.abort(); listener?.abort(); for (const controller of active.values()) controller.abort(); await transport.close(version); await writes; }
process.stdin.once('end', () => { try { decoder.decode(); if(buffer.trim())send(errorResponse(null,new McpError(-32700,'Incomplete newline-delimited input.'))); } catch { send(errorResponse(null,new McpError(-32700,'Invalid UTF-8 input.'))); } close().catch(() => {}); });
process.stdin.once('error', () => close().catch(() => {}));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => close().then(() => process.exit(0)));

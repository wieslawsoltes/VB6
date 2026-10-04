import {spawn} from 'node:child_process';
import {MCP_LIMIT, McpError, parseMessage, checkMessage, checkAbort} from '../src/mcp/protocol.js';

/** One explicitly configured child process. Never accepts shell text from a browser. */
export class NodeStdioTransport {
  constructor({command, args = [], env = {}, cwd}, {onStderr = () => {}} = {}) {
    if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Invalid stdio command configuration.');
    this.config = {command, args, env, cwd}; this.onStderr = onStderr; this.pending = new Map(); this.closed = false;
  }
  start() {
    if (this.closed) throw new McpError(-32000, 'Stdio transport is closed.');
    if (this.child) return;
    const {command, args, env, cwd} = this.config;
    // Companion credentials are not ambient credentials for unrelated child servers.
    // Explicit per-server env entries remain available for trusted stdio relay setup.
    const inherited = {...process.env}; delete inherited.VB6_MCP_TOKEN; delete inherited.VB6_MCP_OWNER_TOKEN;
    this.child = spawn(command, args, {cwd, env: {...inherited, ...env}, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let buffer = ''; this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', text => { try { this.onStderr(text.slice(0, 4000)); } catch {} });
    this.child.stdout.on('data', text => {
      try {
        buffer += text; if (buffer.length > MCP_LIMIT * 2) throw new McpError(-32600, 'Stdio message exceeds size limit.');
        let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1); if (line.trim()) this.receive(parseMessage(line)); }
        if (buffer.length > MCP_LIMIT) throw new McpError(-32600, 'Stdio message exceeds size limit.');
      } catch (error) { this.fail(error); }
    });
    this.child.stdin.on('error', () => this.fail(new McpError(-32000, 'Configured stdio server stdin write failed.')));
    this.child.on('error', () => this.fail(new McpError(-32000, 'Configured stdio server could not start.')));
    this.child.on('exit', () => this.fail(new McpError(-32000, 'Configured stdio server exited.')));
  }
  receive(message) {
    const kind = checkMessage(message);
    if (kind === 'response') { const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); pending.cleanup(); pending.resolve(message); } return; }
    // The gateway/client owns routing for server requests and notifications.
    if (this.onMessage) Promise.resolve(this.onMessage(message)).then(answer => { if (answer) return this.write(answer); }).catch(() => {});
    else { const pending = this.pending.values().next().value; if (pending) Promise.resolve(pending.onMessage(message)).then(answer => { if (answer) return this.write(answer); }).catch(() => {}); }
  }
  write(message) {
    this.start(); const text = JSON.stringify(message); if (text.length > MCP_LIMIT) throw new McpError(-32600, 'Stdio message exceeds size limit.');
    return new Promise((resolve, reject) => this.child.stdin.write(text + '\n', error => error ? reject(new McpError(-32000, 'Stdio write failed.')) : resolve()));
  }
  async exchange(message, {signal, onMessage = () => {}} = {}) {
    checkAbort(signal); this.start(); if (checkMessage(message) !== 'request') { await this.write(message); return; }
    if (this.pending.size >= 128 || this.pending.has(message.id)) throw new McpError(-32600, 'Duplicate or excessive stdio request.');
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort), abort = () => { this.pending.delete(message.id); cleanup(); this.write({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: message.id, reason: 'Client cancelled'}}).catch(() => {}); reject(new McpError(-32800, 'Request cancelled.')); };
      this.pending.set(message.id, {resolve, reject, onMessage, cleanup}); signal?.addEventListener('abort', abort, {once: true});
      this.write(message).catch(error => { this.pending.delete(message.id); cleanup(); reject(error); }); if (signal?.aborted) abort();
    });
  }
  fail(error) { for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); } this.pending.clear(); this.closed = true; this.child?.kill(); }
  async close() { this.fail(new McpError(-32000, 'Stdio transport closed.')); const child = this.child; if (child && child.exitCode === null) { const timer = setTimeout(() => child.kill('SIGKILL'), 2000); timer.unref(); child.once('exit', () => clearTimeout(timer)); } }
}

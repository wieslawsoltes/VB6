// Browser integration fixture. Origins are genuine; no CORS/security bypasses.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createBridge} from './mcp-bridge.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = http.createServer(async (req, res) => {
  const files = {'/VB6/': 'index.html', '/VB6/index.html': 'index.html', '/VB6/studio.js': 'studio.js', '/VB6/studio.css': 'studio.css'};
  const file = files[req.url]; if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(path.join(root, 'dist', file)));
});
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + host.address().port;
const fixture = path.join(root, 'tests/fixtures/mcp/stdio-server.mjs');
const bridge = await createBridge({port: 0, origins: [origin], allowFile: true, serve: path.join(root, 'dist'), stdioServers: {modern: {command: process.execPath, args: [fixture, '--modern']}, legacy: {command: process.execPath, args: [fixture]}}});
console.log(JSON.stringify({hosted: origin + '/VB6/', url: bridge.url, ownerToken: bridge.ownerToken, clientToken: bridge.clientToken}));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await bridge.close(); host.closeAllConnections(); host.close(() => process.exit(0)); });

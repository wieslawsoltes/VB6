// Browser integration fixture. Origins are genuine; no CORS/security bypasses.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createBridge} from './mcp-bridge.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const handler = async (req, res) => {
  const files = {'/VB6/': 'index.html', '/VB6/index.html': 'index.html', '/VB6/studio.js': 'studio.js', '/VB6/studio.css': 'studio.css'};
  const file = files[req.url]; if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(path.join(root, 'dist', file)));
};
const host = http.createServer(handler);
const certificates = await mkdtemp(path.join(os.tmpdir(), 'vb6-mcp-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certificates, 'key.pem'), '-out', path.join(certificates, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], {stdio: 'ignore'});
const tlsHost = https.createServer({key: await readFile(path.join(certificates, 'key.pem')), cert: await readFile(path.join(certificates, 'cert.pem'))}, handler);
await new Promise(resolve => tlsHost.listen(0, '127.0.0.1', resolve));
const tlsOrigin = 'https://127.0.0.1:' + tlsHost.address().port;
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + host.address().port;
const bridge = await createBridge({port: 0, origins: [origin, tlsOrigin], allowFile: true, serve: path.join(root, 'dist')});
console.log(JSON.stringify({hosted: origin + '/VB6/', httpsHosted: tlsOrigin + '/VB6/', url: bridge.url, ownerToken: bridge.ownerToken, clientToken: bridge.clientToken}));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await bridge.close(); tlsHost.closeAllConnections(); tlsHost.close(); await rm(certificates, {recursive: true, force: true}); host.closeAllConnections(); host.close(() => process.exit(0)); });

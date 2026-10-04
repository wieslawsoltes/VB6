// Independent wire fixture: deliberately does not import the implementation under test.
import readline from 'node:readline';
const modern = process.argv.includes('--modern');
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let ready = false;
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line), id = message.id, p = message.params || {};
  if (id === undefined) { if (message.method === 'notifications/initialized') ready = true; return; }
  let result;
  if (message.method === 'server/discover' && modern) result = {supportedVersions: ['2026-07-28'], capabilities: {tools: {}}, _meta: {'io.modelcontextprotocol/serverInfo': {name: 'fixture', version: '1'}}};
  else if (message.method === 'initialize') result = {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'fixture', version: '1'}};
  else if (!modern && !ready) return send({jsonrpc: '2.0', id, error: {code: -32601, message: 'Initialize first'}});
  else if (message.method === 'tools/list') result = {tools: [{name: 'echo', description: 'Echo arguments', inputSchema: {type: 'object', properties: {text: {type: 'string'}}}}]};
  else if (message.method === 'tools/call') result = {content: [{type: 'text', text: p.arguments.text}], structuredContent: {text: p.arguments.text}};
  else if (message.method === 'ping') result = {};
  else return send({jsonrpc: '2.0', id, error: {code: -32601, message: 'Unknown method'}});
  if (modern && message.method !== 'initialize') result.resultType = 'complete';
  send({jsonrpc: '2.0', id, result});
});

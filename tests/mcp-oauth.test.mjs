import test from 'node:test';
import assert from 'node:assert/strict';
import {McpOAuth, bearerChallenge} from '../src/mcp/oauth.js';
import {parseMcpConfig, exportMcpConfig} from '../src/mcp/studio.js';

function oauthFixture(overrides = {}) {
  const calls = [], issuer = 'https://auth.example/tenant', resource = 'https://mcp.example/service';
  const fetch = async (url, init = {}) => {
    calls.push({url, init});
    if (url.includes('oauth-protected-resource')) return Response.json({resource, authorization_servers: [issuer], scopes_supported: ['read'], ...overrides.resource});
    if (url.includes('oauth-authorization-server') || url.includes('openid-configuration')) return Response.json({issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', registration_endpoint: issuer + '/register', code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, ...overrides.metadata});
    if (url.endsWith('/register')) return Response.json({client_id: 'public-id', token_endpoint_auth_method: 'none'});
    if (url.endsWith('/token')) return overrides.token ? overrides.token(url, init) : Response.json({access_token: 'access-token', token_type: 'Bearer', refresh_token: 'refresh-token', expires_in: 3600, scope: 'read'});
    return new Response('', {status: 404});
  };
  const oauth = new McpOAuth(resource, {fetch}); return {oauth, calls, issuer, resource};
}
test('MCP OAuth: Bearer challenge parses quoted commas and escaped quoted values', () => {
  assert.deepEqual(bearerChallenge('Basic realm="other", Bearer resource_metadata="https://mcp.example/meta", scope="read write", realm="a,b"'), {resource_metadata: 'https://mcp.example/meta', scope: 'read write', realm: 'a,b'});
  assert.equal(bearerChallenge('Bearer realm="a\\"b"').realm, 'a"b'); assert.throws(() => bearerChallenge('Bearer scope="read", scope="write"'));
});
test('MCP OAuth: protected-resource discovery and exact issuer validation', async () => {
  const {oauth, calls, issuer} = oauthFixture(); const result = await oauth.discover(); assert.equal(result.metadata.issuer, issuer); assert.equal(result.scope, 'read');
  assert.equal(calls[0].url, 'https://mcp.example/.well-known/oauth-protected-resource/service'); assert.equal(calls[1].url, 'https://auth.example/.well-known/oauth-authorization-server/tenant');
  assert.ok(calls.every(call => call.init.credentials === 'omit' && call.init.redirect === 'error' && call.init.cache === 'no-store'));
  await assert.rejects(oauthFixture({metadata: {issuer: 'https://evil.example'}}).oauth.discover(), /issuer mismatch/);
  await assert.rejects(oauthFixture({resource: {resource: 'https://evil.example'}}).oauth.discover(), /does not identify/);
  await assert.rejects(oauthFixture({metadata: {code_challenge_methods_supported: ['plain']}}).oauth.discover(), /S256/);
  await assert.rejects(oauthFixture({metadata: {token_endpoint_auth_methods_supported: ['client_secret_basic']}}).oauth.discover(), /public OAuth client/);
});
test('MCP OAuth: fallback supports both OIDC discovery URL forms', async () => {
  const paths = [], oauth = new McpOAuth('https://mcp.example/mcp', {fetch: async url => {
    paths.push(url); if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({resource: 'https://mcp.example/mcp', authorization_servers: ['https://auth.example/tenant']});
    if (url === 'https://auth.example/tenant/.well-known/openid-configuration') return Response.json({issuer: 'https://auth.example/tenant', authorization_endpoint: 'https://auth.example/a', token_endpoint: 'https://auth.example/t', code_challenge_methods_supported: ['S256']});
    return new Response('', {status: 404}); }});
  await oauth.discover(); assert.deepEqual(paths.slice(-3), ['https://auth.example/.well-known/oauth-authorization-server/tenant', 'https://auth.example/.well-known/openid-configuration/tenant', 'https://auth.example/tenant/.well-known/openid-configuration']);
});
test('MCP OAuth: PKCE S256, resource binding, state and response issuer are checked before token exchange', async () => {
  const {oauth, calls, issuer, resource} = oauthFixture(); await oauth.discover(); const url = new URL(await oauth.begin({clientId: 'public-id', redirectURI: 'https://app.example/callback'}));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('resource'), resource); assert.equal(url.searchParams.get('scope'), 'read'); assert.equal(url.searchParams.get('code_challenge').length, 43);
  const before = calls.length, state = url.searchParams.get('state');
  await assert.rejects(oauth.complete('https://app.example/callback?state=bad&code=x&iss=' + encodeURIComponent(issuer)), /state mismatch/);
  await assert.rejects(oauth.complete('https://app.example/callback?state=' + state + '&code=x&iss=https%3A%2F%2Fevil.example'), /issuer mismatch/);
  await assert.rejects(oauth.complete('https://app.example/callback?state=' + state + '&code=x'), /issuer mismatch/); assert.equal(calls.length, before);
  assert.equal(await oauth.complete('https://app.example/callback?state=' + state + '&code=valid&iss=' + encodeURIComponent(issuer)), 'access-token');
  const tokenCall = calls.at(-1), values = new URLSearchParams(tokenCall.init.body); assert.equal(values.get('resource'), resource); assert.equal(values.get('grant_type'), 'authorization_code'); assert.ok(values.get('code_verifier').length >= 43); assert.equal(values.get('client_secret'), null);
  assert.equal(await oauth.accessToken(), 'access-token'); assert.equal(oauth.pending, null); await assert.rejects(oauth.complete('https://app.example/callback?code=valid'), /expired/);
});
test('MCP OAuth: response issuer validation is exact, even in error responses', async () => {
  const {oauth} = oauthFixture(); await oauth.discover(); const url = new URL(await oauth.begin({clientId: 'public-id', redirectURI: 'https://app.example/callback'}));
  await assert.rejects(oauth.complete('https://app.example/callback?state=' + url.searchParams.get('state') + '&error=private-error&iss=https%3A%2F%2FAUTH.example%2Ftenant'), error => /issuer mismatch/.test(error.message) && !error.message.includes('private-error'));
});
test('MCP OAuth: refresh is deduplicated, resource-bound, and cannot resurrect cleared credentials', async () => {
  let finish; const {oauth, issuer, resource} = oauthFixture({token: () => new Promise(resolve => { finish = resolve; })}); await oauth.discover();
  oauth.tokens = {accessToken: 'old', refreshToken: 'refresh', expires: 0, clientId: 'public', issuer, scope: 'read'};
  const pending = oauth.accessToken(); await new Promise(resolve => setTimeout(resolve, 0)); oauth.clear(); finish(Response.json({access_token: 'should-not-return', token_type: 'Bearer', expires_in: 3600})); await assert.rejects(pending, /cleared/); assert.equal(oauth.tokens, null);
});
test('MCP OAuth: dynamic public registration uses native/web application types and excludes secrets', async () => {
  const {oauth, calls} = oauthFixture(); await oauth.discover(); assert.equal(await oauth.register('http://127.0.0.1:8766/callback'), 'public-id');
  const body = JSON.parse(calls.at(-1).init.body); assert.equal(body.application_type, 'native'); assert.equal(body.token_endpoint_auth_method, 'none'); assert.deepEqual(body.redirect_uris, ['http://127.0.0.1:8766/callback']);
  assert.throws(() => oauth.clientMetadata('http://app.example/client.json', 'https://app.example/callback'));
  assert.equal(oauth.clientMetadata('https://app.example/client.json', 'https://app.example/callback').client_id, 'https://app.example/client.json');
});
test('MCP config: HTTP/SSE import is explicit, stdio is not executed, credentials are discarded', () => {
  const result = parseMcpConfig({mcpServers: {remote: {url: 'https://server.example/mcp', headers: {Authorization: 'Bearer secret'}}, old: {url: 'https://server.example/sse', type: 'sse'}, dangerous: {command: 'any-command', args: ['--anything']}}});
  assert.equal(result.configs.length, 2); assert.equal(result.configs[1].type, 'sse'); assert.equal(result.warnings.length, 2); assert.ok(!JSON.stringify(result.configs).includes('secret'));
  const exported = JSON.stringify(exportMcpConfig([{name: 'remote', url: 'https://server.example/mcp?access_token=secret&workspace=demo', token: 'secret', type: 'auto'}])); assert.ok(!exported.includes('secret')); assert.ok(exported.includes('workspace=demo'));
  assert.throws(() => parseMcpConfig({mcpServers: {x: {url: 'javascript:alert(1)'}}})); assert.throws(() => parseMcpConfig({servers: {x: {url: 'https://x.test', type: 'unsafe'}}}));
});

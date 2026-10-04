import {McpError, httpURL, randomToken, isRecord} from './protocol.js';

const canonical = value => { const url = httpURL(value); return url.pathname === '/' && !url.search ? url.origin : url.href; };
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Parse a Bearer challenge without splitting commas inside quoted values. */
export function bearerChallenge(header = '') {
  const start = /(?:^|,)\s*Bearer(?:\s|$)/i.exec(header); if (!start) return {};
  const result = {}; let text = header.slice(start.index + start[0].length);
  while (text.trim()) {
    const match = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*(?:,|$)/.exec(text);
    if (!match) break; const key = match[1].toLowerCase(); if (Object.hasOwn(result, key)) throw new McpError(-32602, 'Duplicate OAuth challenge parameter.');
    result[key] = match[2] === undefined ? match[3] : match[2].replace(/\\(.)/g, '$1'); text = text.slice(match[0].length);
  }
  return result;
}
/** Public-client OAuth. Tokens and verifiers stay in memory; no embedded client secrets. */
export class McpOAuth {
  constructor(endpoint, {fetch: fetchFn = globalThis.fetch.bind(globalThis)} = {}) { this.endpoint = httpURL(endpoint).href; this.fetch = fetchFn; this.pending = null; this.tokens = null; this.epoch = 0; }
  async json(url, options = {}) {
    const response = await this.fetch(httpURL(url).href, {...options, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: options.signal || AbortSignal.timeout(15000), headers: {Accept: 'application/json', ...options.headers}});
    if (!response.ok) throw Object.assign(new McpError(-32001, 'OAuth endpoint returned HTTP ' + response.status + '.'), {status: response.status});
    if (!response.body) throw new McpError(-32600, 'Empty OAuth response.');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true}); let text = '', size = 0;
    try { for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) throw new McpError(-32600, 'OAuth response is too large.'); text += decoder.decode(value, {stream: true}); } text += decoder.decode(); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let value; try { value = JSON.parse(text); } catch { throw new McpError(-32600, 'Invalid OAuth JSON.'); }
    if (!isRecord(value)) throw new McpError(-32600, 'Expected an OAuth metadata object.'); return value;
  }
  async discover({challenge = '', authorizationServer} = {}) {
    const hints = bearerChallenge(challenge), endpoint = new URL(this.endpoint);
    const candidates = hints.resource_metadata ? [httpURL(hints.resource_metadata).href] : [...new Set([endpoint.origin + '/.well-known/oauth-protected-resource' + (endpoint.pathname === '/' ? '' : endpoint.pathname), endpoint.origin + '/.well-known/oauth-protected-resource'])];
    let resource, failure;
    for (const url of candidates) { try { resource = await this.json(url); break; } catch (error) { failure = error; if (error.status && ![404,405].includes(error.status)) throw error; } }
    if (!resource) throw failure || new McpError(-32001, 'Protected resource metadata is unavailable.');
    if (canonical(resource.resource) !== canonical(this.endpoint)) throw new McpError(-32001, 'Protected resource metadata does not identify this MCP endpoint.');
    if (!Array.isArray(resource.authorization_servers) || !resource.authorization_servers.length || resource.authorization_servers.length > 16 || resource.authorization_servers.some(value => typeof value !== 'string')) throw new McpError(-32001, 'Metadata has no valid authorization servers.');
    const issuer = authorizationServer || resource.authorization_servers[0];
    if (!resource.authorization_servers.includes(issuer)) throw new McpError(-32001, 'Selected issuer is not advertised by this resource.');
    const base = httpURL(issuer); if (base.search) throw new McpError(-32001, 'Issuer cannot contain a query.');
    const issuerPath = base.pathname.replace(/\/$/, '');
    const discovery = [...new Set([base.origin + '/.well-known/oauth-authorization-server' + issuerPath, base.origin + '/.well-known/openid-configuration' + issuerPath, base.origin + issuerPath + '/.well-known/openid-configuration'])];
    let metadata;
    for (const url of discovery) { try { metadata = await this.json(url); break; } catch (error) { failure = error; if (error.status && ![404,405].includes(error.status)) throw error; } }
    if (!metadata) throw failure || new McpError(-32001, 'Authorization metadata is unavailable.');
    if (metadata.issuer !== issuer) throw new McpError(-32001, 'OAuth issuer mismatch.');
    httpURL(metadata.authorization_endpoint); httpURL(metadata.token_endpoint);
    if (!metadata.code_challenge_methods_supported?.includes('S256')) throw new McpError(-32001, 'Authorization server must advertise S256 PKCE.');
    if (metadata.token_endpoint_auth_methods_supported && !metadata.token_endpoint_auth_methods_supported.includes('none')) throw new McpError(-32001, 'This browser requires a public OAuth client (token endpoint authentication: none).');
    if (this.metadata?.issuer !== issuer) { this.clear(); }
    this.resource = resource; this.metadata = metadata;
    this.scope = hints.scope !== undefined ? hints.scope : (resource.scopes_supported || []).join(' ');
    return {resource, metadata, scope: this.scope};
  }
  clientMetadata(clientId, redirectURI) {
    const id = httpURL(clientId); if (id.protocol !== 'https:' || id.pathname === '/') throw new McpError(-32602, 'Client metadata documents need an HTTPS URL with a path.');
    return {client_id: clientId, client_name: 'VB6 Studio Web', redirect_uris: [httpURL(redirectURI).href], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none'};
  }
  async register(redirectURI) {
    if (!this.metadata?.registration_endpoint) throw new McpError(-32001, 'This issuer does not advertise dynamic registration. Use a registered client ID or client metadata URL.');
    const redirect = httpURL(redirectURI), native = ['127.0.0.1','localhost','[::1]'].includes(redirect.hostname);
    const value = await this.json(this.metadata.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'VB6 Studio Web', redirect_uris: [redirect.href], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: native ? 'native' : 'web'})});
    if (typeof value.client_id !== 'string' || value.client_secret || value.token_endpoint_auth_method && value.token_endpoint_auth_method !== 'none') throw new McpError(-32001, 'Issuer did not register a public client.');
    this.registration = {issuer: this.metadata.issuer, clientId: value.client_id}; return value.client_id;
  }
  async begin({clientId, redirectURI, scope = this.scope || ''} = {}) {
    if (!this.metadata) await this.discover();
    if (typeof clientId !== 'string' || !clientId.trim()) throw new McpError(-32602, 'Enter a public client ID registered with ' + this.metadata.issuer + '.');
    if (this.registration?.clientId === clientId && this.registration.issuer !== this.metadata.issuer) throw new McpError(-32001, 'Client registration belongs to another issuer.');
    const redirect = httpURL(redirectURI); if (redirect.search) throw new McpError(-32602, 'Use a redirect URI without a query or fragment.');
    if (/^https:\/\//.test(clientId) && this.metadata.client_id_metadata_document_supported) this.clientMetadata(clientId, redirect.href);
    if (!globalThis.crypto?.subtle) throw new McpError(-32000, 'OAuth PKCE requires a secure browser context.');
    const verifier = randomToken(32), challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))), state = randomToken(24);
    const mergedScope = [...new Set((scope + ' ' + (this.tokens?.scope || '')).trim().split(/\s+/).filter(Boolean))].join(' ');
    this.pending = {clientId, redirectURI: redirect.href, issuer: this.metadata.issuer, state, verifier, created: Date.now(), scope: mergedScope};
    const url = httpURL(this.metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({response_type: 'code', client_id: clientId, redirect_uri: redirect.href, resource: this.resource.resource, state, code_challenge: challenge, code_challenge_method: 'S256', ...(mergedScope ? {scope: mergedScope} : {})})) url.searchParams.set(key, value);
    return url.href;
  }
  async complete(callbackURL) {
    const pending = this.pending; if (!pending || Date.now() - pending.created > 600000) throw new McpError(-32001, 'OAuth sign-in expired. Start again.');
    const callback = httpURL(callbackURL), expected = new URL(pending.redirectURI);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new McpError(-32001, 'OAuth redirect URI mismatch.');
    for (const key of ['state','code','iss','error']) if (callback.searchParams.getAll(key).length > 1) throw new McpError(-32001, 'Duplicate OAuth response parameter.');
    if (callback.searchParams.get('state') !== pending.state) throw new McpError(-32001, 'OAuth state mismatch.');
    const issuer = callback.searchParams.get('iss');
    if ((issuer !== null || this.metadata.authorization_response_iss_parameter_supported) && issuer !== pending.issuer) throw new McpError(-32001, 'OAuth authorization response issuer mismatch.');
    this.pending = null;
    if (callback.searchParams.has('error')) throw new McpError(-32001, 'Authorization was declined or failed.');
    const code = callback.searchParams.get('code'); if (!code || code.length > 10000) throw new McpError(-32001, 'OAuth response has no valid code.');
    return this.tokenRequest({grant_type: 'authorization_code', code, client_id: pending.clientId, redirect_uri: pending.redirectURI, code_verifier: pending.verifier, resource: this.resource.resource}, pending);
  }
  async tokenRequest(values, binding) {
    const epoch = this.epoch, issuer = this.metadata.issuer;
    const result = await this.json(this.metadata.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(values)});
    if (epoch !== this.epoch || this.metadata.issuer !== issuer || binding.issuer !== issuer) throw new McpError(-32001, 'OAuth credentials were cleared or the issuer changed.');
    if (typeof result.access_token !== 'string' || !result.access_token || /[\r\n]/.test(result.access_token) || String(result.token_type).toLowerCase() !== 'bearer') throw new McpError(-32001, 'Issuer returned an invalid bearer token.');
    this.tokens = {accessToken: result.access_token, refreshToken: result.refresh_token || this.tokens?.refreshToken, scope: result.scope ?? binding.scope, expires: typeof result.expires_in === 'number' ? Date.now() + result.expires_in * 1000 : Infinity, clientId: binding.clientId, issuer: binding.issuer}; return this.tokens.accessToken;
  }
  async accessToken() {
    if (!this.tokens) return '';
    if (this.tokens.issuer !== this.metadata?.issuer) { this.clear(); throw new McpError(-32001, 'OAuth issuer changed. Sign in again.'); }
    if (Date.now() >= this.tokens.expires - 30000) {
      if (!this.tokens.refreshToken) throw new McpError(-32001, 'OAuth access token expired. Sign in again.');
      if (!this.refreshing) this.refreshing = this.tokenRequest({grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken, client_id: this.tokens.clientId, resource: this.resource.resource}, this.tokens).finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.tokens) throw new McpError(-32001, 'OAuth credentials were cleared.');
    return this.tokens.accessToken;
  }
  clear() { this.epoch++; this.pending = null; this.tokens = null; this.registration = null; }
}

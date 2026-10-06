import {generateKeyPairSync, sign, createHash, randomUUID} from 'node:crypto';
import {createChatGPTAuth, CHATGPT_ISSUER, CHATGPT_SCOPE} from '../../tools/chatgpt-auth.mjs';
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
export const jwk = {...publicKey.export({format: 'jwk'}), kid: 'fixture-key', alg: 'RS256', use: 'sig'};
export function jwt(claims, header = {}) {
  const parts = [Buffer.from(JSON.stringify({alg: 'RS256', kid: 'fixture-key', ...header})).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')];
  return parts.join('.') + '.' + sign('sha256', Buffer.from(parts.join('.')), privateKey).toString('base64url');
}
export function fixture(options = {}) {
  let clock = Date.now(), transaction, tokenIndex = 0;
  const calls = [], writes = [];
  const state = {scope: CHATGPT_SCOPE, subject: 'subject-A', client: 'oaiapp_fixture', refreshError: '', revokeStatus: 200, ...options};
  const store = {data: {version: 1, hostId: 'urn:uuid:' + randomUUID(), accounts: []}, remember: false,
    async save(value) { writes.push(structuredClone(value)); }, async close() {}};
  const fetchImpl = async (url, init = {}) => {
    calls.push({url, ...init});
    if (state.networkError) throw new Error('secret-upstream-message');
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({issuer: CHATGPT_ISSUER, authorization_endpoint: CHATGPT_ISSUER + '/api/accounts/authorize', token_endpoint: CHATGPT_ISSUER + '/api/accounts/oauth/token', jwks_uri: CHATGPT_ISSUER + '/.well-known/jwks.json', revocation_endpoint: CHATGPT_ISSUER + '/oauth/revoke', ...state.discovery});
    if (url.endsWith('/jwks.json')) return Response.json({keys: [jwk]});
    if (url.endsWith('/oauth/token')) {
      const params = new URLSearchParams(init.body), refresh = params.get('grant_type') === 'refresh_token';
      if (refresh && state.beforeRefresh) await state.beforeRefresh();
      if (refresh && state.refreshError) return Response.json({error: state.refreshError}, {status: 400});
      if (!refresh) {
        if (createHash('sha256').update(params.get('code_verifier')).digest('base64url') !== transaction.searchParams.get('code_challenge')) throw new Error('PKCE failed');
        if (params.get('redirect_uri') !== transaction.searchParams.get('redirect_uri')) throw new Error('Wrong redirect');
      }
      const identity = jwt({iss: CHATGPT_ISSUER, aud: params.get('client_id'), sub: state.subject, nonce: transaction.searchParams.get('nonce'), email: state.subject + '@example.invalid', exp: clock / 1000 + 3600, iat: clock / 1000, ...state.claims});
      tokenIndex++;
      return Response.json({access_token: 'secret-access-' + tokenIndex, refresh_token: 'secret-refresh-' + tokenIndex, id_token: identity, token_type: 'Bearer', scope: state.scope, expires_in: 3600, ...(state.tokenFields || {})});
    }
    if (url.endsWith('/oauth/revoke')) return new Response('', {status: state.revokeStatus});
    if (url === 'https://api.openai.com/v1/models') return Response.json({models: [{slug: 'model-z', display_name: 'Model Z', visibility: 'list'}, {slug: 'model-hidden', visibility: 'hidden'}, {slug: 'model-a', display_name: 'Model A', visibility: 'list'}]});
    if (url === 'https://api.openai.com/v1/responses') return state.inference ? state.inference(init) : Response.json({status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Done'}]}], usage: {total_tokens: 10}});
    throw new Error('Unexpected URL ' + url);
  };
  const auth = createChatGPTAuth({store, fetchImpl, now: () => clock, ...options.authOptions});
  const originalStart = auth.start;
  auth.start = async opts => { const result = await originalStart(opts); transaction = new URL(result.authorizationUrl); return result; };
  const start = opts => auth.start(opts);
  async function callback(fields = {}) {
    const target = new URL(transaction.searchParams.get('redirect_uri')); target.search = new URLSearchParams({state: transaction.searchParams.get('state'), code: 'fixture-code', client_id: state.client, ...fields}).toString();
    const response = await fetch(target); await response.text(); await new Promise(resolve => setTimeout(resolve, 10)); return response;
  }
  async function login(opts) { await start(opts); const response = await callback(); if (!response.ok) throw new Error('Fixture login failed'); return auth.status().accounts.at(-1).id; }
  return {auth, state, calls, writes, store, fetchImpl, start, callback, login, now: () => clock, advance(ms) { clock += ms; }, get transaction() { return transaction; }};
}

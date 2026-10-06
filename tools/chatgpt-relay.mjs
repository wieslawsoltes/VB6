/** Authenticated relay extension; caller must enforce bearer token + exact Origin/Host first. */
import {ChatGPTAuthError, CHATGPT_RESOURCE} from './chatgpt-auth.mjs';
import {chatGPTModels, chatGPTRequest} from '../src/agents/chatgpt-protocol.js';
import {readEvents} from '../src/agents/providers.js';
export async function chatGPTControl(auth, data, {openBrowser, signal} = {}) {
  if (!auth) throw new ChatGPTAuthError('chatgpt_relay_disabled', 503);
  const id = data.accountId;
  if (id !== undefined && (typeof id !== 'string' || id.length > 128)) throw new ChatGPTAuthError('chatgpt_unknown_account', 400);
  switch (data.operation) {
    case 'status': return auth.status();
    case 'login': {
      if (data.openBrowser !== undefined && typeof data.openBrowser !== 'boolean') throw new ChatGPTAuthError('chatgpt_invalid_operation', 400);
      const result = await auth.start({accountId: id || '', consent: data.consent === true, ...(data.loginId ? {loginId: data.loginId} : {})});
      if (!data.openBrowser) return result;
      // URL comes ONLY from our pending PKCE attempt, never a browser-supplied URL.
      let browser = 'unavailable';
      if (openBrowser && !signal?.aborted && auth.status().loginId === result.loginId) {
        try { browser = await openBrowser(result.authorizationUrl, {signal}) ? 'launched' : 'failed'; }
        catch { browser = 'failed'; }
      }
      return {...result, browser};
    }
    case 'cancel': if (typeof data.loginId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(data.loginId)) throw new ChatGPTAuthError('chatgpt_invalid_login_id', 400); return auth.cancel(data.loginId);
    case 'logout': return auth.logout(id);
    default: throw new ChatGPTAuthError('chatgpt_invalid_operation', 400);
  }
}
export async function chatGPTUpstream(auth, data, {fetchImpl, signal}) {
  if (!auth) throw new ChatGPTAuthError('chatgpt_relay_disabled', 503);
  if (data.provider !== 'openai' || typeof data.accountId !== 'string') throw new ChatGPTAuthError('chatgpt_unknown_account', 400);
  const requestBody = data.operation === 'models' ? undefined : JSON.stringify(chatGPTRequest(data.body));
  const credential = await auth.authorize(data.accountId);
  const combined = AbortSignal.any([signal, credential.signal]); combined.throwIfAborted();
  // There is no API-key lookup, fallback or model retry here, even on quota/access failures.
  const response = await fetchImpl(CHATGPT_RESOURCE + (data.operation === 'models' ? '/models' : '/responses'), {
    method: data.operation === 'models' ? 'GET' : 'POST', body: requestBody,
    headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + credential.accessToken},
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: combined
  });
  if (data.operation !== 'models' || !response.ok) return response;
  let value; await readEvents(response, item => { value = item; }, {signal: combined, maxBytes: 262144});
  return Response.json({data: chatGPTModels(value), chatgpt: true});
}

/** Classic-IDE connection controls. Only the relay bearer enters browser memory, never OAuth tokens. */
import {el} from '../core/core.js';
import {relayURL, readEvents} from './providers.js';
const field = (label, control) => el('label', {class: 'agent-field'}, el('span', {}, label), control);
const button = (label, action) => el('button', {type: 'button', onclick: action}, label);
const errors = {
  chatgpt_login_in_progress: 'A sign-in is already pending in this relay. Refresh status or cancel it first.',
  chatgpt_relay_disabled: 'Start the updated local relay with ChatGPT enabled (VB6_CHATGPT_ENABLED must not be 0).',
  chatgpt_invalid_client: 'OpenAI rejected this client registration. Review the registration and sign in again.',
  chatgpt_connection_failed: 'Cannot reach OpenAI from the relay. Check the connection and try again.',
  chatgpt_unknown_account: 'Choose a ChatGPT account from this relay, or sign in to add one.'
};
export async function chatGPTControl({relay, relayToken, operation, accountId, loginId, consent = false, signal, fetchImpl = globalThis.fetch}) {
  const origin = relayURL(relay);
  if (!relayToken || /[\r\n]/.test(relayToken)) throw new Error('Enter the local relay access token in Connection. This is not a provider API key.');
  let response;
  try { response = await fetchImpl(origin + '/agent/chatgpt', {method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken}, body: JSON.stringify({operation, accountId, loginId, consent}), signal: AbortSignal.any([signal, AbortSignal.timeout(90000)].filter(Boolean))}); }
  catch { signal?.throwIfAborted(); throw new Error('Cannot reach the ChatGPT relay. Check its URL, allowed IDE origin and browser local-network permission.'); }
  let value;
  try { await readEvents(response, data => { value = data; }, {signal, maxBytes: 262144}); }
  catch (error) { signal?.throwIfAborted(); if (response.ok) throw error; }
  if (!response.ok) throw new Error(errors[value?.error?.code] || (response.status === 401 ? 'The relay access token is missing or invalid.' : response.status === 404 ? 'This relay does not support ChatGPT sign-in. Restart it with the updated source.' : 'ChatGPT connection operation failed. Check the account, relay and OpenAI availability.'));
  return value;
}
export class ChatGPTConnection {
  constructor(panel) {
    this.panel = panel; this.snapshot = null; this.busy = false; this.controller = null; this.disposed = false;
    this.mode = el('select', {'aria-label': 'OpenAI authentication'}, el('option', {value: 'api-key'}, 'API key — API billing'), el('option', {value: 'chatgpt'}, 'ChatGPT account — ChatGPT plan usage'));
    this.accounts = el('select', {'aria-label': 'ChatGPT account'}, el('option', {value: ''}, '(Sign in to add an account)'));
    this.message = el('p', {role: 'status', 'aria-label': 'ChatGPT connection status'}, 'ChatGPT sign-in uses your local relay. No API key is needed.');
    this.login = button('Sign in with ChatGPT', () => this.action('login'));
    this.reconsent = button('Enable plan usage…', () => this.action('login', true));
    this.check = button('Refresh account status', () => this.action('status'));
    this.logout = button('Sign out', () => this.action('logout'));
    this.cancel = button('Cancel sign-in', () => this.cancelLogin());
    this.link = el('a', {target: '_blank', rel: 'noopener noreferrer', hidden: true}, 'Open ChatGPT sign-in');
    this.details = el('fieldset', {}, el('legend', {}, 'ChatGPT account'), field('Account:', this.accounts), this.message,
      el('div', {class: 'agent-actions'}, this.login, this.reconsent, this.check, this.logout, this.cancel), this.link,
      el('p', {}, 'Sign in and approve plan usage in the OpenAI window. Your eligible ChatGPT allowance and app/workspace limits apply; this is not unlimited API access. No automatic fallback to API-key billing.'),
      el('p', {}, 'The local relay owns sign-in and refresh tokens. By default they remain only in relay memory; restart requires sign-in again. Clear Credentials clears browser-to-relay access, not your ChatGPT session; use Sign out to revoke it.'),
      el('p', {}, 'This preview does not accept a per-request output-token cap. Session usage, request/tool limits, timeouts and existing IDE permissions still apply, but a single request may exceed the remaining budget.'),
      el('a', {href: 'https://chatgpt.com/#settings/Usage', target: '_blank', rel: 'noopener noreferrer'}, 'ChatGPT Settings → Usage'));
    this.root = el('div', {}, field('Authentication:', this.mode), this.details);
    this.mode.onchange = () => { this.resetCatalog(); this.render(); if (this.enabled && this.panel.token.value && !this.snapshot) void this.action('status'); };
    this.accounts.onchange = () => { this.resetCatalog(); this.render(); };
    for (const control of [panel.relay, panel.token]) control.addEventListener('input', () => { this.snapshot = null; this.accounts.replaceChildren(el('option', {value: ''}, '(Refresh account status)')); this.resetCatalog(); this.render(); });
  }
  get enabled() { return this.panel.provider.value === 'openai' && this.mode.value === 'chatgpt'; }
  get selected() { return this.snapshot?.accounts?.find(a => a.id === this.accounts.value); }
  resetCatalog() { this.panel.model.value = ''; this.panel.models.replaceChildren(el('option', {value: ''}, '(Refresh models)')); }
  options() {
    if (!this.enabled) return {authMode: 'api-key'};
    if (!this.selected?.signedIn || !this.selected.planEnabled) throw new Error('Sign in with ChatGPT and enable plan usage in Connection before running or discovering models.');
    return {authMode: 'chatgpt', accountId: this.selected.id};
  }
  binding() { return this.enabled ? JSON.stringify(['chatgpt', relayURL(this.panel.relay.value), this.selected?.id || '']) : 'api-key'; }
  description() { return this.enabled ? 'ChatGPT plan usage — ' + (this.selected?.label || 'no account') + '. No automatic API billing fallback. Per-request output cap is not supported by this preview.' : 'API-key billing. Provider API charges may apply.'; }
  render(busy = !!this.panel.pending || this.panel.api.agent.busy) {
    this.root.hidden = this.panel.provider.value !== 'openai'; this.details.hidden = !this.enabled;
    if (this.enabled) { this.panel.connection.value = 'relay'; this.panel.connection.onchange?.(); }
    for (const control of [this.mode, this.accounts, this.login, this.reconsent, this.check]) control.disabled = busy || this.busy;
    this.panel.connection.disabled = busy || this.busy || this.enabled;
    this.logout.disabled = busy || this.busy || !this.selected?.signedIn;
    this.reconsent.disabled ||= !this.selected || this.selected.planEnabled;
    this.cancel.disabled = !(this.busy || this.snapshot?.login === 'pending');
    if (this.panel.outputTokens) {
      const input = this.panel.outputTokens;
      input.disabled = busy || this.busy;
      input.setAttribute('aria-label', this.enabled ? 'ChatGPT output reserve (not a provider cap)' : 'Maximum output tokens');
      input.title = this.enabled ? 'Local context-planning reserve only. OpenAI does not accept a hard output cap in ChatGPT-plan mode.' : '';
      const label = input.parentElement?.querySelector('span');
      if (label) label.textContent = this.enabled ? 'Output reserve (not a cap):' : 'Output tokens/request:';
    }
  }
  apply(value) {
    if (!value || !Array.isArray(value.accounts) || value.accounts.length > 16 || value.accounts.some(a => typeof a.id !== 'string' || typeof a.label !== 'string')) throw new Error('Invalid ChatGPT relay status.');
    const before = this.accounts.value;
    this.snapshot = value;
    this.accounts.replaceChildren(el('option', {value: ''}, '(Add a ChatGPT account)'), ...value.accounts.map(a => el('option', {value: a.id}, a.label + (a.signedIn ? a.planEnabled ? ' — plan enabled' : ' — plan consent required' : ' — signed out'))));
    this.accounts.value = value.accounts.some(a => a.id === before) ? before : value.accounts.findLast(a => a.signedIn)?.id || value.accounts.at(-1)?.id || '';
    const labels = {pending: 'Waiting for OpenAI sign-in and consent…', complete: 'Sign-in verified.', 'consent-required': 'Signed in, but ChatGPT plan permission was not granted. Use Enable plan usage or explicitly select API-key mode.', failed: 'Sign-in could not be verified. Retry sign-in.', declined: 'Sign-in was declined; no account was replaced.', expired: 'Sign-in timed out. Try again.', cancelled: 'Sign-in cancelled.'};
    this.message.textContent = (labels[value.login] || 'Account status refreshed.') + (value.storage === 'owner-only-file' ? ' This relay remembers tokens in its owner-only local file.' : ' OAuth tokens are held only in relay memory.');
    this.render();
  }
  async action(operation, consent = false) {
    if (this.busy || this.panel.pending || this.panel.api.agent.busy || this.disposed) return;
    // Open synchronously for browser popup policies, then sever opener before navigation.
    let popup;
    if (operation === 'login') { popup = this.panel.root.ownerDocument.defaultView.open('about:blank', '_blank'); if (popup) popup.opener = null; }
    const controller = new AbortController(); this.controller = controller; this.busy = true; this.panel.refresh();
    const loginId = operation === 'login' ? Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('') : undefined;
    if (loginId) this.loginId = loginId;
    const config = {loginId, relay: this.panel.relay.value, relayToken: this.panel.token.value, accountId: this.accounts.value || undefined};
    try {
      if (operation === 'login' && !this.snapshot) { const current = await chatGPTControl({...config, operation: 'status', signal: controller.signal}); controller.signal.throwIfAborted(); this.apply(current); config.accountId = this.accounts.value || undefined; }
      const value = await chatGPTControl({...config, operation, consent, signal: controller.signal});
      controller.signal.throwIfAborted(); this.apply(value);
      if (operation === 'logout') { this.resetCatalog(); this.message.textContent = value.revoked ? 'Signed out; renewable session revoked. Registration retained for future sign-in.' : 'Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT settings.'; }
      if (operation === 'login') {
        const url = new URL(value.authorizationUrl);
        if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize' || url.username || url.password || url.hash) throw new Error('The relay returned an invalid sign-in address.');
        this.link.href = url.href; this.link.hidden = false;
        if (popup && !popup.closed) popup.location.replace(url.href);
        const initialIds = new Set(value.accounts.map(a => a.id));
        for (let i = 0; i < 420; i++) {
          await new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 1500); controller.signal.addEventListener('abort', abort, {once: true}); if (controller.signal.aborted) abort(); });
          const current = await chatGPTControl({...config, operation: 'status', signal: controller.signal}); controller.signal.throwIfAborted(); this.apply(current);
          if (current.login !== 'pending') {
            const added = current.accounts.find(a => !initialIds.has(a.id) && a.signedIn); if (added) this.accounts.value = added.id;
            this.resetCatalog(); break;
          }
        }
      }
    } catch (error) { popup?.close(); if (!this.disposed) this.message.textContent = error.name === 'AbortError' ? 'Sign-in cancelled.' : error.message; }
    finally { if (this.controller === controller) this.controller = null; if (this.loginId === loginId) this.loginId = ''; this.busy = false; this.link.hidden = true; this.link.removeAttribute('href'); if (!this.disposed) this.panel.refresh(); }
  }
  async cancelLogin() {
    const loginId = this.loginId || (this.snapshot?.login === 'pending' ? this.snapshot.loginId : '');
    this.controller?.abort(); if (!loginId) return;
    try { const value = await chatGPTControl({relay: this.panel.relay.value, relayToken: this.panel.token.value, operation: 'cancel', loginId}); if (!this.disposed) this.apply(value); }
    catch { if (!this.disposed) this.message.textContent = 'Local wait cancelled. Could not contact relay to cancel sign-in; its pending login expires automatically.'; }
  }
  dispose() { this.disposed = true; if (this.busy) void this.cancelLogin(); this.controller?.abort(); }
}

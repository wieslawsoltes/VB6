/** Classic-IDE connection controls. Only the relay bearer enters browser memory, never OAuth tokens. */
import {el} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {chatGPTLoginURL} from './chatgpt-protocol.js';
import {relayURL, readEvents} from './providers.js';
const field = (label, control) => el('label', {class: 'agent-field'}, el('span', {}, label), control);
const button = (label, action) => el('button', {type: 'button', onclick: action}, label);
class ConnectionError extends Error {}
const errors = Object.freeze({
  chatgpt_login_in_progress: 'A sign-in is already pending in this relay. Refresh status or cancel it first.',
  chatgpt_relay_disabled: 'Start the updated local relay with ChatGPT enabled (VB6_CHATGPT_ENABLED must not be 0).',
  chatgpt_invalid_client: 'OpenAI rejected this client registration. Review the registration and sign in again.',
  chatgpt_connection_failed: 'Cannot reach OpenAI from the relay. Check the connection and try again.',
  chatgpt_invalid_discovery: 'The relay could not validate OpenAI sign-in configuration. Update the relay and try again.',
  chatgpt_unknown_account: 'Choose a ChatGPT account from this relay, or sign in to add one.'
});
function relayConfig(relay, relayToken) {
  let origin;
  try { origin = relayURL(relay); } catch { throw new ConnectionError('Enter a loopback Relay URL, normally http://127.0.0.1:4892.'); }
  const token = typeof relayToken === 'string' ? relayToken.trim() : '';
  if (!token || /[\r\n\0]/.test(token)) throw new ConnectionError('Start the local relay, then paste its local access token into Access token above. This is not an OpenAI API key. See Set up the local ChatGPT relay below.');
  return {relay: origin, relayToken: token};
}
/** Only an origin is shown. Never include the IDE URL's path, query or fragment in a shell command. */
export function chatGPTSetup(href) {
  let url;
  try { url = new URL(href); } catch {}
  const origin = url && ['http:', 'https:'].includes(url.protocol) ? url.origin : 'http://127.0.0.1:8080';
  const sh = "'" + origin.replaceAll("'", "'\"'\"'") + "'", ps = "'" + origin.replaceAll("'", "''") + "'";
  return {origin, unsupported: url?.protocol === 'file:' || url?.protocol === 'vb6:',
    posix: 'VB6_AGENT_ORIGINS=' + sh + ' npm run agent:relay',
    powershell: '$env:VB6_AGENT_ORIGINS = ' + ps + '; npm run agent:relay'};
}
export function chatGPTAuthorizationURL(value) {
  try { return chatGPTLoginURL(value); }
  catch { throw new ConnectionError('The relay returned an invalid sign-in address. Update the relay and try again.'); }
}

export async function chatGPTControl({relay, relayToken, operation, accountId, loginId, consent = false, signal, openBrowser = false, fetchImpl = globalThis.fetch,
  timeoutMs = ['login', 'logout'].includes(operation) ? 45000 : 8000}) {
  const config = relayConfig(relay, relayToken);
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(90000, Math.trunc(Number(timeoutMs)) || 8000)));
  const combined = AbortSignal.any([signal, timeout].filter(Boolean));
  try {
    combined.throwIfAborted();
    let response;
    try { response = await fetchImpl(config.relay + '/agent/chatgpt', {method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + config.relayToken}, body: JSON.stringify({operation, accountId, loginId, consent, ...(openBrowser ? {openBrowser: true} : {})}), signal: combined}); }
    catch { throw new ConnectionError('Cannot reach the local ChatGPT relay. Start it using the setup command below, check Relay URL, and allow local-network access in the browser. The relay must allow this exact IDE origin.'); }
    combined.throwIfAborted();
    let value;
    try { await readEvents(response, data => { value = data; }, {signal: combined, maxBytes: 262144}); }
    catch { combined.throwIfAborted(); if (response.ok) throw new ConnectionError('The relay returned an invalid or interrupted status response. Restart it with the updated source.'); }
    combined.throwIfAborted();
    if (!response.ok) {
      const code = value?.error?.code;
      const hint = typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] :
        response.status === 401 ? 'The local relay access token is invalid. Paste the token printed by the currently running relay, not an OpenAI API key.' :
        response.status === 403 ? 'The relay refused this IDE origin. Restart it with the exact-origin setup command below; do not enable wildcard or null origins.' :
        response.status === 404 ? 'This relay does not support ChatGPT sign-in. Restart it with the updated source.' :
        response.status === 429 ? 'The relay is busy. Wait for the current operation to finish, then refresh account status.' :
        'ChatGPT connection operation failed. Check the account, relay and OpenAI availability.';
      throw new ConnectionError(hint);
    }
    return value;
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new ConnectionError('The ChatGPT relay did not finish responding in time. Check the running relay and local-network permission, then refresh account status or cancel sign-in.');
    throw error instanceof ConnectionError ? error : new ConnectionError('ChatGPT connection could not be completed. Check the relay setup and try again.');
  }
}
function waitForPoll(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
    signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
  });
}
export class ChatGPTConnection {
  constructor(panel) {
    this.panel = panel; this.snapshot = null; this.busy = false; this.controller = null; this.disposed = false;
    this.mode = el('select', {'aria-label': 'OpenAI authentication'}, el('option', {value: 'api-key'}, 'API key — API billing'), el('option', {value: 'chatgpt'}, 'ChatGPT account — ChatGPT plan usage'));
    this.accounts = el('select', {'aria-label': 'ChatGPT account'}, el('option', {value: ''}, '(Sign in to add an account)'));
    this.message = el('p', {role: 'status', 'aria-live': 'polite', 'aria-label': 'ChatGPT connection status'}, 'Start the local relay and enter its access token above, then sign in. No OpenAI API key is needed.');
    const setup = chatGPTSetup(globalThis.location?.href);
    this.setup = el('details', {'aria-label': 'ChatGPT relay setup'}, el('summary', {}, 'Set up the local ChatGPT relay'),
      el('p', {}, 'A browser page cannot start the relay on your computer. With Node.js 22+, run one of these commands in your VB6 repository checkout to start the relay AND open sign-in in your system browser. GitHub Pages also needs this local process.'),
      el('strong', {}, 'macOS / Linux terminal'), el('pre', {tabindex: 0, style: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}, setup.posix + ' -- --sign-in'),
      el('strong', {}, 'Windows PowerShell'), el('pre', {tabindex: 0, style: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}, setup.powershell + ' -- --sign-in'),
      el('p', {}, 'Paste the printed local access token into Access token above. Allow local-network access when your browser asks. No provider API key, wildcard origin or public relay is needed.'),
      el('p', {}, 'For a downloaded HTML file or the packaged desktop IDE, use the browser IDE: run npm run build and npm run serve, then open http://127.0.0.1:8080. The file and desktop origins are not allowed by this relay.'));
    this.setup.open = !panel.token.value;
    this.login = button('Sign in with ChatGPT', () => this.beginLogin());
    this.reconsent = button('Enable plan usage…', () => this.beginLogin(true));
    this.check = button('Refresh account status', () => this.action('status'));
    this.logout = button('Sign out', () => this.action('logout'));
    this.cancel = button('Cancel sign-in', () => this.cancelLogin());
    // A real user-clicked link, not a blank window retargeted after asynchronous I/O.
    this.link = el('a', {target: '_blank', rel: 'noopener noreferrer', tabindex: 0, hidden: true}, 'Open ChatGPT sign-in');
    // The shared dialog's Enter shortcut must not swallow native keyboard link activation.
    this.link.addEventListener('keydown', event => { if (event.key === 'Enter') event.stopPropagation(); });
    this.loginURL = el('input', {type: 'text', readOnly: true, hidden: true, 'aria-label': 'ChatGPT sign-in link', style: {width: '100%'}});
    this.copyLink = button('Copy sign-in link', () => this.copySignInLink()); this.copyLink.hidden = true;
    this.portal = el('div', {}, this.message,
      el('div', {class: 'agent-actions'}, this.login, this.reconsent, this.check, this.logout, this.cancel),
      this.link, this.loginURL, this.copyLink, this.setup);
    this.portalHome = el('div', {}, this.portal);
    this.details = el('fieldset', {}, el('legend', {}, 'ChatGPT account'), field('Account:', this.accounts), this.portalHome,
      el('p', {}, 'Sign in and approve plan usage in the OpenAI window. Your eligible ChatGPT allowance and app/workspace limits apply; this is not unlimited API access. No automatic fallback to API-key billing.'),
      el('p', {}, 'The local relay owns sign-in and refresh tokens. By default they remain only in relay memory; restart requires sign-in again. Clear Credentials clears browser-to-relay access, not your ChatGPT session; use Sign out to revoke it.'),
      el('p', {}, 'This preview does not accept a per-request output-token cap. Session usage, request/tool limits, timeouts and existing IDE permissions still apply, but a single request may exceed the remaining budget.'),
      el('a', {href: 'https://chatgpt.com/#settings/Usage', target: '_blank', rel: 'noopener noreferrer'}, 'ChatGPT Settings → Usage'));
    this.root = el('div', {}, field('Authentication:', this.mode), this.details);
    // Switching authentication mode must not silently start a request or disable Sign in.
    this.mode.onchange = () => { this.resetCatalog(); this.render(); };
    panel.clearKey?.addEventListener('click', () => this.clearLogin());
    this.accounts.onchange = () => { this.resetCatalog(); this.render(); };
    for (const control of [panel.relay, panel.token]) control.addEventListener('input', () => { if (this.busy) this.controller?.abort(); this.clearLogin(); this.snapshot = null; this.accounts.replaceChildren(el('option', {value: ''}, '(Refresh account status)')); this.resetCatalog(); this.render(); });
  }
  beginLogin(consent = false) {
    // Always show visible first-run/setup UI, even with no token or blocked popups.
    try { this.showSignIn(); } catch { this.notify('The sign-in dialog could not open. Reopen AI Coding Agents, or use the --sign-in relay command below.', true); }
    return this.action('login', consent);
  }
  showSignIn() {
    if (this.signInDialog || this.disposed) return;
    const relay = el('input', {'aria-label': 'Sign-in relay URL', value: this.panel.relay.value});
    const token = el('input', {type: 'password', autocomplete: 'off', 'aria-label': 'Sign-in relay access token', value: this.panel.token.value});
    this.signInInputs = [relay, token];
    [this.panel.relay, this.panel.token].forEach((target, i) => {
      const input = this.signInInputs[i];
      input.addEventListener('input', () => {
        target.value = input.value;
        target.dispatchEvent(new target.ownerDocument.defaultView.Event('input', {bubbles: true}));
      });
    });
    const content = el('div', {class: 'agent-page'},
      el('p', {}, 'Browser handoff v2 — the local relay opens your system browser. If no browser opens, use Open ChatGPT sign-in or copy the link below. Keep this IDE open.'),
      field('Local relay URL:', relay), field('Local relay access token:', token),
      el('p', {}, 'This token pairs the IDE with the relay on your computer. It is not an OpenAI API key or your ChatGPT password.'), this.portal);
    this.signInDialog = true;
    void modal('ChatGPT sign-in', {width: 700, content,
      buttons: [{label: 'Back to IDE', value: false}],
      onReady: ({dialog, finish}) => { this.finishSignIn = finish; dialog.style.maxHeight = '90vh'; dialog.style.overflow = 'auto'; }
    }).catch(() => this.notify('The sign-in dialog could not open. Use the --sign-in relay command below.', true)).finally(() => {
      this.portalHome.append(this.portal); token.value = '';
      this.signInInputs = null; this.signInDialog = false; this.finishSignIn = null;
    });
    this.render();
  }
  async copySignInLink() {
    if (this.link.hidden || !this.link.hasAttribute('href')) return;
    const value = chatGPTAuthorizationURL(this.link.href);
    try {
      await this.panel.root.ownerDocument.defaultView.navigator.clipboard.writeText(value);
      this.notify('Sign-in link copied. Open it in a browser on this computer; keep the IDE open.');
    } catch {
      this.loginURL.focus(); this.loginURL.select();
      this.notify('Select and copy the sign-in link above, then paste it into your browser address bar.');
    }
  }
  notify(text, error = false) {
    this.message.textContent = text;
    this.message.setAttribute('role', error ? 'alert' : 'status');
    if (this.panel.status) this.panel.status.textContent = 'ChatGPT: ' + text;
    if (error) this.setup.open = true;
  }
  clearLogin() {
    this.loginId = ''; this.loginConfig = null; this.manualLogin = false;
    this.link.hidden = true; this.link.removeAttribute('href');
    this.loginURL.hidden = true; this.loginURL.value = ''; this.copyLink.hidden = true; this.browserLaunch = '';
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
    this.login.disabled ||= !!this.loginId || this.snapshot?.login === 'pending';
    this.cancel.disabled = this.cancelling || !(this.busy || this.loginId || this.snapshot?.login === 'pending');
    this.details.setAttribute('aria-busy', String(this.busy));
    for (const input of this.signInInputs || []) input.disabled = busy || this.busy;
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
    if (!value || !Array.isArray(value.accounts) || value.accounts.length > 16 || value.accounts.some(a => typeof a.id !== 'string' || a.id.length > 128 || typeof a.label !== 'string' || a.label.length > 1024)) throw new ConnectionError('Invalid ChatGPT relay status. Restart the updated local relay.');
    const before = this.accounts.value;
    this.snapshot = value;
    this.accounts.replaceChildren(el('option', {value: ''}, '(Add a ChatGPT account)'), ...value.accounts.map(a => el('option', {value: a.id}, a.label + (a.signedIn ? a.planEnabled ? ' — plan enabled' : ' — plan consent required' : ' — signed out'))));
    this.accounts.value = value.accounts.some(a => a.id === before) ? before : value.accounts.findLast(a => a.signedIn)?.id || value.accounts.at(-1)?.id || '';
    const labels = {pending: 'Waiting for OpenAI sign-in and consent…', complete: 'Sign-in verified.', 'consent-required': 'Signed in, but ChatGPT plan permission was not granted. Use Enable plan usage or explicitly select API-key mode.', failed: 'Sign-in could not be verified. Retry sign-in.', declined: 'Sign-in was declined; no account was replaced.', expired: 'Sign-in timed out. Try again.', cancelled: 'Sign-in cancelled.'};
    if (value.login !== 'pending') this.clearLogin();
    this.notify((value.login === 'pending' && this.manualLogin ? (this.browserLaunch === 'launched' ? 'Sign-in handed to your system browser. If no window appeared, click Open ChatGPT sign-in or copy the link below; keep this IDE open.' : 'Click Open ChatGPT sign-in below to open the OpenAI page, or copy the link into your browser. No automatic popup is required.') : labels[value.login] || 'Account status refreshed.') + (value.storage === 'owner-only-file' ? ' This relay remembers tokens in its owner-only local file.' : ' OAuth tokens are held only in relay memory.'));
    if (value.accounts.some(a => a.signedIn)) this.setup.open = false;
    this.render();
  }
  async action(operation, consent = false) {
    if (this.disposed) return;
    if (this.busy || this.panel.pending || this.panel.api.agent.busy) { this.notify('Finish or stop the current operation before changing ChatGPT sign-in.'); return; }
    let controller, config;
    try {
      // No window.open call: all preparation happens in a visible dialog; the relay owns OS launch.
      this.notify(operation === 'login' ? 'Checking local relay setup…' : operation === 'logout' ? 'Signing out and revoking the session…' : 'Checking local relay account status…');
      const setup = chatGPTSetup(globalThis.location?.href);
      if (setup.unsupported) throw new ConnectionError('ChatGPT sign-in needs the browser IDE served over HTTP(S), not a file or packaged desktop origin. Run npm run build and npm run serve, then open http://127.0.0.1:8080 and connect the local relay.');
      config = {...relayConfig(this.panel.relay.value, this.panel.token.value), accountId: this.accounts.value || undefined};
      if (operation === 'login' && (this.loginId || this.snapshot?.login === 'pending')) throw new ConnectionError('Finish or cancel the pending sign-in first. Use Refresh account status to check it.');
      controller = new AbortController(); this.controller = controller; this.busy = true; this.panel.refresh();
      if (operation === 'login') {
        if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new ConnectionError('This browser cannot create secure sign-in state. Use an up-to-date browser and reopen the served IDE.');
        config.loginId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('');
        if (!this.snapshot) {
          this.notify('Connecting to the local relay…');
          const current = await chatGPTControl({...config, operation: 'status', signal: controller.signal});
          controller.signal.throwIfAborted(); this.apply(current); config.accountId = this.accounts.value || undefined;
          if (current.login === 'pending') throw new ConnectionError('A sign-in is already pending in this relay. Refresh status or cancel it first.');
        }
        this.loginId = config.loginId; this.loginConfig = {...config};
        this.notify('Preparing OpenAI browser sign-in through the local relay…');
      }
      const value = await chatGPTControl({...config, operation, consent, openBrowser: operation === 'login', signal: controller.signal});
      controller.signal.throwIfAborted(); this.apply(value);
      if (operation === 'logout') {
        this.resetCatalog(); this.notify(value.revoked ? 'Signed out; renewable session revoked. Registration retained for future sign-in.' : 'Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT settings.');
      }
      if (operation === 'login') {
        const url = chatGPTAuthorizationURL(value.authorizationUrl);
        this.link.href = url; this.link.hidden = false; this.manualLogin = true;
        this.loginURL.value = url; this.loginURL.hidden = false; this.copyLink.hidden = false;
        this.browserLaunch = value.browser === 'launched' ? 'launched' : 'unavailable';
        this.apply(value); // Always expose a real hyperlink, even if the system launcher reports success.
        const initialIds = new Set(value.accounts.map(a => a.id));
        let complete = false;
        for (let i = 0; i < 420; i++) {
          await waitForPoll(controller.signal);
          const current = await chatGPTControl({...config, operation: 'status', signal: controller.signal});
          controller.signal.throwIfAborted(); this.apply(current);
          if (current.login !== 'pending') {
            const added = current.accounts.find(a => !initialIds.has(a.id) && a.signedIn); if (added) this.accounts.value = added.id;
            this.resetCatalog(); complete = true;
            if (current.login === 'complete') this.finishSignIn?.(true);
            break;
          }
        }
        if (!complete) throw new ConnectionError('The sign-in wait expired. Refresh account status or cancel the pending sign-in before trying again.');
      }
    } catch (error) {
      if (!this.disposed && !this.cancelling) this.notify(error?.name === 'AbortError' ? 'ChatGPT operation cancelled.' :
        error instanceof ConnectionError ? error.message : 'ChatGPT sign-in could not start. Check the local relay setup and browser permissions, then try again.', error?.name !== 'AbortError');
      // A valid login page survives a failed status poll. Never report success or start a second login.
    } finally {
      if (controller && this.controller === controller) this.controller = null;
      this.busy = !!this.cancelling;
      if (!this.disposed) { try { this.panel.refresh(); } catch { this.notify('ChatGPT controls could not refresh. Reopen AI Coding Agents and check the local relay.', true); } }
    }
  }
  async cancelLogin() {
    if (this.cancelling) return;
    const config = this.loginConfig || {relay: this.panel.relay.value, relayToken: this.panel.token.value, loginId: this.snapshot?.loginId};
    this.cancelling = true; this.busy = true; this.controller?.abort();
    try {
      if (!this.disposed) { this.notify('Cancelling ChatGPT sign-in…'); this.panel.refresh(); }
      if (config.loginId) {
        const value = await chatGPTControl({...config, operation: 'cancel'});
        if (!this.disposed) this.apply(value);
      }
      this.clearLogin();
      if (!this.disposed) this.notify('ChatGPT sign-in cancelled.');
    } catch {
      if (!this.disposed) this.notify('Local wait cancelled. Could not contact the relay to cancel sign-in; refresh status or retry Cancel. Its pending login expires automatically.', true);
    } finally {
      this.cancelling = false; this.busy = !!this.controller;
      if (!this.disposed) { try { this.panel.refresh(); } catch {} }
    }
  }
  dispose() { this.finishSignIn?.(false); this.disposed = true; if (this.busy || this.loginId) void this.cancelLogin(); this.controller?.abort(); }
}

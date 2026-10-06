#!/usr/bin/env python3
"""Sign-in failure/first-run regressions. Relay and popup failures are injected; no real account or billing."""
import argparse, functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports/chatgpt-login'
REPORTS.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--opaque', action='store_true', help='Restricted local harness only; not real-origin verification.')
args = parser.parse_args()
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT/'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
checks = []
def check(value, label):
    if not value: raise AssertionError(label)
    checks.append(label)
FIXTURE = r'''() => {
  const panel = vb6Studio.documents.tools.get('tool:coding-agents');
  window.fixturePanel = panel;
  window.fixtureReset = (mode = 'ok', popupMode = 'ok') => {
    const f = window.signinFixture = {mode, popupMode, requests: [], popups: [], started: false, cancelled: false};
    panel.chatgpt.clearLogin(); panel.chatgpt.snapshot = null;
    panel.chatgpt.accounts.replaceChildren(new Option('(Sign in)', ''));
    panel.relay.value = 'http://127.0.0.1:4892'; panel.token.value = 'fixture-local-relay-token-123456789';
    panel.chatgpt.mode.value = 'chatgpt'; panel.refresh();
    window.open = () => {
      if (f.popupMode === 'throw') throw new DOMException('private-popup-error', 'SecurityError');
      if (f.popupMode === 'null') return null;
      const popup = {closed: false, opener: window, document: {body: {}, title: ''},
        close() { this.closed = true; if (f.popupMode === 'close-throws') throw new Error('private-close-error'); },
        location: {replace(url) { if (f.popupMode === 'navigation-throws') throw new DOMException('private-navigation-error', 'SecurityError'); f.url = url; }}
      };
      if (f.popupMode === 'opener-throws') Object.defineProperty(popup, 'opener', {set() { throw new Error('private-opener-error'); }});
      if (f.popupMode === 'closed') popup.closed = true;
      f.popups.push(popup); return popup;
    };
    window.fetch = async (url, init) => {
      if (url !== 'http://127.0.0.1:4892/agent/chatgpt') throw new Error('Unexpected request destination');
      const data = JSON.parse(init.body); f.requests.push(data.operation);
      if (f.mode === 'network' || f.mode === 'poll-failure' && f.started && !f.complete && data.operation === 'status') throw new TypeError('private-network-error');
      if (/^http-/.test(f.mode)) return Response.json({error: {message: 'private-server-error'}}, {status: Number(f.mode.slice(5))});
      if (f.mode === 'disabled') return Response.json({error: {code: 'chatgpt_relay_disabled'}}, {status: 503});
      if (f.mode === 'stall-fetch') return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true}));
      if (f.mode === 'stall-body') return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { f.bodyCancelled = true; }}));
      if (data.operation === 'cancel') { f.cancelled = true; f.started = false; }
      if (data.operation === 'login') { f.started = true; f.loginId = data.loginId; f.launchRequested = data.openBrowser === true; }
      return Response.json({accounts: f.complete ? [{id: 'account-fixture', label: 'Fixture account', signedIn: true, planEnabled: true}] : [],
        login: f.complete ? 'complete' : f.started ? 'pending' : f.cancelled ? 'cancelled' : 'idle', loginId: f.started ? f.loginId : '', storage: 'memory-only',
        ...(data.operation === 'login' ? {browser: f.mode === 'system-launch' ? 'launched' : 'unavailable', authorizationUrl: f.mode === 'bad-url' ? 'https://evil.invalid/?secret=hidden' : 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=fixture'} : {})});
    };
  };
}'''
try:
    with sync_playwright() as p:
        browser_name = os.environ.get('VB6_BROWSER', 'chromium')
        executable = os.environ.get('CHROMIUM_PATH') if browser_name == 'chromium' else None
        browser = getattr(p, browser_name).launch(headless=True, **({'executable_path': executable} if executable else {}))
        for filename in ['index.html', 'VB6-Studio-Web.html']:
            context = browser.new_context(viewport={'width': 1500, 'height': 1100})
            context.route('https://**', lambda route: route.abort())
            context.route('https://auth.openai.com/api/accounts/authorize*', lambda route: route.fulfill(content_type='text/html', body='<h1>Manual sign-in navigation fixture</h1>'))
            page = context.new_page(); page.set_default_timeout(15000); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            if args.opaque:
                page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(), wait_until='domcontentloaded')
            else: page.goto(base + '/' + filename)
            page.wait_for_function('!!globalThis.vb6Studio?.codingAgents')
            page.evaluate("() => { vb6Studio.command('codingAgents'); vb6Studio.documents.tools.get('tool:coding-agents').pages.select('connection'); }")
            page.evaluate(FIXTURE)
            def reset(mode='ok', popup='ok'):
                if page.get_by_role('dialog', name='ChatGPT sign-in', exact=True).count():
                    page.get_by_role('button', name='Back to IDE', exact=True).click()
                page.wait_for_function("!fixturePanel.chatgpt.busy")
                page.evaluate('([mode, popup]) => fixtureReset(mode, popup)', [mode, popup])
            def idle(): page.wait_for_function('!fixturePanel.chatgpt.busy')
            def status(): return page.get_by_label('ChatGPT connection status', exact=True).inner_text()
            def cancel():
                page.get_by_role('button', name='Cancel sign-in', exact=True).click(); idle()
            def login(): page.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
            reset()
            page.get_by_label('Agent relay token', exact=True).fill('')
            login(); idle()
            check(page.get_by_role('dialog', name='ChatGPT sign-in', exact=True).is_visible() and 'paste its local access token' in status(), filename + ': missing token has explicit first-run instructions')
            check(page.evaluate('signinFixture.requests.length === 0 && signinFixture.popups.length === 0'), filename + ': missing token does not open a blank tab or contact a provider')
            check(page.evaluate('fixturePanel.chatgpt.setup.open') and 'ChatGPT:' in page.locator('.agent-status').inner_text(), filename + ': setup and footer expose the error even in a scrolled panel')
            check(page.get_by_label('ChatGPT connection status', exact=True).get_attribute('role') == 'alert', filename + ': sign-in errors are accessible alerts')
            page.screenshot(path=str(REPORTS/(filename.replace('.html', '') + '-signin-setup.png')))
            # Finish first-run pairing inside the dialog, not by searching for fields behind it.
            page.get_by_label('Sign-in relay access token', exact=True).fill('local-relay-browser-fixture-token-123456789')
            login()
            page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).wait_for()
            check(page.evaluate('signinFixture.launchRequested && signinFixture.popups.length === 0'), filename + ': first-run dialog pairs relay and requests OS launch without window.open')
            cancel()
            reset('system-launch', 'throw'); login()
            page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).wait_for()
            check('handed to your system browser' in status() and page.evaluate('signinFixture.launchRequested'), filename + ': OS launch is reported as handoff, not authentication success')
            check(page.get_by_label('ChatGPT sign-in link', exact=True).input_value().startswith('https://auth.openai.com/'), filename + ': selectable URL remains available even after launcher success')
            page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async()=>{throw new Error('clipboard denied');}}})")
            page.get_by_role('button', name='Copy sign-in link', exact=True).click()
            page.wait_for_function("fixturePanel.chatgpt.message.textContent.includes('Select and copy')")
            check(page.get_by_label('ChatGPT sign-in link', exact=True).evaluate('(e) => document.activeElement===e && e.selectionStart===0 && e.selectionEnd===e.value.length'), filename + ': clipboard denial selects the complete fallback URL')
            page.get_by_role('button', name='Back to IDE', exact=True).click()
            check(page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).is_visible() and page.evaluate('!!fixturePanel.chatgpt.loginId'), filename + ': closing dialog preserves pending sign-in in Connection')
            cancel()
            reset()
            page.get_by_label('OpenAI authentication', exact=True).select_option('api-key')
            page.get_by_label('OpenAI authentication', exact=True).select_option('chatgpt')
            check(page.evaluate('signinFixture.requests.length === 0') and page.get_by_role('button', name='Sign in with ChatGPT', exact=True).is_enabled(), filename + ': switching mode never starts a hidden blocking request')
            page.get_by_label('Agent relay URL', exact=True).fill('https://evil.invalid/?secret=hidden')
            login(); idle()
            check('loopback Relay URL' in status() and page.evaluate('signinFixture.popups.length === 0'), filename + ': invalid relay rejected before popup and without reflecting the URL')
            for code, hint in [(401, 'currently running relay'), (403, 'exact-origin'), (404, 'updated source'), (429, 'relay is busy')]:
                reset('http-' + str(code))
                page.get_by_role('button', name='Refresh account status', exact=True).click(); idle()
                check(hint in status(), filename + f': HTTP {code} gives an actionable recovery message')
            reset('disabled')
            page.get_by_role('button', name='Refresh account status', exact=True).click(); idle()
            check('VB6_CHATGPT_ENABLED' in status(), filename + ': disabled relay explains how to enable sign-in')
            reset('network', 'close-throws'); login(); idle()
            check('Cannot reach the local ChatGPT relay' in status() and page.evaluate('signinFixture.popups.length === 0') and page.get_by_role('dialog', name='ChatGPT sign-in', exact=True).is_visible(), filename + ': missing relay stays in a visible dialog without a disposable blank popup')
            reset('stall-body')
            page.get_by_role('button', name='Refresh account status', exact=True).click()
            check('Checking local relay account status' in status(), filename + ': immediate progress appears before slow I/O')
            idle()
            check('did not finish responding in time' in status() and page.evaluate('signinFixture.bodyCancelled'), filename + ': stalled body times out and releases the controls')
            for popup_mode in ['throw', 'null', 'opener-throws', 'navigation-throws', 'closed']:
                reset('ok', popup_mode); login()
                page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).wait_for()
                check('No automatic popup is required' in status() and page.evaluate('signinFixture.popups.length === 0'), filename + ': ' + popup_mode + ' cannot prevent the visible dialog and native link')
                if popup_mode == 'throw' and not args.opaque:
                    with context.expect_page() as info:
                        page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).click()
                    popup = info.value
                    popup.get_by_role('heading', name='Manual sign-in navigation fixture').wait_for()
                    check(popup.evaluate('window.opener === null'), filename + ': manual link actually opens an isolated browser tab')
                    popup.close()
                cancel()
                check(page.evaluate('!fixturePanel.chatgpt.loginId && !fixturePanel.chatgpt.link.hasAttribute("href")'), filename + ': ' + popup_mode + ' cancellation removes only the pending link')
            reset('poll-failure', 'null'); login(); idle()
            check(page.get_by_role('link', name='Open ChatGPT sign-in', exact=True).is_visible() and page.get_by_role('button', name='Sign in with ChatGPT', exact=True).is_disabled(), filename + ': failed status polling preserves login and prevents a duplicate attempt')
            page.evaluate('signinFixture.complete = true')
            page.get_by_role('button', name='Refresh account status', exact=True).click(); idle()
            check('Sign-in verified' in status() and page.evaluate('!fixturePanel.chatgpt.loginId && fixturePanel.chatgpt.selected.planEnabled'), filename + ': explicit status retry recovers the same verified account')
            reset('bad-url'); login(); idle()
            check('invalid sign-in address' in status() and page.evaluate('!fixturePanel.chatgpt.link.hasAttribute("href")'), filename + ': malicious login destination never becomes a link')
            cancel()
            reset('stall-fetch'); login()
            check('Connecting to the local relay' in status(), filename + ': preparation exposes progress before any login URL exists')
            cancel()
            check('cancelled' in status() and page.get_by_role('button', name='Sign in with ChatGPT', exact=True).is_enabled(), filename + ': cancellation during setup recovers from an unresponsive relay')
            reset()
            page.evaluate("() => { const original = fixturePanel.refresh.bind(fixturePanel); let first = true; fixturePanel.refresh = (...args) => { if (first) { first = false; throw new Error('private-render-error'); } return original(...args); }; }")
            login(); idle()
            check('could not start' in status() and not page.evaluate('!!fixturePanel.chatgpt.controller'), filename + ': setup exceptions are caught and do not strand the busy state')
            reset('poll-failure', 'null'); login(); idle()
            page.get_by_role('button', name='Back to IDE', exact=True).click()
            page.get_by_role('button', name='Clear Credentials', exact=True).click()
            check(page.evaluate("fixturePanel.token.value === '' && !fixturePanel.chatgpt.loginConfig && !fixturePanel.chatgpt.link.hasAttribute('href')"), filename + ': clearing credentials also removes retry state and the login URL')
            check(not errors, filename + ': all failure paths have no unhandled browser exceptions')
            check('private-' not in page.locator('.agent-panel').inner_text(), filename + ': raw network and popup errors never leak into the panel')
            context.close()
        if not args.opaque:
            context = browser.new_context(); page = context.new_page()
            page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri())
            page.wait_for_function('!!globalThis.vb6Studio?.codingAgents')
            page.evaluate("() => { vb6Studio.command('codingAgents'); const p=vb6Studio.documents.tools.get('tool:coding-agents'); p.pages.select('connection'); p.chatgpt.mode.value='chatgpt'; p.chatgpt.render(); }")
            page.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
            check('not a file or packaged desktop origin' in page.get_by_label('ChatGPT connection status', exact=True).inner_text(), 'file build: actionable HTTP setup instead of an impossible null-origin login')
            check(len(context.pages) == 1, 'file build: no useless blank popup')
            context.close()
        browser.close()
    (REPORTS/'signin-errors.json').write_text(json.dumps({'browser': browser_name, 'mockRelay': True, 'mockPopupFailures': True, 'liveOpenAITested': False, 'opaqueBrowserHarness': args.opaque, 'checks': checks, 'count': len(checks)}, indent=2))
    print(json.dumps({'passed': len(checks), 'opaqueBrowserHarness': args.opaque}))
finally:
    server.shutdown()

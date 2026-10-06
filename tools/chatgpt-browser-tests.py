#!/usr/bin/env python3
"""Real IDE/relay/OAuth callback integration; OpenAI identity and model endpoints are fixtures, not live billing."""
import functools, http.server, json, os, subprocess, threading, urllib.parse, urllib.request, argparse
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports/chatgpt-login'
REPORTS.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT/'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
proc = subprocess.Popen(['node', 'tools/chatgpt-browser-fixture.mjs'], cwd=ROOT, env={**os.environ, 'VB6_TEST_ORIGIN': base}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
relay = json.loads(proc.stdout.readline())['relay']
parser = argparse.ArgumentParser(); parser.add_argument('--opaque', action='store_true'); args = parser.parse_args()
checks = []
def check(value, label):
    if not value: raise AssertionError(label)
    checks.append(label)
def consent(route):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
    callback = q['redirect_uri'][0] + '?' + urllib.parse.urlencode({'state': q['state'][0], 'code': 'fixture-code', 'client_id': 'oaiapp_fixture'})
    route.fulfill(content_type='text/html', body='<h1>OpenAI consent fixture — not a live account</h1><a href="' + callback.replace('&','&amp;') + '">Approve fixture consent</a>')
try:
    with sync_playwright() as p:
        browser_name = os.environ.get('VB6_BROWSER', 'chromium')
        browser_type = getattr(p, browser_name)
        executable = os.environ.get('CHROMIUM_PATH') if browser_name == 'chromium' else None
        browser = browser_type.launch(headless=True, **({'executable_path': executable} if executable else {}))
        for filename in ['index.html', 'VB6-Studio-Web.html']:
            context = browser.new_context(viewport={'width': 1500, 'height': 1100})
            context.route('https://**', lambda route: route.abort())
            context.route('https://auth.openai.com/api/accounts/authorize*', consent)
            page = context.new_page(); page.set_default_timeout(15000); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            if args.opaque:
                def relay_fetch(source, url, init):
                    assert url.startswith(relay + '/')
                    req = urllib.request.Request(url, data=init.get('body','').encode(), method=init['method'], headers={**init['headers'], 'Origin':base})
                    try: response = urllib.request.urlopen(req)
                    except urllib.error.HTTPError as error: response = error
                    return {'status': response.status, 'headers': dict(response.headers), 'body': response.read().decode()}
                page.expose_binding('__fixtureRelayFetch', relay_fetch)
                page.set_content((ROOT/'dist'/('VB6-Studio-Web.html')).read_text(), wait_until='domcontentloaded')
                page.evaluate('''window.fetch = async (url, init) => { const r = await __fixtureRelayFetch(url, {method:init.method, headers:init.headers, body:init.body}); return new Response(r.body, {status:r.status, headers:r.headers}); };
                window.open = () => window.__fixturePopup = {closed:false, opener:window, location:{replace(url){window.__fixtureAuthURL=url;}}, close(){this.closed=true;}};''')
            else:
                page.goto(base + '/' + filename)
            page.wait_for_function('!!globalThis.vb6Studio?.codingAgents')
            page.evaluate("vb6Studio.command('codingAgents')")
            panel = page.locator('.agent-panel')
            panel.get_by_role('tab', name='Connection', exact=True).click()
            check(page.get_by_label('OpenAI authentication', exact=True).input_value() == 'api-key', filename + ': API billing remains default')
            page.get_by_label('Agent relay URL', exact=True).fill(relay)
            page.get_by_label('Agent relay token', exact=True).fill('chatgpt-browser-fixture-token-123456789')
            page.get_by_label('OpenAI authentication', exact=True).select_option('chatgpt')
            check(page.get_by_label('Agent connection', exact=True).is_disabled(), filename + ': ChatGPT enforces relay')
            if args.opaque:
                page.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
                page.wait_for_function('!!window.__fixtureAuthURL')
                q = urllib.parse.parse_qs(urllib.parse.urlparse(page.evaluate('window.__fixtureAuthURL')).query)
                callback = q['redirect_uri'][0] + '?' + urllib.parse.urlencode({'state':q['state'][0], 'code':'fixture-code', 'client_id':'oaiapp_fixture'})
                check(urllib.request.urlopen(callback).status == 200, filename + ': verified loopback callback (opaque browser fixture)')
                check(page.evaluate('window.__fixturePopup.opener === null'), filename + ': product severs fixture popup opener')
            else:
                with context.expect_page() as popup_info:
                    page.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
                popup = popup_info.value
                popup.get_by_role('link', name='Approve fixture consent').wait_for()
                check(popup.evaluate('window.opener === null'), filename + ': OAuth popup has no opener')
                popup.get_by_role('link', name='Approve fixture consent').click()
                popup.wait_for_function("document.body.textContent.includes('sign-in complete')")
                popup.close()
            page.wait_for_function("vb6Studio.documents.tools.get('tool:coding-agents').chatgpt.selected?.planEnabled && !vb6Studio.documents.tools.get('tool:coding-agents').chatgpt.busy")
            page.get_by_role('button', name='Refresh Models', exact=True).click()
            page.wait_for_function("document.querySelector('[aria-label=\"Available AI models\"]')?.options.length === 3")
            names = page.get_by_label('Available AI models', exact=True).locator('option').all_text_contents()
            check(names[1:] == ['Model Z', 'Model A'], filename + ': eligible models retain display names and ordering')
            page.get_by_label('Available AI models', exact=True).select_option('model-z')
            panel.get_by_role('tab', name='Permissions', exact=True).click()
            page.get_by_label('Agent permission mode', exact=True).select_option('readonly')
            check(page.get_by_label('ChatGPT output reserve (not a provider cap)', exact=True).is_enabled(), filename + ': local reserve is adjustable and not presented as a provider cap')
            panel.get_by_role('tab', name='Task', exact=True).click()
            page.get_by_label('Agent task', exact=True).fill('Inspect the current VB6 project.')
            panel.get_by_role('button', name='Run', exact=True).click()
            dialog = page.get_by_role('dialog', name='AI Coding Agent — Start Task', exact=True)
            check('ChatGPT plan usage' in dialog.inner_text(), filename + ': run confirmation identifies billing mode')
            dialog.get_by_role('button', name='Start Task', exact=True).click()
            page.wait_for_function("vb6Studio.codingAgents.agent.state === 'completed'")
            check(page.evaluate('vb6Studio.codingAgents.agent.budgetUsed') == 50, filename + ': real tool continuation and usage accounting')
            check('ChatGPT fixture inspected' in panel.inner_text(), filename + ': reply appears in conversation')
            # The current workbench must compose with account-bound ChatGPT tasks.
            check(page.evaluate("!!vb6Studio.codingAgents.conversations.active.review.first"), filename + ': ChatGPT run captures workbench review checkpoint')
            page.evaluate("window.__fixtureAccount = vb6Studio.documents.tools.get('tool:coding-agents').chatgpt.accounts.value")
            page.get_by_label('Agent task', exact=True).fill('Inspect the project again from the queued ChatGPT follow-up.')
            panel.get_by_role('button', name='Queue message', exact=True).click()
            page.get_by_label('Agent task', exact=True).fill('/compact')
            panel.get_by_role('tab', name='Queue', exact=True).click()
            panel.get_by_role('button', name='Send selected message…', exact=True).click()
            dialog = page.get_by_role('dialog', name='AI Coding Agent — Start Task', exact=True)
            check('ChatGPT plan usage' in dialog.inner_text() and 'selected queued message' in dialog.inner_text(), filename + ': queued ChatGPT message requires fresh billing confirmation')
            dialog.get_by_role('button', name='Cancel', exact=True).click()
            page.wait_for_function("!vb6Studio.documents.tools.get('tool:coding-agents').pending")
            check(page.evaluate("vb6Studio.codingAgents.agent.usage.requests === 2 && vb6Studio.codingAgents.conversations.active.followups.list().length === 1"), filename + ': cancelled queue confirmation sends nothing and retains message')
            # Changing accounts cannot redirect an existing queue, even to the add-account selection.
            page.evaluate("const p=vb6Studio.documents.tools.get('tool:coding-agents'); p.chatgpt.accounts.value=''; p.start(false,false,p.workbench.queueList.value)")
            page.wait_for_function("vb6Studio.documents.tools.get('tool:coding-agents').status.textContent.includes('another billing mode')")
            check(page.evaluate("vb6Studio.codingAgents.agent.usage.requests === 2 && vb6Studio.codingAgents.conversations.active.followups.list().length === 1"), filename + ': account switch cannot consume or send queued message')
            page.evaluate("const p=vb6Studio.documents.tools.get('tool:coding-agents'); p.chatgpt.accounts.value=window.__fixtureAccount; p.chatgpt.busy=true; p.start(false,false,p.workbench.queueList.value)")
            check(page.evaluate("!vb6Studio.documents.tools.get('tool:coding-agents').pending && vb6Studio.codingAgents.agent.usage.requests === 2"), filename + ': queue waits for authentication operation to finish')
            page.evaluate("const p=vb6Studio.documents.tools.get('tool:coding-agents'); p.chatgpt.busy=false; p.refresh()")
            panel.get_by_role('button', name='Send selected message…', exact=True).click()
            dialog = page.get_by_role('dialog', name='AI Coding Agent — Start Task', exact=True)
            dialog.get_by_role('button', name='Start Task', exact=True).click()
            page.wait_for_function("vb6Studio.codingAgents.agent.state === 'completed' && vb6Studio.codingAgents.agent.usage.requests === 4")
            check(page.evaluate("vb6Studio.codingAgents.conversations.active.followups.list().length === 0 && vb6Studio.codingAgents.agent.budgetUsed === 100"), filename + ': confirmed same-account queue executes with cumulative usage')
            check(page.evaluate("vb6Studio.documents.tools.get('tool:coding-agents').prompt.value === '/compact' && !vb6Studio.codingAgents.agent.history.some(x => x.role === 'user' && x.content === '/compact')"), filename + ': queued ChatGPT task preserves unsent compact draft')
            panel.get_by_role('tab', name='Connection', exact=True).click()
            page.screenshot(path=str(REPORTS/(filename.replace('.html','') + '-connection.png')))
            # Billing/account cannot drift on an existing task even when provider/model are identical.
            page.evaluate("const p = vb6Studio.documents.tools.get('tool:coding-agents'); p.chatgpt.mode.value='api-key'; p.model.value='model-z'; p.prompt.value='Continue'; p.start();")
            page.wait_for_function("vb6Studio.documents.tools.get('tool:coding-agents').status.textContent.includes('another billing mode')")
            checks.append(filename + ': existing task rejects silent billing switch')
            page.get_by_label('OpenAI authentication', exact=True).select_option('chatgpt')
            page.get_by_role('button', name='Sign out', exact=True).click()
            page.wait_for_function("!vb6Studio.documents.tools.get('tool:coding-agents').chatgpt.busy && !vb6Studio.documents.tools.get('tool:coding-agents').chatgpt.selected?.signedIn")
            check('revoked' in page.get_by_label('ChatGPT connection status', exact=True).inner_text(), filename + ': sign-out reports revocation')
            page.evaluate("const p=vb6Studio.documents.tools.get('tool:coding-agents'); const item=p.api.conversations.active.followups.add('Keep this queued after sign-out.'); p.model.value='model-z'; p.start(false,false,item.id)")
            page.wait_for_function("vb6Studio.documents.tools.get('tool:coding-agents').status.textContent.includes('Sign in with ChatGPT')")
            check(page.evaluate("vb6Studio.codingAgents.agent.usage.requests === 4 && vb6Studio.codingAgents.conversations.active.followups.list().length === 1"), filename + ': signed-out queue cannot fall back to API billing')
            check(not errors, filename + ': no browser exceptions')
            if not args.opaque: check(page.evaluate("!JSON.stringify(localStorage).includes('secret-access') && !JSON.stringify(localStorage).includes('secret-refresh')"), filename + ': OAuth credentials absent from browser storage')
            context.close()
        browser.close()
    (REPORTS/'results.json').write_text(json.dumps({'mockOpenAI': True, 'opaqueBrowserHarness': args.opaque, 'checks': checks, 'count': len(checks)}, indent=2))
    print(json.dumps({'passed': len(checks), 'mockOpenAI': True}))
finally:
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill()
    server.shutdown()

#!/usr/bin/env python3
"""MCP UI + real transport integration. Build first.

Default: real file://, HTTP/HTTPS hosted subpaths and localhost navigations with genuine CORS.
--opaque: UI-only set_content for policy-restricted environments; explicitly does
not claim deployment or browser network validation. CI never uses --opaque.
"""
from __future__ import annotations
import argparse, json, os, subprocess, time, traceback, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/mcp-browser.json'
parser = argparse.ArgumentParser()
parser.add_argument('--opaque', action='store_true')
args = parser.parse_args()
results = []

def check(value, message='Assertion failed'):
    if not value:
        raise AssertionError(message)

def wire(info, method, params=None):
    params = {**(params or {}), '_meta': {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {'name': 'browser-test', 'version': '1'}, 'io.modelcontextprotocol/clientCapabilities': {}}}
    message = {'jsonrpc': '2.0', 'id': 801, 'method': method, 'params': params}
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + info['clientToken'], 'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': method}
    if method == 'tools/call':
        headers['MCP-Name'] = params['name']
    request = urllib.request.Request(info['url'] + '/mcp', data=json.dumps(message).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        text = response.read().decode()
        content_type = response.headers.get_content_type()
    if content_type == 'text/event-stream':
        messages = [json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: ')]
        return next(message for message in messages if message.get('id') == 801)
    return json.loads(text)

def finished(page):
    page.wait_for_function("!vb6Studio.documents.tools.get('tool:mcp').operation")

def tab(page, name):
    page.locator('.mcp-panel').get_by_role('tab', name=name, exact=True).click()

def choose_tool(page, name):
    index = page.evaluate("name => vb6Studio.documents.tools.get('tool:mcp').catalog.findIndex(t=>t.name===name)", name)
    check(index >= 0, 'Tool is missing: ' + name)
    page.get_by_label('MCP catalog', exact=True).select_option(str(index))

def invoke(page, name, params, approve=None):
    choose_tool(page, name)
    page.get_by_label('MCP arguments', exact=True).fill(json.dumps(params))
    page.get_by_role('button', name='Invoke selected', exact=True).click()
    if approve is not None:
        dialog = page.get_by_role('dialog', name='Allow MCP operation?', exact=True)
        dialog.wait_for()
        check(dialog.locator('.default-button').inner_text() == 'Deny', 'Approval must default to denial')
        dialog.get_by_role('button', name='Allow once' if approve else 'Deny', exact=True).click()
    finished(page)
    text = page.get_by_label('MCP result', exact=True).inner_text()
    return json.loads(text) if text.startswith('{') else text

def revision(page):
    return page.evaluate('vb6Studio.mcp.adapter.revision')

def exercise(browser, mode, info):
    # Trust only the fixture's ephemeral self-signed TLS certificate. CORS and
    # browser mixed-content/local-network policies remain enabled.
    context = browser.new_context(viewport={'width': 1500, 'height': 1020}, accept_downloads=True, ignore_https_errors=mode == 'https-hosted-subpath')
    page = context.new_page()
    page.set_default_timeout(12000)
    errors, requests = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
    if mode == 'opaque':
        page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text())
    else:
        page.goto((ROOT / 'dist/VB6-Studio-Web.html').as_uri() if mode == 'file' else info['hosted'] if mode == 'hosted-subpath' else info['httpsHosted'] if mode == 'https-hosted-subpath' else info['url'] + '/')
    page.wait_for_function('!!globalThis.vb6Studio?.mcp')
    check(not page.evaluate('vb6Studio.mcp.adapter.enabled'), 'Sharing must be disabled on load')
    check(page.evaluate('vb6Studio.mcp.clients.size') == 0)
    check(all(url.startswith(info['hosted']) or url.startswith(info['httpsHosted']) or url.startswith(info['url']) for url in requests) if mode != 'opaque' else not requests, 'App boot must not contact outside services')
    if mode == 'file':
        check(not requests, 'The single file must not fetch startup assets')
    page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('McpBrowser'))")
    page.evaluate("vb6Studio.command('mcpConnections')")
    tab(page, 'Expose IDE')
    page.get_by_label('Enable MCP sharing', exact=True).check()
    page.get_by_role('dialog').get_by_role('button', name='Enable sharing', exact=True).click()
    finished(page)
    tab(page, 'Connect')
    page.get_by_role('button', name='Connect to this IDE', exact=True).click()
    finished(page)
    tab(page, 'Browse & invoke')
    page.get_by_role('button', name='Tools', exact=True).click()
    finished(page)
    check(page.locator('[aria-label="MCP catalog"] option').count() == 18)
    detached_checked = False
    if mode != 'opaque':
        # The MCP modeless tool keeps live clients and popup-local approval UI.
        with page.expect_popup() as opened:
            page.locator('.mdi-active').get_by_label('Float document in Browser Window', exact=True).click()
        popup = opened.value
        popup.on('pageerror', lambda error: errors.append(str(error)))
        popup.wait_for_selector('.browser-window-root[data-ready="true"]')
        index = page.evaluate("vb6Studio.documents.tools.get('tool:mcp').catalog.findIndex(t=>t.name==='vb6.module.write')")
        popup.get_by_label('MCP catalog', exact=True).select_option(str(index))
        popup.get_by_label('MCP arguments', exact=True).fill(json.dumps({'module': 'Form1', 'code': 'popup-denied', 'expectedRevision': revision(page)}))
        popup.get_by_role('button', name='Invoke selected', exact=True).click()
        popup.get_by_role('dialog', name='Allow MCP operation?', exact=True).get_by_role('button', name='Deny', exact=True).click()
        finished(page)
        check('declined' in popup.get_by_label('MCP result', exact=True).inner_text())
        popup.close()
        page.wait_for_function('vb6Studio.browserWindows.windows.size===0')
        check(page.evaluate('vb6Studio.mcp.clients.size') == 1)
        detached_checked = True
    original = page.evaluate('vb6Studio.project.modules[0].code')
    project = invoke(page, 'vb6.project.get', {})
    check(project['structuredContent']['name'] == 'McpBrowser')
    denied = invoke(page, 'vb6.module.write', {'module': 'Form1', 'code': "Option Explicit\n' denied", 'expectedRevision': revision(page)}, False)
    check('declined' in str(denied))
    check(page.evaluate('vb6Studio.project.modules[0].code') == original)
    code = 'Option Explicit\nPrivate Sub Form_Load()\n  Dim value As Integer\n  value = 21\nEnd Sub\n'
    saved = invoke(page, 'vb6.module.write', {'module': 'Form1', 'code': code, 'expectedRevision': revision(page)}, True)
    check(not saved.get('isError'), str(saved))
    check(page.evaluate('vb6Studio.project.modules[0].code') == code)
    check(page.evaluate('vb6Studio.history.undoStack.length') > 0)
    page.evaluate("vb6Studio.command('undo')")
    check(page.evaluate('vb6Studio.project.modules[0].code') == original)
    page.evaluate("vb6Studio.command('redo')")
    check(page.evaluate('vb6Studio.project.modules[0].code') == code)
    compiled = invoke(page, 'vb6.project.compile', {})
    check(compiled['structuredContent']['valid'], str(compiled))
    for catalog, minimum in [('Resources', 6), ('Templates', 2), ('Prompts', 2)]:
        page.get_by_role('button', name=catalog, exact=True).click()
        finished(page)
        check(page.locator('[aria-label="MCP catalog"] option').count() >= minimum)
    page.get_by_role('button', name='Tools', exact=True).click()
    finished(page)
    replacement = page.evaluate("VB6StudioAPI.newProject('McpReplacement')")
    replacement['modules'][0]['code'] = code
    replaced = invoke(page, 'vb6.project.replace', {'project': replacement, 'expectedRevision': revision(page)}, True)
    check(not replaced.get('isError') and replaced['structuredContent']['name'] == 'McpReplacement', str(replaced))
    check(page.evaluate("vb6Studio.documents.tools.has('tool:mcp') && vb6Studio.mcp.clients.size===1"), 'Global MCP window/connection lost during project load')
    # Runtime uses the existing sandbox iframe and debugger, not a mock adapter.
    started = invoke(page, 'vb6.runtime.start', {'breakOnEntry': True, 'expectedRevision': revision(page)}, True)
    check(not started.get('isError'), str(started))
    page.wait_for_function("vb6Studio.runState==='paused'", timeout=20000)
    # Running a project may activate another MDI document; bring the MCP window back.
    page.evaluate("vb6Studio.command('mcpConnections')")
    evaluated = invoke(page, 'vb6.debug.evaluate', {'expression': '21 * 2', 'expectedRevision': revision(page)}, True)
    check('42' in json.dumps(evaluated) and not evaluated.get('isError'), str(evaluated))
    stopped = invoke(page, 'vb6.runtime.stop', {'expectedRevision': revision(page)}, True)
    check(stopped['structuredContent']['runState'] == 'design', str(stopped))
    # Cancellation/revocation while the approval dialog is visible must not commit.
    choose_tool(page, 'vb6.module.write')
    page.get_by_label('MCP arguments', exact=True).fill(json.dumps({'module': 'Form1', 'code': 'revoked', 'expectedRevision': revision(page)}))
    page.get_by_role('button', name='Invoke selected', exact=True).click()
    page.get_by_role('dialog', name='Allow MCP operation?', exact=True).wait_for()
    page.evaluate('vb6Studio.mcp.setSharing(false)')
    finished(page)
    check(page.evaluate('vb6Studio.project.modules[0].code') == code)
    check(page.get_by_role('dialog', name='Allow MCP operation?', exact=True).count() == 0, 'Revoked approval still visible')
    page.evaluate('vb6Studio.mcp.setSharing(true)')
    network_checked = False
    if mode != 'opaque':
        # Real browser outbound fetch + preflight, with exact origins (including null).
        for alias, version in [('modern', '2026-07-28'), ('legacy', '2025-11-25')]:
            tab(page, 'Connect')
            page.get_by_label('Connection name', exact=True).fill(alias)
            page.get_by_label('MCP endpoint', exact=True).fill(info['url'] + '/stdio/' + alias)
            page.get_by_label('Bearer token', exact=True).fill(info['ownerToken'])
            page.locator('.mcp-panel').get_by_role('button', name='Connect', exact=True).click()
            finished(page)
            check(page.get_by_label('Bearer token', exact=True).input_value() == '', 'Credential input was not cleared')
            tab(page, 'Browse & invoke')
            check(version in page.get_by_label('Active MCP connection', exact=True).locator('option:checked').inner_text())
            page.get_by_role('button', name='Tools', exact=True).click()
            finished(page)
            text = '<img src=x onerror="globalThis.mcpInjected=true">'
            echoed = invoke(page, 'echo', {'text': text}, True)
            check(echoed['structuredContent']['text'] == text)
            check(page.locator('.mcp-result img').count() == 0 and not page.evaluate('!!globalThis.mcpInjected'))
            page.get_by_role('button', name='Disconnect', exact=True).click()
            finished(page)
        tab(page, 'Expose IDE')
        page.get_by_label('Companion URL', exact=True).fill(info['url'])
        page.get_by_label('Companion owner token', exact=True).fill(info['ownerToken'])
        page.get_by_role('button', name='Attach companion', exact=True).click()
        finished(page)
        check(page.evaluate('vb6Studio.mcp.bridge?.connected'), 'Browser could not attach companion')
        # A synchronous external HTTP client blocks the Python event loop, but Chromium
        # continues polling independently in its own process.
        reply = wire(info, 'tools/call', {'name': 'vb6.project.get', 'arguments': {}})
        check(reply['result']['structuredContent']['name'] == 'McpReplacement', str(reply))
        check(page.get_by_label('Companion owner token', exact=True).input_value() == '')
        page.get_by_role('button', name='Detach companion', exact=True).click()
        finished(page)
        check(not page.evaluate('vb6Studio.mcp.bridge?.connected'))
        network_checked = True
    page.evaluate("vb6Studio.command('mcpConnections')")
    tab(page, 'Connect')
    (ROOT / 'reports/screenshots').mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ROOT / ('reports/screenshots/mcp-' + mode + '.png')))
    check(not errors, 'Browser script errors: ' + str(errors))
    if mode != 'opaque':
        page.reload()
        page.wait_for_function('!!globalThis.vb6Studio?.mcp')
        check(not page.evaluate('vb6Studio.mcp.adapter.enabled') and page.evaluate('vb6Studio.mcp.clients.size') == 0, 'Reload must revoke sharing and credentials')
    context.close()
    return {'tools': 18, 'approval': 'deny/allow/revoke', 'undo': True, 'runtime': 'paused/evaluate/stop', 'network': network_checked, 'detachedWindow': detached_checked, 'reload': mode != 'opaque'}

fixture = None
try:
    info = {}
    if not args.opaque:
        fixture = subprocess.Popen(['node', str(ROOT / 'tools/mcp-browser-fixture.mjs')], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        info = json.loads(fixture.stdout.readline())
    with sync_playwright() as playwright:
        options = {'headless': True, 'args': ['--no-sandbox']}
        if os.environ.get('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = playwright.chromium.launch(**options)
        version = browser.version
        for mode in (['opaque'] if args.opaque else ['file', 'hosted-subpath', 'https-hosted-subpath', 'localhost']):
            started = time.monotonic()
            try:
                details = exercise(browser, mode, info)
                results.append({'mode': mode, 'passed': True, 'details': details})
                print('PASS MCP browser:', mode, flush=True)
            except Exception as error:
                results.append({'mode': mode, 'passed': False, 'error': str(error)})
                print('FAIL MCP browser:', mode, str(error), flush=True)
                traceback.print_exc(limit=3)
            results[-1]['seconds'] = round(time.monotonic() - started, 3)
        browser.close()
finally:
    if fixture:
        fixture.terminate()
        try:
            fixture.wait(timeout=8)
        except subprocess.TimeoutExpired:
            fixture.kill()
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps({'browser': locals().get('version'), 'opaqueUIOnly': args.opaque, 'results': results}, indent=2))
raise SystemExit(0 if results and all(result['passed'] for result in results) else 1)

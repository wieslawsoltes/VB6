#!/usr/bin/env python3
"""MCP server access UI plus real external-agent HTTP, file and hosted navigation tests."""
from __future__ import annotations
import argparse, json, os, subprocess, time, traceback, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util
_spec=importlib.util.spec_from_file_location('mcp_browser_harness',Path(__file__).with_name('mcp-browser-harness.py'))
harness=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(harness)

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/mcp-browser.json'
parser=argparse.ArgumentParser();parser.add_argument('--opaque',action='store_true');args=parser.parse_args();results=[]
def check(value,message='Assertion failed'):
    if not value:raise AssertionError(message)
def finished(page):page.wait_for_function("!vb6Studio.documents.tools.get('tool:mcp').operation")
def tab(page,name):
    page.evaluate("vb6Studio.command('mcpAgentAccess')")
    page.locator('.mcp-panel').get_by_role('tab',name=name,exact=True).click()
def revision(page):return page.evaluate('vb6Studio.mcp.adapter.revision')
def invoke(page,info,name,values,approve=None,window=None):
    pending=harness.begin(page,info,name,values)
    if approve is not None:
        dialog=(window or page).get_by_role('dialog',name='Allow MCP operation?',exact=True)
        dialog.wait_for();check(dialog.locator('.default-button').inner_text()=='Deny')
        dialog.get_by_role('button',name='Allow once' if approve else 'Deny',exact=True).click()
    reply=harness.result(page,pending)
    return reply.get('result',reply)
def exercise(browser,mode,info):
    context=browser.new_context(viewport={'width':1500,'height':1020},accept_downloads=True,ignore_https_errors=mode=='https-hosted-subpath')
    page=context.new_page();page.set_default_timeout(12000);errors=[];network=mode!='opaque';requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
    try:
        if mode=='opaque':page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        else:page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri() if mode=='file' else info['hosted'] if mode=='hosted-subpath' else info['httpsHosted'] if mode=='https-hosted-subpath' else info['url']+'/')
        page.wait_for_function('!!globalThis.vb6Studio?.mcp')
        check(not page.evaluate('vb6Studio.mcp.adapter.enabled'))
        check(page.evaluate("!('clients' in vb6Studio.mcp) && !('connect' in vb6Studio.mcp) && !('McpClient' in VB6StudioAPI.MCP) && !('McpOAuth' in VB6StudioAPI.MCP)"),'Outbound MCP API remains')
        page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('McpBrowser'));vb6Studio.command('mcpAgentAccess')")
        check(page.locator('.mcp-panel').get_by_role('tab').all_text_contents()==['Agent access','Agent permissions','Capabilities','Activity'])
        check(page.get_by_role('button',name='Invoke selected',exact=True).count()==0)
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        harness.install_peer(page)
        if network:
            page.get_by_label('Companion URL',exact=True).fill(info['url'])
            page.get_by_label('Companion owner token',exact=True).fill(info['ownerToken'])
            page.get_by_role('button',name='Attach companion',exact=True).click();finished(page)
            check(page.evaluate('vb6Studio.mcp.bridge?.connected'))
            check(page.get_by_label('Companion owner token',exact=True).input_value()=='')
        peer=info if network else None
        tab(page,'Capabilities')
        check(page.get_by_label('Exposed agent tools').locator('option').count()==106)
        page.get_by_label('Filter exposed agent tools').fill('debug.assign')
        check(page.get_by_label('Exposed agent tools').locator('option').count()==1)
        check('pauseId' in page.get_by_label('Agent tool schema').inner_text())
        # Exported configuration has a placeholder, never either paired credential.
        tab(page,'Agent access')
        with page.expect_download() as download:
            page.get_by_role('button',name='Download agent configuration template',exact=True).click()
        config=Path(download.value.path()).read_text();check('PASTE_CLIENT_TOKEN_FROM_TERMINAL' in config)
        if network:check(info['ownerToken'] not in config and info['clientToken'] not in config)
        detached=False
        if network:
            with page.expect_popup() as opened:page.locator('.mdi-active').get_by_label('Float document in Browser Window',exact=True).click()
            popup=opened.value;popup.on('pageerror',lambda e:errors.append(str(e)));popup.wait_for_selector('.browser-window-root[data-ready="true"]')
            popup.get_by_label('Companion URL',exact=True).click()
            denied=invoke(page,peer,'vb6.module.write',{'module':'Form1','code':'popup denied','expectedRevision':revision(page)},False,popup)
            check('declined' in str(denied));popup.close();page.wait_for_function('vb6Studio.browserWindows.windows.size===0')
            check(page.evaluate('vb6Studio.mcp.bridge?.connected'));detached=True
        original=page.evaluate('vb6Studio.project.modules[0].code')
        project=invoke(page,peer,'vb6.project.get',{});check(project['structuredContent']['name']=='McpBrowser')
        denied=invoke(page,peer,'vb6.module.write',{'module':'Form1','code':'denied','expectedRevision':revision(page)},False)
        check('declined' in str(denied));check(page.evaluate('vb6Studio.project.modules[0].code')==original)
        code='Option Explicit\nPrivate Sub Form_Load()\n  Dim value As Integer\n  value = 21\nEnd Sub\n'
        saved=invoke(page,peer,'vb6.module.write',{'module':'Form1','code':code,'expectedRevision':revision(page)},True)
        check(not saved.get('isError'),str(saved));check(page.evaluate('vb6Studio.project.modules[0].code')==code)
        page.evaluate("vb6Studio.command('undo')");check(page.evaluate('vb6Studio.project.modules[0].code')==original)
        page.evaluate("vb6Studio.command('redo')");check(page.evaluate('vb6Studio.project.modules[0].code')==code)
        check(invoke(page,peer,'vb6.project.compile',{})['structuredContent']['valid'])
        started=invoke(page,peer,'vb6.runtime.start',{'breakOnEntry':True,'expectedRevision':revision(page)},True)
        check(not started.get('isError'),str(started));page.wait_for_function("vb6Studio.runState==='paused'")
        page.evaluate("vb6Studio.command('mcpAgentAccess')")
        evaluated=invoke(page,peer,'vb6.debug.evaluate',{'expression':'21 * 2','expectedRevision':revision(page)},True)
        check('42' in json.dumps(evaluated) and not evaluated.get('isError'),str(evaluated))
        stopped=invoke(page,peer,'vb6.runtime.stop',{'expectedRevision':revision(page)},True)
        check(stopped['structuredContent']['runState']=='design')
        pending=harness.begin(page,peer,'vb6.module.write',{'module':'Form1','code':'revoked','expectedRevision':revision(page)})
        page.get_by_role('dialog',name='Allow MCP operation?',exact=True).wait_for()
        page.evaluate('vb6Studio.mcp.setSharing(false)')
        try:harness.result(page,pending)
        except Exception:pass # A detached network relay may close the HTTP response.
        check(page.evaluate('vb6Studio.project.modules[0].code')==code)
        check(page.get_by_role('dialog',name='Allow MCP operation?',exact=True).count()==0)
        check(not page.evaluate('vb6Studio.mcp.bridge?.connected'))
        # Same-ID replacement cannot approve the wrong project or resurrect grants.
        tab(page,'Agent access')
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog',name='Share this IDE through MCP?',exact=True).wait_for()
        page.evaluate('vb6Studio.loadProject(structuredClone(vb6Studio.project))')
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        check(not page.evaluate('vb6Studio.mcp.adapter.enabled'))
        tab(page,'Agent access')
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        tab(page,'Agent permissions')
        page.get_by_label('Agent scope code',exact=True).check()
        page.get_by_role('button',name='Grant selected permissions',exact=True).click()
        page.get_by_role('dialog',name='Authorize coding agents?',exact=True).wait_for()
        page.evaluate('vb6Studio.loadProject(structuredClone(vb6Studio.project))')
        finished(page)
        check(page.get_by_role('dialog',name='Authorize coding agents?',exact=True).count()==0)
        check(not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        page.evaluate('vb6Studio.mcp.setSharing(false)')
        check(not errors,str(errors))
        page.evaluate("vb6Studio.command('mcpAgentAccess')")
        (ROOT/'reports/screenshots').mkdir(parents=True,exist_ok=True);page.screenshot(path=str(ROOT/('reports/screenshots/mcp-'+mode+'.png')))
        if network:
            page.reload();page.wait_for_function('!!globalThis.vb6Studio?.mcp')
            check(not page.evaluate('vb6Studio.mcp.adapter.enabled || vb6Studio.mcp.bridge'))
        # Only app static assets and explicitly paired loopback relay requests are allowed.
        if network:check(all(url.startswith((info['url'],info['hosted'].rsplit('/VB6/',1)[0],info['httpsHosted'].rsplit('/VB6/',1)[0])) for url in requests),str(requests))
        return {'tools':106,'serverOnly':True,'approval':'deny/allow/revoke','runtime':'paused/evaluate/stop','network':network,'detachedWindow':detached,'reload':network}
    finally:context.close()

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

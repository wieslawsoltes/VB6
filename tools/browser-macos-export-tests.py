#!/usr/bin/env python3
"""Real browser fetch/download tests with a NONEXECUTABLE native protocol fixture.
Actual Apple Silicon compiler/AppKit acceptance lives in test-macos-native.mjs.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports' / 'macos-export'
OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = 'http://127.0.0.1:8080'
TOKEN = 'c' * 64
MEMORY = os.environ.get('VB6_MACOS_TEST_TRANSPORT') == 'memory'
fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', '''
import {macOSArchiveFixture,macOSImageFixture,fixtureProject} from './tests/macos-fixture.mjs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
console.log(JSON.stringify({project:fixtureProject(),zip:Buffer.from(macOSArchiveFixture()).toString('base64'),sha256:hash(macOSArchiveFixture()),executableSha256:hash(macOSImageFixture())}));
'''], cwd=ROOT))
BINARY = base64.b64decode(fixture['zip'])
checks, errors, downloads, pending, requests = [], [], [], [], []
mode = {'value': 'success'}

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as pw:
    kind = os.environ.get('VB6_BROWSER', 'chromium')
    launch = {'headless': True}
    if kind == 'chromium':
        launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
    browser = getattr(pw, kind).launch(**launch)
    page = browser.new_page(accept_downloads=True, viewport={'width':1440, 'height':1050})
    page.set_default_timeout(20000)
    page.on('download', lambda item: downloads.append(item))
    page.on('pageerror', lambda error: errors.append(str(error)))
    headers = {'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST', 'Access-Control-Expose-Headers': 'X-VB6-SHA256, X-VB6-Executable-SHA256, X-VB6-Target',
        'Access-Control-Allow-Private-Network': 'true'}
    def success(route):
        route.fulfill(headers={**headers, 'content-type':'application/zip', 'X-VB6-Target':'macos-arm64',
            'X-VB6-SHA256':fixture['sha256'], 'X-VB6-Executable-SHA256':fixture['executableSha256']}, body=BINARY)
    def compiler(route):
        request = route.request
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers=headers)
            return
        body = json.loads(request.post_data or '{}')
        requests.append(body)
        if request.headers.get('authorization') != 'Bearer ' + TOKEN:
            route.fulfill(status=401, headers={**headers, 'content-type':'application/json'}, body=json.dumps({'error':{'message':'Bad fixture token'}}))
        elif body.get('method') == 'capabilities':
            route.fulfill(headers={**headers, 'content-type':'application/json'}, body=json.dumps({'result':{'version':1, 'target':'macos-arm64', 'arch':'arm64', 'runtime':'AppKit', 'available':True, 'timeout':1000}}))
        elif mode['value'] == 'hold':
            pending.append(route)
        elif mode['value'] == 'failure':
            route.fulfill(status=400, headers={**headers, 'content-type':'application/json'}, body=json.dumps({'error':{'message':'Fixture Apple Clang failure', 'compilerLog':'Test diagnostic: unresolved native member'}}))
        else:
            success(route)
    page.route(ORIGIN + '/**', lambda route: route.fulfill(content_type='text/html', body=(ROOT/'dist/VB6-Studio-Web.html').read_text()))
    page.route('http://127.0.0.1:8769/macos', compiler)
    def dialog():
        page.evaluate('void vb6Studio.command("exportMacOS")')
        page.get_by_role('dialog', name='Make macOS Apple Silicon Application').wait_for()
        page.get_by_text('Advanced: optional Mac compiler bridge',exact=True).click()
    def close_dialog():
        page.get_by_role('button', name='Close', exact=True).click()
        page.get_by_role('dialog', name='Make macOS Apple Silicon Application').wait_for(state='detached')
    def set_mode(value):
        mode['value'] = value
        if MEMORY:
            page.evaluate('value=>__macTestFixture.mode=value', value)
    def release_pending():
        if MEMORY:
            page.evaluate('__macTestFixture.pending.shift()()')
        else:
            success(pending.pop())
    def await_pending():
        for _ in range(200):
            if page.evaluate('__macTestFixture.pending.length') if MEMORY else pending:
                return
            page.wait_for_timeout(10)
        raise AssertionError('Native request did not reach held response')
    try:
        if MEMORY:
            # No browser policy is changed. This run substitutes in-memory transport
            # and a labelled SHA adapter; CI still requires actual HTTP/WebCrypto.
            page.expose_function('__macTestDigest', lambda data: list(hashlib.sha256(bytes(data)).digest()))
            page.evaluate('''data => {
              globalThis.__macTestFixture={mode:'success',pending:[],requests:[]};
              const fixture=globalThis.__macTestFixture, nativeFetch=globalThis.fetch;
              if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(_algorithm,bytes)=>new Uint8Array(await __macTestDigest(Array.from(new Uint8Array(bytes.buffer||bytes,bytes.byteOffset||0,bytes.byteLength)))).buffer}});
              globalThis.fetch=async(url,options)=>{
                if(String(url)!=='http://127.0.0.1:8769/macos')return nativeFetch(url,options);
                options.signal?.throwIfAborted();const body=JSON.parse(options.body);fixture.requests.push(body);
                const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
                if(options.headers.Authorization!=='Bearer '+data.token)return json({error:{message:'Bad fixture token'}},401);
                if(body.method==='capabilities')return json({result:{version:1,target:'macos-arm64',arch:'arm64',runtime:'AppKit',available:true,timeout:1000}});
                if(fixture.mode==='failure')return json({error:{message:'Fixture Apple Clang failure',compilerLog:'Test diagnostic: unresolved native member'}},400);
                const success=()=>new Response(Uint8Array.from(atob(data.zip),c=>c.charCodeAt(0)),{headers:{'content-type':'application/zip','x-vb6-target':'macos-arm64','x-vb6-sha256':data.sha256,'x-vb6-executable-sha256':data.executableSha256}});
                if(fixture.mode==='hold')return new Promise((resolve,reject)=>{fixture.pending.push(()=>resolve(success()));options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
                return success();
              };
            }''', {**fixture,'token':TOKEN})
            page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(), wait_until='domcontentloaded', timeout=60000)
        else:
            page.goto(ORIGIN + '/', wait_until='commit', timeout=60000)
        # The installed export API is the startup oracle; feature actions keep 20 seconds.
        page.wait_for_function('!!globalThis.vb6Studio?.macOSExportInstalled', timeout=60000)
        page.evaluate('p=>vb6Studio.loadProject(VB6StudioAPI.normalizeProject(p))', fixture['project'])
        before = page.evaluate('JSON.stringify(vb6Studio.project)')
        check('Win32, Microsoft runtime, VB.NET and macOS exports remain independent', page.evaluate('''['exportWin32','exportClassic','exportVbNet','exportMacOS'].every(id=>vb6Studio.menu('File').some(i=>i?.id===id&&i.enabled))'''))
        dialog()
        # Independent source exports carry ZIP creation timestamps. Keep timers
        # running, but deliberately give the two builds different wall-clock times.
        page.clock.set_fixed_time('2001-01-01T12:00:00Z')
        with page.expect_download() as item:
            page.get_by_role('button', name='Download Source Build Kit', exact=True).click()
        source = OUT/'source-kit.zip'
        item.value.save_as(source)
        with zipfile.ZipFile(source) as z:
            manifest = json.loads(z.read('build.json'))
            check('source ZIP contains native compiler output, AppKit SDK and untouched project', z.testzip() is None and z.read('project.vb6web').decode()==before and 'native/appkit-host.mm' in z.namelist() and 'main.cpp' in z.namelist())
            check('source ZIP is labelled as a build kit, never as an executable', manifest['report']['artifact']=='native-source-build-kit' and b'not an executable' in z.read('README.md'))
            driver = OUT/'extracted-build.mjs'
            driver.write_bytes(z.read('build.mjs'))
            check('exported source driver parses independently', subprocess.run(['node','--check',str(driver)],capture_output=True).returncode==0)
        check('source export does not contact a compiler or mutate project', not requests and (not MEMORY or page.evaluate('__macTestFixture.requests.length')==0) and page.evaluate('JSON.stringify(vb6Studio.project)')==before)
        check('download link stays visible inside the active dialog', page.get_by_role('link', name='Save ZIP: NativeFixture-macos-source.zip').is_visible())
        first_url = page.get_by_role('link', name='Save ZIP: NativeFixture-macos-source.zip').get_attribute('href')
        page.evaluate('''() => {const click=HTMLAnchorElement.prototype.click;window.restoreMacClick=()=>HTMLAnchorElement.prototype.click=click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('-macos-source.zip')){window.suppressedMacDownload=this.href;return;}return click.call(this);};}''')
        page.clock.set_fixed_time('2001-01-01T12:01:00Z')
        page.get_by_role('button', name='Download Source Build Kit', exact=True).click()
        suppressed_url = page.evaluate('window.suppressedMacDownload')
        check('suppressed automatic download retains its own manual-save URL', bool(suppressed_url) and suppressed_url != first_url and suppressed_url == page.get_by_role('link', name='Save ZIP: NativeFixture-macos-source.zip').get_attribute('href'))
        # The retry oracle is the Blob offered by THIS build, not the earlier ZIP.
        # Snapshot it before the manual click, then compare every downloaded byte.
        expected_retry = bytes(page.evaluate('''async () => Array.from(new Uint8Array(await (await fetch(window.suppressedMacDownload)).arrayBuffer()))'''))
        with page.expect_download() as retry:
            page.get_by_role('link', name='Save ZIP: NativeFixture-macos-source.zip').click()
        retried = OUT/'source-kit-retry.zip'
        retry.value.save_as(retried)
        check('manual save retries the exact source archive after a suppressed automatic click', expected_retry==retried.read_bytes())
        with zipfile.ZipFile(source) as first, zipfile.ZipFile(retried) as second:
            check('distinct source-build timestamps do not change any exported file payload', first.infolist()[0].date_time != second.infolist()[0].date_time and first.namelist()==second.namelist() and all(first.read(name)==second.read(name) for name in first.namelist()))
        page.evaluate('void restoreMacClick()')
        page.get_by_label('macOS application name', exact=True).focus()
        page.keyboard.press('Shift+Tab')
        check('native download link participates in the modal focus trap', page.evaluate('document.activeElement.matches("[data-macos-download] a[download]")'))
        page.screenshot(path=str(OUT/'macos-export-dialog.png'))
        close_dialog()
        dialog()
        page.get_by_label('macOS compiler bridge token', exact=True).fill(TOKEN)
        with page.expect_download() as item:
            page.get_by_role('button', name='Build via Mac Bridge', exact=True).click()
        output = OUT/'NONEXECUTABLE-protocol-fixture.app.zip'
        item.value.save_as(output)
        check('native download preserves exact archive bytes and executable mode metadata', item.value.suggested_filename=='NativeFixture.app.zip' and output.read_bytes()==BINARY)
        check('native report records both digests without claiming browser signature verification', page.evaluate('vb6Studio.lastMacOSBuild.executableSha256')==fixture['executableSha256'] and page.evaluate('vb6Studio.lastMacOSBuild.browserSignatureCryptographicallyVerified') is False)
        check('native result does not persist token or change project', TOKEN not in page.evaluate('JSON.stringify(vb6Studio.project)+JSON.stringify(vb6Studio.lastMacOSBuild)') and page.get_by_label('macOS compiler bridge token',exact=True).input_value()=='' and page.evaluate('JSON.stringify(vb6Studio.project)')==before)
        close_dialog()
        set_mode('failure')
        dialog()
        page.get_by_label('macOS compiler bridge token',exact=True).fill(TOKEN)
        count = len(downloads)
        page.get_by_role('button',name='Build via Mac Bridge',exact=True).click()
        page.get_by_role('dialog').get_by_role('status').filter(has_text='unresolved native member').wait_for()
        check('native compiler failure displays diagnostic text and downloads nothing',len(downloads)==count)
        close_dialog()
        set_mode('hold')
        dialog()
        page.get_by_label('macOS compiler bridge token',exact=True).fill(TOKEN)
        page.get_by_role('button',name='Build via Mac Bridge',exact=True).click()
        await_pending()
        check('token is cleared before native compilation completes',page.get_by_label('macOS compiler bridge token',exact=True).input_value()=='')
        close_dialog()
        try:
            release_pending()
        except Exception:
            pass  # A cancelled fetch may already have destroyed the route.
        page.wait_for_timeout(100)
        check('Close works during a build and prevents late downloads',len(downloads)==count)
        dialog()
        check('reopening the dialog never restores a token',page.get_by_label('macOS compiler bridge token',exact=True).input_value()=='')
        page.get_by_label('macOS compiler bridge token',exact=True).fill(TOKEN)
        page.get_by_role('button',name='Build via Mac Bridge',exact=True).click()
        await_pending()
        page.evaluate('vb6Studio.project.description="changed during native build"')
        release_pending()
        page.get_by_role('dialog').get_by_role('status').filter(has_text='Project changed during export').wait_for()
        check('stale native result is not downloaded after project mutation',len(downloads)==count)
        close_dialog()
        page.evaluate('vb6Studio.runState="running"')
        check('native export command is disabled while executing',page.evaluate('!vb6Studio.menu("File").find(i=>i?.id==="exportMacOS").enabled'))
        page.evaluate('void vb6Studio.command("exportMacOS")')
        check('programmatic native export command also enforces design mode',page.get_by_role('dialog',name='Make macOS Apple Silicon Application').count()==0)
        page.evaluate('vb6Studio.runState="design"')
        if not MEMORY:
            local = browser.new_page(accept_downloads=True,viewport={'width':1440,'height':1050})
            # WebKit's load event can remain pending after the standalone API is usable.
            # Bound document startup separately from the unchanged export interactions.
            local.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri(), wait_until='commit', timeout=60000)
            local.wait_for_function('!!globalThis.vb6Studio?.macOSExportInstalled', timeout=60000)
            local.evaluate('p=>vb6Studio.loadProject(VB6StudioAPI.normalizeProject(p))',fixture['project'])
            local.evaluate('void vb6Studio.command("exportMacOS")')
            with local.expect_download() as item:
                local.get_by_role('button',name='Download Source Build Kit',exact=True).click()
            check('standalone file-origin IDE exports source without a web server',item.value.suggested_filename=='NativeFixture-macos-source.zip')
            local.close()
        check('standalone IDE reports no JavaScript errors',not errors)
    finally:
        (OUT/('browser-'+kind+'.json')).write_text(json.dumps({'browser':kind,'checks':checks,'errors':errors,'transport':'labelled in-memory fetch/SHA adapter' if MEMORY else 'HTTP origin and browser WebCrypto','fileOriginTested':not MEMORY,'nativeExecution':'Synthetic protocol fixture only; actual macOS execution is tested separately'},indent=2))
        browser.close()

#!/usr/bin/env python3
"""Exercise exact IDE deployment downloads, all split samples and startup lifecycle.
VB6_OFFLINE=1 is a supplemental local mode, never a substitute for CI origins/CSP.
"""
import hashlib, json, os, re, shutil, subprocess, threading, zipfile
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
from exporter_browser_wait import wait_for_export
ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/exporter'
BROWSER = os.environ.get('VB6_BROWSER', 'chromium')
INLINE = os.environ.get('VB6_OFFLINE') == '1'
if INLINE and os.environ.get('GITHUB_ACTIONS'):
    raise RuntimeError('Supplemental inline tests cannot replace actual CI deployment origins')
subprocess.run(['node', 'tools/build-exporter-fixtures.mjs'], cwd=ROOT, check=True)
catalog = json.loads((REPORT / 'catalog.json').read_text())
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def end_headers(self):
        if self.path.startswith('/csp/'):
            # No unsafe-inline script, no eval, no modules or JSON fetch required.
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'")
        super().end_headers()
    def translate_path(self, value):
        if value.startswith('/csp/'):
            value = '/reports/exporter/' + value[5:]
        return super().translate_path(value)
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
results = []
def check(value, message):
    if not value: raise AssertionError(message)
def load(page, file, origin):
    if not INLINE:
        page.goto(base + '/' + str(file.relative_to(ROOT)) if origin == 'http' else file.as_uri())
        return
    text = file.read_text()
    # This does not certify deployment loading/CSP. Execute the exact external
    # file bytes via DOM script nodes, with no raw-text rewriting of JavaScript.
    scripts = re.findall(r'<script defer src="\./([^\"]+)"></script>', text)
    text = re.sub(r'<script defer src="\./[^\"]+"></script>', '', text)
    if scripts:
        text = text.replace('<link rel="stylesheet" href="./app.css">', '<style>' + (file.parent / 'app.css').read_text() + '</style>')
    page.set_content(text)
    for name in scripts: page.add_script_tag(content=(file.parent / name).read_text())
def ready(page):
    wait_for_export(page, 'globalThis.vb6ApplicationStatus?.phase === "ready"')
    check(page.evaluate('vb6Application.vm.state !== "error"'), 'Failed VM reported ready')
    check(page.locator('#vb6-startup').is_hidden(), 'Loading banner remained after success')
def run_case(browser, name, file, origin, verify=None, failure=False, prepare=None):
    print('Testing ' + name, flush=True)
    context = browser.new_context(viewport={'width': 1100, 'height': 850})
    page = context.new_page(); page.set_default_timeout(25000)
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        if prepare: prepare(page)
        load(page, file, origin)
        if failure:
            wait_for_export(page, 'globalThis.vb6ApplicationStatus?.phase === "error"')
            check(page.locator('#vb6-startup').get_attribute('role') == 'alert', 'Startup failure has no alert')
            check(page.evaluate('vb6ApplicationReady.then(() => false, () => true)'), 'Public ready promise swallowed rejection')
            if 'adapter-error' in name:
                check('<tag>' in page.locator('#vb6-startup').text_content() and page.locator('#vb6-startup tag').count() == 0, 'Failure message was interpreted as HTML')
        else: ready(page)
        if verify: verify(page)
        check(not errors, str(errors))
        results.append({'case': name, 'passed': True})
    finally: context.close()

def desktop_files(page):
    # Save through the authored Northwind event, then use the desktop after the
    # last form has actually unloaded. Compare downloaded bytes, not just names.
    page.locator('[data-control="cmdSave"]').click()
    page.get_by_role('button', name='OK', exact=True).click()
    expected = bytes(page.evaluate('Array.from(vb6Application.fs.readBytes("/Orders/Order-1001.txt"))'))
    check(b'TOTAL: $107.00' in expected, 'Northwind did not save its full order')
    binary = bytes([0, 255, 128, 13, 10, 0, 42])
    page.evaluate('''bytes=>{
      const fs=vb6Application.fs;
      fs.makeDirectory('/Exports');fs.makeDirectory('/Exports/Empty');
      fs.writeBytes('/Exports/check.bin',bytes);
      fs.writeBytes('/Exports/retired.bin',[1]);
      vb6Application.settings.desktopTest=42;
      globalThis.closedHost=vb6Application;globalThis.relaunchEvents=0;
      addEventListener('vb6:ready',()=>{relaunchEvents++;});
    }''', list(binary[:-1]))
    page.locator('[data-control="cmdClose"]').click()
    wait_for_export(page, '!document.querySelector("[data-desktop-action=launch]").disabled')
    check(page.evaluate('[...vb6Application.vm.formInstances].every(instance=>!instance.loaded)'),
          'Desktop offered relaunch while a form was still loaded')
    page.locator('[data-desktop-action="files"]').click()
    page.get_by_role('button', name='Orders', exact=True).click()
    with page.expect_download() as pending:
        page.get_by_role('button', name='Download Order-1001.txt', exact=True).click()
    check(pending.value.failure() is None and Path(pending.value.path()).read_bytes() == expected,
          'Order download changed its ANSI bytes')
    page.get_by_role('button', name='Up', exact=True).click()
    page.get_by_role('button', name='Exports', exact=True).click()
    target = page.get_by_role('button', name='Download check.bin', exact=True)
    target.focus()
    page.evaluate('globalThis.desktopDownloadTarget=document.activeElement')
    target.hover()
    with page.expect_download() as pending:
        page.mouse.down()
        try:
            retained = page.evaluate('''async bytes=>{
              const fs=vb6Application.fs;
              fs.remove('/Exports/check.bin');fs.writeBytes('/Exports/check.bin',bytes);
              fs.remove('/Exports/retired.bin');fs.writeBytes('/Exports/aaa-added.txt',[65]);
              vb6Application.stage.style.paddingLeft='1px';
              // Let the mutation observer enqueue and complete its own refresh.
              await new Promise(resolve=>setTimeout(resolve,0));
              await new Promise(resolve=>setTimeout(resolve,0));
              return desktopDownloadTarget.isConnected&&document.activeElement===desktopDownloadTarget;
            }''', list(binary))
            check(retained, 'Application repaint replaced or unfocused the active disk download button')
        finally:
            page.mouse.up()
    check(Path(pending.value.path()).read_bytes() == binary, 'Binary file download changed bytes')
    wait_for_export(page, '!document.querySelector(\'[data-disk-path="/Exports/retired.bin"]\')&&!!document.querySelector(\'[data-disk-path="/Exports/aaa-added.txt"]\')')
    check(page.evaluate('desktopDownloadTarget.isConnected&&document.activeElement===desktopDownloadTarget'),
          'Completed disk refresh discarded the existing download control or its keyboard focus')
    check(page.locator('[data-disk-path="/Exports/retired.bin"]').count() == 0, 'Removed file remained in the disk listing')
    check(page.locator('[data-disk-path="/Exports/aaa-added.txt"]').count() == 1, 'New file was missing from the disk listing')
    check(page.locator('[data-disk-path="/Exports/check.bin"] td').nth(1).inner_text() == str(len(binary)) + ' bytes',
          'Replaced file retained its previous byte count')
    with page.expect_download() as pending:
        page.get_by_role('button', name='Download all (.zip)', exact=True).click()
    with zipfile.ZipFile(pending.value.path()) as archive:
        check(archive.read('Orders/Order-1001.txt') == expected, 'ZIP changed the saved order')
        check(archive.read('Exports/check.bin') == binary, 'ZIP changed binary bytes')
        check(archive.read('Exports/aaa-added.txt') == b'A', 'ZIP missed a file created during a disk refresh')
        check('Exports/retired.bin' not in archive.namelist(), 'ZIP retained a removed file')
        check('Exports/Empty/' in archive.namelist(), 'ZIP lost the empty directory')
    page.screenshot(path=str(REPORT / 'application-private-disk.png'), animations='disabled')
    page.locator('[data-desktop-action="close-files"]').click()
    page.evaluate('''()=>{
      const mount=VB6Runtime.mountApplication;let failNext=true;
      VB6Runtime.mountApplication=(...args)=>{
        if(failNext){failNext=false;return Promise.reject(new Error('Temporary restart failure'));}
        return mount(...args);
      };
    }''')
    page.locator('[data-desktop-action="launch"]').click()
    wait_for_export(page, 'vb6ApplicationStatus.phase==="error"')
    check(page.evaluate('vb6Application===closedHost&&closedHost.disposed'),
          'Failed relaunch lost access to the last closed host')
    page.locator('[data-desktop-action="launch"]').click()
    wait_for_export(page, 'vb6Application!==closedHost&&vb6ApplicationStatus.phase==="ready"')
    ready(page)
    check(page.evaluate('closedHost.disposed&&vb6Application.settings.desktopTest===42'),
          'Relaunch did not dispose the previous host or preserve settings')
    check(bytes(page.evaluate('Array.from(vb6Application.fs.readBytes("/Orders/Order-1001.txt"))')) == expected,
          'Relaunch lost the saved order')
    check(bytes(page.evaluate('Array.from(vb6Application.fs.readBytes("/Exports/check.bin"))')) == binary,
          'Relaunch lost binary files')
    check(page.evaluate('vb6Application.fs.directories.has("/Exports/Empty")'), 'Relaunch lost empty folders')
    check(page.locator('[data-desktop-action="launch"]').is_disabled(), 'Running app can be launched twice')
    check(page.evaluate('async()=>{const host=vb6Application;return await vb6RestartApplication()===host&&relaunchEvents===1;}'),
          'A second launch duplicated the running application')

def deny_storage(page):
    page.add_init_script('''Object.defineProperty(window,'localStorage',{
      configurable:true,get(){throw new DOMException('Storage denied by test policy','SecurityError');}
    });''')

try:
    with sync_playwright() as p:
        launch = {'headless': True}
        if BROWSER == 'chromium':
            launch['args'] = ['--no-sandbox']
            if os.environ.get('CHROMIUM_PATH'): launch['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = getattr(p, BROWSER).launch(**launch)
        origins = ['inline'] if INLINE else ['http', 'file']
        for origin in origins:
            for sample in catalog:
                run_case(browser, origin + '-split-' + sample, REPORT / sample / 'index.html', origin)
            run_case(browser, origin + '-desktop-files-and-relaunch', REPORT / 'orders/index.html', origin, desktop_files)
            run_case(browser, origin + '-desktop-denied-storage', REPORT / 'desktop-persist/index.html', origin,
                     desktop_files, prepare=deny_storage)
            run_case(browser, origin + '-gallery', REPORT / 'gallery/index.html', origin,
                     lambda page: check(page.evaluate('vb6Application.forms[0].controls.length >= 40'), 'Control gallery missing controls'))
            def adapter(page):
                check(page.evaluate('adapterRuntimePresent && readyEvents === 1 && adapterMessages.includes("ready")'), 'Adapter or lifecycle event missing')
                check(page.evaluate('vb6Application.options.dataCredential().then(v => v === "fixture-session-only")'), 'Runtime callback lost')
                check(page.evaluate('Array.from(vb6Application.fs.readBytes("/binary.dat")).join()') == '0,255,128', 'Binary VFS was changed')
                check(page.evaluate('vb6Application.settings.initial') == 'authored', 'Application settings lost')
            run_case(browser, origin + '-adapter', REPORT / 'adapter/index.html', origin, adapter)
            run_case(browser, origin + '-inline-html', REPORT / 'adapter.html', origin, adapter)
            for failed in ['missing-runtime', 'adapter-error', 'vb-error']:
                run_case(browser, origin + '-' + failed, REPORT / failed / 'index.html', origin, failure=True)
        # Actual File-menu command and exact downloaded ZIP, not an API mock.
        context = browser.new_context(accept_downloads=True)
        page = context.new_page(); page.set_default_timeout(25000)
        load(page, ROOT / 'dist/VB6-Studio-Web.html' if INLINE else ROOT / 'dist/index.html', 'http')
        wait_for_export(page, 'Boolean(globalThis.vb6Studio?.applicationExportInstalled)')
        source = json.loads((ROOT / 'examples/calculator.vb6web').read_text())
        page.evaluate('project => vb6Studio.loadProject(project)', source)
        expected = page.evaluate('vb6Studio.project')
        page.locator('[data-menu="File"]').click()
        with page.expect_download() as event:
            page.get_by_role('menuitem', name='Make Deployment Archive (.zip)…', exact=True).click()
        download = event.value; check(download.failure() is None, 'ZIP download failed')
        archive = REPORT / 'download.zip'; download.save_as(archive)
        destination = REPORT / 'download'; destination.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            check(set(z.namelist()) == {'index.html', 'app.css', 'runtime.js', 'bootstrap.js', 'manifest.json'}, 'Unexpected deployment archive entries')
            z.extractall(destination)
        manifest = json.loads((destination / 'manifest.json').read_text())
        for entry in manifest['files']:
            check((destination / entry['path']).stat().st_size == entry['bytes'], 'Manifest byte count differs from downloaded bytes')
        for origin in origins:
            run_case(browser, origin + '-actual-IDE-download', destination / 'index.html', origin,
                     lambda app: check(json.loads(app.locator('#vb6-project').text_content()) == expected, 'IDE ZIP changed source project'))
        results.append({'case': 'download-integrity', 'passed': True, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
        context.close()
        if not INLINE:
            # Real origin reload tests, not a synthetic localStorage shim.
            context = browser.new_context(); page = context.new_page(); page.set_default_timeout(25000)
            for fixture, expected_value in [('adapter', 'persisted'), ('no-persist', 'authored')]:
                page.goto(base + '/reports/exporter/' + fixture + '/index.html'); ready(page)
                stored_before = page.evaluate('localStorage.getItem("vb6-app:" + vb6Application.project.id)')
                page.evaluate('()=>{vb6Application.settings.initial="persisted";vb6Application.fs.write("/saved.txt","saved");vb6Application.persist();}')
                if fixture == 'no-persist':
                    check(page.evaluate('localStorage.getItem("vb6-app:" + vb6Application.project.id)') == stored_before, 'Disabled persistence wrote storage')
                page.reload(); ready(page)
                check(page.evaluate('vb6Application.settings.initial') == expected_value, 'Persistence option was not honored')
                page.evaluate('localStorage.clear()')
                results.append({'case': 'http-reload-' + fixture, 'passed': True})
            violations = []; page.on('console', lambda m: violations.append(m.text) if 'Content Security Policy' in m.text else None)
            page.goto(base + '/csp/adapter/index.html'); ready(page)
            check(not violations, str(violations))
            results.append({'case': 'external-script-CSP', 'passed': True})
            page.goto(base + '/csp/orders/index.html'); ready(page)
            desktop_files(page)
            check(not violations, str(violations))
            results.append({'case': 'desktop-files-and-relaunch-CSP', 'passed': True})
            context.close()
        browser.close()
except Exception as error:
    results.append({'case': 'execution', 'passed': False, 'error': str(error)})
    raise
finally:
    server.shutdown()
    if os.environ.get('GITHUB_ACTIONS'):
        for item in REPORT.iterdir():
            if item.is_dir(): shutil.rmtree(item)
            elif item.suffix in ['.html', '.zip']: item.unlink()
    (REPORT / 'results.json').write_text(json.dumps({'browser': BROWSER, 'inline': INLINE, 'realOriginsAndCSPVerified': not INLINE and not any(not r['passed'] for r in results), 'results': results}, indent=2) + '\n')
print(json.dumps({'browser': BROWSER, 'inline': INLINE, 'passed': len(results)}))

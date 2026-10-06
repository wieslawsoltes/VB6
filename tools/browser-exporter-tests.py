#!/usr/bin/env python3
"""Exercise exact IDE deployment downloads, all split samples and startup lifecycle.
VB6_OFFLINE=1 is a supplemental local mode, never a substitute for CI origins/CSP.
"""
import hashlib, json, os, re, shutil, subprocess, threading, zipfile
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
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
    page.wait_for_function('globalThis.vb6ApplicationStatus?.phase === "ready"')
    check(page.evaluate('vb6Application.vm.state !== "error"'), 'Failed VM reported ready')
    check(page.locator('#vb6-startup').is_hidden(), 'Loading banner remained after success')
def run_case(browser, name, file, origin, verify=None, failure=False):
    print('Testing ' + name, flush=True)
    context = browser.new_context(viewport={'width': 1100, 'height': 850})
    page = context.new_page(); page.set_default_timeout(25000)
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        load(page, file, origin)
        if failure:
            page.wait_for_function('globalThis.vb6ApplicationStatus?.phase === "error"')
            check(page.locator('#vb6-startup').get_attribute('role') == 'alert', 'Startup failure has no alert')
            check(page.evaluate('vb6ApplicationReady.then(() => false, () => true)'), 'Public ready promise swallowed rejection')
            if 'adapter-error' in name:
                check('<tag>' in page.locator('#vb6-startup').text_content() and page.locator('#vb6-startup tag').count() == 0, 'Failure message was interpreted as HTML')
        else: ready(page)
        if verify: verify(page)
        check(not errors, str(errors))
        results.append({'case': name, 'passed': True})
    finally: context.close()
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
        page.wait_for_function('Boolean(globalThis.vb6Studio?.applicationExportInstalled)')
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

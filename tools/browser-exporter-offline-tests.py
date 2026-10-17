#!/usr/bin/env python3
"""Real-origin service worker installation, offline input, updates and exact IDE ZIPs.
No request routing, inline page substitute, browser-policy overrides or retries.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote
import zipfile
from playwright.sync_api import sync_playwright, Error as PlaywrightError
from exporter_browser_wait import wait_for_export
from exporter_offline_server import offline_fixture_handler, OfflineFixtureOrigin

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/exporter-offline'
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
if os.environ.get('VB6_OFFLINE') == '1':
    raise RuntimeError('Offline deployment acceptance requires real HTTP origins and service workers')
# A test run owns this dedicated output directory; never reuse an earlier ZIP.
shutil.rmtree(REPORT, ignore_errors=True)
subprocess.run(['node', 'tools/build-offline-export-fixtures.mjs'], cwd=ROOT, check=True)
metadata = json.loads((REPORT / 'fixture-builds.json').read_text())
state = {
    'a': 'one', 'b': 'one', 'broken': 'one', 'failed': 'failed',
    'corrupt': True, 'api_available': True, 'api_requests': 0,
    'worker_requests': 0
}
results, errors = [], []

Handler = offline_fixture_handler(ROOT, REPORT, state)

origin = OfflineFixtureOrigin(Handler, ROOT)
base = origin.url
outages = []
def check(value, message):
    if not value:
        raise AssertionError(message)
def passed(name, **evidence):
    results.append({'case': name, 'passed': True, **evidence})
    print('PASS ' + name, flush=True)
def cache_key(app, release):
    scope = base + '/apps/' + app + '/'
    return 'vb6-export:' + quote(scope, safe="-_.!~*'()") + ':' + metadata[release]['cacheVersion']
def new_page(context):
    page = context.new_page(); page.set_default_timeout(25000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("globalThis.policyViolations=[];addEventListener('securitypolicyviolation',e=>policyViolations.push(e.violatedDirective));")
    return page
def ready(page, phase='ready'):
    wait_for_export(page, '(phase)=>globalThis.vb6ApplicationStatus?.phase===phase', arg=phase)
    if phase == 'ready':
        check(page.evaluate('vb6Application.vm.state !== "error"'), 'VM failed despite ready status')
        check(page.locator('#vb6-startup').is_hidden(), 'Startup banner did not hide')
def installed(page):
    wait_for_export(page, 'globalThis.vb6OfflineStatus?.phase === "ready"')
    wait_for_export(page, 'navigator.serviceWorker.getRegistration().then(r=>r?.active?.state === "activated")')
    check(not page.evaluate('policyViolations'), 'Generated export violated external-script CSP')
def binary(page):
    return page.evaluate('fetch("./assets/raw.bin").then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))')
def calculator(page):
    page.get_by_role('button', name='Clear', exact=True).click()
    page.get_by_role('button', name='7', exact=True).click()
    page.get_by_role('button', name='+', exact=True).click()
    page.get_by_role('button', name='8', exact=True).click()
    page.get_by_role('button', name='=', exact=True).click()
    wait_for_export(page, 'document.querySelector("[data-control=txtDisplay] input")?.value === "15"')

def online(context):
    origin.start()
    context.set_offline(False)

def open_offline_page(context, previous, url):
    # Playwright WebKit currently rejects SW-served requests before dispatching
    # the fetch event when its offline flag is set (even literal responses):
    # https://github.com/microsoft/playwright/issues/42775
    # Close the REAL origin in every engine. Chromium/Firefox additionally use
    # offline emulation; WebKit qualifies server-unavailability, not that flag.
    origin.stop()
    context.set_offline(ENGINE != 'webkit')
    check(origin.server is None, 'Origin is still listening')
    # A clean client with no installed worker must fail against the same stopped
    # origin. This rejects accidental online/cache/fixture-response substitution.
    negative_context = context.browser.new_context()
    negative = negative_context.new_page()
    try:
        try:
            negative.goto(base + '/uncached-outage-probe', wait_until='domcontentloaded', timeout=5000)
        except PlaywrightError:
            pass
        else:
            raise AssertionError('Worker-free navigation unexpectedly succeeded with origin stopped')
    finally:
        negative_context.close()
    page = new_page(context)
    response = page.goto(url, wait_until='domcontentloaded')
    check(response is not None and response.status == 200 and response.from_service_worker,
          'Offline navigation was not fulfilled by the installed service worker')
    ready(page)
    check(page.evaluate('Boolean(navigator.serviceWorker.controller)'), 'Offline client is not controlled')
    outages.append({'url': url, 'originStopped': True, 'workerFreeNavigationFailed': True,
                    'fromServiceWorker': True, 'browserOfflineEmulation': ENGINE != 'webkit'})
    previous.close()
    return page

def assert_network_only_api(page):
    # Browser offline emulation is not specified to cut off fetches initiated by
    # a service worker in every engine. First prove no API response exists in any
    # cache while genuinely offline. Then restore transport, make the origin
    # return 503, and require both that status and a new server request. A cached
    # API response would return 200 without reaching the deliberately failed host.
    check(not page.evaluate('caches.match(new URL("./api/data", location.href)).then(Boolean)'),
          'Dynamic API unexpectedly exists in CacheStorage')
    context = page.context
    online(context)
    before = state['api_requests']
    state['api_available'] = False
    try:
        status = page.evaluate('fetch("./api/data").then(r=>r.status,()=>0)')
        check(status == 503, 'Dynamic API did not remain network-only during an origin outage')
        check(state['api_requests'] == before + 1, 'Dynamic API did not reach the failed origin')
    finally:
        state['api_available'] = True

try:
    with sync_playwright() as p:
        launch = {'headless': True}
        if ENGINE == 'chromium':
            launch['args'] = ['--no-sandbox']
            if os.environ.get('CHROMIUM_PATH'):
                launch['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = getattr(p, ENGINE).launch(**launch)
        context = browser.new_context(viewport={'width': 1100, 'height': 850}, accept_downloads=True)
        a = new_page(context); a.goto(base + '/apps/a/index.html'); ready(a); installed(a)
        check(a.evaluate('releaseMarker') == 'one', 'Wrong first release')
        check(cache_key('a', 'one') in a.evaluate('caches.keys()'), 'Missing scope-owned verified cache')
        check(a.evaluate('navigator.serviceWorker.controller === null'), 'First install force-claimed an existing client')
        passed('complete-install-under-subpath-with-external-script-CSP')
        a.reload(); ready(a)
        check(a.evaluate('Boolean(navigator.serviceWorker.controller)'), 'Reload is not controlled')
        check(binary(a) == [0,255,128], 'Cached binary bytes changed')
        check(a.evaluate('fetch("./api/data").then(r=>r.json()).then(v=>v.networkOnly)'), 'Network fixture did not run')
        passed('controlled-reload-and-binary-assets')
        a = open_offline_page(context, a, base + '/apps/a/index.html')
        calculator(a)
        check(binary(a) == [0,255,128], 'Binary asset unavailable offline')
        assert_network_only_api(a)
        passed('real-network-offline-open-and-VB-control-input', originStopped=True, browserOfflineEmulation=ENGINE != 'webkit')
        a = open_offline_page(context, a, base + '/apps/a/?launch=fixture')
        check(a.evaluate('releaseMarker') == 'one', 'Launch query lost the entry fallback')
        passed('offline-entry-navigation-with-launch-query')
        online(context)
        b = new_page(context); b.goto(base + '/apps/b/index.html'); ready(b); installed(b)
        check(cache_key('a', 'one') in b.evaluate('caches.keys()'), 'Sibling install deleted first application cache')
        check(cache_key('b', 'one') in b.evaluate('caches.keys()'), 'Sibling cache missing')
        passed('same-origin-sibling-cache-isolation')
        # Keep two independently controlled old-release clients alive. This
        # prevents immediate activation and makes the waiting-worker contract
        # explicit rather than depending on how a prior offline navigation is
        # classified by an individual engine.
        updater = new_page(context); updater.goto(base + '/apps/a/index.html'); ready(updater)
        check(a.evaluate('Boolean(navigator.serviceWorker.controller)'), 'Offline launch client lost service-worker control')
        check(updater.evaluate('Boolean(navigator.serviceWorker.controller)'), 'Update guard is not controlled by the active release')
        check(updater.evaluate('releaseMarker') == 'one', 'Update guard did not load the active release')
        state['a'] = 'two'
        before_worker_requests = state['worker_requests']
        updater.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
        check(state['worker_requests'] > before_worker_requests, 'Explicit update did not request the service-worker script')
        wait_for_export(updater, 'navigator.serviceWorker.getRegistration().then(r=>r?.waiting?.state === "installed")')
        check(updater.evaluate('globalThis.vb6OfflineStatus?.updateAvailable === true'), 'Waiting update was not surfaced to the application')
        for client in (a, updater):
            check(client.evaluate('releaseMarker') == 'one', 'Update replaced live application code')
            check(client.evaluate('fetch("./assets/version.txt").then(r=>r.text())') == 'one', 'Live release mixed new assets')
        check(cache_key('a', 'one') in a.evaluate('caches.keys()'), 'Waiting update removed active cache')
        calculator(a)
        passed('update-waits-without-reloading-or-mixing-live-release')
        a.close(); updater.close()
        wait_for_export(b, '(url)=>navigator.serviceWorker.getRegistration(url).then(r=>r?.active?.state === "activated" && !r.waiting)', arg=base + '/apps/a/')
        keys = b.evaluate('caches.keys()')
        check(cache_key('a', 'one') not in keys and cache_key('a', 'two') in keys, 'Update did not retire only the old release')
        check(cache_key('b', 'one') in keys, 'Update deleted sibling cache')
        a = new_page(context); a.goto(base + '/apps/a/index.html'); ready(a); installed(a)
        check(a.evaluate('releaseMarker') == 'two', 'Updated code not loaded')
        a = open_offline_page(context, a, base + '/apps/a/index.html')
        check(a.evaluate('releaseMarker') == 'two', 'Updated release unavailable offline')
        online(context)
        passed('natural-activation-and-offline-updated-release')
        a.evaluate('(key)=>caches.open(key).then(c=>c.delete(new URL("./assets/raw.bin",location.href).href))', cache_key('a', 'two'))
        check(binary(a) == [0,255,128], 'Evicted exact-version asset did not recover')
        passed('evicted-entry-recovers-verified-network-bytes')
        state['a'] = 'one'
        a.evaluate('(key)=>caches.open(key).then(c=>c.delete(new URL("./adapter.js",location.href).href))', cache_key('a', 'two'))
        check(a.evaluate('fetch("./adapter.js").then(r=>r.status)') == 503, 'Eviction silently mixed a mismatched server code')
        passed('evicted-code-rejects-mismatched-server-release')
        broken = new_page(context); broken.goto(base + '/apps/broken/index.html'); ready(broken)
        wait_for_export(broken, 'globalThis.vb6OfflineStatus?.phase === "error"')
        check(broken.evaluate('vb6OfflineReady.then(()=>false,()=>true)'), 'Failed installation promise falsely resolved')
        check(cache_key('broken', 'one') not in broken.evaluate('caches.keys()'), 'Partial release was left cached')
        passed('corrupt-upload-fails-install-with-no-partial-cache')
        state['corrupt'] = False; broken.reload(); ready(broken); installed(broken)
        passed('repaired-upload-installs-on-explicit-page-reload')
        failed = new_page(context); failed.goto(base + '/apps/failed/index.html'); ready(failed, 'error')
        wait_for_export(failed, 'globalThis.vb6OfflineStatus?.phase === "error"')
        check(failed.evaluate('navigator.serviceWorker.getRegistration().then(r=>!r)'), 'Failed application installed an offline worker')
        passed('failed-startup-never-registers-broken-application')
        local = new_page(context); local.goto((REPORT / 'fixtures/one/index.html').as_uri()); ready(local)
        wait_for_export(local, 'globalThis.vb6OfflineStatus?.phase === "unavailable"')
        passed('file-origin-runs-normally-without-offline-registration')
        local.close()
        # Independent menu download, ZIP metadata/byte verification and Node parity.
        ide = new_page(context); ide.goto(base + '/dist/index.html')
        wait_for_export(ide, 'Boolean(globalThis.vb6Studio?.applicationExportInstalled)')
        source = json.loads((ROOT / 'examples/calculator.vb6web').read_text())
        ide.evaluate('project=>vb6Studio.loadProject(project)', source)
        expected = ide.evaluate('vb6Studio.project')
        large = ide.evaluate('''async()=>{
          const result = await VB6StudioAPI.exportApplicationBundle(vb6Studio.project, {}, {}, {assets:{'large.bin':{base64:btoa('x'.repeat(4000000))}}});
          return {length:result.files['large.bin'].length, verified:(await VB6StudioAPI.verifyApplicationBundle(result.files)).valid};
        }''')
        check(large == {'length': 4000000, 'verified': True}, 'Large binary asset packaging/verification failed')
        passed('four-megabyte-browser-asset-packaging-and-verification')
        ide.locator('[data-menu="File"]').click()
        with ide.expect_download() as download_event:
            ide.get_by_role('menuitem', name='Make Offline Application (.zip)…', exact=True).click()
        download = download_event.value; check(download.failure() is None, 'Offline ZIP download failed')
        archive = REPORT / 'offline-download.zip'; download.save_as(archive)
        destination = REPORT / 'download'; destination.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            check(z.testzip() is None, 'Downloaded ZIP CRC mismatch')
            check(all(i.date_time == (1980,1,1,0,0,0) for i in z.infolist()), 'ZIP contains nondeterministic dates')
            check(z.namelist() == sorted(z.namelist()), 'ZIP file order is not deterministic')
            manifest = json.loads(z.read('manifest.json'))
            for item in manifest['files']:
                data = z.read(item['path'])
                check(len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'Actual downloaded file fingerprint mismatch')
            check(hashlib.sha256(json.dumps(manifest['files'], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() == manifest['buildId'], 'Independent build identifier differs')
            z.extractall(destination)
        expected_file = REPORT / 'download-project.vb6web'; expected_file.write_text(json.dumps(expected))
        comparison = REPORT / 'node-comparison.zip'
        subprocess.run(['node', 'tools/export-application.mjs', str(expected_file), '--format', 'zip', '--offline', '--out', str(comparison)], cwd=ROOT, check=True)
        check(archive.read_bytes() == comparison.read_bytes(), 'Node and actual browser exporter bytes differ')
        check(ide.evaluate('vb6Studio.lastApplicationExport.buildId') == manifest['buildId'], 'IDE did not retain release identity')
        passed('actual-IDE-offline-download-byte-identical-to-Node', buildId=manifest['buildId'], zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        deployed = new_page(context); deployed.goto(base + '/download/index.html'); ready(deployed); installed(deployed)
        deployed.reload(); ready(deployed)
        deployed = open_offline_page(context, deployed, base + '/download/index.html'); calculator(deployed)
        deployed.screenshot(path=str(REPORT / 'offline-calculator.png'))
        passed('exact-IDE-download-reopened-and-used-offline')
        check(not errors, 'Uncaught browser errors: ' + repr(errors))
        passed('zero-uncaught-page-errors')
        context.close(); browser.close()
except Exception as error:
    results.append({'case': 'execution', 'passed': False, 'error': str(error)})
    raise
finally:
    origin.stop()
    (REPORT / 'results.json').write_text(json.dumps({'browser': ENGINE, 'realOrigins': True, 'outages': outages, 'pageErrors': errors, 'results': results}, indent=2) + '\n')
    if os.environ.get('GITHUB_ACTIONS'):
        shutil.rmtree(REPORT / 'fixtures', ignore_errors=True)
        shutil.rmtree(REPORT / 'download', ignore_errors=True)
        (REPORT / 'node-comparison.zip').unlink(missing_ok=True)
print(json.dumps({'browser': ENGINE, 'passed': len(results)}))

#!/usr/bin/env python3
"""Actual agent transcript paint, disclosure, scroll and streaming regressions.

Required GPU backends may never pass via fallback. --offline uses inline local
bundles for restricted environments, but does not relax backend requirements.
Software-driver CI is functional qualification, not a physical-GPU claim.
"""
import argparse, functools, http.server, io, json, math, os, shutil, subprocess, threading, traceback
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from rendering_launch import rendering_launch_flags

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/rendering/agent-thread'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
backends = parser.add_mutually_exclusive_group()
backends.add_argument('--require-webgpu', action='store_true')
backends.add_argument('--require-webgl2', action='store_true')
parser.add_argument('--software-gpu', action='store_true')
parser.add_argument('--headed', action='store_true')
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
backend = 'webgpu' if args.require_webgpu else 'webgl2' if args.require_webgl2 else 'canvas2d'
fixture = subprocess.check_output(['node', '--input-type=module', '-e',
    "import {bundle} from './tools/bundle.mjs';process.stdout.write(bundle('./tests/fixtures/rendering-agent-thread.mjs','AgentFixture'));"], cwd=ROOT, text=True)
css = (ROOT / 'dist/studio.css').read_text()
html = '<!doctype html><meta charset="utf-8"><style>' + css + '''
body{margin:0;padding:20px;background:#c0c0c0;font:16px Arial}
h2{margin:0 0 16px}.agent-thread-view{height:700px;max-width:1100px}
.agent-thread-view>.agent-conversation{font:16px/1.45 Arial}
</style><h2>AI Coding Agents — transcript rendering regression</h2>'''
server = None
if not args.offline:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
flags = rendering_launch_flags(software_gpu=args.software_gpu)
results = []

def check(value, message):
    if not value: raise AssertionError(message)

def record_failure(page, result, error):
    # Save the primary failure BEFORE attempting a diagnostic screenshot. A
    # stalled compositor must not erase the failed case from the final report.
    result.update(passed=False, error=str(error))
    traceback.print_exc(); print('FAIL', result['name'], flush=True)
    try:
        page.screenshot(path=str(OUT / (result['name'] + '-failure.png')), caret='initial')
    except Exception as capture_error:
        result['failureScreenshotError'] = str(capture_error)


def close_case(page, context, result):
    # Closing a browsing context is not an explicit renderer disposal. Release
    # the retained GPU buffers/context, observers and thread state before the
    # next DPI case allocates resources in the same browser process.
    try:
        page.evaluate('()=>{window.renderer?.dispose();window.fixture?.view?.dispose();}')
    except Exception as error:
        result.update(passed=False, cleanupError=str(error))
    finally:
        context.close()


def equal(a, b, label):
    diff = ImageChops.difference(Image.open(io.BytesIO(a)).convert('RGB'), Image.open(io.BytesIO(b)).convert('RGB'))
    if diff.getbbox():
        diff.save(OUT / (label + '-diff.png'))
        raise AssertionError('Pixel mismatch: ' + label + ' ' + str(diff.getbbox()))

def settle(page):
    page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(renderer.driver?.device)await renderer.driver.device.queue.onSubmittedWorkDone();}')

def capture(page, label):
    # Establish stability independently, never search for a matching reference.
    # A screenshot transport timeout can occur after fonts/GPU readiness. Retry
    # that command once on the SAME page, not an assertion, test or renderer.
    # See https://playwright.dev/python/docs/api/class-page#page-screenshot
    import hashlib
    previous, stable = None, 0
    samples, capture_errors = [], []
    accepted = False
    image_path = OUT / (label + '.png')
    report_path = OUT / (label + '-capture.json')
    image_path.unlink(missing_ok=True)

    def report():
        report_path.write_text(json.dumps({'backend': backend, 'samples': samples,
            'stableCaptures': stable, 'captureErrors': capture_errors,
            'accepted': accepted}, indent=2) + '\n')

    try:
        for attempt in range(12):
            # Readiness and backend failures are outside the recoverable call.
            settle(page)
            check(page.evaluate('renderer.backend') == backend, 'Unexpected backend fallback')
            try:
                image = page.screenshot(caret='initial')
            except PlaywrightTimeoutError as error:
                capture_errors.append({'attempt': attempt, 'error': str(error)})
                previous, stable = None, 0
                report()  # Preserve the timeout before any recovery attempt.
                if len(capture_errors) > 1:
                    raise
                continue
            check(page.evaluate('renderer.backend') == backend, 'Unexpected backend fallback')
            stable = stable + 1 if image == previous else 1
            samples.append({'attempt': attempt, 'sha256': hashlib.sha256(image).hexdigest(),
                            'consecutive': stable})
            if stable == 3:
                image_path.write_bytes(image)
                accepted = True
                return image
            previous = image
        raise AssertionError('Capture did not stabilize: ' + label)
    finally:
        report()

def marker_parity(page, label, dpr):
    rect = page.locator('details.agent-tool > summary').first.bounding_box()
    painted = capture(page, label + '-painted')
    # Explicit native oracle, not a renderer fallback. Opacity avoids moving
    # layout, changing the DOM text or destroying the live GPU device.
    page.evaluate("renderer.canvas.style.opacity='0'")
    try:
        native = capture(page, label + '-native')
    finally:
        page.evaluate("renderer.canvas.style.opacity='1'")
    bounds = (math.floor(rect['x'] * dpr), math.floor(rect['y'] * dpr),
              math.ceil((rect['x'] + rect['width']) * dpr), math.ceil((rect['y'] + rect['height']) * dpr))
    a, b = Image.open(io.BytesIO(painted)).convert('RGB'), Image.open(io.BytesIO(native)).convert('RGB')
    diff = ImageChops.difference(a.crop(bounds), b.crop(bounds))
    if diff.getbbox():
        diff.save(OUT / (label + '-diff.png'))
        raise AssertionError('Disclosure marker/heading differs from native HTML: ' + label)


def invariant(page, label):
    # Removing non-painted tool bodies cannot alter a single displayed pixel.
    original = capture(page, label + '-retained')
    page.evaluate('fixture.detachHidden()')
    detached = capture(page, label + '-detached')
    equal(original, detached, label)
    page.evaluate('fixture.restoreHidden()')
    equal(original, capture(page, label + '-restored'), label + '-restore')
    reads = page.evaluate('auditReads')
    check(reads == {'hiddenGeometry': 0, 'hiddenText': 0}, 'Hidden paint tree was measured: ' + str(reads))
    return reads

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or p.chromium.executable_path,
            headless=not args.headed, args=flags, ignore_default_args=['--hide-scrollbars'])
        for dpr in [1, 1.25, 1.5, 2]:
            for text in ['native', 'gpu']:
                name = f'{backend}-{text}-{dpr}'
                context = browser.new_context(viewport={'width': 1120, 'height': 850}, device_scale_factor=dpr)
                page = context.new_page(); errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                result = {'name': name, 'passed': False}; results.append(result)
                try:
                    if server: page.goto(f'http://127.0.0.1:{server.server_port}/tests/fixtures/rendering.html')
                    page.set_content(html)
                    page.add_script_tag(content=(ROOT / 'dist/vb6-rendering.js').read_text())
                    page.add_script_tag(content=fixture)
                    stats = page.evaluate('''async({backend,text})=>{
                      window.fixture=AgentFixture.mount();
                      window.renderer=new VB6Rendering.UIRenderer(document,{backend,text,fallbacks:['html']});
                      window.auditReads=AgentFixture.audit(renderer);await renderer.ready;
                      return renderer.getStats();
                    }''', {'backend': backend, 'text': text})
                    check(stats['active'] == backend, 'Required backend did not execute: ' + json.dumps(stats))
                    settle(page)
                    invariant(page, name + '-collapsed')
                    marker_parity(page, name + '-closed-marker', dpr)
                    check(page.evaluate("renderer.getStats().last.reasons['native disclosure summary'] > 0"), 'Disclosure marker not preserved')
                    if text == 'gpu': check(page.evaluate('renderer.getStats().last.gpuText > 0'), 'Atlas path was not exercised')
                    # Open through real input; closing with Enter must preserve
                    # focus, the summary marker and the still-connected body.
                    first = page.locator('details.agent-tool > summary').first
                    first.click(); check(page.locator('details.agent-tool').first.evaluate('n=>n.open'), 'Mouse expansion failed')
                    marker_parity(page, name + '-open-marker', dpr)
                    first.focus(); page.keyboard.press('Enter')
                    check(not page.locator('details.agent-tool').first.evaluate('n=>n.open'), 'Keyboard collapse failed')
                    page.evaluate('document.activeElement.blur()')
                    invariant(page, name + '-closed-again')
                    # Synchronous state changes precede MutationObserver. Force
                    # a real scene build at each transition, including cached order.
                    sync = page.evaluate('''()=>{const d=fixture.tools()[0],r=[];for(const open of [true,false,true,false]){
                      d.open=open;renderer.renderNow({force:true});r.push({open,reads:{...auditReads}});}return r;}''')
                    check(all(not any(item['reads'].values()) for item in sync), 'Synchronous collapse reused hidden geometry')
                    page.evaluate('fixture.view.scroller.scrollTop=fixture.view.scroller.scrollHeight')
                    settle(page); invariant(page, name + '-scrolled')
                    page.evaluate('fixture.view.scroller.scrollTop=320')
                    settle(page)
                    before = page.evaluate('fixture.view.scroller.scrollTop')
                    page.evaluate('fixture.stream()'); settle(page)
                    check(page.evaluate('fixture.view.scroller.scrollTop') == before, 'Streaming moved the reader')
                    invariant(page, name + '-streaming')
                    page.evaluate('fixture.complete();fixture.view.jump.click()')
                    settle(page)
                    check(page.evaluate('fixture.view.follow'), 'Jump to latest failed')
                    invariant(page, name + '-complete')
                    # Narrow reflow and horizontal preformatted scrolling.
                    page.set_viewport_size({'width': 760, 'height': 850}); settle(page)
                    invariant(page, name + '-narrow')
                    horizontal = page.locator('.agent-code-block pre').first.evaluate('n=>{n.scrollLeft=120;return n.scrollLeft}')
                    check(horizontal > 0, 'Horizontal code scroll was not exercised')
                    invariant(page, name + '-horizontal')
                    page.evaluate('fixture.view.follow=false;fixture.view.savedTop=0;fixture.view.scroller.scrollTop=0;window.nativeFixture=fixture.nativeOverflow()')
                    settle(page)
                    invariant(page, name + '-nested-native')
                    check(page.evaluate('auditReads.hiddenGeometry') == 0, 'Hidden nested result was measured')
                    check(not errors, str(errors))
                    final = page.evaluate('renderer.getStats()')
                    result.update(passed=True, stats=final, audit=page.evaluate('auditReads'), pixelInvariants=8)
                    print('PASS', name, flush=True)
                except Exception as error:
                    record_failure(page, result, error)
                finally: close_case(page, context, result)
        browser.close()
finally:
    if server: server.shutdown(); server.server_close()
    (OUT / 'report.json').write_text(json.dumps({'backend': backend, 'softwareGpuRequested': args.software_gpu,
        'physicalHardwareQualified': False, 'headed': args.headed, 'offline': args.offline, 'flags': flags, 'results': results}, indent=2) + '\n')
check(len(results) == 8 and all(item['passed'] for item in results), 'Agent transcript rendering regression failed')

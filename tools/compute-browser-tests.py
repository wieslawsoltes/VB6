"""Strict WebGPU validation: a missing adapter is a failure, never a skipped pass."""
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports' / 'compute'
REPORTS.mkdir(parents=True, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as p:
        executable = os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROMIUM')
        kwargs = dict(headless=True, args=['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'])
        if executable:
            kwargs['executable_path'] = executable
        browser = p.chromium.launch(**kwargs)
        page = browser.new_page(viewport={'width': 1000, 'height': 1100})
        page.set_default_timeout(90000)
        page_errors = []
        page.on('pageerror', lambda e: page_errors.append(str(e)))
        url = f'http://127.0.0.1:{server.server_port}'
        page.goto(url + '/artifacts/vb6-compute/playground.html')
        page.add_script_tag(content=(ROOT / 'tests/compute-browser.js').read_text())
        report = page.evaluate('runComputeBrowserTests()')
        report['browser'] = browser.version
        report['pageErrors'] = page_errors
        (REPORTS / 'gpu.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2), flush=True)
        if report.get('available') and not report.get('failed'):
            page.locator('#run').click()
            page.wait_for_function("document.getElementById('status').textContent.includes('Module1.ticks')")
            assert '"Module1.ticks": 1' in page.locator('#status').inner_text()
            page.locator('#again').click()
            page.wait_for_function("document.getElementById('status').textContent.includes('\"Module1.ticks\": 2')")
            page.screenshot(path=str(REPORTS / 'playground.png'), full_page=True)
            page.locator('#dispose').click()
            page.wait_for_function("document.getElementById('status').textContent==='Disposed.'")
            report['playground'] = 'passed: compile, repeat, GPU presentation, dispose'
        (REPORTS / 'gpu.json').write_text(json.dumps(report, indent=2))
        browser.close()
        assert report.get('available'), 'No WebGPU adapter: validation is not complete'
        assert report.get('failed') == 0, 'GPU scenario failures; see reports/compute/gpu.json'
        assert not page_errors, page_errors
        assert report['resourcesAfterTests'] == 0, 'Leaked GPU resources'
finally:
    server.shutdown()
    server.server_close()

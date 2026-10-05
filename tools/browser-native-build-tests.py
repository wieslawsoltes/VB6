#!/usr/bin/env python3
"""Browser-only compiler/export/worker tests. Build and emit native fixtures first.
No native executable is run here; Windows execution is tested separately.
"""
from __future__ import annotations
import hashlib
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'validation' / 'browser-native'
OUT.mkdir(parents=True, exist_ok=True)
PROJECT = json.loads((ROOT / 'validation/win32/AotWindows.vb6web').read_text())
EXPECTED = (ROOT / 'validation/win32/AotWindows.exe').read_bytes()
SDK = (ROOT / 'dist/vb6-native.js').read_text()
checks = []

def check(name: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
    try:
        page = browser.new_page(accept_downloads=True, viewport={'width': 1440, 'height': 960})
        requests = []
        errors = []
        page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('https:', 'http:')) else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)
        page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text())
        page.wait_for_function('!!globalThis.vb6Studio?.project')
        check('single HTML IDE runs without Node', page.evaluate('typeof require === "undefined" && typeof process === "undefined"'))
        page.evaluate('p => vb6Studio.loadProject(p)', PROJECT)
        check('File menu exposes Win32 AOT export', page.evaluate('vb6Studio.menu("File").some(i => i?.id === "exportWin32" && i.enabled)'))
        with page.expect_download() as pending:
            page.evaluate('vb6Studio.command("exportWin32")')
        download = pending.value
        check('download filename is a native executable', download.suggested_filename == 'AotWindows.exe')
        destination = OUT / download.suggested_filename
        download.save_as(destination)
        check('browser EXE bytes equal independently compiled Node output', destination.read_bytes() == EXPECTED)
        check('IDE reports no-extraction PE32 build', page.evaluate('vb6Studio.lastNativeBuild.extraction === false && vb6Studio.lastNativeBuild.format === "PE32"'))
        page.evaluate('vb6Studio.runState = "running"')
        check('running project cannot export', page.evaluate('!vb6Studio.menu("File").find(i => i?.id === "exportWin32").enabled'))
        page.evaluate('vb6Studio.runState = "design"')
        bad = json.loads(json.dumps(PROJECT))
        bad['modules'][0]['code'] = 'Option Explicit\nPrivate Sub Form_Load()\nDim value As Variant\nEnd Sub'
        downloads = []
        page.on('download', lambda d: downloads.append(d.suggested_filename))
        page.evaluate('p => vb6Studio.loadProject(p)', bad)
        page.evaluate('vb6Studio.command("exportWin32")')
        check('unsupported source produces diagnostic and no EXE', not downloads and page.evaluate('vb6Studio.lastNativeBuild.diagnostics.some(d => d.severity === "error")'))
        check('IDE export has no script or network errors', not errors and not requests)
        numeric_dir = ROOT / 'validation/numeric'
        if numeric_dir.exists():
            original = json.loads((ROOT / 'examples/calculator.vb6web').read_text())
            page.evaluate('p => vb6Studio.loadProject(p)', original)
            with page.expect_download() as pending:
                page.evaluate('vb6Studio.command("exportWin32")')
            calculator_download = pending.value
            check('unchanged Calculator exports from File Make EXE', calculator_download.suggested_filename == 'Calculator.exe')
            calculator_download.save_as(OUT / 'Calculator.exe')
            check('Calculator IDE export matches Node native compiler', (OUT / 'Calculator.exe').read_bytes() == (numeric_dir / 'Calculator.exe').read_bytes())
        currency_dir = ROOT / 'validation/currency'
        if currency_dir.exists():
            money = json.loads((currency_dir / 'AotCurrency.vb6web').read_text())
            page.evaluate('p => vb6Studio.loadProject(p)', money)
            before = page.evaluate('JSON.stringify(vb6Studio.project.modules)')
            with page.expect_download() as pending:
                page.evaluate('vb6Studio.command("exportWin32")')
            downloaded = pending.value
            downloaded.save_as(OUT / 'AotCurrency.exe')
            check('Currency File Make EXE preserves original source', before == page.evaluate('JSON.stringify(vb6Studio.project.modules)'))
            check('Currency File Make EXE output equals Node', downloaded.suggested_filename == 'AotCurrency.exe' and (OUT / 'AotCurrency.exe').read_bytes() == (currency_dir / 'AotCurrency.exe').read_bytes())
            check('Currency export has no network requests or page errors', not errors and not requests)
        date_dir = ROOT / 'validation/dates'
        if date_dir.exists():
            dates = json.loads((date_dir / 'AotDates.vb6web').read_text())
            page.evaluate('p => vb6Studio.loadProject(p)', dates)
            before = page.evaluate('JSON.stringify(vb6Studio.project.modules)')
            with page.expect_download() as pending:
                page.evaluate('vb6Studio.command("exportWin32")')
            downloaded = pending.value
            downloaded.save_as(OUT / 'AotDates.exe')
            check('Date File Make EXE preserves original source', before == page.evaluate('JSON.stringify(vb6Studio.project.modules)'))
            check('Date File Make EXE output equals Node', downloaded.suggested_filename == 'AotDates.exe' and (OUT / 'AotDates.exe').read_bytes() == (date_dir / 'AotDates.exe').read_bytes())
            check('Date export has no page or network errors', not errors and not requests)
        page.close()
        page = browser.new_page()
        page.add_script_tag(content=SDK)
        fixture_hashes = {}
        fixtures = [(ROOT / 'validation/win32', name) for name in ('AotWindows', 'AotDynamicArrays', 'AotStorage', 'AotErrors')]
        if numeric_dir.exists():
            fixtures.extend((numeric_dir, name) for name in ('Calculator', 'AotNumbers', 'AotIndexedControls'))
        if currency_dir.exists():
            fixtures.append((currency_dir, 'AotCurrency'))
            if (currency_dir / 'AotCurrencyBindings.vb6web').exists():
                fixtures.append((currency_dir, 'AotCurrencyBindings'))
        if date_dir.exists():
            fixtures.extend((date_dir, name) for name in ('AotDates', 'AotDateABI') if (date_dir / f'{name}.vb6web').exists())
        for fixture_dir, fixture_name in fixtures:
            fixture_project = json.loads((fixture_dir / f'{fixture_name}.vb6web').read_text())
            fixture_expected = (fixture_dir / f'{fixture_name}.exe').read_bytes()
            fixture_hashes[fixture_name] = hashlib.sha256(fixture_expected).hexdigest()
            actual = bytes(page.evaluate('p => Array.from(VB6Native.compileWin32(p).bytes)', fixture_project))
            check(f'{fixture_name}: standalone SDK emits identical PE bytes', actual == fixture_expected)
            worker = page.evaluate('''async ({source,project}) => {
              const script = source + `\nself.onmessage=e=>{try{const result=VB6Native.compileWin32(e.data);self.postMessage({ok:true,bytes:result.bytes},[result.bytes.buffer]);}catch(error){self.postMessage({ok:false,error:error.message});}};`;
              const url=URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
              const worker=new Worker(url);
              try { return await new Promise((resolve,reject)=>{
                const timeout=setTimeout(()=>reject(new Error('Compiler worker timeout')),10000);
                worker.onmessage=e=>{clearTimeout(timeout);e.data.ok?resolve(Array.from(e.data.bytes)):reject(new Error(e.data.error));};
                worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};worker.postMessage(project);
              }); } finally { worker.terminate();URL.revokeObjectURL(url); }
            }''', {'source': SDK, 'project': fixture_project})
            check(f'{fixture_name}: worker transfers identical PE bytes without DOM', bytes(worker) == fixture_expected)
        (OUT / 'results.json').write_text(json.dumps({'ok': True, 'checks': checks, 'browser': browser.version, 'sha256': hashlib.sha256(EXPECTED).hexdigest(), 'fixtureSha256': fixture_hashes, 'origin': 'inline standalone HTML / Blob worker; no hosting or native execution'}, indent=2))
    finally:
        browser.close()
print(json.dumps({'passed': len(checks)}, indent=2))

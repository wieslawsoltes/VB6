#!/usr/bin/env python3
"""Actual Canvas and optional required-WebGPU acceptance of retained graphics.
Memory transport is explicitly local-only; it never certifies GPU/origin tests.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ENGINE=os.environ.get('VB6_BROWSER','chromium')
TRANSPORT=os.environ.get('VB6_TEST_TRANSPORT','http')
GPU=os.environ.get('VB6_REQUIRE_GPU')=='1'
if TRANSPORT not in {'http','file','memory'}: raise ValueError('Invalid test transport')
if GPU and TRANSPORT=='memory': raise ValueError('GPU validation requires a real secure origin')
REPORT=ROOT/'reports/graphics'/ENGINE;REPORT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','tools/build-graphics-fixture.mjs'],cwd=ROOT,check=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'engine':ENGINE,'transport':TRANSPORT,'requiredGPU':GPU,'runs':[],'errors':[]}
try:
 with sync_playwright() as pw:
    options={'headless':os.environ.get('VB6_HEADED')!='1'}
    if ENGINE=='chromium':
        executable=os.environ.get('CHROMIUM_PATH') or os.environ.get('RENDERING_BROWSER_EXECUTABLE') or shutil.which('chromium')
        if executable: options['executable_path']=executable
        options['args']=['--no-sandbox','--disable-dev-shm-usage']
        if GPU:options['args']+=shlex.split(os.environ.get('GRAPHICS_GPU_FLAGS','--enable-unsafe-webgpu --enable-gpu --ignore-gpu-blocklist --enable-features=Vulkan --use-webgpu-adapter=swiftshader --disable-vulkan-surface --disable-gpu-rasterization'))
    browser=getattr(pw,ENGINE).launch(**options)
    report['browserVersion']=browser.version
    try:
     for dpr in [1,1.25,2]:
        context=browser.new_context(viewport={'width':1000,'height':700},device_scale_factor=dpr)
        page=context.new_page();page.on('pageerror',lambda error:report['errors'].append(str(error)))
        try:
            fixture=ROOT/'reports/graphics/fixtures/suite.html'
            if TRANSPORT=='memory':page.set_content('<!doctype html><meta charset="utf-8">');page.add_style_tag(content=(fixture.parent/'suite.css').read_text());page.add_script_tag(content=(fixture.parent/'suite.js').read_text())
            elif TRANSPORT=='file':page.goto(fixture.as_uri())
            else:page.goto(f'http://127.0.0.1:{server.server_port}/reports/graphics/fixtures/suite.html')
            result=page.evaluate("backend=>GraphicsTests.runGraphicsTests(GraphicsRuntime.RuntimeAPI,backend)",'webgpu' if GPU else 'canvas2d')
            report['runs'].append(result)
        finally:context.close()
    finally:browser.close()
 if report['errors']:raise AssertionError('\n'.join(report['errors']))
 report['passed']=True
 print(json.dumps({'passed':True,'cases':sum(len(r['cases']) for r in report['runs']),'assertions':sum(r['assertions'] for r in report['runs']),'transport':TRANSPORT,'gpu':GPU}))
except Exception as error:
 report['passed']=False;report['failure']=str(error);raise
finally:
 (REPORT/('gpu-results.json' if GPU else 'canvas-results.json')).write_text(json.dumps(report,indent=2))
 server.shutdown();server.server_close()

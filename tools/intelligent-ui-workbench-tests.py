#!/usr/bin/env python3
"""Real workbench input tests in HTTP modules, standalone and file deployments.
--opaque is only a labelled local diagnostic, never an automatic fallback.
"""
from __future__ import annotations
import argparse, functools, http.server, json, os, shutil, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
from intelligent_ui_workbench_cases import run_workbench_cases
from intelligent_ui_ordering_cases import run_surface_ordering_cases

ROOT=Path(__file__).resolve().parents[1]
# Full IDE parsing has a separate bound from the 12000 ms interaction deadline.
IDE_STARTUP_TIMEOUT_MS=60000
parser=argparse.ArgumentParser()
parser.add_argument('--opaque',action='store_true')
parser.add_argument('--browser',choices=['chromium','firefox','webkit'],default=os.environ.get('VB6_BROWSER','chromium'))
args=parser.parse_args()
REPORT=ROOT/'reports/intelligent-ui-workbench'/args.browser
REPORT.mkdir(parents=True,exist_ok=True)
results=[]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(server.server_port)
def check(value,message):
    if not value: raise AssertionError(message)
def passed(name):
    results.append({'name':name,'passed':True})
    print('PASS',name,flush=True)
def load(browser,mode):
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.set_default_timeout(12000)
    page._errors=[]
    page.on('pageerror',lambda e:page._errors.append(str(e)))
    try:
        if mode=='opaque':page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(),wait_until='domcontentloaded',timeout=IDE_STARTUP_TIMEOUT_MS)
        elif mode=='file':page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri(),wait_until='commit',timeout=IDE_STARTUP_TIMEOUT_MS)
        else:page.goto(base+('/index.html' if mode=='modules' else '/VB6-Studio-Web.html'),wait_until='commit',timeout=IDE_STARTUP_TIMEOUT_MS)
        page.wait_for_function('!!globalThis.vb6Studio?.intelligentUI',timeout=IDE_STARTUP_TIMEOUT_MS)
    except Exception:
        # The caller only owns successfully loaded pages; release failed startup.
        try:page.close()
        except Exception:pass
        raise
    return page
version=None
try:
    with sync_playwright() as p:
        options={'headless':True}
        if args.browser=='chromium':
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:options['executable_path']=executable
            options['args']=['--no-sandbox']
        browser=getattr(p,args.browser).launch(**options)
        version=browser.version
        try:
            for mode in (['opaque'] if args.opaque else ['modules','standalone','file']):
                run_workbench_cases(browser,mode,load,check,passed,REPORT)
                run_surface_ordering_cases(browser,mode,load,check,passed,REPORT)
        finally:browser.close()
finally:
    server.shutdown()
    (REPORT/'results.json').write_text(json.dumps({'browser':args.browser,'browserVersion':version,'transportMode':'opaque-document-only' if args.opaque else 'HTTP-and-file','cases':results},indent=2)+'\n')

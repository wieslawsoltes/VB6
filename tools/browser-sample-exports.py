#!/usr/bin/env python3
"""Download every catalog example from the real IDE toolbar, then reopen those
exact bytes over HTTP and file origins. No prebuilt HTML stands in for a download.
VB6_OFFLINE=1 is supplemental only: actual downloads, but inline navigation and
an explicit non-release result. Normal CI forbids it and requires all origins.
"""
import hashlib, json, os, subprocess, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/win32-exports'
REPORT.mkdir(parents=True,exist_ok=True)
BROWSER=os.environ.get('VB6_BROWSER','chromium')
INLINE=os.environ.get('VB6_OFFLINE')=='1'
if INLINE and os.environ.get('GITHUB_ACTIONS'): raise RuntimeError('Inline export tests cannot replace CI origins')
catalog=json.loads(subprocess.check_output(['node','--input-type=module','-e',"""
import {EXAMPLES} from './src/project/examples.js';
import {WIN32_SERVICE_SAMPLES} from './src/project/win32-service-examples.js';
import {WIN32_SYSTEM_SAMPLES} from './src/project/win32-system-examples.js';
const services=[...WIN32_SERVICE_SAMPLES,...WIN32_SYSTEM_SAMPLES];
console.log(JSON.stringify(EXAMPLES.map(e=>({id:e.id,expected:services.find(s=>s.id===e.id)?.expected}))));
"""],cwd=ROOT,text=True))
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
results=[]
def check(value,message):
    if not value: raise AssertionError(message)
def idle(page):
    page.wait_for_function('()=>{const v=vb6Application.vm;return !v.processing&&v.stack.length===0&&v.eventQueue.length===0;}')
def stats(page):
    return page.evaluate('({memory:vb6Application.vm.win32.api.memory.used,handles:vb6Application.vm.win32.api.handles.entries.size})')
def exercise(page,sample):
    page.wait_for_function('Boolean(globalThis.vb6Application?.vm)')
    # Language Lab deliberately catches division by zero; lastError retains handled errors.
    check(page.evaluate('vb6Application.vm.state !== "error" && vb6Application.dialogs.length === 0'),'Exported startup error or unexpected modal')
    check(page.evaluate('''()=>{const w=vb6Application.vm.win32.api;return w.resolve('kernel32','FormatMessageW').arity===7&&w.resolve('kernel32','SystemTimeToFileTime').arity===2&&w.invoke('kernel32','GetSystemDefaultLCID',[])===0x409;}'''),'New Win32 APIs missing from downloaded runtime')
    detail={}
    if sample.get('expected'):
        idle(page);before=stats(page)
        for iteration in range(1,3):
            page.locator('[data-control="cmdRun"]').click()
            page.wait_for_function("n=>document.querySelector('[data-control=lblStatus]')?.textContent.includes('Completed '+n)",arg=iteration)
            idle(page);output=page.locator('[data-control="txtOutput"] textarea').input_value()
            check(all(value in output for value in sample['expected']),f'{sample["id"]}: {output}')
            check(stats(page)==before,f'{sample["id"]} retained transient resources')
        detail={'output':output,'runs':2,'resources':before}
    elif sample['id']=='win32':
        for control,text in [('cmdDraw','GDI drawing'),('cmdBitmap','Writable DIB'),('cmdRegions','Complex region:'),('cmdAdvanced','Affine path clip')]:
            page.locator(f'[data-control="{control}"]').click();idle(page)
            page.wait_for_function('text=>document.querySelector("[data-control=lblStatus]")?.textContent.includes(text)',arg=text)
        raster=page.evaluate('''()=>{const h=vb6Application,s=h.forms[0].controlMap.get('piccanvas').surface;
          return {memory:h.vm.win32.api.memory.used,pixels:Array.from(s.readPixels(0,0,488,104).data).filter((v,i)=>i%4!==3&&v!==255).length};}''')
        check(raster['memory']==0 and raster['pixels']>0,'Workbench drawing/cleanup failed');detail=raster
    else:
        detail=page.evaluate('({forms:vb6Application.forms.length,console:vb6Application.console.textContent,state:vb6Application.vm.state})')
        check(detail['forms']>0 or len(detail['console'])>0,'Sample has neither form nor console output')
    check(page.evaluate('vb6Application.vm.state !== "error" && vb6Application.dialogs.length === 0'),'Unhandled runtime error after sample interaction')
    if sample['id']=='language': check('Handled error: Division by zero' in detail['console'] and 'Complete.' in detail['console'],'Language Lab did not complete its error-handler example')
    return detail
try:
    with sync_playwright() as p:
        launch={'headless':True}
        if BROWSER=='chromium':
            launch['args']=['--no-sandbox']
            if os.environ.get('CHROMIUM_PATH'): launch['executable_path']=os.environ['CHROMIUM_PATH']
        browser=getattr(p,BROWSER).launch(**launch)
        context=browser.new_context(viewport={'width':1200,'height':860},accept_downloads=True)
        ide=context.new_page();ide.set_default_timeout(20000);errors=[]
        ide.on('pageerror',lambda e:errors.append(str(e)))
        if INLINE: ide.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        else: ide.goto(base+'/dist/index.html')
        ide.wait_for_function('Boolean(globalThis.vb6Studio)')
        for sample in catalog:
            project=json.loads((ROOT/f'examples/{sample["id"]}.vb6web').read_text())
            ide.evaluate('project=>vb6Studio.loadProject(project)',project)
            expected=ide.evaluate('vb6Studio.project')
            with ide.expect_download() as event:
                ide.locator('[data-command="exportHTML"]').first.click()
            download=event.value
            check(download.failure() is None,'IDE download failed')
            file=REPORT/(sample['id']+'.html');download.save_as(file)
            data=file.read_bytes();text=data.decode('utf-8')
            check(text.startswith('<!doctype html>'),'Missing standalone document')
            check('VB6Runtime.mountApplication' in text,'Missing embedded runtime')
            origins=['inline'] if INLINE else ['http','file']
            for origin in origins:
                app_context=browser.new_context(viewport={'width':1100,'height':820})
                app=app_context.new_page();app.set_default_timeout(20000);app_errors=[];requests=[]
                app.on('pageerror',lambda e:app_errors.append(str(e)))
                app.on('request',lambda req:requests.append(req.url))
                url=base+'/reports/win32-exports/'+file.name if origin=='http' else file.as_uri()
                try:
                    if INLINE: app.set_content(text)
                    else: app.goto(url)
                    embedded=app.locator('#vb6-project').text_content()
                    check(json.loads(embedded)==expected,'Downloaded embedded project differs from current IDE project')
                    detail=exercise(app,sample)
                    check(not app_errors,str(app_errors))
                    check(not [r for r in requests if r.startswith(('http:','https:')) and r!=url], 'Export startup loaded external network resources: '+str(requests))
                    results.append({'case':origin+'-download-'+sample['id'],'passed':True,'sha256':hashlib.sha256(data).hexdigest(),**detail})
                    if sample['id'].startswith('win32-') and origin==origins[0]: app.screenshot(path=str(REPORT/(sample['id']+'.png')))
                    app.evaluate('()=>vb6Application.dispose()')
                finally: app_context.close()
        check(not errors,str(errors));browser.close()
    check(len(results)==len(catalog)*(1 if INLINE else 2),'Incomplete export catalog')
except Exception as error:
    results.append({'case':'execution','passed':False,'error':str(error)})
    raise
finally:
    server.shutdown()
    # Retain checksums/screenshots/results, not dozens of multi-megabyte HTML copies in CI artifacts.
    if os.environ.get('GITHUB_ACTIONS'):
        for file in REPORT.glob('*.html'): file.unlink()
    (REPORT/'results.json').write_text(json.dumps({'browser':BROWSER,'inline':INLINE,'catalogCount':len(catalog),'realOriginVerified':not INLINE,'results':results},indent=2)+'\n')
print(json.dumps({'browser':BROWSER,'inline':INLINE,'passed':len(results),'catalog':len(catalog)}))

#!/usr/bin/env python3
"""Real-engine WebBrowser/VM/designer/export tests. Inline mode is local-only;
CI must exercise HTTP/file loading plus same-origin, cross-origin and CSP frames.
"""
import json, os, re, subprocess, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BROWSER=os.environ.get('VB6_BROWSER','chromium')
INLINE=os.environ.get('VB6_OFFLINE')=='1'
if INLINE and os.environ.get('GITHUB_ACTIONS'):
    raise RuntimeError('Offline supplemental mode is not CI origin/CSP validation')
REPORT=ROOT/'reports/webbrowser'/BROWSER
REPORT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','tools/build-webbrowser-fixtures.mjs'],cwd=ROOT,check=True)
FIXTURES=ROOT/'reports/webbrowser/fixtures'
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path.startswith('/external'):
            self.send_response(200)
            if self.path.startswith('/external-denied'):
                self.send_header('Content-Security-Policy',"frame-ancestors 'none'")
                self.send_header('X-Frame-Options','DENY')
            self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers()
            self.wfile.write(b'<!doctype html><title>External</title><p id="remote">External document</p>');return
        super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
results=[]
def check(value,message):
    if not value: raise AssertionError(message)
def passed(name):
    results.append({'case':name,'passed':True});print('PASS '+name,flush=True)
def load(page,path,origin='http'):
    if not INLINE:
        page.goto(base+'/'+str(path.relative_to(ROOT)) if origin=='http' else path.as_uri());return
    text=path.read_text()
    scripts=re.findall(r'<script defer src="\./([^\"]+)"></script>',text)
    text=re.sub(r'<script defer src="\./[^\"]+"></script>','',text)
    if scripts: text=text.replace('<link rel="stylesheet" href="./app.css">','<style>'+ (path.parent/'app.css').read_text()+'</style>')
    page.set_content(text)
    for script in scripts: page.add_script_tag(content=(path.parent/script).read_text())
def ready(page):
    page.wait_for_function('globalThis.vb6ApplicationStatus?.phase === "ready"')
    page.evaluate("() => { globalThis.wb = vb6Application.forms[0].controls.find(c=>c.model.type==='WebBrowser'); globalThis.callVB = async name => { const i=wb.instance; return VB6Runtime.RuntimeAPI.unbox(await vb6Application.vm.callProcedure(i,i.module.procedures.get(name.toLowerCase()),[])); }; }")
    page.wait_for_function('wb.ReadyState === 4 && !vb6Application.vm.processing')
def settled(page):
    page.wait_for_function('wb.ReadyState === 4 && !vb6Application.vm.processing && vb6Application.vm.eventQueue.length === 0')
def navigate_html(page,text):
    page.evaluate('(html)=>wb.NavigateToString(html)',text)
    page.evaluate('wb.webBrowser.job');settled(page)
try:
    with sync_playwright() as p:
        launch={'headless':True}
        if BROWSER=='chromium':
            launch['args']=['--no-sandbox']
            if os.environ.get('CHROMIUM_PATH'): launch['executable_path']=os.environ['CHROMIUM_PATH']
        browser=getattr(p,BROWSER).launch(**launch)
        for origin in (['inline'] if INLINE else ['http','file']):
            for deployment in ['inline.html','split/index.html']:
                context=browser.new_context(viewport={'width':1100,'height':850});page=context.new_page();page.set_default_timeout(20000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                load(page,FIXTURES/deployment,origin);ready(page)
                frame=page.frame_locator('iframe')
                check('Updated from VB6' in frame.locator('#status').inner_text(),'DocumentComplete did not run real VB source')
                frame.locator('#counter').click();check(frame.locator('#counter').inner_text()=='Clicks: 1','HTML5 script event failed')
                check(frame.locator('#chart').evaluate("e=>e.getContext('2d').getImageData(20,100,1,1).data[3]")==255,'Canvas did not render')
                page.screenshot(path=str(REPORT/f'sample-{origin}-{deployment.split("/")[0]}.png'),full_page=True)
                passed(origin+'-'+deployment+'-html5-source-event')
                page.evaluate("callVB('SaveDocument')")
                check(page.evaluate("callVB('Dimensions')")=='200|100|125','Native-shaped ByRef arguments lost')
                page.evaluate('wb.Zoom=100')
                check(page.evaluate("callVB('DOMProbe')")=='Written HTML5|After|2|11|42','DOM parsing/default collection/Boolean/async script semantics failed')
                settled(page);check(page.evaluate("callVB('StaleDocumentError')")==0,'Document.Open lost document identity')
                passed(origin+'-'+deployment+'-DOM-write-automation')
                check(page.evaluate("wb.ExecuteScript('(()=>{try{return !!parent.document.body}catch(e){return e.name}})()')")=='SecurityError','Child accessed host document')
                check(page.evaluate("wb.ExecuteScript('(()=>{try{localStorage.setItem(\"x\",\"y\");return false}catch(e){return e.name}})()')")=='SecurityError','Child accessed host storage')
                page.evaluate("window.dispatchEvent(new MessageEvent('message',{data:{channel:'vb6-webbrowser-ready',nonce:wb.webBrowser.frame.nonce},origin:'null',source:window}))")
                check(page.evaluate('wb.webBrowser.frame.connected'),'Forged parent message replaced live bridge')
                passed(origin+'-'+deployment+'-opaque-origin-security')
                page.evaluate("callVB('CancelNavigation')");page.evaluate("wb.Navigate('https://example.test/cancelled')");page.evaluate('wb.webBrowser.job')
                check(page.evaluate('wb.DocumentAvailable === -1 && wb.LocationURL === "about:blank"'),'ByRef Cancel lost')
                page.evaluate("wb.ExecuteScript('window.open(\"https://example.test/popup\")')")
                page.wait_for_function('!vb6Application.vm.processing && vb6Application.vm.eventQueue.length===0')
                check(page.evaluate("callVB('Popups')")==1,'Popup Cancel event missing');check(len(context.pages)==1,'Unrequested popup escaped')
                passed(origin+'-'+deployment+'-cancellable-events')
                navigate_html(page,'<title>One</title><p id="one">One</p>')
                check(page.evaluate("callVB('StaleDocumentError')")==91,'Old document handles not revoked')
                page.evaluate('globalThis.docBefore=wb.Document;globalThis.framesBefore=document.querySelectorAll("iframe").length')
                page.evaluate("wb.Navigate('#one')");page.evaluate('wb.webBrowser.job');settled(page)
                check(page.evaluate('wb.Document===docBefore && document.querySelectorAll("iframe").length===framesBefore'),'Fragment replaced document')
                navigate_html(page,'<title>Two</title><p>Two</p>')
                page.evaluate('wb.GoBack()');page.evaluate('wb.webBrowser.job');settled(page);check(page.evaluate('wb.LocationURL')=='about:blank#one','Back lost inline document history')
                page.evaluate('wb.Refresh()');page.evaluate('wb.webBrowser.job');settled(page);check(page.evaluate('wb.CanGoForward')==-1,'Refresh discarded forward history')
                page.evaluate('wb.GoForward()');page.evaluate('wb.webBrowser.job');settled(page);check(page.evaluate('wb.LocationName')=='Two','Forward restored wrong content')
                passed(origin+'-'+deployment+'-history-identity')
                before=page.evaluate("callVB('CompletionCount')")
                page.evaluate('vb6Application.vm.setState("paused");wb.NavigateToString("<title>Paused</title>")')
                page.wait_for_function('vb6Application.vm.eventQueue.length>0')
                check(page.evaluate('wb.LocationName')=='Two','Paused cancellation was bypassed')
                page.evaluate('vb6Application.vm.setState("idle");vb6Application.vm.processEvents()');page.evaluate('wb.webBrowser.job');settled(page)
                check(page.evaluate("callVB('CompletionCount')")==before+1,'Debugger pause discarded/duplicated completion')
                passed(origin+'-'+deployment+'-debugger-queue')
                if not INLINE and origin=='http':
                    for endpoint in [base+'/external','http://localhost:'+str(server.server_port)+'/external',base+'/external-denied']:
                        page.evaluate('(url)=>wb.Navigate(url)',endpoint);page.evaluate('wb.webBrowser.job');settled(page)
                        check(page.evaluate('wb.DocumentAvailable===0 && wb.NavigationStatus==="opaque"'),'External page falsely exposed DOM/success status')
                        check(page.evaluate("wb.ExecuteScript === undefined ? 0 : (()=>{try{wb.ExecuteScript('1');return 0}catch(e){return e.number}})()") ==70,'External document isolation failed')
                    passed(deployment+'-actual-same-cross-origin-CSP-XFO')
                pending=page.evaluate("async()=>{wb.NavigateToString('<title>Dispose</title>');await wb.webBrowser.job;wb.dispose();return wb.webBrowser.closed && !wb.node.isConnected;}")
                check(pending,'Control did not release frame');check(not errors,str(errors));passed(origin+'-'+deployment+'-dispose')
                context.close()
        # The actual bundled IDE: no page navigation during design, real event
        # declarations, renaming, sample loading and runtime adapter registration.
        context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page.set_default_timeout(30000)
        load(page,ROOT/'dist/VB6-Studio-Web.html' if INLINE else ROOT/'dist/index.html')
        page.wait_for_function('globalThis.vb6Studio?.controlRegistry?.has("WebBrowser",true)')
        page.evaluate('project=>vb6Studio.loadProject(project)',json.loads((FIXTURES/'project.json').read_text()))
        page.wait_for_function('vb6Studio.activeModule?.name === "BrowserForm"')
        check(page.locator('.vb-webbrowser iframe').count()==0,'Designer executed authored HTML')
        page.evaluate('vb6Studio.ensureEvent("WebBrowser1","NavigateError")')
        check(page.evaluate('vb6Studio.activeModule.code.includes("ByRef Cancel As Boolean")'),'Designer omitted cancellable declaration')
        check(page.evaluate('vb6Studio.controlRegistry.describe("WebBrowser").defaultEvent')=='DocumentComplete','Wrong default event')
        page.screenshot(path=str(REPORT/'designer.png'),full_page=True);passed('actual-IDE-toolbox-designer-events');context.close();browser.close()
finally:
    server.shutdown();server.server_close()
    (REPORT/'results.json').write_text(json.dumps({'browser':BROWSER,'supplementalInline':INLINE,'results':results},indent=2)+'\n')
print(f'{len(results)} WebBrowser integration cases passed ({BROWSER}).')

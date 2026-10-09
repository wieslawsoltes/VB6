#!/usr/bin/env python3
"""Real HTTP separate-origin AppBlock/MCP host tests. No opaque-origin substitute."""
from __future__ import annotations
import argparse, functools, http.server, json, os, re, shutil, subprocess, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default=os.environ.get('VB6_BROWSER', 'chromium'))
args = parser.parse_args()
report = ROOT / 'reports/intelligent-ui-host' / args.browser
report.mkdir(parents=True, exist_ok=True)
results, probes = [], []
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.startswith('/probe'): probes.append(self.path)
        if self.path == '/host-test.html':
            data = b'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/intelligent-ui.css"><main id="root"></main><script src="/intelligent-ui.js"></script>'
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(data); return
        super().do_GET()
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
bootstrap = """import fs from 'node:fs';import {createIntelligentUISandboxServer} from './tools/serve-intelligent-ui-sandbox.mjs';
const server=createIntelligentUISandboxServer({parentOrigin:process.env.TEST_PARENT_ORIGIN,html:fs.readFileSync('dist/intelligent-ui-sandbox.html','utf8')});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"""
companion = subprocess.Popen(['node', '--input-type=module', '-e', bootstrap], cwd=ROOT, env={**os.environ,'TEST_PARENT_ORIGIN':origin}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
def check(value, message):
    if not value: raise AssertionError(message)
def passed(name):
    results.append({'name':name,'passed':True}); print('PASS', name, flush=True)
try:
    port = int(companion.stdout.readline().strip())
    proxy = 'http://127.0.0.1:' + str(port) + '/intelligent-ui-sandbox.html'
    with sync_playwright() as p:
        options={'headless':True}
        if args.browser == 'chromium':
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable: options['executable_path']=executable
            options['args']=['--no-sandbox']
        browser=getattr(p,args.browser).launch(**options)
        try:
            page=browser.new_page(viewport={'width':1300,'height':1000});page.set_default_timeout(15000)
            page.goto(origin+'/host-test.html');page.wait_for_function('!!globalThis.IntelligentUI')
            page.evaluate('''({proxy,origin})=>{
              window.calls=[];window.messages=[];window.approvals=[];window.allowed=false;window.hostErrors=[];
              const raw='<h2>Isolated app</h2><button id="increment">Count: 0</button><button id="message">Send</button><button id="read">Read</button><button id="forbidden">Forbidden</button><output id="out"></output><script>'+`let n=0;increment.onclick=()=>increment.textContent='Count: '+(++n);message.onclick=()=>GenUI.issueNewTurn('Count '+n).then(()=>out.textContent='sent').catch(()=>out.textContent='denied');read.onclick=()=>GenUI.callTool('read',{}).then(v=>out.textContent=JSON.stringify(v)).catch(()=>out.textContent='denied');forbidden.onclick=()=>GenUI.callTool('model-only',{}).catch(()=>out.textContent='forbidden');let topBlocked=false,storageBlocked=false;try{parent.parent.document.body}catch{topBlocked=true}try{localStorage.getItem('dummy')}catch{storageBlocked=true}document.body.dataset.isolation=JSON.stringify({topBlocked,storageBlocked});fetch(${JSON.stringify(origin+'/probe-fetch')}).catch(()=>{document.body.dataset.fetchBlocked='yes'});const img=new Image();img.src=${JSON.stringify(origin+'/probe-image')};`+'<'+ '/script>';
              window.host=new IntelligentUI.McpAppHost(document.querySelector('#root'),{proxyUrl:proxy,html:IntelligentUI.appBlockDocument(raw),tools:[{name:'read'},{name:'model-only',_meta:{ui:{visibility:['model']}}}],callTool:(name,args)=>{calls.push(name);return {structuredContent:{value:42}};},onMessage:p=>messages.push(p),approve:action=>{approvals.push(action);return allowed;},onError:e=>hostErrors.push(e.message)});
            }''', {'proxy':proxy,'origin':origin})
            page.wait_for_function('host.ready')
            frame=page.frame_locator('#root > iframe').frame_locator('iframe')
            frame.get_by_role('button',name='Count: 0',exact=True).click()
            check(frame.locator('#increment').inner_text()=='Count: 1','Raw app did not execute in its inner frame')
            check(frame.locator('body').get_attribute('data-isolation')=='{"topBlocked":true,"storageBlocked":true}','Opaque view accessed IDE DOM or storage')
            expect(frame.locator('body')).to_have_attribute('data-fetch-blocked', 'yes')
            check(not probes,'Undeclared network probes reached the IDE origin')
            passed('separate-origin proxy, opaque app execution, DOM/storage and inherited CSP isolation')
            frame.get_by_role('button',name='Send',exact=True).click();frame.locator('#out').filter(has_text='denied').wait_for()
            check(page.evaluate('messages.length')==0,'Denied message reached host')
            page.evaluate('allowed=true');frame.get_by_role('button',name='Send',exact=True).click();frame.locator('#out').filter(has_text='sent').wait_for()
            check(page.evaluate('messages[0]')=={'role':'user','content':[{'type':'text','text':'Count 1'}]},'Reviewed message was not exact')
            passed('explicit approval blocks or delivers exact user-message envelopes')
            frame.get_by_role('button',name='Read',exact=True).click();frame.locator('#out').filter(has_text='42').wait_for()
            frame.get_by_role('button',name='Forbidden',exact=True).click();frame.locator('#out').filter(has_text='forbidden').wait_for()
            check(page.evaluate('calls')==['read'],'App called a model-only or unknown connection tool')
            passed('tool calls remain connection-scoped and enforce app visibility')
            page.evaluate('window.keptFrame=host.frame;host.setDisplayMode("pip")')
            check(page.locator('.iui-app-pip').count()==1,'PiP did not float the existing app')
            check(frame.locator('#increment').inner_text()=='Count: 1','PiP reloaded app state')
            page.get_by_role('button',name='Move floating app with arrow keys or drag',exact=True).press('ArrowLeft')
            page.evaluate('host.setDisplayMode("fullscreen")')
            page.get_by_role('button',name='Return app inline',exact=True).click()
            check(page.evaluate('host.frame===keptFrame&&host.display.mode==="inline"'),'Display transitions replaced the iframe')
            check(frame.locator('#increment').inner_text()=='Count: 1','Display transitions lost local state')
            passed('PiP, keyboard movement, fullscreen and inline preserve actual isolated app state')

            page.evaluate("host.updateHostContext({styles:{variables:{'--color-background-primary':'#123456'}}})")
            expect(frame.locator('body')).to_have_css('background-color', 'rgb(18, 52, 86)')
            passed('host theme updates reach the isolated app without replacing its state')
            page.evaluate('host.cancel()');frame.get_by_role('button',name='Send',exact=True).click();frame.locator('#out').filter(has_text='denied').wait_for()
            check(page.evaluate('messages.length')==1,'Cancelled app retained message authority')
            page.evaluate('host.dispose()');check(page.locator('#root iframe').count()==0,'Disposal left a live proxy')
            passed('cancellation revokes actions; disposal removes both frames')
            check(page.evaluate('''proxy=>{try{new IntelligentUI.McpAppHost(document.querySelector('#root'),{proxyUrl:location.origin+'/same',html:'x'});return false;}catch{return true;}}''',proxy),'Same-origin host accepted')
            passed('same-origin sandbox configuration is rejected')
            # Real generated MCP App resource, through the same header-enforced proxy.
            page.evaluate('''async proxy=>{
              const html=await (await fetch('/intelligent-ui-mcp.html')).text();window.source='{@body const [n,setN] = DIL.useState(3)}<slider label="App count" min={1} max={10} step={1} value={n} onChange={v=>setN(v)}/><metric value={n*10}/><Cite ref="inspection"/>';
              window.host=new IntelligentUI.McpAppHost(document.querySelector('#root'),{proxyUrl:proxy,html,onError:e=>hostErrors.push(e.message)});host.setToolInput({source});host.setToolResult({structuredContent:{ui:{id:'rendered',revision:1,title:'Rendered resource',source,data:{},references:{inspection:{kind:'citation',title:'Inspected module',details:'Exact source excerpt',provenance:{source:'vb6.module.read'}}}}}});
            }''',proxy)
            page.wait_for_function('host.ready');frame=page.frame_locator('#root > iframe').frame_locator('iframe')
            frame.get_by_role('slider',name='App count',exact=True).fill('7')
            frame.locator('.iui-metric-value').filter(has_text='70').wait_for()
            frame.get_by_text('Inspected module',exact=True).wait_for()
            passed('generated MCP resource loads via two origins and renders state plus pinned references')
            page.screenshot(path=str(report/'mcp-host.png'));page.evaluate('host.teardown()');check(page.locator('#root iframe').count()==0,'Teardown left resource mounted')
            check(not page.evaluate('hostErrors'),'MCP host reported errors: '+str(page.evaluate('hostErrors')))
            passed('generated MCP resource supports graceful teardown')
            # Both ends are real package transports, using a trusted test app.
            page.evaluate(r"""async proxy=>{
              const library=await (await fetch('/intelligent-ui.js')).text();window.toolChanges=0;
              const appScript=`globalThis.client=new IntelligentUI.McpAppClient({tools:[{name:'echo',inputSchema:{type:'object'}}],onToolCall:async(name,args)=>({content:[{type:'text',text:JSON.stringify(args)}],structuredContent:args})});client.connect();`;
              const html='<!doctype html><button id="change">Change tools</button><script>'+library.replace(/<\/script/gi,'<\\/script')+appScript+"document.getElementById('change').onclick=()=>client.setTools([{name:'updated',inputSchema:{type:'object'}}]);"+'<'+ '/script>';
              window.host=new IntelligentUI.McpAppHost(document.querySelector('#root'),{proxyUrl:proxy,html,onToolsChanged:()=>toolChanges++,onError:e=>hostErrors.push(e.message)});
            }""",proxy)
            page.wait_for_function('host.ready')
            check(page.evaluate('host.listAppTools()')['tools'][0]['name']=='echo','App tool catalogue was not returned')
            check(page.evaluate('host.callAppTool("echo",{selected:7})')['structuredContent']=={'selected':7},'App tool result changed in transit')
            page.frame_locator('#root > iframe').frame_locator('iframe').get_by_role('button',name='Change tools',exact=True).click()
            page.wait_for_function('toolChanges===1')
            check(page.evaluate('host.listAppTools()')['tools'][0]['name']=='updated','Tool list-changed notification did not refresh the catalogue')
            page.evaluate('host.teardown()')
            passed('actual app-exposed tool discovery, invocation, list changes and teardown')
            # Actual IDE integration, not a host test double.
            page.goto(origin+'/index.html');page.wait_for_function('!!vb6Studio?.intelligentUI')
            page.evaluate('''proxy=>{vb6Studio.intelligentUI.open();vb6Studio.intelligentUI.extensions.configure({url:proxy,enabled:true});}''',proxy)
            page.get_by_label('Intelligent UI example',exact=True).select_option('app');page.get_by_role('button',name='Load example',exact=True).click()
            page.get_by_role('button',name='Run isolated app',exact=True).click();page.get_by_role('button',name='Allow once',exact=True).click()
            app=page.frame_locator('.iui-playground-preview iframe').frame_locator('iframe')
            app.get_by_role('button',name='Count: 0',exact=True).click()
            check(app.get_by_role('button',name='Count: 1',exact=True).count()==1,'IDE app did not update')
            page.screenshot(path=str(report/'ide-app.png'))
            app.get_by_role('button',name='Ask agent',exact=True).click()
            page.get_by_role('button',name='Queue reviewed message',exact=True).wait_for()
            expect(app.locator('#delivery')).to_have_text('Awaiting review')
            page.get_by_role('button',name='Cancel',exact=True).last.click()
            expect(app.locator('#delivery')).to_have_text('Declined')
            check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==0,'Declined app message entered queue')
            app.get_by_role('button',name='Ask agent',exact=True).click()
            page.get_by_role('button',name='Queue reviewed message',exact=True).click()
            expect(app.locator('#delivery')).to_have_text('Queued')
            check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items[0].text')=='Explain counter 1','App did not await the reviewed exact message')
            passed('IDE AppBlock RPC awaits actual approval and propagates acceptance or denial')
            # Accepted follow-ups intentionally activate the agent's MDI window.
            # Reactivate the existing app window through the real IDE command;
            # do not force-click through the overlapping agent pane.
            page.evaluate('vb6Studio.intelligentUI.open()')
            expect(page.locator('[data-mdi-key="tool:intelligent-ui"]')).to_have_class(re.compile(r'\bmdi-active\b'))
            expect(app.get_by_role('button',name='Count: 1',exact=True)).to_be_visible()
            app.get_by_role('button',name='Ask agent',exact=True).click()
            page.get_by_role('button',name='Queue reviewed message',exact=True).wait_for()
            page.evaluate('vb6Studio.intelligentUI.setEnabled(false)')
            check(page.locator('.iui-playground-preview iframe').count()==0,'Disabling UI did not revoke running app')
            expect(page.get_by_role('button',name='Queue reviewed message',exact=True)).to_have_count(0)
            check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==1,'Revoked app completed a pending approval')
            passed('IDE AppBlock execution requires approval and revokes pending actions on feature disable')
            page.evaluate("""async()=>{
              vb6Studio.intelligentUI.setEnabled(true);vb6Studio.intelligentUI.open();const adapter=vb6Studio.mcp.adapter;adapter.setEnabled(true);
              window.downloadSource='<text>Exact reviewed UI source</text>';
              await adapter.tools.find(t=>t.name==='vb6.ui.present').execute({source:downloadSource,title:'Download fixture'},{principal:'download-owner'});
            }""")
            page.get_by_role('button',name='Open as MCP App',exact=True).last.click()
            download_app=page.frame_locator('.iui-gallery-item iframe').frame_locator('iframe')
            download_app.get_by_role('button',name='Download UI source',exact=True).click()
            with page.expect_download() as saved:
                page.get_by_role('button',name='Allow once',exact=True).click()
            artifact=saved.value
            check(artifact.suggested_filename=='source.dil','Unexpected source download name')
            check(Path(artifact.path()).read_text()==page.evaluate('downloadSource'),'Downloaded bytes differ from the reviewed UI source')
            passed('actual IDE MCP App source download requires approval and preserves exact bytes')
            downloads=[];page.on('download',lambda value: downloads.append(value))
            download_app.get_by_role('button',name='Download UI source',exact=True).click()
            page.get_by_role('button',name='Cancel',exact=True).last.click()
            expect(download_app.get_by_role('button',name='Download UI source',exact=True)).to_be_enabled()
            check(not downloads,'Declined source download wrote a file')
            page.get_by_role('button',name='Close MCP App',exact=True).last.click()
            check(page.locator('.iui-gallery-item iframe').count()==0,'Closing downloadable app left a live frame')
            passed('declined source downloads have no file effects and app disposal releases frames')
            page.close()
        finally: browser.close()
finally:
    companion.terminate();companion.wait(timeout=5);server.shutdown()
    (report/'results.json').write_text(json.dumps({'browser':args.browser,'transport':'real-HTTP-two-origins','cases':results},indent=2)+'\n')

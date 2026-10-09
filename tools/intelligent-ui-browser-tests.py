#!/usr/bin/env python3
"""Real IDE and package UI tests; no paid API, mocked success, or automatic navigation fallback.
Default exercises HTTP modules, HTTP standalone and file standalone. --opaque is
an explicitly labelled DOM/Worker-only mode for navigation-restricted environments.
"""
from __future__ import annotations
import argparse, functools, http.server, json, os, shutil, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--opaque', action='store_true')
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default=os.environ.get('VB6_BROWSER', 'chromium'))
args = parser.parse_args()
REPORT = ROOT / 'reports/intelligent-ui' / args.browser
REPORT.mkdir(parents=True, exist_ok=True)
results, browser_events = [], []
browser_identity = {}
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/intelligent-ui-test-host':
            data = b'<!doctype html><meta charset="utf-8"><iframe title="MCP test view" sandbox="allow-scripts" style="width:100%;height:650px"></iframe>'
            self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data); return
        super().do_GET()
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
def check(value, message):
    if not value: raise AssertionError(message)
def passed(name):
    results.append({'name': name, 'passed': True})
    print('PASS', name, flush=True)
def load(browser, mode):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.set_default_timeout(12000)
    page._errors = []
    page.on('pageerror', lambda e: page._errors.append(str(e)))
    if mode == 'opaque': page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text(), wait_until='domcontentloaded')
    elif mode == 'file': page.goto((ROOT / 'dist/VB6-Studio-Web.html').as_uri())
    else: page.goto(base + ('/index.html' if mode == 'modules' else '/VB6-Studio-Web.html'))
    page.wait_for_function('!!globalThis.vb6Studio?.intelligentUI')
    return page

def ide_cases(browser, mode):
    page = load(browser, mode)
    before = page.evaluate('JSON.stringify(vb6Studio.project)')
    page.evaluate('vb6Studio.intelligentUI.open()')
    page.wait_for_function('document.querySelector(".iui-metric-value")?.textContent==="232"')
    page.locator('.iui-playground-preview input[type=range]').fill('9')
    page.wait_for_function('document.querySelector(".iui-metric-value")?.textContent==="261"')
    check('worker' in page.locator('.iui-playground-preview .iui-status').inner_text(), 'Worker backend did not start')
    passed(mode + ': Worker-rendered calculator updates without a provider request')
    page.get_by_label('Intelligent UI example', exact=True).select_option('controls')
    page.get_by_role('button', name='Load example', exact=True).click()
    page.get_by_role('textbox', name='Your name', exact=True).fill('Grace')
    page.wait_for_function('document.querySelector(".iui-playground-preview").textContent.includes("Hello, Grace")')
    page.get_by_role('checkbox', name='Enable greeting', exact=True).uncheck()
    page.wait_for_function('document.querySelector(".iui-playground-preview").textContent.includes("Greeting disabled")')
    passed(mode + ': actual VB6 TextBox, CheckBox, Label and CommandButton adapters')
    page.evaluate('document.documentElement.dataset.ideTheme="fluent-dark"')
    check(page.evaluate('getComputedStyle(document.querySelector(".iui-root")).getPropertyValue("--iui-bg").trim()') != '#fff', 'Theme variables were not applied')
    page.evaluate('document.documentElement.dataset.ideTheme="classic"')
    passed(mode + ': IDE theme variables reach rich controls')
    page.evaluate('''async () => {
      const a=vb6Studio.mcp.adapter;a.setEnabled(true);
      const call=(name,args={})=>a.tools.find(t=>t.name===name).execute(args,{principal:'browser-owner'});
      const project=await call('vb6.project.get');window.boundProject=project;
      window.uiResult=await call('vb6.ui.present',{title:'Inspected project',source:'<metric label="Bound project" value={data.project.name} /><table label="Inspected modules" rows={data.project.documents} columns={[{key:"name",label:"Module"},{key:"kind",label:"Kind"}]} />',dataRefs:{project:'vb6.project.get'}});
    }''')
    page.wait_for_selector('.iui-gallery .iui-table table')
    check(page.locator('.iui-gallery').inner_text().find(page.evaluate('boundProject.name')) >= 0, 'Inspected binding missing')
    isolation = page.evaluate('''async()=>{try{await vb6Studio.mcp.adapter.tools.find(t=>t.name==='vb6.ui.read').execute({id:uiResult.ui.id},{principal:'other-owner'});return false;}catch{return true;}}''')
    check(isolation, 'A different principal could read UI data')
    page.evaluate('vb6Studio.mcp.setSharing(false)')
    page.wait_for_function('document.querySelectorAll(".iui-gallery-item").length===0')
    passed(mode + ': MCP binding provenance, principal isolation and sharing revocation')
    # Real public-thread streaming: the provider protocol is exercised independently in Node tests.
    source = '{@body const [n,setN] = DIL.useState(8)}<slider label="Thread seats" min={1} max={40} step={1} value={n} onChange={v => setN(v)} /><metric label="Thread total" value={n*29} /><button onClick={() => GenUI.issueNewTurn("Explain "+n+" seats")}>Queue UI follow-up</button>'
    text = 'Interactive explanation.\n```vb6-ui\n' + source
    page.evaluate('''text=>{vb6Studio.codingAgents.open();const a=vb6Studio.codingAgents.agent;a.requestId='ui-stream';a.emit('user',text);a.emit('status','Streaming');a.emit('delta',text);window.threadText=text;window.oldTask=vb6Studio.codingAgents.conversations.activeId;}''', text)
    page.locator('.agent-assistant input[type=range]').fill('11')
    page.wait_for_function('document.querySelector(".agent-assistant .iui-metric-value")?.textContent==="319"')
    check(page.locator('.agent-user .iui-root').count() == 0, 'User text was interpreted as an executable UI')
    page.evaluate(r'''()=>{const a=vb6Studio.codingAgents.agent;a.emit('delta','\n```\nThis is the text fallback.');a.emit('assistant',threadText+'\n```\nThis is the text fallback.');}''')
    page.wait_for_function('document.querySelector(".agent-assistant .iui-status")?.textContent.startsWith("Interactive")')
    check(page.locator('.agent-assistant input[type=range]').input_value() == '11', 'Stream replaced user state')
    passed(mode + ': explicit assistant fences stream, preserve state, and do not interpret user messages')
    page.get_by_role('button', name='Queue UI follow-up', exact=True).click()
    page.get_by_role('button', name='Cancel', exact=True).last.click()
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length') == 0, 'Cancelled action changed the queue')
    page.get_by_role('button', name='Queue UI follow-up', exact=True).click()
    page.get_by_role('button', name='Queue reviewed message', exact=True).click()
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items[0].text') == 'Explain 11 seats', 'Current interaction value did not reach reviewed action')
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests') == 0, 'UI action sent a provider request implicitly')
    passed(mode + ': actions require local review, cancellation is inert, no automatic send')
    page.evaluate('vb6Studio.intelligentUI.setEnabled(false)')
    page.wait_for_function('document.querySelectorAll(".agent-assistant .iui-root").length===0')
    page.evaluate('vb6Studio.intelligentUI.setEnabled(true)')
    page.wait_for_selector('.agent-assistant input[type=range]')
    check(page.locator('.agent-assistant input[type=range]').input_value() == '11', 'Toggle lost bounded local state')
    passed(mode + ': UI toggle releases renderers and restores local state')
    page.evaluate('vb6Studio.codingAgents.conversations.create("Second task")')
    page.wait_for_function('document.querySelectorAll(".agent-assistant .iui-root").length===0')
    page.evaluate('vb6Studio.codingAgents.conversations.select(oldTask)')
    page.wait_for_selector('.agent-assistant input[type=range]')
    check(page.locator('.agent-assistant input[type=range]').input_value() == '11', 'Task switching lost UI state')
    check(page.evaluate('JSON.stringify(vb6Studio.project)') == before, 'UI presentation mutated the VB6 project')
    passed(mode + ': task switching restores state without changing project data')
    # Reviewed rich messages/context use the actual IDE modal and queue, no provider network.
    page.evaluate("""()=>{window.richBytes='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA4QAAAAASUVORK5CYII=';window.richDone=false;vb6Studio.intelligentUI.action({type:'messageContent',args:[[{type:'text',text:'Review attached pixel'},{type:'image',mimeType:'image/png',data:richBytes}]]}).then(()=>richDone=true);} """)
    page.get_by_role('button',name='Queue reviewed message',exact=True).wait_for()
    check(page.locator('.iui-content-preview img').count()==1,'Review did not show the embedded image')
    page.get_by_role('button',name='Queue reviewed message',exact=True).click()
    page.wait_for_function('richDone')
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.at(-1).content[1].data===richBytes'),'Queue changed attachment bytes')
    passed(mode + ': reviewed rich content previews locally and retains exact queued bytes')
    for number in [1,2]:
        page.evaluate("""number=>{window.contextDone=false;vb6Studio.intelligentUI.action({type:'context',args:[{structuredContent:{selection:number}}]},{viewId:'browser-context'}).then(()=>contextDone=true);}""",number)
        page.get_by_role('button',name='Replace reviewed context',exact=True).click()
        page.wait_for_function('contextDone')
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.agent.uiContexts.snapshot().find(c=>c.id==="browser-context").structuredContent.selection')==2,'Model context did not replace the prior value')
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==2,'Context updates incorrectly appended follow-ups')
    page.evaluate('vb6Studio.intelligentUI.open()')
    page.get_by_role('button',name='Clear reviewed UI context',exact=True).click()
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.agent.uiContexts.entries.size')==0,'Clear context did not release view data')
    passed(mode + ': latest-wins reviewed context stays separate from the message queue')
    # Exercise actual confirmed queue delivery with a labelled protocol double.
    # No provider connection is made, and the unsent composer draft must survive.
    page.evaluate("""()=>{
      const panel=vb6Studio.codingAgents.open(),task=vb6Studio.codingAgents.conversations.active;
      panel.provider.value='openai';panel.connection.value='direct';panel.browserConsent.checked=true;
      panel.model.value='fixture';panel.keyInput.value='test-only-unused';panel.mode.value='readonly';panel.profileChanged();
      panel.prompt.value='Keep this unsent draft';task.draft=panel.prompt.value;window.deliveredBodies=[];
      panel.transportFactory=()=>async(body,{receive})=>{deliveredBodies.push(body);receive({status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}});};
      window.sendDone=false;panel.start(false,false,task.followups.items.at(-1).id).then(()=>sendDone=true);
    }""")
    page.get_by_role('button',name='Start Task',exact=True).click()
    page.wait_for_function('sendDone')
    check(page.evaluate('deliveredBodies.length===1&&JSON.stringify(deliveredBodies[0]).includes(richBytes)'), 'Confirmed provider body lost attachment bytes')
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==1,'Sent attachment was not removed exactly once from Queue')
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.draft')=='Keep this unsent draft','Sending queued media erased the unsent draft')
    passed(mode + ': confirmed rich queue delivery preserves bytes and draft with a protocol double')
    page.screenshot(path=str(REPORT / (mode + '-ide.png')))
    check(not page._errors, 'Uncaught IDE errors: ' + repr(page._errors))
    page.close()

def package_cases(browser):
    page = browser.new_page(viewport={'width': 1000, 'height': 800})
    page.set_default_timeout(12000)
    page.set_content('<main id="root"></main>')
    page.add_style_tag(content=(ROOT / 'dist/intelligent-ui.css').read_text())
    page.add_script_tag(content=(ROOT / 'dist/intelligent-ui.js').read_text())
    worker = (ROOT / 'dist/intelligent-ui-worker.js').read_text()
    page.evaluate('''worker=>{window.surface=new IntelligentUI.UISurface(document.querySelector('#root'),{workerSource:worker});}''', worker)
    page.evaluate('''()=>surface.update('{@body const [s,setS] = DIL.useState("abc")}<input key="field" label="Stable" value={s} onChange={v => setS(v)} /><text>{s}</text>')''')
    field = page.get_by_role('textbox', name='Stable', exact=True)
    field.fill('edited')
    page.wait_for_function('surface.result.tree.some(n=>n.children?.some(c=>c.text==="edited"))')
    page.evaluate('''()=>{window.field=document.querySelector('input');field.focus();field.setSelectionRange(1,3);return surface.update('{@body const [s,setS] = DIL.useState("new default")}<input key="field" label="Stable" value={s} onChange={v => setS(v)} /><text>{s}</text><caption>More text</caption>');}''')
    check(page.evaluate('document.querySelector("input")===field&&document.activeElement===field&&field.value==="edited"&&field.selectionStart===1&&field.selectionEnd===3'), 'Keyed update replaced input/caret')
    passed('package: Worker updates preserve input identity, focus, selection and edited values')
    page.evaluate('''()=>surface.update('<row><text key="keep">Keep</text></row>')''')
    page.evaluate('''()=>{window.kept=document.querySelector('.iui-text');return surface.update('<column><text key="keep">Keep</text></column>');}''')
    check(page.evaluate('document.querySelector(".iui-column .iui-text")===kept'), 'Replacing a parent lost retained children')
    passed('package: keyed descendants survive parent component replacement')
    page.evaluate('''()=>surface.update('<text>{data.payload}</text><image src="javascript:alert(1)"/><AppBlock><script>parent.hacked=true<\\/script></AppBlock>',{data:{payload:'<img src=x onerror="window.hacked=true">'}})''')
    check(page.locator('#root iframe,#root img,#root script').count() == 0, 'Untrusted content created active DOM')
    check(page.evaluate('globalThis.hacked===undefined'), 'Untrusted source executed')
    passed('package: interpolated HTML, script URLs and raw AppBlocks remain inert')
    outcome = page.evaluate('''async()=>{await surface.update('<text>Good</text>');try{await surface.update('{#each data.rows as row}<text>{data.text}</text>{/each}',{data:{rows:Array(100).fill(0),text:'x'.repeat(10000)}});return false;}catch{return document.querySelector('.iui-text')?.textContent==='Good';}}''')
    check(outcome, 'Failed evaluation did not retain last valid DOM')
    passed('package: aggregate rendering budget rejects expansion and preserves last valid view')
    coalesced = page.evaluate('''async()=>{const first=surface.update('<text>0</text>',{partial:true});let same=true;for(let i=1;i<=1000;i++)same&&=surface.update('<text>'+i+'</text>',{partial:true})===first;await first;return same&&document.querySelector('.iui-text').textContent==='1000';}''')
    check(coalesced, 'Stream updates did not share a bounded coalesced completion')
    passed('package: 1,000 partial updates coalesce into one pending completion')
    page.evaluate('''()=>surface.update('<table rows={data.rows} columns={["value"]}/><chart data={data.rows}/><chart label="Empty" data={[]}/>',{data:{rows:[{value:{}},{value:3},{value:null}]}})''')
    page.get_by_role('button', name='value', exact=True).click()
    check(page.locator('.iui-chart-view svg').count()==2, 'Malformed data or empty series broke chart rendering')
    passed('package: nested/null table values sort safely and empty charts remain valid')
    page.evaluate('''()=>{window.formActions=[];surface.options.onAction=action=>formActions.push(action);return surface.update('{@body const [choice,setChoice] = DIL.useState("a")}<form onSubmit={v=>GenUI.issueNewTurn(JSON.stringify(v))}><radio name="choice" label="Choice A" value="a" checked={choice==="a"} onChange={v=>setChoice(v)}/><radio name="choice" label="Choice B" value="b" checked={choice==="b"} onChange={v=>setChoice(v)}/><input name="count" label="Count" type="number" value={2}/><input name="ignored" disabled value="no"/><button submit>Submit form</button></form>');}''')
    page.get_by_role('radio', name='Choice B', exact=True).check()
    page.wait_for_function('surface.result.tree.some(n=>n.type==="form"&&n.children.some(c=>c.props.value==="b"&&c.props.checked))')
    page.get_by_role('button', name='Submit form', exact=True).click()
    page.wait_for_function('formActions.length===1')
    check(page.evaluate('JSON.parse(formActions[0].args[0])')=={'choice':'b','count':2}, 'Form submitted unchecked radios or disabled/incorrectly typed inputs')
    passed('package: form submission respects radio selection, numeric values and disabled inputs')
    custom = page.evaluate('''async worker=>{surface.dispose();const root=document.querySelector('#root');surface=new IntelligentUI.UISurface(root,{workerSource:worker,catalog:IntelligentUI.createCatalog({CustomNumber:{value:'number'}}),factories:{CustomNumber:({document})=>{const node=document.createElement('output');return {node,update:p=>{node.textContent=String(p.value);}};}}});await surface.update('<CustomNumber value={42}/>');return root.querySelector('output').textContent;}''', worker)
    check(custom == '42', 'Custom catalog did not reach Worker')
    passed('package: custom catalog/factory works across Worker boundary')
    compiled = page.evaluate('''async()=>{surface.dispose();document.querySelector('#root').style.width='900px';surface=new IntelligentUI.UISurface(document.querySelector('#root'),{workerSource:WORKER,responsive:false});const source='{@body const [n,setN] = DIL.useState(1)}<input key="sized" label="Responsive value" value={n} onChange={v=>setN(Number(v))}/><grid columns={DIL.useBreakpoint("md")?3:1}><text>{DIL.useViewport().width}</text></grid><metric label="Count" value={n} change="Ready"/><icon name="check" label="Confirmed"/>';await surface.updateCompiled(IntelligentUI.compile(source),{viewport:{width:900,height:600}});window.sized=document.querySelector('input');return document.querySelector('.iui-grid').style.gridTemplateColumns;}'''.replace('WORKER',json.dumps(worker)))
    check('3' in compiled, 'Compiled document did not render wide grid')
    page.get_by_role('textbox', name='Responsive value', exact=True).fill('7')
    page.wait_for_function('document.querySelector(".iui-metric-value").textContent==="7"')
    page.evaluate('surface.setViewport({width:400,height:600})')
    page.wait_for_function('document.querySelector(".iui-grid").style.gridTemplateColumns.startsWith("repeat(1")')
    check(page.evaluate('document.querySelector("input")===sized&&sized.value==="7"'), 'Responsive resize replaced input or lost state')
    check(page.get_by_role('img', name='Confirmed').count()==1, 'Trusted icon lacks accessible label')
    check(page.locator('.iui-metric-change').inner_text()=='Ready','Metric change not displayed')
    passed('package: precompiled Worker input, responsive resize, metric changes and accessible icons')
    watchdog = page.evaluate('''async()=>{const client=new IntelligentUI.UIClient({workerSource:'onmessage=()=>{for(;;){}}',timeout:80});try{await client.request('update',{source:'Hi'});return false;}catch(error){return error.code==='watchdog';}finally{client.dispose();}}''')
    check(watchdog, 'Watchdog did not terminate an unresponsive Worker')
    passed('package: Worker watchdog terminates runaway execution without replay')
    page.close()

def app_cases(browser):
    page = browser.new_page(viewport={'width': 900, 'height': 800})
    page.set_default_timeout(12000)
    # An actual MCP App host has an HTTP(S) origin. --opaque remains an explicit
    # local-only diagnostic; do not silently substitute it for deployment tests.
    if args.opaque: page.set_content('<iframe title="MCP test view" sandbox="allow-scripts" style="width:100%;height:650px"></iframe>')
    else: page.goto(base + '/intelligent-ui-test-host')
    page.on('crash', lambda: browser_events.append({'event':'app-page-crash'}))
    page.on('pageerror', lambda error: browser_events.append({'event':'app-page-error','message':str(error)}))
    page.evaluate('''html=>{
      const frame=document.querySelector('iframe');window.messages=[];window.toolSource='{@body const [n,setN] = DIL.useState(3)}<slider label="App count" min={1} max={10} step={1} value={n} onChange={v => setN(v)} /><metric label="App total" value={n*10}/><button onClick={() => GenUI.issueNewTurn("Explain "+n)}>Ask host</button>';
      window.sendApp=message=>frame.contentWindow.postMessage(message,'*');
      addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const m=event.data;messages.push(m);
        if(m.method==='ui/initialize')sendApp({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme:'dark',styles:{variables:{'--color-background-primary':'#111111','--color-text-primary':'#ffffff'}}}}});
        else if(m.method==='ui/notifications/initialized'){sendApp({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{source:toolSource}}});sendApp({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{ui:{version:1,id:'app',revision:1,title:'Test app',source:toolSource,data:{}}}}});}
        else if(m.id&&m.method)sendApp({jsonrpc:'2.0',id:m.id,result:{}});
      });frame.srcdoc=html;
    }''', (ROOT / 'dist/intelligent-ui-mcp.html').read_text())
    frame = page.frame_locator('iframe')
    frame.locator('input[type=range]').fill('7')
    check(frame.locator('.iui-metric-value').inner_text() == '70', 'MCP App did not update locally')
    frame.get_by_role('button', name='Ask host', exact=True).click()
    page.wait_for_function('messages.some(m=>m.method==="ui/message")')
    message = page.evaluate('messages.find(m=>m.method==="ui/message").params')
    check(message == {'role': 'user', 'content': [{'type': 'text', 'text': 'Explain 7'}]}, 'MCP App message envelope is not spec-shaped')
    check(page.evaluate('messages.some(m=>m.method==="ui/notifications/size-changed")'), 'No resize notification')
    passed('MCP App: initialize, tool input/result, local state, user message array and resize')
    page.evaluate('sendApp({jsonrpc:"2.0",method:"ui/notifications/tool-cancelled",params:{}})')
    frame.get_by_role('button', name='Ask host', exact=True).click()
    check(len(page.evaluate('messages.filter(m=>m.method==="ui/message")')) == 1, 'Cancelled tool view could issue host actions')
    passed('MCP App: cancellation blocks further host actions')
    page.evaluate('sendApp({jsonrpc:"2.0",id:"teardown",method:"ui/resource-teardown",params:{}})')
    page.wait_for_function('messages.some(m=>m.id==="teardown"&&m.result)')
    check(frame.locator('.iui-root').count() == 0, 'Teardown left a live surface')
    passed('MCP App: teardown disposes view and transport')
    page.close()

try:
    with sync_playwright() as p:
        launcher=getattr(p,args.browser)
        kwargs={'headless':True}
        if args.browser=='chromium':
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable: kwargs['executable_path']=executable
            kwargs['args']=['--no-sandbox']
        browser=launcher.launch(**kwargs)
        browser_identity={'version':browser.version,'options':kwargs}
        browser.on('disconnected', lambda: browser_events.append({'event':'browser-disconnected'}))
        try:
            for mode in (['opaque'] if args.opaque else ['modules','standalone','file']): ide_cases(browser,mode)
            package_cases(browser)
            app_cases(browser)
        finally: browser.close()
finally:
    server.shutdown()
    (REPORT/'results.json').write_text(json.dumps({'browser':args.browser,'transportMode':'opaque-document-only' if args.opaque else 'HTTP-and-file','cases':results,'browserIdentity':browser_identity,'browserEvents':browser_events},indent=2)+'\n')

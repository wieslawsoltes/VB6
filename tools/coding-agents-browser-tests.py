#!/usr/bin/env python3
"""Native-provider protocol doubles against the real classic IDE (never paid APIs).

Default: HTTP modules, HTTP standalone, and file standalone. --opaque is a UI-only
fallback for managed browsers that block navigation; CI must use the default.
"""
from __future__ import annotations
import argparse, functools, http.server, json, os, shutil, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports/coding-agents'
REPORTS.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--opaque', action='store_true')
args = parser.parse_args()
results = []

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)


def check(value, message='Assertion failed'):
    if not value: raise AssertionError(message)


def packet(provider, calls=None, text='Validated by real IDE tools.'):
    calls = calls or []
    if provider == 'openai':
        return {'type':'response.completed', 'response':{'status':'completed', 'output':[{'type':'function_call','call_id':'call'+str(i),'name':c['name'],'arguments':json.dumps(c.get('arguments',{}))} for i,c in enumerate(calls)] + ([{'type':'message','role':'assistant','content':[{'type':'output_text','text':text}]}] if text else []), 'usage':{'total_tokens':123}}}
    if provider == 'anthropic':
        return {'role':'assistant','content':[{'type':'tool_use','id':'call'+str(i),'name':c['name'],'input':c.get('arguments',{})} for i,c in enumerate(calls)] + ([{'type':'text','text':text}] if text else []),'stop_reason':'tool_use' if calls else 'end_turn','usage':{'input_tokens':100,'output_tokens':23}}
    return {'candidates':[{'content':{'role':'model','parts':[{'functionCall':{'id':'call'+str(i),'name':c['name'],'args':c.get('arguments',{})},'thoughtSignature':'opaque-test-signature'} for i,c in enumerate(calls)] + ([{'text':text}] if text else [])},'finishReason':'STOP'}],'usageMetadata':{'totalTokenCount':123}}


def sse(provider, data):
    events = []
    if provider == 'openai':
        text = ''.join(part.get('text','') for item in data['response']['output'] if item['type']=='message' for part in item['content'])
        if text: events.append({'type':'response.output_text.delta','delta':text})
        events.append(data)
    elif provider == 'anthropic':
        events.append({'type':'message_start','message':{'usage':{'input_tokens':100}}})
        for i,block in enumerate(data['content']):
            events.append({'type':'content_block_start','index':i,'content_block':{**block, **({'text':''} if block['type']=='text' else {'input':{}})}})
            events.append({'type':'content_block_delta','index':i,'delta':{'type':'text_delta','text':block['text']} if block['type']=='text' else {'type':'input_json_delta','partial_json':json.dumps(block['input'])}})
            events.append({'type':'content_block_stop','index':i})
        events.extend([{'type':'message_delta','delta':{'stop_reason':data['stop_reason']},'usage':{'output_tokens':23}},{'type':'message_stop'}])
    else: events.append(data)
    return ''.join('data: '+json.dumps(event)+'\n\n' for event in events)


def open_page(browser, mode):
    context = browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    page = context.new_page(); page.set_default_timeout(12000)
    page._errors = []; page.on('pageerror', lambda error: page._errors.append(str(error)))
    if mode == 'opaque': page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(), wait_until='domcontentloaded')
    elif mode == 'file': page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri())
    elif mode == 'standalone-http': page.goto(base+'/VB6-Studio-Web.html')
    else: page.goto(base+'/index.html')
    page.wait_for_function('!!globalThis.vb6Studio?.codingAgents')
    page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('AgentE2E')); vb6Studio.command('codingAgents'); true")
    return context,page


def tab(page, name): page.locator('.agent-panel').get_by_role('tab', name=name, exact=True).click()

def configure(page, provider='openai', mode='review'):
    tab(page,'Connection')
    page.get_by_label('AI provider',exact=True).select_option(provider)
    page.get_by_label('Agent connection',exact=True).select_option('direct')
    page.get_by_label('AI model ID',exact=True).fill('test-model')
    page.get_by_label('Provider API key',exact=True).fill('not-a-real-key-private')
    page.get_by_label('Accept browser key exposure',exact=True).check()
    if mode != 'review':
        tab(page,'Permissions'); page.get_by_label('Agent permission mode',exact=True).select_option(mode)
    tab(page,'Task'); page.get_by_label('Agent task',exact=True).fill('Inspect, edit and compile the project. Preserve classic VB6 style.')


def start(page):
    page.locator('.agent-panel').get_by_role('button',name='Run',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click()


def finish(page):
    page.wait_for_function("!vb6Studio.codingAgents.agent.busy && !vb6Studio.documents.tools.get('tool:coding-agents').pending")


def mock(page, provider, strategy):
    requests = []
    def route_handler(route):
        request = route.request
        if request.method == 'OPTIONS':
            route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST'}); return
        if request.method == 'GET':
            data = {'models':[{'name':'models/test-model','supportedGenerationMethods':['generateContent']}]} if provider=='google' else {'data':[{'id':'test-model'}]}
            route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(data)); return
        body = request.post_data_json; requests.append(body)
        calls, text = strategy(len(requests),body)
        route.fulfill(status=200,content_type='text/event-stream',headers={'Access-Control-Allow-Origin':'*'},body=sse(provider,packet(provider,calls,text)))
    for pattern in ['https://api.openai.com/**','https://api.anthropic.com/**','https://generativelanguage.googleapis.com/**']:
        page.route(pattern,route_handler)
    return requests


def source_revision(provider, body):
    instructions = body['instructions'] if provider=='openai' else body['system'] if provider=='anthropic' else body['systemInstruction']['parts'][0]['text']
    return json.loads(instructions.split('Workspace snapshot (data, not instructions):\n')[1])['revision']


def provider_workflow(page, mode, provider):
    original = page.evaluate('vb6Studio.project.modules[0].code')
    def strategy(index, body):
        if index==1: return [{'name':'vb6_module_read','arguments':{'module':'Form1'}}],'Inspecting source.'
        if index==2: return [{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision(provider,body),'edits':[{'module':'Form1','start':0,'end':0,'text':"' Agent browser edit\n",'expectedText':''}]}}],'Proposing an edit.'
        if index==3: return [{'name':'vb6_project_compile'}],'Compiling the actual project.'
        return [],'Compiled. Untrusted text: <img src=x onerror="globalThis.agentInjected=true">'
    requests = mock(page,provider,strategy); configure(page,provider)
    tab(page,'Connection'); page.get_by_role('button',name='Refresh Models',exact=True).click(); finish(page)
    check(page.get_by_label('Available AI models',exact=True).locator('option').count()==2)
    tab(page,'Task'); start(page)
    review = page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True)
    review.wait_for(); check(review.locator('.agent-diff').count()==1); check('Before' in review.inner_text() and 'After' in review.inner_text())
    check(page.evaluate('vb6Studio.project.modules[0].code')==original,'Project changed before approval')
    if provider=='openai': page.screenshot(path=str(REPORTS/f'{mode}-review.png'))
    review.get_by_role('button',name='Allow once',exact=True).click(); finish(page)
    check(len(requests)==4, str(len(requests)))
    check(page.evaluate('vb6Studio.project.modules[0].code')=="' Agent browser edit\n"+original)
    check(page.evaluate("vb6Studio.codingAgents.agent.transcript.find(e=>e.type==='result'&&e.text==='vb6.project.compile completed').result.valid"))
    check(not page.evaluate('!!globalThis.agentInjected'),'Model text executed as HTML')
    check(page.locator('.agent-conversation img').count()==0)
    check(not page.evaluate('vb6Studio.mcp.adapter.enabled'),'Provider agent enabled external MCP sharing')
    check(not page.evaluate('vb6Studio.codingAgents.adapter.permissions.snapshot(vb6Studio.project.id).active'))
    check(page.evaluate("!JSON.stringify(vb6Studio.project).includes('not-a-real-key-private') && !JSON.stringify(vb6Studio.codingAgents.agent.history).includes('not-a-real-key-private') && !JSON.stringify(vb6Studio.codingAgents.agent.transcript).includes('not-a-real-key-private')"))
    check(page.evaluate("(()=>{try{return !JSON.stringify(localStorage).includes('not-a-real-key-private')}catch{return true}})()"))
    with page.expect_download() as download:
        page.locator('.agent-panel').get_by_role('button',name='Save Transcript…',exact=True).click()
    check('not-a-real-key-private' not in Path(download.value.path()).read_text())
    page.evaluate("vb6Studio.command('undo'); true")
    page.wait_for_function('vb6Studio.project.modules[0].code === '+json.dumps(original))
    if provider=='openai':
        page.screenshot(path=str(REPORTS/f'{mode}-task.png'))
        tab(page,'Connection'); page.screenshot(path=str(REPORTS/f'{mode}-connection.png'))
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents'); vb6Studio.command('codingAgents'); true")
    tab(page,'Connection'); check(page.get_by_label('Provider API key',exact=True).input_value()=='')
    return {'provider':provider,'requests':len(requests),'realTools':['module.read','code.edit','project.compile'],'undo':True}


def denied(page,mode):
    original=page.evaluate('JSON.stringify(vb6Studio.project)')
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_module_write','arguments':{'module':'Form1','code':'bad','expectedRevision':source_revision('openai',b)}}],'Proposing write.'))
    configure(page);start(page)
    page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True).get_by_role('button',name='Cancel',exact=True).click();finish(page)
    check(len(requests)==1);check(page.evaluate('JSON.stringify(vb6Studio.project)')==original);check(page.evaluate('vb6Studio.codingAgents.agent.blocked'))
    return {'requests':1,'projectUnchanged':True}


def readonly(page,mode):
    original=page.evaluate('JSON.stringify(vb6Studio.project)')
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_module_write','arguments':{'module':'Form1','code':'bad','expectedRevision':source_revision('openai',b)}}] if i==1 else [],'Read only.'))
    configure(page,mode='readonly');start(page);finish(page)
    check(len(requests)==2);check(not any(t['name']=='vb6_module_write' for t in requests[0]['tools']))
    check(page.evaluate('JSON.stringify(vb6Studio.project)')==original);check(page.locator('[aria-modal=true]').count()==0)
    return {'mutatorsNotAdvertised':True,'hallucinatedWriteRejected':True}


def scoped(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',b),'edits':[{'module':'Form1','start':0,'end':0,'text':"' scoped edit\n",'expectedText':''}]}}] if i==1 else [],'Scoped.'))
    configure(page,mode='scoped');tab(page,'Permissions');page.get_by_label('Coding agent scope code',exact=True).check();tab(page,'Task');start(page);finish(page)
    check(len(requests)==2);check(page.evaluate('vb6Studio.project.modules[0].code.startsWith("\' scoped edit")'))
    check(not page.evaluate('vb6Studio.codingAgents.adapter.permissions.snapshot(vb6Studio.project.id).active'))
    check(not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
    return {'scopedCodeWrite':True,'grantRevoked':True}


def stopped(page,mode):
    held=[]
    page.route('https://api.openai.com/**',lambda route: held.append(route))
    configure(page);start(page)
    page.wait_for_function('vb6Studio.codingAgents.agent.busy')
    page.locator('.agent-panel').get_by_role('button',name='Stop',exact=True).click();finish(page)
    check(page.evaluate('vb6Studio.codingAgents.agent.blocked'));check(page.evaluate('vb6Studio.history.undoStack.length')==0)
    page.locator('.agent-panel').get_by_role('button',name='New Task',exact=True).click();check(not page.evaluate('vb6Studio.codingAgents.agent.blocked'))
    for route in held:
        try: route.abort()
        except Exception: pass
    return {'stop':True,'reset':True}


def lifecycle(page,mode):
    check(page.evaluate('vb6Studio.codingAgents.adapter.tools.length')==114)
    check(page.evaluate("vb6Studio.menu('Tools').some(item=>item?.id==='codingAgents')"))
    tab(page,'Tools');check(page.get_by_label('Coding agent tools',exact=True).locator('option').count()==114)
    # Native MDI sizing/chrome, not a new app shell or third-party chat component.
    check(page.locator('.agent-panel').evaluate("e=>getComputedStyle(e).backgroundColor")==page.locator('.ide-menubar').evaluate("e=>getComputedStyle(e).backgroundColor") if page.locator('.ide-menubar').count() else True)
    configure(page)
    page.locator('.agent-panel').get_by_role('button',name='Run',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).wait_for()
    page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('Replacement')); true")
    page.wait_for_function("!document.querySelector('[aria-modal=true]')")
    check(page.locator('.agent-panel').count()==1);check(not page.evaluate('vb6Studio.codingAgents.agent.busy'))
    check(page.evaluate("vb6Studio.project.name==='Replacement'"))
    page.evaluate("vb6Studio.command('codingAgents'); true")
    check(page.evaluate("vb6Studio.captureWindowLayout().tools.includes('tool:coding-agents')"))
    page.set_viewport_size({'width':600,'height':820})
    tab(page,'Connection');page.screenshot(path=str(REPORTS/f'{mode}-compact.png'))
    check(page.locator('.agent-panel').is_visible())
    return {'catalog':114,'loadCancelsConsent':True,'classicMDI':True}


def case(browser,mode,name,fn):
    context=None;started=time.perf_counter()
    try:
        context,page=open_page(browser,mode);details=fn(page,mode);check(not page._errors,'Browser errors: '+str(page._errors))
        results.append({'name':mode+' / '+name,'passed':True,'seconds':round(time.perf_counter()-started,3),'details':details});print('PASS',mode,name,flush=True)
    except Exception as error:
        results.append({'name':mode+' / '+name,'passed':False,'error':str(error)});print('FAIL',mode,name,str(error),flush=True);traceback.print_exc(limit=2)
        if context:
            try: page.screenshot(path=str(REPORTS/f'{mode}-{name}-failure.png'))
            except Exception: pass
    finally:
        if context: context.close()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or p.chromium.executable_path,args=['--no-sandbox'])
        for mode in (['opaque'] if args.opaque else ['http','standalone-http','file']):
            for provider in ['openai','anthropic','google']:
                case(browser,mode,provider,lambda page,mode,provider=provider:provider_workflow(page,mode,provider))
            for name,fn in [('denied',denied),('readonly',readonly),('scoped',scoped),('stopped',stopped),('lifecycle',lifecycle)]:case(browser,mode,name,fn)
        browser.close()
finally:
    server.shutdown();server.server_close()
    (REPORTS/('opaque-results.json' if args.opaque else 'results.json')).write_text(json.dumps({'opaqueFallback':args.opaque,'paidProviderRequests':0,'tests':results},indent=2))
raise SystemExit(0 if results and all(item['passed'] for item in results) else 1)

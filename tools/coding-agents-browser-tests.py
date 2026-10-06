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
parser.add_argument('--browser', choices=['chromium','firefox','webkit'], default='chromium')
args = parser.parse_args()
REPORTS = REPORTS / args.browser
REPORTS.mkdir(parents=True, exist_ok=True)
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
        result = strategy(len(requests),body)
        if isinstance(result, dict):
            route.fulfill(status=result['http_status'],headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Retry-After','Retry-After':str(result.get('retry_after',0))},body=''); return
        calls, text = result
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
    check(page.evaluate('vb6Studio.codingAgents.adapter.tools.length')==125)
    check(page.evaluate("vb6Studio.menu('Tools').some(item=>item?.id==='codingAgents')"))
    tab(page,'Tools');check(page.get_by_label('Coding agent tools',exact=True).locator('option').count()==127)
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
    return {'catalog':125,'loadCancelsConsent':True,'classicMDI':True}


def plan_question(page, mode, provider):
    def strategy(index, body):
        if index==1: return [{'name':'vb6_agent_plan','arguments':{'expectedPlanRevision':0,'steps':[{'id':'inspect','title':'Inspect the project','status':'in_progress'},{'id':'compile','title':'Compile and report','status':'pending'}]}}], 'I will inspect and compile.'
        if index==2: return [{'name':'vb6_agent_question','arguments':{'question':'Which form should I inspect? <img src=x onerror="window.injected=true">','options':['Customer','Invoice']}}], 'One question.'
        if index==3:
            check('Customer' in json.dumps(body)); return [{'name':'vb6_project_compile'}], 'Checking diagnostics.'
        if index==4: return [{'name':'vb6_agent_plan','arguments':{'expectedPlanRevision':1,'steps':[{'id':'inspect','title':'Inspect the project','status':'completed'},{'id':'compile','title':'Compile and report','status':'completed'}]}}], 'Compiler checked.'
        return [],'Done.'
    requests=mock(page,provider,strategy); configure(page,provider,mode='readonly'); start(page)
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Question',exact=True)
    dialog.wait_for(); check(dialog.get_by_role('button',name='Send Answer').is_disabled())
    check(dialog.locator('img').count()==0); check(not page.evaluate('!!window.injected'))
    page.get_by_label('Suggested answers',exact=True).select_option('Customer')
    check(page.get_by_label('Answer to agent',exact=True).input_value()=='Customer')
    if provider=='openai': page.screenshot(path=str(REPORTS/f'{mode}-question.png'))
    dialog.get_by_role('button',name='Send Answer',exact=True).click(); finish(page)
    check(len(requests)==5); check(page.evaluate('vb6Studio.codingAgents.agent.plan.revision')==2)
    conversation=page.get_by_label('Agent conversation',exact=True).text_content()
    check('Which form should I inspect?' in page.locator('.agent-question .agent-message-body').inner_text())
    check('Customer' in page.locator('.agent-user').last.inner_text())
    check(conversation.index('Agent question') < conversation.index('Your answer'))
    check(page.get_by_label('Agent conversation',exact=True).locator('img').count()==0)
    tab(page,'Tasks');page.get_by_role('button',name='New Task with Context…',exact=True).click()
    context_dialog=page.get_by_role('dialog',name='AI Coding Agent — Review Context',exact=True);context_dialog.wait_for()
    context=page.get_by_label('Reviewed task context',exact=True).input_value()
    check('Agent question:\nWhich form should I inspect?' in context)
    check('User answer:\nCustomer' in context)
    check(context.index('Agent question:') < context.index('User answer:'))
    context_dialog.get_by_role('button',name='Cancel',exact=True).click()
    check(len(requests)==5)
    tab(page,'Plan'); check(page.get_by_label('Agent task plan',exact=True).locator('li[data-status=completed]').count()==2)
    check(page.evaluate('vb6Studio.history.undoStack.length')==0)
    check(not page.evaluate('vb6Studio.codingAgents.adapter.permissions.snapshot(vb6Studio.project.id).active'))
    if provider=='openai': page.screenshot(path=str(REPORTS/f'{mode}-plan.png'))
    return {'provider':provider,'planRevision':2,'questionAnswered':True,'readOnly':True}


def task_switching(page, mode):
    requests=mock(page,'openai',lambda i,b:([], 'First task answer.' if i==1 else 'Second task answer.'))
    configure(page);start(page);finish(page)
    first=page.evaluate('vb6Studio.codingAgents.conversations.activeId')
    check(page.get_by_label('Agent task',exact=True).input_value()=='')
    page.get_by_label('Agent task',exact=True).fill('Unsent first draft')
    page.locator('.agent-panel').get_by_role('button',name='New Task',exact=True).click()
    second=page.evaluate('vb6Studio.codingAgents.conversations.activeId'); check(first!=second)
    page.get_by_label('Agent task',exact=True).fill('Second independent task.');start(page);finish(page)
    check(len(requests)==2);check('First task answer.' not in json.dumps(requests[1]))
    tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first)
    page.get_by_label('Task name',exact=True).fill('First task renamed');page.get_by_role('button',name='Rename',exact=True).click()
    tab(page,'Task');check(page.get_by_label('Agent task',exact=True).input_value()=='Unsent first draft')
    check('First task answer.' in page.get_by_label('Agent conversation',exact=True).inner_text())
    check('Second task answer.' not in page.get_by_label('Agent conversation',exact=True).inner_text())
    tab(page,'Tasks');page.get_by_role('button',name='New Task with Context…',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Review Context',exact=True);dialog.wait_for()
    check('First task answer.' in page.get_by_label('Reviewed task context',exact=True).input_value())
    check('not-a-real-key-private' not in page.get_by_label('Reviewed task context',exact=True).input_value())
    page.get_by_label('Reviewed task context',exact=True).fill('Reviewed public background only.')
    dialog.get_by_role('button',name='Create Task',exact=True).click()
    check(len(requests)==2);check(page.get_by_label('Agent tasks',exact=True).locator('option').count()==3)
    tab(page,'Task');check('Reviewed public background only.' in page.get_by_label('Agent task',exact=True).input_value())
    check(page.evaluate('vb6Studio.codingAgents.agent.history.length')==0)
    tab(page,'Tasks');page.screenshot(path=str(REPORTS/f'{mode}-tasks.png'))
    page.get_by_role('button',name='Delete Task…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Delete Task',exact=True).get_by_role('button',name='Delete Task',exact=True).click()
    check(page.get_by_label('Agent tasks',exact=True).locator('option').count()==2)
    check(len(requests)==2)
    return {'independentTasks':2,'draftRestored':True,'reviewedContext':True,'noImplicitRequests':True}


def limited_resume(page, mode):
    original=page.evaluate('vb6Studio.project.modules[0].code')
    def strategy(index,body):
        if index==1:return [{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',body),'edits':[{'module':'Form1','start':0,'end':0,'text':"' once\n",'expectedText':''}]}}], 'Edit once.'
        check(sum(1 for item in body['input'] if item.get('role')=='user')==1)
        check(any(item.get('type')=='function_call_output' for item in body['input']))
        return [],'Continued without replay.'
    requests=mock(page,'openai',strategy);configure(page)
    tab(page,'Permissions');page.get_by_label('Maximum agent requests',exact=True).fill('1');tab(page,'Task');start(page)
    page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True).get_by_role('button',name='Allow once',exact=True).click();finish(page)
    check(page.evaluate('vb6Studio.codingAgents.agent.state')=='limit');check(len(requests)==1)
    check(page.get_by_label('Agent task',exact=True).input_value()=='')
    page.locator('.agent-panel').get_by_role('button',name='Continue',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True).get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(len(requests)==2);check(page.evaluate('vb6Studio.project.modules[0].code')=="' once\n"+original)
    check(page.evaluate('vb6Studio.history.undoStack.length')==1)
    check(page.locator('.agent-panel').get_by_role('button',name='Continue',exact=True).is_disabled())
    return {'oneUndoEntry':True,'noDuplicatePrompt':True,'continued':True}


def request_retry(page,mode):
    original=page.evaluate('vb6Studio.project.modules[0].code')
    def strategy(index,body):
        if index==1:return [{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',body),'edits':[{'module':'Form1','start':0,'end':0,'text':"' retry once\n",'expectedText':''}]}}], 'Edit once.'
        if index==2:return {'http_status':429,'retry_after':2}
        check(any(item.get('type')=='function_call_output' for item in body['input']))
        return [],'Recovered.'
    requests=mock(page,'openai',strategy);configure(page)
    tab(page,'Permissions');page.get_by_label('Automatic generation retries',exact=True).fill('0');tab(page,'Task');start(page)
    page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True).get_by_role('button',name='Allow once',exact=True).click();finish(page)
    check(page.evaluate('vb6Studio.codingAgents.agent.state')=='retry');check(len(requests)==2)
    check(not page.evaluate('vb6Studio.codingAgents.adapter.enabled'))
    page.wait_for_timeout(100);check(len(requests)==2)
    page.locator('.agent-panel').get_by_role('button',name='Continue',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True)
    check('2 seconds' in dialog.inner_text());dialog.get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(len(requests)==3);check(page.evaluate('vb6Studio.project.modules[0].code')=="' retry once\n"+original)
    check(page.evaluate('vb6Studio.history.undoStack.length')==1)
    return {'manualRetry':True,'automaticRetries':0,'editAppliedOnce':True}


def question_cancel(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_agent_question','arguments':{'question':'What should I do next?'}}], 'Please clarify.'))
    configure(page);start(page)
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Question',exact=True);dialog.wait_for()
    dialog.get_by_role('button',name='Cancel',exact=True).click();finish(page)
    check(len(requests)==1);check(page.evaluate('vb6Studio.codingAgents.agent.blocked'))
    check(page.locator('.agent-panel').get_by_role('button',name='Continue',exact=True).is_disabled())
    return {'cancelStopsTask':True,'noPermissionGranted':True}

def live_thread(page, mode):
    configure(page, mode='readonly')
    page.evaluate("""() => {
      const api = vb6Studio.codingAgents, panel = vb6Studio.documents.tools.get('tool:coding-agents');
      window.threadRequests = [];
      panel.transportFactory = () => async (body, {signal, receive}) => new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, {once:true});
        window.threadRequests.push({body, receive, done: () => {signal.removeEventListener('abort',abort);resolve();}});
      });
      api.adapter.tools.push({name:'vb6.test.slow',description:'Test read-only progress',annotations:{readOnlyHint:true},inputSchema:{type:'object'},execute:() => new Promise(resolve => {window.finishSlowTool = () => resolve({revision:api.adapter.revision,confirmed:true});})});
    }""")
    start(page); page.wait_for_function('threadRequests.length === 1')
    page.locator('.agent-assistant[data-status=waiting]').wait_for(state='visible')
    page.evaluate('(p) => {threadRequests[0].receive(p);threadRequests[0].done();}', packet('openai',[{'name':'vb6_test_slow'}],''))
    tool = page.locator('.agent-tool[data-status=running]'); tool.wait_for(state='visible')
    check('vb6.test.slow' in tool.inner_text()); check(page.locator('.agent-panel').get_by_role('tab',name='Task',exact=True).get_attribute('aria-selected')=='true')
    page.screenshot(path=str(REPORTS/f'{mode}-thread-running.png'))
    page.evaluate('finishSlowTool()'); page.wait_for_function('threadRequests.length === 2')
    page.locator('.agent-tool[data-status=complete]').locator('summary').click()
    page.evaluate("threadRequests[1].receive({type:'response.output_text.delta',delta:'Reading Form1. '})")
    page.wait_for_function("document.querySelector('.agent-assistant[data-status=streaming]')?.textContent.includes('Reading Form1.')")
    page.evaluate("window.fixedTool = document.querySelector('.agent-tool'); threadRequests[1].receive({type:'response.output_text.delta',delta:'Checking its event handlers.'})")
    page.wait_for_function("document.querySelector('.agent-assistant[data-status=streaming]')?.textContent.includes('event handlers.')")
    check(page.evaluate("fixedTool === document.querySelector('.agent-tool') && fixedTool.open"))
    prompt=page.get_by_label('Agent task',exact=True); prompt.fill('Unsent follow-up while streaming')
    check(not prompt.is_disabled()); page.screenshot(path=str(REPORTS/f'{mode}-thread-streaming.png'))
    page.get_by_role('button',name='Stop generation',exact=True).click(); finish(page)
    partial=page.locator('.agent-assistant[data-status=interrupted]'); check('Reading Form1. Checking its event handlers.' in partial.inner_text())
    check(prompt.input_value()=='Unsent follow-up while streaming')
    check(page.evaluate('vb6Studio.codingAgents.agent.unreportedRequests')==1)
    with page.expect_download() as download: page.get_by_role('button',name='Save Transcript…',exact=True).click()
    exported=json.loads(Path(download.value.path()).read_text()); check(exported['version']==2)
    check(any(e['status']=='interrupted' and 'Reading Form1.' in e['text'] for e in exported['thread']['entries']))
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents')")
    check('Reading Form1. Checking its event handlers.' in page.get_by_label('Agent conversation',exact=True).inner_text())
    check(page.get_by_label('Agent task',exact=True).input_value()=='Unsent follow-up while streaming')
    return {'toolOnlyProgress':True,'streamedBeforeCompletion':True,'stableExpandedTool':True,'partialRetainedOnStopAndReopen':True,'draftWhileRunning':True,'exportedPartial':True}


def thread_reading(page,mode):
    page.evaluate("""() => {
      const agent=vb6Studio.codingAgents.agent;
      for(let i=0;i<100;i++) {
        agent.emit('user','Message '+i);
        agent.emit('status','Request '+i,{requestId:'test'+i});
        agent.emit('assistant','Reply '+i+'\\nA completed response stays selectable.',{requestId:'test'+i});
      }
    }""")
    page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===150")
    log=page.get_by_label('Agent conversation',exact=True)
    check(log.evaluate('e=>e.scrollHeight-e.scrollTop-e.clientHeight')<=2)
    page.evaluate("""() => {
      const panel=vb6Studio.documents.tools.get('tool:coding-agents'), log=panel.log;
      window.unchangedReply=document.querySelectorAll('.agent-assistant')[10];
      const range=document.createRange();range.selectNodeContents(unchangedReply.querySelector('.agent-message-body'));getSelection().removeAllRanges();getSelection().addRange(range);window.selectedReply=getSelection().toString();
      log.scrollTop=0;log.dispatchEvent(new Event('scroll'));window.readingTop=log.scrollTop;
      panel.api.agent.emit('status','Request new',{requestId:'new'});
      for(let i=0;i<50;i++)panel.api.agent.emit('delta','New text '+i+' ',{requestId:'new'});
    }""")
    page.get_by_role('button',name='Jump to latest (1 new)',exact=True).wait_for(state='visible')
    check(page.evaluate('unchangedReply.isConnected && getSelection().toString()===selectedReply'))
    check(log.evaluate('e=>Math.abs(e.scrollTop-readingTop)')<2)
    page.get_by_role('button',name='Show earlier messages',exact=True).click()
    page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===200")
    check(log.evaluate('e=>e.scrollTop')>0)
    page.get_by_role('button',name='Jump to latest (1 new)',exact=True).click()
    page.wait_for_function("document.querySelector('.agent-assistant[data-status=streaming]')?.textContent.includes('New text 49')")
    check(log.evaluate('e=>e.scrollHeight-e.scrollTop-e.clientHeight')<=2)
    page.evaluate("vb6Studio.codingAgents.agent.emit('assistant','New text completed',{requestId:'new'})")
    page.wait_for_function("!document.querySelector('.agent-assistant[data-status=streaming]')")
    check(page.locator('.agent-thread-entry').count()<=250)
    page.screenshot(path=str(REPORTS/f'{mode}-thread-history.png'))
    return {'keyedSelectionPreserved':True,'manualScrollPreserved':True,'loadEarlier':True,'jumpToLatest':True,'boundedDom':True}


def thread_formatting(page,mode):
    text='## Source review\n**Safe text** and `Form1`.\n\n```vb\nPrivate Sub Form_Load()\n    MsgBox "Hello"\nEnd Sub\n```\n\n<img src=x onerror="window.injected=true">\n[Unsafe](javascript:alert(1)) [Docs](https://example.com/docs)'
    page.evaluate("t=>{const a=vb6Studio.codingAgents.agent;a.emit('status','Formatting',{requestId:'format'});a.emit('assistant',t,{requestId:'format'});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.copiedText=text}}});}",text)
    page.get_by_role('button',name='Copy code',exact=True).wait_for(state='visible')
    check(page.locator('.agent-message-body img').count()==0);check(not page.evaluate('!!window.injected'))
    check(page.locator('.agent-message-body a').count()==1);check(page.locator('.agent-message-body a').get_attribute('rel')=='noopener noreferrer')
    page.get_by_role('button',name='Copy code',exact=True).click();page.wait_for_function('window.copiedText?.startsWith("Private Sub Form_Load()")')
    page.get_by_role('button',name='Copy message',exact=True).click();page.wait_for_function('window.copiedText === '+json.dumps(text))
    page.screenshot(path=str(REPORTS/f'{mode}-thread-formatted.png'))
    # The thread inherits the IDE palette; it does not load a separate chat theme.
    check(page.locator('.agent-panel').evaluate('e=>getComputedStyle(e).backgroundColor')==page.locator('.agent-user').evaluate('e=>getComputedStyle(e).backgroundColor') if page.locator('.agent-user').count() else True)
    return {'safeMarkdown':True,'noModelHtml':True,'safeLinksOnly':True,'copyCodeAndMessage':True}


def budget_preferences(page,mode):
    tab(page,'Permissions');budget=page.get_by_label('Session token budget',exact=True)
    check(budget.input_value()=='4000000');check(page.get_by_label('Maximum agent requests',exact=True).input_value()=='128')
    page.get_by_label('Agent limit preset',exact=True).select_option('large')
    check(budget.input_value()=='20000000');check(page.get_by_label('Maximum output tokens',exact=True).input_value()=='65536')
    budget.fill('0');budget.dispatch_event('change');check('must be an integer' in page.locator('.agent-limit-error').inner_text())
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.limits.tokenBudget')==20000000)
    budget.fill('9999999');budget.dispatch_event('change');check(page.get_by_label('Agent limit preset',exact=True).input_value()=='custom')
    first=page.evaluate('vb6Studio.codingAgents.conversations.activeId')
    page.get_by_role('button',name='New Task',exact=True).click();check(budget.input_value()=='9999999')
    budget.fill('3000000');budget.dispatch_event('change');tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first)
    tab(page,'Permissions');check(budget.input_value()=='9999999')
    if mode in ['http','standalone-http']:
        stored=page.evaluate("JSON.parse(localStorage.getItem('vb6.codingAgents.limits.v1'))")
        check(set(stored.keys())=={'version','limits'});check(all(isinstance(v,int) for v in stored['limits'].values()))
        page.reload();page.wait_for_function('!!globalThis.vb6Studio?.codingAgents');page.evaluate("vb6Studio.command('codingAgents')")
        tab(page,'Permissions');check(page.get_by_label('Session token budget',exact=True).input_value()=='3000000')
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.tokens')==0)
    page.screenshot(path=str(REPORTS/f'{mode}-session-limits.png'))
    return {'default20x':True,'presets':True,'invalidRejected':True,'independentTaskLimits':True,'numericOnlyPersistence':mode in ['http','standalone-http']}


def composer_keyboard(page,mode):
    requests=mock(page,'openai',lambda i,b:([],'Reply to keyboard send.'));configure(page)
    prompt=page.get_by_label('Agent task',exact=True);prompt.fill('First line');prompt.press('Shift+Enter');prompt.press('a')
    check(prompt.input_value()=='First line\na');check(page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).count()==0)
    prompt.dispatch_event('keydown',{'key':'Enter','isComposing':True});check(page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).count()==0)
    prompt.press('Enter');page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==1);check('First line\na' in json.dumps(requests).replace('\\n','\n'))
    check(prompt.input_value()=='');check(page.locator('.agent-assistant').count()==1)
    return {'enterSends':True,'shiftEnterNewline':True,'imeDoesNotSend':True}


def thread_catch_up(page,mode):
    page.evaluate("""() => {
      const agent=vb6Studio.codingAgents.agent;
      for(let i=0;i<40;i++){agent.emit('user','Read '+i);agent.emit('status','Request',{requestId:'read'+i});agent.emit('assistant','Reply '+i,{requestId:'read'+i});}
    }""")
    page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===80")
    log=page.get_by_label('Agent conversation',exact=True)
    log.evaluate("e=>{e.scrollTop=100;e.dispatchEvent(new Event('scroll'));}")
    page.evaluate("const a=vb6Studio.codingAgents.agent;a.emit('status','new',{requestId:'after-reading'});a.emit('assistant','New final reply',{requestId:'after-reading'});")
    page.get_by_role('button',name='Jump to latest (1 new)',exact=True).wait_for(state='visible')
    check(page.locator('[data-entry-id="response:after-reading"]').count()==0)
    log.evaluate("e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));}")
    page.wait_for_function("document.querySelector('[data-entry-id=\"response:after-reading\"]')?.textContent.includes('New final reply')")
    check(log.evaluate('e=>e.scrollHeight-e.scrollTop-e.clientHeight')<=2)
    check(page.evaluate("vb6Studio.documents.tools.get('tool:coding-agents').threadView.follow"))
    return {'finishedRepliesRevealWithoutAnotherEvent':True,'bottomRestoresFollowing':True}


def thread_return(page,mode):
    first=page.evaluate("""() => {
      const api=vb6Studio.codingAgents,a=api.agent;
      a.emit('status','read',{requestId:'remember'});a.emit('tool','vb6.project.get',{callId:'remember-call',arguments:{}});a.emit('result','Project read',{callId:'remember-call',result:{id:'test'}});
      for(let i=0;i<40;i++)a.emit('user','Keep reading '+i+'\\nThis task has its own reading position.');
      return api.conversations.activeId;
    }""")
    page.locator('.agent-tool summary').click();page.wait_for_function("document.querySelector('.agent-tool').open")
    page.get_by_label('Agent conversation',exact=True).evaluate("e=>{e.scrollTop=400;e.dispatchEvent(new Event('scroll'));}")
    page.get_by_role('button',name='New Task',exact=True).click()
    tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first);tab(page,'Task')
    page.wait_for_function("Math.abs(document.querySelector('.agent-conversation').scrollTop-400)<2")
    check(page.locator('.agent-tool').evaluate('e=>e.open'));check(not page.evaluate("vb6Studio.documents.tools.get('tool:coding-agents').threadView.follow"))
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents');")
    page.wait_for_function("Math.abs(document.querySelector('.agent-conversation').scrollTop-400)<2")
    check(page.locator('.agent-tool').evaluate('e=>e.open'))
    tab(page,'Connection');page.evaluate("vb6Studio.codingAgents.agent.emit('user','Arrived on a hidden tab')");tab(page,'Task')
    check(page.get_by_label('Agent conversation',exact=True).evaluate('e=>Math.abs(e.scrollTop-400)')<2)
    # Same task ID with a new thread object must discard old DOM, even at revision zero.
    page.evaluate("vb6Studio.codingAgents.agent.reset();vb6Studio.documents.tools.get('tool:coding-agents').render();")
    check(page.locator('.agent-thread-entry').count()==0)
    return {'taskLocalReading':True,'expandedToolsRestored':True,'panelReopen':True,'hiddenTab':True,'resetIdentity':True}


def thread_pruning_anchor(page,mode):
    page.evaluate("""() => {
      const a=vb6Studio.codingAgents.agent;a.thread.maxEntries=200;
      for(let i=0;i<100;i++){a.emit('user','Question '+i);a.emit('status','Request',{requestId:'prune'+i});a.emit('assistant','Reply '+i,{requestId:'prune'+i});}
    }""")
    page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===150")
    page.get_by_label('Agent conversation',exact=True).evaluate("e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));}")
    page.get_by_role('button',name='Show earlier messages',exact=True).click()
    page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===200")
    page.evaluate("""() => {
      const log=document.querySelector('.agent-conversation');log.scrollTop=1800;log.dispatchEvent(new Event('scroll'));
      const top=log.getBoundingClientRect().top+log.clientTop;
      window.readingAnchor=Array.from(document.querySelectorAll('.agent-thread-entry')).find(e=>e.getBoundingClientRect().bottom>top);
      window.anchorTop=readingAnchor.getBoundingClientRect().top;
      vb6Studio.codingAgents.agent.emit('user','Trigger bounded-history pruning.');
    }""")
    page.wait_for_function("vb6Studio.codingAgents.agent.thread.omitted===1 && document.querySelectorAll('.agent-thread-entry').length===199")
    check(page.evaluate('readingAnchor.isConnected && Math.abs(readingAnchor.getBoundingClientRect().top-anchorTop)<2'))
    return {'visibleAnchorSurvivesPruning':True,'omissionExplicit':True}


def batch_recovery(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_project_get'},{'name':'vb6_project_get'}],'') if i==1 else ([], 'Deferred reads completed.'))
    configure(page,mode='readonly');tab(page,'Permissions');page.get_by_label('Maximum agent tool calls',exact=True).fill('1');tab(page,'Task');start(page);finish(page)
    page.get_by_role('button',name='Resume task',exact=True).wait_for(state='visible')
    check(len(requests)==1);check(page.evaluate('vb6Studio.codingAgents.agent.usage.calls')==0)
    check(page.get_by_role('button',name='Send',exact=True).is_disabled());check('deferred' in page.locator('.agent-limit-recovery').inner_text())
    page.get_by_role('button',name='Review limits…',exact=True).click();page.get_by_label('Maximum agent tool calls',exact=True).fill('4');tab(page,'Task')
    page.get_by_role('button',name='Resume task',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True);check('deferred batch' in dialog.inner_text());dialog.get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(len(requests)==2);check(sum(i.get('type')=='function_call_output' for i in requests[1]['input'])==2)
    page.wait_for_function("document.querySelectorAll('.agent-tool[data-status=complete]').length===2")
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.tokens')==246)
    check(page.evaluate("vb6Studio.codingAgents.agent.state==='completed' && !vb6Studio.codingAgents.agent.pendingTurn"))
    return {'deferredNotExecuted':True,'reviewLimitsFromThread':True,'batchNotRequestedTwice':True,'usageNotDoubled':True}


def output_recovery(page,mode,provider):
    requests=[]
    def route_handler(route):
        if route.request.method=='OPTIONS':
            route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST'});return
        requests.append(route.request.post_data_json)
        data=packet(provider, [{'name':'vb6_project_get'}] if len(requests)==1 else [], 'Partial output.' if len(requests)==1 else 'Complete output.')
        if len(requests)==1:
            if provider=='openai':data['type']='response.incomplete';data['response']['status']='incomplete';data['response']['incomplete_details']={'reason':'max_output_tokens'}
            elif provider=='anthropic':data['stop_reason']='max_tokens'
            else:data['candidates'][0]['finishReason']='MAX_TOKENS'
        route.fulfill(status=200,content_type='text/event-stream',headers={'Access-Control-Allow-Origin':'*'},body=sse(provider,data))
    page.route({'openai':'https://api.openai.com/**','anthropic':'https://api.anthropic.com/**','google':'https://generativelanguage.googleapis.com/**'}[provider],route_handler)
    configure(page,provider,mode='readonly');tab(page,'Permissions');page.get_by_label('Maximum output tokens',exact=True).fill('512');tab(page,'Task');start(page);finish(page)
    page.get_by_role('button',name='Resume task',exact=True).wait_for(state='visible')
    check(len(requests)==1);check(page.evaluate('vb6Studio.codingAgents.agent.usage.calls')==0)
    check('Partial output.' in page.locator('.agent-assistant[data-status=interrupted]').inner_text())
    check(page.evaluate("vb6Studio.codingAgents.agent.limit.kind==='output'"))
    # An unchanged output allowance must fail before another paid request.
    page.get_by_role('button',name='Resume task',exact=True).click();page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True).get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(len(requests)==1);check('Increase the output' in page.locator('.agent-status').inner_text())
    page.get_by_role('button',name='Review limits…',exact=True).click();page.get_by_label('Maximum output tokens',exact=True).fill('1024');tab(page,'Task')
    page.get_by_label('Agent task',exact=True).fill('Unsent follow-up')
    page.screenshot(path=str(REPORTS/f'{mode}-{provider}-output-recovery.png'))
    page.get_by_role('button',name='Resume task',exact=True).click();page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True).get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(len(requests)==2);check('Unsent follow-up' not in json.dumps(requests));check(page.get_by_label('Agent task',exact=True).input_value()=='Unsent follow-up')
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.tokens')==246);check(page.evaluate("vb6Studio.codingAgents.agent.state==='completed'"))
    page.wait_for_function("document.querySelectorAll('.agent-assistant').length===2")
    check('Complete output.' in page.locator('.agent-assistant[data-status=complete]').inner_text())
    return {'outputCapRecoverable':True,'largerCapRequired':True,'partialToolsNotExecuted':True,'partialTextRetained':True,'draftNotSent':True,'cumulativeUsage':True}


def permission_full(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',b),'edits':[{'module':'Form1','start':0,'end':0,'text':"' full-access edit\n",'expectedText':''}]}}] if i==1 else [],'Full IDE access done.'))
    configure(page);page.get_by_label('Task permission profile',exact=True).select_option('full')
    start(page);finish(page);check(len(requests)==0)
    check('not confirmed' in page.locator('.agent-status').inner_text())
    page.locator('.agent-panel').get_by_role('button',name='Run',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True)
    check('FULL IDE ACCESS' in dialog.inner_text());dialog.get_by_label('Confirm Full IDE access for this run',exact=True).check()
    dialog.get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==2);check(page.evaluate('vb6Studio.project.modules[0].code.startsWith("\' full-access edit")'))
    check(page.evaluate("!vb6Studio.codingAgents.agent.transcript.some(e=>e.type==='approval')"))
    check('Inactive' in page.get_by_label('Effective agent permissions',exact=True).inner_text())
    check(page.evaluate("vb6Studio.codingAgents.agent.transcript.some(e=>e.type==='permission'&&e.permission?.action==='allow')"))
    page.screenshot(path=str(REPORTS/f'{mode}-full-permissions.png'))
    return {'separateUncheckedConsent':True,'noPerToolPrompts':True,'realCodeEdit':True,'leaseEnded':True}


def permission_autoedit(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',b),'edits':[{'module':'Form1','start':0,'end':0,'text':"' auto-edit\n",'expectedText':''}]}}] if i==1 else [{'name':'vb6_runtime_start','arguments':{'expectedRevision':source_revision('openai',b)}}] if i==2 else [],'Auto edit.'))
    configure(page,mode='autoedit');start(page)
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True);dialog.wait_for()
    check('vb6.runtime.start' in dialog.inner_text());check(page.evaluate('vb6Studio.project.modules[0].code.startsWith("\' auto-edit")'))
    dialog.get_by_role('button',name='Cancel',exact=True).click();finish(page)
    check(page.evaluate("vb6Studio.codingAgents.agent.state==='blocked'"));check(len(requests)==2)
    return {'automaticEdit':True,'executionStillReviewed':True,'denialStops':True}


def permission_rule_denial(page,mode):
    original=page.evaluate('JSON.stringify(vb6Studio.project)')
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',b),'edits':[{'module':'Form1','start':0,'end':0,'text':'BAD','expectedText':''}]}}],'Blocked rule.'))
    configure(page,mode='full');tab(page,'Permissions')
    page.get_by_label('Permission rule for code',exact=True).select_option('deny')
    page.get_by_label('Permission rule tool',exact=True).select_option('vb6.code.edit')
    page.get_by_label('Permission rule action',exact=True).select_option('allow');page.get_by_role('button',name='Set tool rule',exact=True).click()
    page.screenshot(path=str(REPORTS/f'{mode}-permission-rules.png'))
    tab(page,'Task');page.locator('.agent-panel').get_by_role('button',name='Run',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True);dialog.get_by_label('Confirm Full IDE access for this run',exact=True).check();dialog.get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==1);check(not any(t['name']=='vb6_code_edit' for t in requests[0]['tools']))
    check(page.evaluate('JSON.stringify(vb6Studio.project)')==original);check(page.evaluate("vb6Studio.codingAgents.agent.state==='blocked'"))
    check(page.locator('[aria-modal=true]').count()==0)
    return {'denyOverridesFullAndExactAllow':True,'noMutation':True,'notAdvertised':True}


def permission_never_ask(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_runtime_start','arguments':{'expectedRevision':source_revision('openai',b)}}],'Never ask.'))
    configure(page,mode='autoedit');tab(page,'Permissions');page.get_by_label('Approval policy',exact=True).select_option('never');tab(page,'Task');start(page);finish(page)
    check(len(requests)==1);check(page.locator('[aria-modal=true]').count()==0)
    check(page.evaluate("vb6Studio.runState==='design'&&vb6Studio.codingAgents.agent.state==='blocked'"))
    return {'neverMeansDenyNotAllow':True}


def permission_approve_run(page,mode):
    requests=mock(page,'openai',lambda i,b:([{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',b),'edits':[{'module':'Form1','start':0,'end':0,'text':"' approved step "+str(i)+"\n",'expectedText':''}]}}] if i<3 else [],'Two edits.'))
    configure(page);start(page)
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Review Operation',exact=True);dialog.wait_for();check('exact tool' in dialog.inner_text())
    dialog.get_by_role('button',name='Allow tool for this run',exact=True).click();finish(page)
    check(len(requests)==3);check(page.evaluate("vb6Studio.codingAgents.agent.transcript.filter(e=>e.type==='approval').length") == 1)
    check(page.evaluate("vb6Studio.project.modules[0].code.startsWith(\"' approved step 2\\n' approved step 1\\n\")"))
    check(page.evaluate('vb6Studio.codingAgents.agent.permissionSession.snapshot().approvedTools.length')==0)
    return {'exactToolRunApproval':True,'twoRealEditsOnePrompt':True,'grantNotPersisted':True}


def permission_task_profiles(page,mode):
    configure(page);page.get_by_label('Task permission profile',exact=True).select_option('full')
    tab(page,'Permissions');page.get_by_label('Permission lease minutes',exact=True).fill('30')
    page.get_by_label('Permission rule for files',exact=True).select_option('deny');tab(page,'Task')
    first=page.evaluate('vb6Studio.codingAgents.conversations.activeId')
    page.get_by_role('button',name='New Task',exact=True).click()
    check(page.get_by_label('Task permission profile',exact=True).input_value()=='review')
    tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first);tab(page,'Task')
    check(page.get_by_label('Task permission profile',exact=True).input_value()=='full')
    tab(page,'Permissions');check(page.get_by_label('Permission lease minutes',exact=True).input_value()=='30')
    check(page.get_by_label('Permission rule for files',exact=True).input_value()=='deny')
    check(not page.evaluate('vb6Studio.codingAgents.adapter.permissions.snapshot(vb6Studio.project.id).active'))
    page.evaluate("vb6Studio.closeDocument('tool:coding-agents');vb6Studio.command('codingAgents')")
    check(page.get_by_label('Task permission profile',exact=True).input_value()=='full')
    check(page.get_by_label('Provider API key',exact=True).input_value()=='')
    return {'perTaskProfile':True,'newTaskSafeDefault':True,'noAuthorityOrCredentialPersistence':True}


def permission_revoke(page,mode):
    configure(page);page.get_by_label('Task permission profile',exact=True).select_option('full')
    page.evaluate("""() => {
      const panel=vb6Studio.documents.tools.get('tool:coding-agents');
      panel.transportFactory=()=>async (_, {signal})=>new Promise((resolve,reject)=>{
        window.permissionRequestStarted=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      });
    }""")
    page.locator('.agent-panel').get_by_role('button',name='Run',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True);dialog.get_by_label('Confirm Full IDE access for this run',exact=True).check();dialog.get_by_role('button',name='Start Task',exact=True).click()
    page.wait_for_function('window.permissionRequestStarted===true')
    check(page.get_by_label('Task permission profile',exact=True).is_disabled())
    page.get_by_role('button',name='Revoke permissions & stop',exact=True).click();finish(page)
    check(page.evaluate('vb6Studio.codingAgents.agent.permissionSession.signal.aborted'))
    check(page.evaluate("vb6Studio.codingAgents.agent.state==='blocked'"))
    return {'explicitRevokeAbortsProvider':True,'noMidRunEscalation':True}


def permission_plan(page,mode):
    requests=mock(page,'openai',lambda i,b:([],'Plan: inspect Form1, propose changes, ask the user before implementing.'))
    configure(page);page.get_by_label('Task permission profile',exact=True).select_option('plan');start(page);finish(page)
    check(len(requests)==1);check('PLAN MODE' in requests[0]['instructions'])
    check(not any(t['name'] in ['vb6_code_edit','vb6_runtime_start'] for t in requests[0]['tools']))
    return {'planInstructions':True,'nonMutatingCatalog':True}


def automatic_retry(page, mode):
    original=page.evaluate('vb6Studio.project.modules[0].code')
    def strategy(index, body):
        if index==1:return [{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',body),'edits':[{'module':'Form1','start':0,'end':0,'text':"' auto retry once\n",'expectedText':''}]}}], 'Edit once.'
        if index==2:return {'http_status':503,'retry_after':1}
        return [], 'Recovered automatically without replaying the edit.'
    requests=mock(page,'openai',strategy);configure(page,mode='autoedit');start(page);finish(page)
    check(len(requests)==3);check(page.evaluate("vb6Studio.codingAgents.agent.state==='completed'"))
    check(page.evaluate('vb6Studio.project.modules[0].code')=="' auto retry once\n"+original)
    check(page.evaluate('vb6Studio.history.undoStack.length')==1)
    check(page.evaluate("vb6Studio.codingAgents.agent.thread.entries.some(e=>e.status==='retrying')"))
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests')==3)
    check(not page.evaluate('vb6Studio.codingAgents.agent.permissionSession.active'))
    page.screenshot(path=str(REPORTS/f'{mode}-automatic-recovery.png'))
    return {'automaticRetry':True,'confirmedEditNotReplayed':True,'permissionLeaseEnded':True}


def context_compaction(page, mode, provider='openai', slash=False):
    normals=0;summaries=0
    def strategy(index, body):
        nonlocal normals,summaries
        if not body.get('tools'):
            summaries+=1
            check('not-a-real-key-private' not in json.dumps(body));check('opaque-test-signature' not in json.dumps(body))
            check(not body.get('tool_choice'))
            return [], 'Confirmed: read the project. No modifications. Preserve the original task and inspect live state before any edit.'
        normals+=1
        if normals==1:return [{'name':'vb6_project_get'}], 'Confirmed project inspection. '*1800
        check('Context checkpoint' in json.dumps(body))
        return [], 'Continued from the checkpoint; no operations replayed.'
    requests=mock(page,provider,strategy);configure(page,provider,mode='readonly')
    tab(page,'Permissions');page.get_by_label('Maximum agent requests',exact=True).fill('1');tab(page,'Task');start(page);finish(page)
    before=page.evaluate('vb6Studio.codingAgents.agent.historyBytes')
    page.evaluate("""() => {
      const task=vb6Studio.codingAgents.conversations.active;
      globalThis.reviewBeforeCompact={first:task.review.first,last:task.review.last,revision:task.review.revision};
      task.followups.add('Unsent queued review feedback.');
    }""")
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.calls')==1)
    page.get_by_label('Agent task',exact=True).fill('/compact' if slash else 'Unsent draft must remain local.')
    if slash:page.get_by_label('Agent task',exact=True).press('Enter')
    else:page.get_by_role('button',name='Compact context',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Compact Context',exact=True)
    check('No IDE tools will execute' in dialog.inner_text());dialog.get_by_role('button',name='Compact Context',exact=True).click();finish(page)
    check(summaries==1 and normals==1);check(page.evaluate('vb6Studio.codingAgents.agent.compactions')==1)
    check(page.evaluate("""() => {
      const task=vb6Studio.codingAgents.conversations.active;
      return task.review.first===reviewBeforeCompact.first && task.review.last===reviewBeforeCompact.last
        && task.review.revision===reviewBeforeCompact.revision && task.followups.list()[0].text==='Unsent queued review feedback.';
    }"""))
    check('Unsent queued review feedback.' not in json.dumps(requests))
    check(page.evaluate('vb6Studio.codingAgents.agent.historyBytes')<before)
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.calls')==1)
    check(page.get_by_label('Agent task',exact=True).input_value()==('' if slash else 'Unsent draft must remain local.'))
    check('Unsent draft must remain local.' not in json.dumps(requests));check('/compact' not in json.dumps(requests))
    page.locator('.agent-panel').get_by_role('button',name='Continue',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Continue Task',exact=True).get_by_role('button',name='Continue Task',exact=True).click();finish(page)
    check(summaries==1 and normals==2);check(page.evaluate('vb6Studio.codingAgents.agent.usage.tokens')==369)
    check(page.evaluate("vb6Studio.codingAgents.agent.state==='completed'"))
    check('compactions' in page.get_by_label('Task context usage',exact=True).inner_text())
    page.screenshot(path=str(REPORTS/f'{mode}-{provider}-context-compaction.png'))
    return {'toolFreeCheckpoint':True,'wholeTaskRetained':True,'cumulativeUsage':True,'draftNotSent':True,'slashCommand':slash}


def stop_backoff(page, mode):
    requests=mock(page,'openai',lambda i,b:{'http_status':503,'retry_after':30});configure(page,mode='readonly');start(page)
    page.wait_for_function("vb6Studio.codingAgents.agent.thread.entries.some(e=>e.status==='retrying')")
    page.locator('.agent-panel').get_by_role('button',name='Stop',exact=True).click();finish(page)
    page.wait_for_timeout(100);check(len(requests)==1);check(page.evaluate("vb6Studio.codingAgents.agent.state==='blocked'"))
    check(not page.evaluate('vb6Studio.codingAgents.agent.permissionSession.active'))
    return {'backoffCancelled':True,'noLateRequest':True}


def queued_followups(page, mode, provider='openai'):
    requests=mock(page,provider,lambda i,b:([],'Finished queued turn.'))
    configure(page,provider,'readonly')
    page.get_by_label('Agent task',exact=True).fill('First queued message.')
    page.get_by_role('button',name='Queue message',exact=True).click()
    check(len(requests)==0)
    page.get_by_label('Agent task',exact=True).fill('Composer draft that must survive.')
    tab(page,'Queue')
    check(page.get_by_label('Queued agent messages',exact=True).locator('option').count()==1)
    page.get_by_role('button',name='Send selected message…',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True)
    check('First queued message.' in dialog.inner_text())
    dialog.get_by_role('button',name='Cancel',exact=True).click()
    check(len(requests)==0)
    check(page.get_by_label('Queued agent messages',exact=True).locator('option').count()==1)
    page.get_by_role('button',name='Send selected message…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click()
    finish(page)
    check(len(requests)==1)
    body=json.dumps(requests[0]);check('First queued message.' in body);check('Composer draft that must survive.' not in body)
    check(page.get_by_label('Queued agent messages',exact=True).locator('option').count()==0)
    tab(page,'Task');check(page.get_by_label('Agent task',exact=True).input_value()=='Composer draft that must survive.')
    return {'provider':provider,'manualConfirmOnly':True,'consumedAfterAcceptance':True,'draftPreserved':True}


def queue_while_running(page,mode):
    configure(page,mode='readonly')
    page.evaluate("""() => {
      const panel=vb6Studio.documents.tools.get('tool:coding-agents');
      panel.transportFactory=()=>async (_, {signal,receive})=>new Promise((resolve,reject)=>{
        window.queueStarted=true;window.finishQueueRequest=()=>{receive({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Only original run finished.'}]}],usage:{total_tokens:10}});resolve()};
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      });
    }""")
    start(page);page.wait_for_function('window.queueStarted===true')
    page.get_by_label('Agent task',exact=True).fill('Queued while running.')
    page.get_by_role('button',name='Queue message',exact=True).click()
    tab(page,'Queue');check(page.get_by_role('button',name='Send selected message…',exact=True).is_disabled())
    page.get_by_role('button',name='Edit selected message…',exact=True).click()
    page.get_by_label('Edit queued message',exact=True).fill('Edited while running.')
    page.get_by_role('dialog',name='AI Coding Agent — Edit Queued Message',exact=True).get_by_role('button',name='Save Message',exact=True).click()
    check('Edited while running.' in page.get_by_label('Queued message preview',exact=True).inner_text())
    page.evaluate('window.finishQueueRequest()');finish(page)
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests')==1)
    check(page.get_by_label('Queued agent messages',exact=True).locator('option').count()==1)
    check(not page.get_by_role('button',name='Send selected message…',exact=True).is_disabled())
    return {'editingDuringRun':True,'noAutomaticFollowup':True}


def queue_permission_confirmation(page,mode):
    requests=mock(page,'openai',lambda i,b:([],'Done.'))
    configure(page);page.get_by_label('Task permission profile',exact=True).select_option('full')
    page.get_by_role('button',name='Queue message',exact=True).click();tab(page,'Queue')
    page.get_by_role('button',name='Send selected message…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==0);check(page.get_by_label('Queued agent messages',exact=True).locator('option').count()==1)
    check('not confirmed' in page.locator('.agent-status').inner_text())
    # A changed queue entry while confirmation is pending must not send its predecessor.
    page.get_by_role('button',name='Send selected message…',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True);dialog.get_by_label('Confirm Full IDE access for this run',exact=True).check()
    page.evaluate("const q=vb6Studio.codingAgents.conversations.active.followups;const item=q.list()[0];q.edit(item.id,'changed after confirmation began',item.version)")
    dialog.get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==0);check('changed during confirmation' in page.locator('.agent-status').inner_text())
    return {'freshFullAcknowledgment':True,'staleQueueRejected':True,'noConsumptionOnPreflightFailure':True}


def queue_task_lifecycle(page,mode):
    configure(page,mode='readonly');page.get_by_label('Agent task',exact=True).fill('A');page.get_by_role('button',name='Queue message',exact=True).click()
    first=page.evaluate('vb6Studio.codingAgents.conversations.activeId')
    page.get_by_role('button',name='New Task',exact=True).click()
    page.get_by_label('Agent task',exact=True).fill('B');page.get_by_role('button',name='Queue message',exact=True).click()
    tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first)
    tab(page,'Queue');check(page.get_by_label('Queued message preview',exact=True).inner_text()=='A')
    page.evaluate("vb6Studio.closeDocument('tool:coding-agents');vb6Studio.command('codingAgents')")
    tab(page,'Queue');check(page.get_by_label('Queued message preview',exact=True).inner_text()=='A')
    check(page.get_by_label('Provider API key',exact=True).input_value()=='')
    check(not page.evaluate("JSON.stringify(vb6Studio.project).includes('followup-')"))
    page.evaluate("vb6Studio.loadProject(structuredClone(vb6Studio.project));vb6Studio.command('codingAgents')");tab(page,'Queue')
    check(page.get_by_role('button',name='Send selected message…',exact=True).is_disabled())
    return {'unstartedQueueBindsWorkspace':True,'taskIsolation':True,'reopenKeepsQueueClearsCredentials':True}


def make_review_change(page):
    def strategy(i,body):
        if i==1:return [{'name':'vb6_code_edit','arguments':{'expectedRevision':source_revision('openai',body),'edits':[{'module':'Form1','start':0,'end':0,'text':"' Review change <img onerror=alert(1)>\n",'expectedText':''}]}}],'Preparing a source edit.'
        return [],'Source edited.'
    requests=mock(page,'openai',strategy);configure(page,mode='autoedit');original=page.evaluate('vb6Studio.project.modules[0].code');start(page);finish(page)
    return requests,original


def review_restore(page,mode):
    requests,original=make_review_change(page);modified=page.evaluate('vb6Studio.project.modules[0].code')
    tab(page,'Changes')
    documents=page.get_by_label('Changed project documents',exact=True)
    # Native select.innerText omits option labels in WebKit. Check the actual
    # selected option, not a browser-specific rendering of the select element.
    selected=documents.locator('option:checked')
    check(documents.locator('option').count()==1, 'Expected one changed source document')
    check(selected.count()==1 and selected.text_content()=='modified — Form1.frm', 'Expected the modified Form1 source selected')
    selection={'selectInnerText':documents.inner_text(),'selectedOptionText':selected.text_content()}
    check(modified!=original, 'Source must actually change before it can be restored')
    check('Review change' in page.get_by_label('Project change diff',exact=True).inner_text())
    check(page.get_by_label('Project change diff',exact=True).locator('img').count()==0)
    with page.expect_download() as info:page.get_by_role('button',name='Save review patch…',exact=True).click()
    patch=Path(info.value.path()).read_text();check('+\' Review change' in patch);check('not-a-real-key-private' not in patch)
    check(len(requests)==2)
    page.get_by_role('button',name='Restore source…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Restore Reviewed Source',exact=True).get_by_role('button',name='Restore Source',exact=True).click()
    check(page.evaluate('vb6Studio.project.modules[0].code')==original)
    check(page.evaluate("vb6Studio.history.undoStack.at(-1).label.startsWith('Restore reviewed source')"))
    page.evaluate("vb6Studio.command('undo')");check(page.evaluate('vb6Studio.project.modules[0].code')==modified)
    check(len(requests)==2)
    return {'sourceRestoration':True,'normalUndo':True,'patchExport':True,'inertMarkup':True,'noProviderRequestsForReview':True,'selection':selection}


def review_stale_and_reload(page,mode):
    requests,original=make_review_change(page);tab(page,'Changes')
    page.get_by_role('button',name='Restore source…',exact=True).click()
    page.evaluate("text => { vb6Studio.project.modules[0].code += text; vb6Studio.markDirty(); }", "\n' manual edit")
    page.get_by_role('dialog',name='AI Coding Agent — Restore Reviewed Source',exact=True).get_by_role('button',name='Restore Source',exact=True).click()
    check('manual edit' in page.evaluate('vb6Studio.project.modules[0].code'))
    check('changed after review' in page.locator('.agent-status').inner_text())
    page.evaluate("vb6Studio.loadProject(structuredClone(vb6Studio.project));vb6Studio.command('codingAgents')")
    tab(page,'Changes');check('Previous workspace' in page.get_by_label('Change review summary',exact=True).inner_text());check(page.get_by_role('button',name='Restore source…',exact=True).is_disabled())
    check(len(requests)==2)
    return {'staleRevisionRefused':True,'sameIDReloadRefused':True}


def review_feedback(page,mode):
    requests,original=make_review_change(page);tab(page,'Changes')
    page.locator('.agent-diff-line[data-kind="+"]').first.click()
    page.get_by_label('Change review feedback',exact=True).fill('Keep this comment but add a test.')
    page.get_by_role('button',name='Queue review feedback',exact=True).click()
    check(len(requests)==2);tab(page,'Queue')
    text=page.get_by_label('Queued message preview',exact=True).inner_text()
    check('Form1.frm' in text and 'current line 1' in text and 'add a test' in text and 'Re-read' in text)
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests')==2)
    tab(page,'Changes');page.screenshot(path=str(REPORTS/f'{mode}-change-review.png'))
    return {'lineTargetedFeedback':True,'explicitLocalQueueOnly':True}


def review_last_run(page,mode):
    requests,original=make_review_change(page)
    check(page.evaluate("""() => { const panel=vb6Studio.documents.tools.get('tool:coding-agents'), view=panel.workbench, refresh=view.refreshChanges; let calls=0;
      view.refreshChanges=function(){calls++;return refresh.call(this);};
      try {panel.syncTask();return calls;} finally {view.refreshChanges=refresh;}
    }""")==1, 'Task synchronization must capture the current review only once')
    page.get_by_label('Agent task',exact=True).fill('Explain only.');page.get_by_label('Task permission profile',exact=True).select_option('readonly');start(page);finish(page)
    tab(page,'Changes');check(page.get_by_label('Changed project documents',exact=True).locator('option').count()==1)
    page.get_by_label('Review change scope',exact=True).select_option('run');check(page.get_by_label('Changed project documents',exact=True).locator('option').count()==0)
    page.get_by_label('Review change scope',exact=True).select_option('task');check(page.get_by_label('Changed project documents',exact=True).locator('option').count()==1)
    return {'taskAndLastRunCheckpoints':True,'oneReviewRefreshPerTaskSwitch':True}


def hosted_preview(page,mode):
    # A generic embedding-host double, not a substitute for genuine Electron CI.
    page.evaluate("""() => {
      globalThis.previewURLs=[];globalThis.previewWrites=0;
      globalThis.previewObserver=new MutationObserver(records=>previewWrites+=records.filter(r=>r.attributeName==='srcdoc').length);
      previewObserver.observe(vb6Studio.root,{subtree:true,attributes:true,attributeFilter:['srcdoc']});
      vb6Studio.runtimeDocumentLoader=html=>{const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));previewURLs.push(url);return Promise.resolve(url);};
      vb6Studio.run();
    }""")
    runtime=page.get_by_title('Running Visual Basic application',exact=True).element_handle().content_frame()
    runtime.wait_for_function('!!globalThis.vb6Application')
    check(page.evaluate('previewWrites===0 && !vb6Studio.runtimeFrame.hasAttribute("srcdoc") && !vb6Studio.runtimeFrame.sandbox.contains("allow-same-origin")'))
    # Verify the browser's actual opaque origin without requesting a forbidden
    # cross-origin DOM read (WebKit reports contentDocument access as a page error).
    # https://html.spec.whatwg.org/multipage/browsers.html#concept-origin-opaque
    page.evaluate("""() => {
      globalThis.previewMessageOrigin=undefined;
      const source=vb6Studio.runtimeFrame.contentWindow;
      const listener=event=>{
        if(event.isTrusted && event.source===source && event.data==='hosted-preview-origin-probe'){
          previewMessageOrigin=event.origin;removeEventListener('message',listener);
        }
      };
      addEventListener('message',listener);
    }""")
    runtime.evaluate("parent.postMessage('hosted-preview-origin-probe','*')")
    page.wait_for_function('typeof previewMessageOrigin === "string"')
    check(page.evaluate('previewMessageOrigin === "null"'), 'Runtime message must have an opaque origin')
    check(runtime.evaluate('typeof vb6Native === "undefined" && typeof require === "undefined"'))
    page.evaluate('vb6Studio.stop()')
    result=page.evaluate('vb6Studio.designImmediate.execute("? 6 * 7")')
    check(result.get('value')=='42')
    check(page.evaluate('previewWrites===0 && !vb6Studio.runtimeFrame && vb6Studio.runState==="design" && !vb6Studio.designImmediate.frame.hasAttribute("srcdoc")'))
    page.evaluate('vb6Studio.designImmediate.reset();previewObserver.disconnect();previewURLs.forEach(url=>URL.revokeObjectURL(url));delete vb6Studio.runtimeDocumentLoader;void 0;')
    return {'hostHookForRunAndImmediate':True,'noSrcdocNavigation':True,'opaqueSandbox':True,'nativeBridgeAbsent':True,'messageOrigin':page.evaluate('previewMessageOrigin')}


def hosted_preview_stale(page,mode):
    page.evaluate("""() => {
      globalThis.pendingPreviews=[];
      vb6Studio.runtimeDocumentLoader=html=>new Promise((resolve,reject)=>pendingPreviews.push({html,resolve,reject}));
      vb6Studio.run();globalThis.oldPreview=vb6Studio.runtimeFrame;
    }""")
    check(page.evaluate('pendingPreviews.length===1 && !oldPreview.hasAttribute("srcdoc") && !oldPreview.hasAttribute("src")'))
    page.evaluate('vb6Studio.stop(false)')
    page.evaluate('vb6Studio.run();globalThis.currentPreview=vb6Studio.runtimeFrame;pendingPreviews[0].reject(new Error("old host failure"));void 0;')
    check(page.evaluate('vb6Studio.runtimeFrame===currentPreview && vb6Studio.runState==="running" && !oldPreview.hasAttribute("src")'))
    # A same-ID workspace replacement also invalidates a delayed successful handle.
    page.evaluate('vb6Studio.loadProject(structuredClone(vb6Studio.project));pendingPreviews[1].resolve("about:blank#stale");void 0;')
    check(page.evaluate('!vb6Studio.runtimeFrame && vb6Studio.runState==="design" && !currentPreview.hasAttribute("src")'))
    page.evaluate('delete vb6Studio.runtimeDocumentLoader;void 0;')
    return {'lateFailureCannotStopNewRun':True,'sameIDReloadCannotNavigateOldFrame':True}


def hosted_preview_failure(page,mode):
    page.evaluate('vb6Studio.runtimeDocumentLoader=()=>Promise.reject(new Error("fixture host rejection"));vb6Studio.run();void 0;')
    page.wait_for_function('vb6Studio.runState==="design" && !vb6Studio.runtimeFrame')
    check(page.evaluate('vb6Studio.statusMessage.textContent.includes("fixture host rejection")'))
    result=page.evaluate('(async()=>{try{await vb6Studio.designImmediate.execute("? 1");return "unexpected success";}catch(error){return error.message;}})()')
    check('fixture host rejection' in result)
    check(page.evaluate('!vb6Studio.designImmediate.frame && !vb6Studio.designImmediate.busy && vb6Studio.runState==="design"'))
    page.evaluate('delete vb6Studio.runtimeDocumentLoader;void 0;')
    return {'runFailureVisible':True,'immediateFailureVisible':True,'noInsecureFallback':True}



def queued_command_isolation(page,mode):
    requests=mock(page,'openai',lambda i,b:([],'Selected message accepted.'))
    configure(page,mode='readonly');page.get_by_label('Agent task',exact=True).fill('Send only this selected queue message.')
    page.get_by_role('button',name='Queue message',exact=True).click()
    page.get_by_label('Agent task',exact=True).fill('/compact')
    tab(page,'Queue');page.get_by_role('button',name='Send selected message…',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True)
    check('selected queued message' in dialog.inner_text());dialog.get_by_role('button',name='Cancel',exact=True).click()
    check(len(requests)==0);check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==1)
    page.get_by_role('button',name='Send selected message…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==1);check('Send only this selected queue message.' in json.dumps(requests))
    check('/compact' not in json.dumps(requests));check(page.evaluate('vb6Studio.codingAgents.agent.compactions')==0)
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.followups.items.length')==0)
    tab(page,'Task');check(page.get_by_label('Agent task',exact=True).input_value()=='/compact')
    # A queued message is explicit message text, not a local slash command.
    page.get_by_role('button',name='Queue message',exact=True).click()
    page.get_by_label('Agent task',exact=True).fill('Separate unsent draft.')
    tab(page,'Queue');page.get_by_role('button',name='Send selected message…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Start Task',exact=True).get_by_role('button',name='Start Task',exact=True).click();finish(page)
    check(len(requests)==2 and '/compact' in json.dumps(requests[1]))
    check('Separate unsent draft.' not in json.dumps(requests));check(page.evaluate('vb6Studio.codingAgents.agent.compactions')==0)
    tab(page,'Task');check(page.get_by_label('Agent task',exact=True).input_value()=='Separate unsent draft.')
    return {'draftCommandDoesNotHijackQueue':True,'queuedTextNotLocalCommand':True,'cancelPreservesQueue':True,'draftPreserved':True}


def two_review_blocks(page,mode):
    page.evaluate("vb6Studio.project.modules[0].code=\"Option Explicit\\n' first\\n' keep\\n' second\\n' end\\n\";vb6Studio.markDirty();")
    requests=mock(page,'openai',lambda i,b:([],'Read only checkpoint.'))
    configure(page,mode='readonly');start(page);finish(page)
    page.evaluate("vb6Studio.project.modules[0].code=vb6Studio.project.modules[0].code.replace('first','FIRST').replace('second','SECOND');vb6Studio.markDirty();")
    tab(page,'Changes')
    return requests


def review_selective_restore(page,mode):
    requests=two_review_blocks(page,mode)
    check(page.get_by_label('Selected change block',exact=True).inner_text()=='Change 1 of 2')
    page.get_by_role('button',name='Next change',exact=True).click()
    check(page.get_by_label('Selected change block',exact=True).inner_text()=='Change 2 of 2')
    page.get_by_role('button',name='Restore selected change…',exact=True).click()
    dialog=page.get_by_role('dialog',name='AI Coding Agent — Restore Selected Change',exact=True)
    check('Only this changed block' in dialog.inner_text())
    page.screenshot(path=str(REPORTS/f'{mode}-selective-restore.png'))
    dialog.get_by_role('button',name='Cancel',exact=True).click()
    check('SECOND' in page.evaluate('vb6Studio.project.modules[0].code'))
    page.get_by_role('button',name='Restore selected change…',exact=True).click()
    page.get_by_role('dialog',name='AI Coding Agent — Restore Selected Change',exact=True).get_by_role('button',name='Restore Change',exact=True).click()
    source=page.evaluate('vb6Studio.project.modules[0].code')
    check("' FIRST" in source and "' second" in source and 'SECOND' not in source)
    check(page.evaluate("vb6Studio.history.undoStack.at(-1).label.startsWith('Restore reviewed change')"))
    page.evaluate("vb6Studio.command('undo')");check('SECOND' in page.evaluate('vb6Studio.project.modules[0].code'))
    check(len(requests)==1)
    return {'singleBlockRestore':True,'otherChangesKept':True,'cancelAndUndo':True,'noProviderRequest':True}


def review_selective_stale(page,mode):
    requests=two_review_blocks(page,mode)
    page.get_by_role('button',name='Restore selected change…',exact=True).click()
    page.evaluate("vb6Studio.project.modules[0].code += \"' concurrent\\n\";vb6Studio.markDirty();")
    page.get_by_role('dialog',name='AI Coding Agent — Restore Selected Change',exact=True).get_by_role('button',name='Restore Change',exact=True).click()
    source=page.evaluate('vb6Studio.project.modules[0].code');check('concurrent' in source and 'FIRST' in source and 'SECOND' in source)
    page.wait_for_function("!vb6Studio.documents.tools.get('tool:coding-agents').workbench.stale.hidden")
    check(page.get_by_role('button',name='Restore selected change…',exact=True).is_disabled())
    check(page.get_by_role('button',name='Restore source…',exact=True).is_disabled())
    page.get_by_role('button',name='Refresh changes',exact=True).click()
    check(page.get_by_label('Change review freshness',exact=True).is_hidden())
    check(len(requests)==1)
    return {'postConsentRevisionRefused':True,'staleButtonsDisabled':True,'refreshRestoresReview':True}


def review_target_retention(page,mode):
    requests=two_review_blocks(page,mode)
    page.locator('.agent-diff-line[data-kind="+"]').last.click()
    page.get_by_label('Change review feedback',exact=True).fill('Only improve the second comment.')
    page.get_by_label('Change diff layout',exact=True).select_option('split')
    tab(page,'Task');tab(page,'Changes')
    check(page.get_by_label('Change diff layout',exact=True).input_value()=='split')
    check(page.get_by_label('Change review feedback',exact=True).input_value()=='Only improve the second comment.')
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents');")
    tab(page,'Changes')
    check(page.get_by_label('Change diff layout',exact=True).input_value()=='split')
    page.get_by_role('button',name='Queue review feedback',exact=True).click();tab(page,'Queue')
    text=page.get_by_label('Queued message preview',exact=True).inner_text()
    check('current line 4' in text and 'SECOND' in text and 'Only improve' in text)
    check(len(requests)==1)
    return {'lineTargetSurvivesRefreshAndReopen':True,'draftAndLayoutRetained':True,'noAutoSend':True}


def review_freshness_without_recapture(page,mode):
    requests=two_review_blocks(page,mode)
    page.locator('.agent-diff-line[data-kind="+"]').last.click()
    page.get_by_label('Change review feedback',exact=True).fill('Saved feedback.')
    page.evaluate("""() => {
      const r=vb6Studio.codingAgents.conversations.active.review;globalThis.reviewRecaptures=0;
      const compare=r.compare;r.compare=function(...args){reviewRecaptures++;return compare.apply(this,args);};
      vb6Studio.project.modules[0].code += "' newer\\n";vb6Studio.markDirty();
    }""")
    page.wait_for_function("!vb6Studio.documents.tools.get('tool:coding-agents').workbench.stale.hidden")
    check(page.evaluate('reviewRecaptures')==0)
    check(page.get_by_role('button',name='Queue review feedback',exact=True).is_disabled())
    check(page.get_by_label('Change review feedback',exact=True).input_value()=='Saved feedback.')
    page.get_by_role('button',name='Refresh changes',exact=True).click()
    check(page.evaluate('reviewRecaptures')==1)
    check(page.evaluate('vb6Studio.codingAgents.conversations.active.review.feedbackTarget') is None)
    check(page.get_by_label('Change review feedback',exact=True).input_value()=='Saved feedback.')
    page.get_by_role('button',name='Queue review feedback',exact=True).click();tab(page,'Queue')
    check('current line' not in page.get_by_label('Queued message preview',exact=True).inner_text())
    check(len(requests)==1)
    return {'coalescedInvalidationNoCapture':True,'draftKept':True,'staleLineTargetCleared':True}


def review_task_preferences(page,mode):
    requests=two_review_blocks(page,mode)
    first=page.evaluate('vb6Studio.codingAgents.conversations.activeId')
    page.get_by_label('Review change scope',exact=True).select_option('run')
    page.get_by_label('Change diff layout',exact=True).select_option('split')
    page.get_by_label('Change review feedback',exact=True).fill('Task one review.')
    page.get_by_role('button',name='New Task',exact=True).click();tab(page,'Changes')
    check(page.get_by_label('Review change scope',exact=True).input_value()=='task')
    check(page.get_by_label('Change diff layout',exact=True).input_value()=='unified')
    check(page.get_by_label('Change review feedback',exact=True).input_value()=='')
    tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first);tab(page,'Changes')
    check(page.get_by_label('Review change scope',exact=True).input_value()=='run')
    check(page.get_by_label('Change diff layout',exact=True).input_value()=='split')
    check(page.get_by_label('Change review feedback',exact=True).input_value()=='Task one review.')
    check(len(requests)==1)
    return {'taskLocalScopeLayoutAndDraft':True,'newTaskNoInheritedState':True}


def queue_selection_retention(page,mode):
    first=page.evaluate("""() => {
      const task=vb6Studio.codingAgents.conversations.active;
      task.followups.add('First queued message');task.followups.add('Second queued message');
      vb6Studio.documents.tools.get('tool:coding-agents').refresh();return task.id;
    }""")
    tab(page,'Queue');page.get_by_label('Queued agent messages',exact=True).select_option(index=1)
    chosen=page.get_by_label('Queued agent messages',exact=True).input_value()
    page.get_by_role('button',name='New Task',exact=True).click();tab(page,'Tasks');page.get_by_label('Agent tasks',exact=True).select_option(first)
    tab(page,'Queue');check(page.get_by_label('Queued agent messages',exact=True).input_value()==chosen)
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents');")
    tab(page,'Queue');check(page.get_by_label('Queued agent messages',exact=True).input_value()==chosen)
    check('Second queued message' in page.get_by_label('Queued message preview',exact=True).inner_text())
    page.get_by_role('button',name='Remove selected message',exact=True).click()
    check('First queued message' in page.get_by_label('Queued message preview',exact=True).inner_text())
    check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests')==0)
    page.screenshot(path=str(REPORTS/f'{mode}-queue-selection.png'))
    return {'selectionRetainedAcrossTasksAndReopen':True,'removedSelectionFallsBack':True,'noProviderRequest':True}


def review_scroll_retention(page,mode):
    page.evaluate("vb6Studio.project.modules[0].code=Array.from({length:600},(_,i)=>\"' old \"+i+'\\n').join('');vb6Studio.markDirty();")
    requests=mock(page,'openai',lambda i,b:([],'Checkpoint.'))
    configure(page,mode='readonly');start(page);finish(page)
    page.evaluate("vb6Studio.project.modules[0].code=vb6Studio.project.modules[0].code.replaceAll('old','new');vb6Studio.markDirty();")
    tab(page,'Changes');page.get_by_role('button',name='Show more diff lines',exact=True).click()
    check(page.locator('.agent-diff-line').count()==1000)
    page.get_by_label('Project change diff',exact=True).evaluate("e=>{e.scrollTop=400;e.dispatchEvent(new Event('scroll'));}")
    tab(page,'Task');tab(page,'Changes')
    page.wait_for_function("Math.abs(vb6Studio.documents.tools.get('tool:coding-agents').workbench.diff.scrollTop-400)<2")
    page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents');")
    tab(page,'Changes')
    check(page.locator('.agent-diff-line').count()==1000)
    page.wait_for_function("Math.abs(vb6Studio.documents.tools.get('tool:coding-agents').workbench.diff.scrollTop-400)<2")
    check(len(requests)==1)
    return {'diffScrollAndExpandedWindowRetained':True,'panelReopen':True}


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
        engine=getattr(p,args.browser)
        options={'executable_path':os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or engine.executable_path,'args':['--no-sandbox']} if args.browser=='chromium' else {}
        browser=engine.launch(**options)
        for mode in (['opaque'] if args.opaque else ['http','standalone-http','file']):
            for provider in ['openai','anthropic','google']:
                case(browser,mode,provider,lambda page,mode,provider=provider:provider_workflow(page,mode,provider))
                case(browser,mode,provider+'-plan-question',lambda page,mode,provider=provider:plan_question(page,mode,provider))
                case(browser,mode,provider+'-context-compaction',lambda page,mode,provider=provider:context_compaction(page,mode,provider))
                case(browser,mode,provider+'-output-recovery',lambda page,mode,provider=provider:output_recovery(page,mode,provider))
                case(browser,mode,provider+'-queued-followups',lambda page,mode,provider=provider:queued_followups(page,mode,provider))
            for name,fn in [('review-scroll-retention',review_scroll_retention),('review-selective-restore',review_selective_restore),('review-selective-stale',review_selective_stale),('review-target-retention',review_target_retention),('review-freshness',review_freshness_without_recapture),('review-task-preferences',review_task_preferences),('queue-selection-retention',queue_selection_retention),('queued-command-isolation',queued_command_isolation),('queue-while-running',queue_while_running),('queue-permission-confirmation',queue_permission_confirmation),('queue-task-lifecycle',queue_task_lifecycle),('review-restore',review_restore),('review-stale-reload',review_stale_and_reload),('review-feedback',review_feedback),('review-last-run',review_last_run),('hosted-preview',hosted_preview),('hosted-preview-stale',hosted_preview_stale),('hosted-preview-failure',hosted_preview_failure),('automatic-retry',automatic_retry),('stop-backoff',stop_backoff),('compact-command',lambda page,mode:context_compaction(page,mode,'openai',True)),('denied',denied),('readonly',readonly),('scoped',scoped),('stopped',stopped),('lifecycle',lifecycle),('tasks',task_switching),('limited-resume',limited_resume),('request-retry',request_retry),('question-cancel',question_cancel),('live-thread',live_thread),('thread-reading',thread_reading),('thread-formatting',thread_formatting),('budget-preferences',budget_preferences),('composer-keyboard',composer_keyboard),('thread-catch-up',thread_catch_up),('thread-return',thread_return),('thread-pruning-anchor',thread_pruning_anchor),('batch-recovery',batch_recovery),('permission-full',permission_full),('permission-autoedit',permission_autoedit),('permission-deny',permission_rule_denial),('permission-never',permission_never_ask),('permission-approve-run',permission_approve_run),('permission-tasks',permission_task_profiles),('permission-revoke',permission_revoke),('permission-plan',permission_plan)]:case(browser,mode,name,fn)
        browser.close()
finally:
    server.shutdown();server.server_close()
    (REPORTS/('opaque-results.json' if args.opaque else 'results.json')).write_text(json.dumps({'browser':args.browser,'opaqueFallback':args.opaque,'paidProviderRequests':0,'tests':results},indent=2))
raise SystemExit(0 if results and all(item['passed'] for item in results) else 1)

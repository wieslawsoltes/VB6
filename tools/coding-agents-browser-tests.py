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
    requests=mock(page,'openai',strategy);configure(page);start(page)
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
                case(browser,mode,provider+'-output-recovery',lambda page,mode,provider=provider:output_recovery(page,mode,provider))
            for name,fn in [('denied',denied),('readonly',readonly),('scoped',scoped),('stopped',stopped),('lifecycle',lifecycle),('tasks',task_switching),('limited-resume',limited_resume),('request-retry',request_retry),('question-cancel',question_cancel),('live-thread',live_thread),('thread-reading',thread_reading),('thread-formatting',thread_formatting),('budget-preferences',budget_preferences),('composer-keyboard',composer_keyboard),('thread-catch-up',thread_catch_up),('thread-return',thread_return),('thread-pruning-anchor',thread_pruning_anchor),('batch-recovery',batch_recovery)]:case(browser,mode,name,fn)
        browser.close()
finally:
    server.shutdown();server.server_close()
    (REPORTS/('opaque-results.json' if args.opaque else 'results.json')).write_text(json.dumps({'browser':args.browser,'opaqueFallback':args.opaque,'paidProviderRequests':0,'tests':results},indent=2))
raise SystemExit(0 if results and all(item['passed'] for item in results) else 1)

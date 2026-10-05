#!/usr/bin/env python3
"""Coding-agent end-to-end tests against the real IDE and sandbox runtime.

Default uses real navigation and external HTTP MCP calls in four deployment modes.
--opaque is an explicitly UI-only local fallback; never used in CI.
"""
from __future__ import annotations
import argparse, json, os, subprocess, time, traceback, urllib.request
import hashlib, base64
from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util
_spec=importlib.util.spec_from_file_location('mcp_browser_harness',Path(__file__).with_name('mcp-browser-harness.py'))
harness=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(harness)

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--opaque', action='store_true')
args = parser.parse_args()
results = []


def check(value, message='Assertion failed'):
    if not value:
        raise AssertionError(message)


def tab(page, name):
    page.evaluate("vb6Studio.command('mcpAgentAccess')")
    page.locator('.mcp-panel').get_by_role('tab', name=name, exact=True).click()


def finished(page):
    page.wait_for_function("!vb6Studio.documents.tools.get('tool:mcp').operation")


def delegate(page, scopes=('code','project','designer','files','debugger','runtime','workspace')):
    tab(page, 'Agent permissions')
    for scope in ('code','project','designer','files','debugger','runtime','workspace'):
        page.get_by_label('Agent scope '+scope, exact=True).set_checked(scope in scopes)
    page.get_by_role('button', name='Grant selected permissions', exact=True).click()
    page.get_by_role('dialog', name='Authorize coding agents?', exact=True).get_by_role('button', name='Authorize session', exact=True).click()
    finished(page)
    page.wait_for_function('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active')


def wire(info, method, params, tasks=False):
    params = {**params, '_meta': {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {'name':'agent-e2e','version':'1'}, 'io.modelcontextprotocol/clientCapabilities': {'extensions':{'io.modelcontextprotocol/tasks':{}}} if tasks else {}}}
    headers = {'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':'Bearer '+info['clientToken'],'MCP-Protocol-Version':'2026-07-28','MCP-Method':method}
    if method == 'tools/call': headers['MCP-Name'] = params['name']
    if method in ('tasks/get','tasks/update','tasks/cancel'): headers['MCP-Name']=params['taskId']
    request = urllib.request.Request(info['url']+'/mcp', data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(), headers=headers)
    with urllib.request.urlopen(request,timeout=25) as response:
        text = response.read().decode()
        data = next(json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: ') and json.loads(line[6:]).get('id') == 1) if response.headers.get_content_type() == 'text/event-stream' else json.loads(text)
    if 'error' in data: raise AssertionError(str(data['error']))
    if data['result'].get('isError'): raise AssertionError(str(data['result']))
    return data['result'].get('structuredContent',data['result'])


def exercise(browser, mode, info):
    context = browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True, ignore_https_errors=mode=='https-hosted-subpath')
    page = context.new_page(); errors=[]; touched=set()
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        if mode=='opaque': page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(),wait_until='load')
        elif mode=='file': page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri())
        else: page.goto(info['hosted'] if mode=='hosted-subpath' else info['httpsHosted'] if mode=='https-hosted-subpath' else info['url'])
        page.wait_for_function('!!globalThis.vb6Studio?.mcp')
        page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('AgentWorkflow'))")
        tab(page,'Agent access')
        page.get_by_label('Enable MCP sharing',exact=True).check()
        page.get_by_role('dialog').get_by_role('button',name='Enable sharing',exact=True).click();finished(page)
        harness.install_peer(page)
        network = mode!='opaque'
        if network:
            page.get_by_label('Companion URL',exact=True).fill(info['url'])
            page.get_by_label('Companion owner token',exact=True).fill(info['ownerToken'])
            page.get_by_role('button',name='Attach companion',exact=True).click();finished(page)
            catalog=[];cursor=None
            while True:
                response=harness.wire(info,'tools/list',{'cursor':cursor} if cursor else {})
                check('result' in response,str(response));catalog.extend(response['result']['tools']);cursor=response['result'].get('nextCursor')
                if not cursor:break
        else:catalog=page.evaluate('agentClient.listTools()')
        check(len(catalog)==114,'Expected complete 114-tool catalog')
        writes={t['name'] for t in catalog if not t['annotations']['readOnlyHint']}
        delegate(page)
        def call(name, values=None):
            full='vb6.'+name; values=dict(values or {});touched.add(full)
            if full in writes and name!='debug.cancelEvaluation': values.setdefault('expectedRevision',wire(info,'tools/call',{'name':'vb6.project.get','arguments':{}})['revision'] if network else page.evaluate('vb6Studio.mcp.adapter.revision'))
            if network: return wire(info,'tools/call',{'name':full,'arguments':values})
            result=page.evaluate('async ([name,args])=>{const r=await agentClient.callTool(name,args);if(r.isError)throw new Error(JSON.stringify(r));return r.structuredContent}',[full,values])
            return result
        # Immutable build outputs, actually fetched over the external HTTP relay.
        check(len(call('build.targets')['targets'])==4)
        before=call('project.get')
        built=call('build.create',{'target':'project','expectedRevision':before['revision']})['artifact']
        chunks=[];offset=0
        while True:
            chunk=call('build.read',{'artifactId':built['artifactId'],'offset':offset,'count':257})
            chunks.append(base64.b64decode(chunk['data']));offset=chunk['nextOffset']
            if not chunk['hasMore']:break
        contents=b''.join(chunks);check(hashlib.sha256(contents).hexdigest()==built['sha256'])
        check(json.loads(contents)['name']=='AgentWorkflow');call('build.release',{'artifactId':built['artifactId']})
        check(len(call('project.group')['projects'])==1)
        check(len(call('project.entries',{'files':[{'path':'Agent.vb6web','content':contents.decode()}]})['entries'])==1)
        # Task polling crosses independent HTTP responses and does not need clientInfo.
        if network:
            task=wire(info,'tools/call',{'name':'vb6.agent.wait','arguments':{'afterRevision':call('project.get')['revision'],'timeoutMs':10000}},tasks=True)
            check(task['resultType']=='task' and task['status']=='working',str(task))
            call('project.update',{'description':'Wake an external task'})
            for _ in range(30):
                state=wire(info,'tasks/get',{'taskId':task['taskId']},tasks=True)
                if state['status']=='completed':break
                page.wait_for_timeout(50)
            check(state['status']=='completed' and state['result']['structuredContent']['matched'],str(state))
            cancelled=wire(info,'tools/call',{'name':'vb6.agent.wait','arguments':{'afterRevision':call('project.get')['revision'],'timeoutMs':10000}},tasks=True)
            wire(info,'tasks/cancel',{'taskId':cancelled['taskId']},tasks=True)
            check(wire(info,'tasks/get',{'taskId':cancelled['taskId']},tasks=True)['status']=='cancelled')
        # Everything after local opt-in is controlled through MCP, not direct project edits.
        cap=call('agent.capabilities');check(cap['permissions']['active'])
        check(all(c['tool'] for c in call('commands.list')['commands']))
        check(call('objects.catalog',{'library':'VBA','query':'Left'})['total']>0)
        check(len(call('designer.catalog')['controls'])>30)
        call('project.update',{'description':'Created through the MCP agent surface','settings':{'gridSize':90}})
        call('module.add',{'name':'MathTools','kind':'module','code':'Option Explicit\nPublic Function Twice(ByVal x As Long) As Long\n Twice = x * 2\nEnd Function\n'})
        call('module.metadata',{'module':'MathTools','sourcePath':'src/MathTools.bas'})
        call('references.set',{'references':[{'kind':'Reference','value':'*\\G{00000000-0000-0000-0000-000000000000}#1.0#0#test.tlb#Test'}]})
        check(call('references.get')['references'][0]['kind']=='Reference')
        for name,kind,props in [('cmdRun','CommandButton',{'Caption':'Run agent input','Top':600}),('txtValue','TextBox',{'Text':'hello','Top':1200}),('gridData','MSFlexGrid',{'Rows':3,'Cols':3,'Top':1800})]:
            call('control.edit',{'module':'Form1','action':'add','name':name,'type':kind,'properties':props})
        call('menu.edit',{'module':'Form1','action':'add','name':'mnuRun','properties':{'Caption':'&Agent command'}})
        code='''Option Explicit
Private Sub Form_Load()
    Dim value As Long
    value = 21
    value = value + 1
    Debug.Print value
End Sub
Private Sub cmdRun_Click()
    Dim response As String
    response = InputBox("Agent input", "Runtime input", "original")
    Debug.Print response
    Open "/agent.txt" For Output As #1
    Print #1, response
    Close #1
End Sub
Private Sub mnuRun_Click()
    Debug.Print "menu-fired"
End Sub
'''
        current=call('module.read',{'module':'Form1'})['code']
        call('code.edit',{'edits':[{'module':'Form1','start':0,'end':len(current),'expectedText':current,'text':code},{'module':'MathTools','start':0,'end':0,'text':"' Agent-owned helper\n"}]})
        check(call('project.compile')['valid'])
        check(call('code.symbols',{'query':'Twice'})['total']>0)
        call('bookmarks.set',{'module':'Form1','lines':[2,8]});check(call('bookmarks.get',{'module':'Form1'})['lines']==[2,8])
        call('files.write',{'path':'/seed.bin','encoding':'base64','content':'AP+A'})
        check(call('files.read',{'path':'/seed.bin'})['content']=='AP+A')
        call('resources.string',{'id':42,'text':'Agent resource'})
        check(call('resources.strings')['items'][0]['text']=='Agent resource')
        call('appSettings.set',{'settings':{'Agent':{'Options':{'Mode':'test'}}}})
        check(call('resources.export')['data'])
        check(any(f['path']=='src/MathTools.bas' for f in call('project.files')['items']))
        check(call('project.archive')['data'])
        # Actual editor projection, designer selection, history and workbench layout.
        call('document.open',{'module':'Form1','view':'code','line':2})
        call('editor.set',{'module':'Form1','start':0,'end':15,'view':{'version':1,'ratio':0.4,'active':1,'panes':[{'start':0,'end':0,'mode':'module'},{'start':0,'end':15,'mode':'module'}]}})
        view=call('editor.get',{'module':'Form1'});check(len(view['view']['panes'])==2 and view['selection']['end']==15,str(view))
        call('editor.edit',{'module':'Form1','command':'insert','start':0,'end':0,'text':"' editor command\n"})
        call('history.apply',{'direction':'undo'});check(call('module.read',{'module':'Form1'})['code']==code)
        call('history.apply',{'direction':'redo'});check(call('module.read',{'module':'Form1'})['code'].startswith("' editor command"))
        call('history.apply',{'direction':'undo'})
        call('designer.set',{'module':'Form1','ids':['cmdRun','txtValue'],'zoom':0.75,'locked':False})
        check(len(call('designer.get',{'module':'Form1'})['selection'])==2)
        call('designer.align',{'module':'Form1','ids':['cmdRun','txtValue'],'command':'left'})
        call('workspace.configure',{'appearance':{'theme':'standard','windowMode':'mdi'}})
        call('workspace.saveLayout',{'name':'Agent layout'})
        layout=call('workspace.get')['layout']
        call('workspace.layout',{'layout':layout})
        call('workspace.deleteLayout',{'name':'Agent layout'})
        bars=call('toolbars.get')['layout'];bars['bars'][1]['visible']=True
        call('toolbars.set',{'layout':bars});check(call('toolbars.get')['layout']['bars'][1]['visible'])
        call('commands.execute',{'command':'objectBrowser'})
        check('tool:objects' in call('documents.list')['tools'] or any('object' in k.lower() for k in call('documents.list')['tools']))
        docs=call('documents.list')
        key=next(d['key'] for d in docs['documents'] if d['view']=='code')
        call('documents.set',{'key':key,'action':'maximize'})
        check(next(w for w in call('documents.list')['windows'] if w['key']==key)['maximized'])
        call('documents.set',{'key':key,'action':'restore'})
        call('documents.set',{'key':key,'action':'bounds','bounds':{'x':20,'y':30,'width':600,'height':380}})
        call('project.explorerSet',{'expandedFolders':['form'],'showFolders':True,'toolboxMode':'all'})
        check(call('project.explorer')['expandedFolders']==['form'])
        docking=call('workspace.get')['layout']['docking']; dock_id=docking['windows'][0]['id']
        call('windows.set',{'id':dock_id,'action':'float'})
        call('windows.set',{'id':dock_id,'action':'dock','edge':'left'})
        call('watches.set',{'watches':[{'expression':'value','mode':'expression','module':'Form1','procedure':'Form_Load'}]})
        call('breakpoints.set',{'breakpoints':[{'module':'Form1','line':5,'condition':''}]})
        call('runtime.start',{'breakOnEntry':True})
        call('agent.wait',{'state':'paused','timeoutMs':15000})
        state=call('debug.snapshot');check(state['runState']=='paused',str(state))
        pause=state['pauseId'];frame=state['frameIndex']
        call('debug.selectFrame',{'pauseId':pause,'frameIndex':frame})
        locals_=call('debug.locals',{'pauseId':pause,'frameIndex':frame});check(any(v['name']=='cmdrun' for v in locals_['locals']),str(locals_))
        # Move to value assignment, step over it, then update the real suspended variable.
        call('debug.runToCursor',{'module':'Form1','line':5,'pauseId':pause})
        check(call('agent.wait',{'state':'paused','afterPause':pause,'timeoutMs':15000})['matched'])
        state=call('debug.snapshot');pause=state['pauseId'];frame=state['frameIndex']
        read=call('debug.inspect',{'expression':'value','pauseId':pause,'frameIndex':frame});check('21' in json.dumps(read),str(read))
        call('debug.assign',{'expression':'value','value':'40','pauseId':pause,'frameIndex':frame})
        read=call('debug.inspect',{'expression':'value','pauseId':pause});check('40' in json.dumps(read),str(read))
        # Live edit via MCP, preserving the suspended frame.
        start=code.index('value = value + 1')
        call('code.edit',{'edits':[{'module':'Form1','start':start,'end':start+len('value = value + 1'),'expectedText':'value = value + 1','text':'value = value + 2'}]})
        check(call('debug.snapshot')['pendingEdits'])
        call('debug.applyEdits',{'pauseId':pause});check(not call('debug.snapshot')['pendingEdits'])
        value=call('debug.evaluate',{'expression':'MathTools.Twice(value)'});check('80' in json.dumps(value),str(value))
        call('debug.immediate',{'text':'value = 41','pauseId':pause,'frameIndex':frame})
        call('debug.command',{'command':'stepOver'})
        check(call('agent.wait',{'state':'paused','afterPause':pause,'timeoutMs':15000})['matched'])
        state=call('debug.snapshot');check('43' in json.dumps(call('debug.inspect',{'expression':'value','pauseId':state['pauseId']})))
        call('debug.command',{'command':'continue'})
        page.wait_for_function("vb6Studio.runState==='running'")
        # Invoke actual application controls and menus; output wakes event-based waits.
        runtime=call('runtime.inspect')['runtime'];items=runtime['items']
        run=next(v for v in items if v['name']=='cmdRun');grid=next(v for v in items if v['name']=='gridData');menu=next(v for v in items if v['name']=='mnuRun')
        call('runtime.interact',{'target':grid['id'],'action':'indexedSet','method':'TextMatrix','arguments':[1,1],'value':'agent cell'})
        check(call('runtime.interact',{'target':grid['id'],'action':'indexedGet','method':'TextMatrix','arguments':[1,1]})['result']['value']=='agent cell')
        before=call('project.get')['eventSequence']
        call('runtime.interact',{'target':menu['id'],'action':'menu'})
        call('agent.wait',{'afterEvent':before,'timeoutMs':5000})
        check('menu-fired' in json.dumps(call('output.read')))
        call('runtime.interact',{'target':run['id'],'action':'click'})
        # The runtime processes queued events independently; inspection never touches IDE DOM.
        dialog=None
        for _ in range(30):
            inspected=call('runtime.inspect')['runtime']
            dialog=next((d for d in inspected['dialogs'] if d['active']),None)
            if dialog: break
            page.wait_for_timeout(50)
        check(dialog and dialog['input'],'InputBox did not open')
        call('runtime.interact',{'target':dialog['id'],'action':'dialog','button':0,'value':'agent-approved-input'})
        page.wait_for_function("vb6Studio.output.some(s=>s.includes('agent-approved-input'))")
        call('runtime.capture')
        check('agent-approved-input' in call('files.read',{'path':'/agent.txt'})['content'])
        check(call('runtime.snapshot')['snapshot']['vfs'])
        call('runtime.stop')
        check(call('project.get')['runState']=='design')
        # Reject remote security operations even when every scope is delegated.
        for name,values in [('commands.execute',{'command':'mcpAgentAccess'}),('workspace.configure',{'appearance':{'mcpSharing':True}}),('runtime.interact',{'target':'owner-document','action':'click'})]:
            try: call(name,values)
            except Exception: pass
            else: raise AssertionError('Unsafe route accepted: '+name)
        check(page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        # Revoking is local and stops the next operation at a deny-by-default prompt.
        tab(page,'Agent permissions')
        page.get_by_role('button',name='Revoke agent permissions',exact=True).click()
        check(not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        pending=harness.begin(page,info if network else None,'vb6.code.edit',{'expectedRevision':page.evaluate('vb6Studio.mcp.adapter.revision'),'edits':[{'module':'Form1','start':0,'end':0,'text':'unauthorized'}]})
        page.get_by_role('dialog',name='Allow MCP operation?',exact=True).get_by_role('button',name='Deny',exact=True).click()
        denied=harness.result(page,pending);check('declined' in str(denied),str(denied))
        check(not call('module.read',{'module':'Form1'})['code'].startswith('unauthorized'))
        # Sharing/reload never inherits grants. No remote way to restore them.
        delegate(page,('code',))
        page.evaluate('vb6Studio.mcp.setSharing(false)')
        check(not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        check(not errors,'Unexpected page errors: '+str(errors))
        (ROOT/'reports/screenshots').mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(ROOT/('reports/screenshots/mcp-agent-'+mode+'.png')))
        if mode!='opaque':
            page.reload();page.wait_for_function('!!globalThis.vb6Studio?.mcp')
            check(not page.evaluate('vb6Studio.mcp.adapter.enabled || vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'))
        return {'catalog':len(catalog),'exercisedTools':sorted(touched),'externalHTTP':network,'delegation':'local-only / scoped / revoked','debugger':'inspect,assign,frame,run-to-cursor,live-edit,evaluate,immediate,step,continue','runtime':'controls,grid,menu,inputbox,virtual-files','errors':errors}
    except Exception:
        (ROOT/'reports/screenshots').mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(ROOT/('reports/screenshots/mcp-agent-failed-'+mode+'.png')))
        print('Touched:',', '.join(sorted(touched)),flush=True)
        raise
    finally:
        context.close()

fixture=None
try:
    info={}
    if not args.opaque:
        fixture=subprocess.Popen(['node',str(ROOT/'tools/mcp-browser-fixture.mjs')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        info=json.loads(fixture.stdout.readline())
    with sync_playwright() as p:
        launch={'headless':True,'args':['--no-sandbox']}
        if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
        browser=p.chromium.launch(**launch);version=browser.version
        for mode in (['opaque'] if args.opaque else ['file','hosted-subpath','https-hosted-subpath','localhost']):
            start=time.monotonic()
            try:
                detail=exercise(browser,mode,info);results.append({'mode':mode,'passed':True,'details':detail});print('PASS agent workflow:',mode,flush=True)
            except Exception as error:
                results.append({'mode':mode,'passed':False,'error':str(error)});traceback.print_exc(limit=8)
            results[-1]['seconds']=round(time.monotonic()-start,3)
        browser.close()
finally:
    if fixture:
        fixture.terminate()
        try:fixture.wait(timeout=8)
        except subprocess.TimeoutExpired:fixture.kill()
    (ROOT/'reports').mkdir(exist_ok=True)
    (ROOT/'reports/mcp-agent-browser.json').write_text(json.dumps({'browser':locals().get('version'),'opaqueUIOnly':args.opaque,'results':results},indent=2))
raise SystemExit(0 if results and all(r['passed'] for r in results) else 1)

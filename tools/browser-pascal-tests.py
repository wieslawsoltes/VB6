#!/usr/bin/env python3
"""Pascal acceptance against the generated IDE, workers and exported apps.

Run on HTTP or a real offline file, with the classic or optional Monaco editor.
MCP cases use the real in-process dispatcher after UI authorization; the separate
MCP transport suites qualify external HTTP connections. No compiler is mocked.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import threading
import time
import traceback
import zipfile

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', choices=('chromium', 'firefox', 'webkit'),
                    default=os.environ.get('VB6_BROWSER', 'chromium'))
parser.add_argument('--origin', choices=('http', 'file'),
                    default=os.environ.get('VB6_TEST_TRANSPORT', 'http'))
parser.add_argument('--advanced', action='store_true')
parser.add_argument('--case', default='', help='Local diagnosis: select case names containing this text.')
args = parser.parse_args()
EDITOR = 'advanced' if args.advanced else 'standard'
ARTIFACT = ROOT / 'dist' / ('VB6-Studio-Web-Advanced.html' if args.advanced else 'VB6-Studio-Web.html')
REPORT = ROOT / 'reports' / 'pascal' / args.browser / args.origin / EDITOR
REPORT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('pascal_mcp_harness', ROOT / 'tools/mcp-browser-harness.py')
mcp_harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp_harness)


def check(value, message='Assertion failed'):
    if not value:
        raise AssertionError(str(message))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = None
if args.origin == 'http':
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f'http://127.0.0.1:{server.server_port}'


def url(path):
    return base_url + '/' + path.relative_to(ROOT).as_posix() if server else path.as_uri()


def command(page, name):
    # A run command may wait on startup code that is intentionally paused. Do not
    # await the whole command before the test can inspect/continue the debugger.
    page.evaluate('(name)=>{void vb6Studio.command(name);}', name)


def enable_editor(page):
    if args.advanced:
        check(page.evaluate('vb6Studio.advancedEditor.configure({enabled:true})'))
        page.wait_for_function('''()=>{
          const s=vb6Studio.advancedEditor.runtime?.surfaces.get(vb6Studio.editor);
          return s?.record?.model&&s.view.getLayoutInfo().width>100;
        }''')


def focus_code(page, line=1, column=1):
    page.evaluate('''({line,column})=>{
      vb6Studio.editor.goToLine(line,column);
      const s=vb6Studio.advancedEditor?.runtime?.surfaces.get(vb6Studio.editor);
      if(s){s.view.setPosition({lineNumber:line,column});s.view.revealLineInCenter(line);s.focus();}
      else vb6Studio.editor.input.focus();
    }''', {'line': line, 'column': column})


def studio(browser, errors, requests):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    try:
        context.set_default_timeout(20000)
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        context.on('request', lambda request: requests.append(request.url))
        page = context.new_page()
        # Wait for the standalone app and its APIs instead of coupling IDE
        # readiness to WebKit's load event. Retain the shorter action timeout
        # for every acceptance assertion after startup.
        page.goto(url(ARTIFACT), wait_until='commit', timeout=60000)
        page.wait_for_function(
            'globalThis.vb6Studio?.root?.isConnected&&globalThis.vb6Studio?.mcp&&globalThis.VB6StudioAPI',
            timeout=60000)
        page.evaluate('async()=>{await vb6Studio.setRenderingPolicy({backend:"html"});}')
        return page
    except Exception:
        try:
            context.close()
        except Exception:
            pass
        raise


def load_example(page):
    page.evaluate('''()=>{
      const p=VB6StudioAPI.createPascalExample();p.settings.renderer='canvas2d';
      vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,'code');
    }''')
    enable_editor(page)


def no_errors(page):
    result = page.evaluate('''()=>{
      const p=VB6StudioAPI.compileProject(vb6Studio.project);
      return {valid:p.valid,diagnostics:p.diagnostics};
    }''')
    check(result['valid'], result['diagnostics'])
    return result


def syntax_result(page):
    responses = page.evaluate('vb6Studio.syntaxDiagnostics.metrics.responses')
    page.evaluate('vb6Studio.syntaxDiagnostics.schedule(vb6Studio.project,0)')
    page.wait_for_function('''responses=>!vb6Studio.syntaxDiagnostics.pending&&
      vb6Studio.syntaxDiagnostics.metrics.responses>responses''', arg=responses)
    result = page.evaluate('''()=>({mode:vb6Studio.syntaxDiagnostics.mode,
      diagnostics:vb6Studio.diagnostics.filter(d=>d.origin==='syntax')})''')
    check(result['mode'] == 'worker', result)
    return result


def project_designer(page):
    command(page, 'new')
    dialog = page.get_by_role('dialog', name='New Project', exact=True)
    dialog.wait_for()
    dialog.get_by_role('option', name='Standard EXE', exact=True).click()
    language = dialog.get_by_label('Programming language', exact=True)
    check(language.input_value() == 'vb6', 'Visual Basic must remain the default')
    language.select_option('pascal')
    dialog.get_by_role('button', name='Open', exact=True).click()
    dialog.wait_for(state='hidden')
    page.wait_for_function('vb6Studio.project.language==="pascal"')
    check(page.evaluate('vb6Studio.activeModule.language') == 'pascal')
    check('unit Form1;' in page.evaluate('vb6Studio.activeModule.code'))
    # Real toolbox and designer gestures exercise the shared control/event path.
    page.locator('.toolbox-grid [data-control-type="CommandButton"]').dblclick()
    page.wait_for_function('vb6Studio.activeModule.form.controls.length===1')
    control = page.evaluate('vb6Studio.activeModule.form.controls[0].name')
    page.locator('.designer-form [data-control="' + control + '"]').dblclick()
    page.wait_for_function('name=>vb6Studio.editor.text.includes("procedure "+name+"_Click")', arg=control)
    enable_editor(page)
    code = page.evaluate('vb6Studio.editor.text')
    check('Private Sub' not in code and code.rstrip().endswith('end.'), code)
    check(page.evaluate('vb6Studio.editor.sourceLanguage') == 'pascal')
    no_errors(page)
    page.screenshot(path=str(REPORT / 'pascal-designer-event.png'), animations='disabled')
    page.locator('.menubar [data-menu="Project"]').click()
    page.get_by_role('menuitem', name='Add Visual Basic Class Module', exact=True).click()
    page.wait_for_function('vb6Studio.activeModule.kind==="class"')
    check(page.evaluate('vb6Studio.activeModule.language') == 'vb6')
    check(page.evaluate('vb6Studio.activeModule.code.startsWith("Option Explicit")'))
    no_errors(page)
    return {'language': 'pascal', 'control': control, 'event': control + '_Click', 'classLanguage': 'vb6'}


def forms_and_roundtrip(page):
    load_example(page)
    no_errors(page)
    command(page, 'run')
    frame = page.frame_locator('.runtime-window iframe')
    frame.locator('[data-control="NameText"] input').fill('Grace')
    frame.locator('[data-control="GreetButton"]').click()
    frame.locator('[data-control="GreetingLabel"]').filter(has_text='Hello, Grace!').wait_for()
    frame.locator('[data-control="NameText"] input').fill('Ada')
    frame.locator('[data-control="NameText"] input').press('Enter')
    frame.locator('[data-control="GreetingLabel"]').filter(has_text='Hello, Ada!').wait_for()
    page.screenshot(path=str(REPORT / 'pascal-form-runtime.png'), animations='disabled')
    page.evaluate('()=>vb6Studio.stop(false)')
    page.wait_for_function('vb6Studio.runState==="design"&&!vb6Studio.runtimeFrame')

    # Exercise actual source download and snapshot overlay, including a .pp path.
    page.evaluate('vb6Studio.project.modules[0].sourcePath="forms/Greeting.pp"')
    with page.expect_download() as pending:
        command(page, 'exportSources')
    archive = REPORT / pending.value.suggested_filename
    pending.value.save_as(archive)
    with zipfile.ZipFile(archive) as source:
        entries = {name: source.read(name).decode('utf-8') for name in source.namelist()}
    check('forms/Greeting.pp' in entries and 'forms/Greeting.pp.form.json' in entries, list(entries))
    snapshot = next(name for name in entries if name.endswith('.vb6web'))
    entries['forms/Greeting.pp'] = entries['forms/Greeting.pp'].replace("'Hello, '", "'Welcome, '")
    restored = page.evaluate('''async ({entries,snapshot})=>{
      const imported=await VB6StudioAPI.importFiles(new Map(Object.entries(entries)),{entryPath:snapshot});
      vb6Studio.loadProject(imported.project);
      const m=vb6Studio.project.modules[0];
      return {language:vb6Studio.project.language,path:m.sourcePath,controls:m.form.controls.length,code:m.code};
    }''', {'entries': entries, 'snapshot': snapshot})
    check(restored['language'] == 'pascal' and restored['path'] == 'forms/Greeting.pp', restored)
    check(restored['controls'] == 3 and "'Welcome, '" in restored['code'], restored)
    no_errors(page)
    with page.expect_download() as pending:
        command(page, 'exportHTML')
    application = REPORT / pending.value.suggested_filename
    pending.value.save_as(application)
    exported = page.context.new_page()
    exported.goto(url(application))
    exported.locator('[data-control="NameText"] input').fill('Pascal')
    exported.locator('[data-control="GreetButton"]').click()
    exported.locator('[data-control="GreetingLabel"]').filter(has_text='Welcome, Pascal!').wait_for()
    exported.close()
    return {'sourcePath': restored['path'], 'controls': restored['controls'],
            'exportSHA256': hashlib.sha256(application.read_bytes()).hexdigest()}


def number_lab(page):
    command(page, 'new')
    dialog = page.get_by_role('dialog', name='New Project', exact=True)
    dialog.get_by_role('option', name='Turbo Pascal Number Lab', exact=True).click()
    check(dialog.get_by_label('Programming language', exact=True).input_value() == 'pascal',
          'Number Lab template reports the wrong source language')
    dialog.get_by_role('button', name='Open', exact=True).click()
    page.wait_for_function('vb6Studio.project.name==="PascalNumberLab"')
    check(page.evaluate('vb6Studio.project.language==="pascal"&&vb6Studio.project.modules.length===2'))
    no_errors(page)
    command(page, 'run')
    frame = page.frame_locator('.runtime-window iframe')
    field = frame.locator('[data-control="InputText"] input')
    results = frame.locator('[data-control="ResultsList"]')
    results.filter(has_text='Fibonacci(N) = 55').wait_for()
    field.fill('40'); field.press('Enter')
    results.filter(has_text='Fibonacci(N) = 102334155').wait_for()
    check('1 + ... + N = 820' in results.inner_text(), 'NumberSeries unit returned an incorrect triangular number')
    field.fill('41'); frame.locator('[data-control="CalculateButton"]').click()
    frame.locator('[data-control="StatusLabel"]').filter(has_text='Enter a whole number from 0 to 40.').wait_for()
    frame.locator('[data-control="SaveButton"]').click()
    frame.locator('[data-control="StatusLabel"]').filter(has_text='Calculate valid results before saving.').wait_for()
    field.fill('0'); field.press('Enter')
    results.filter(has_text='Fibonacci(N) = 0').wait_for()
    frame.locator('[data-control="SaveButton"]').click()
    frame.locator('[data-control="StatusLabel"]').filter(has_text='Saved Pascal-Results.txt.').wait_for()
    page.screenshot(path=str(REPORT / 'pascal-number-lab.png'), animations='disabled')
    page.evaluate('()=>vb6Studio.stop(false)')
    page.wait_for_function('vb6Studio.runState==="design"&&!vb6Studio.runtimeFrame')
    with page.expect_download() as pending:
        command(page, 'exportSources')
    archive = REPORT / pending.value.suggested_filename
    pending.value.save_as(archive)
    with zipfile.ZipFile(archive) as source:
        entries = source.namelist()
        check({'Form1.pas', 'Form1.pas.form.json', 'NumberSeries.pas'}.issubset(entries), entries)
        check('uses NumberSeries;' in source.read('Form1.pas').decode('utf-8'))
        check('function Fibonacci(N: Integer): LongInt;' in source.read('NumberSeries.pas').decode('utf-8'))
    with page.expect_download() as pending:
        command(page, 'exportHTML')
    application = REPORT / pending.value.suggested_filename
    pending.value.save_as(application)
    exported = page.context.new_page()
    exported.goto(url(application))
    exported.locator('[data-control="ResultsList"]').filter(has_text='Fibonacci(N) = 55').wait_for()
    exported.locator('[data-control="SaveButton"]').click()
    exported.locator('[data-control="StatusLabel"]').filter(has_text='Saved Pascal-Results.txt.').wait_for()
    saved = exported.evaluate('vb6Application.fs.read("/Pascal-Results.txt")')
    check(saved == 'TURBO PASCAL NUMBER LAB\r\nN = 10\r\nFibonacci(N) = 55\r\n1 + ... + N = 55\r\n', saved)
    check(exported.evaluate('vb6Application.fs.handles.size') == 0, 'Pascal save leaked an open file')
    exported.close()
    return {'units': 2, 'sourceEntries': entries, 'savedText': saved,
            'exportSHA256': hashlib.sha256(application.read_bytes()).hexdigest()}


def editing_and_diagnostics(page):
    load_example(page)
    initial = syntax_result(page)
    check(not initial['diagnostics'], initial)
    completion = page.evaluate('''()=>vb6Studio.editor.intelligence.completions(
      vb6Studio.project,vb6Studio.activeModule,1,'NameText.',9).items.map(i=>i.name)''')
    check('Text' in completion and 'SelStart' in completion and 'Nodes' not in completion, completion)
    before = page.evaluate('vb6Studio.editor.text')
    # A real keyboard insertion must enter project history in either editor.
    lines = before.splitlines()
    focus_code(page, len(lines), len(lines[-1]) + 1)
    page.keyboard.press('Control+End')
    page.keyboard.insert_text('\n{ Pascal browser editing }\n')
    page.wait_for_function('vb6Studio.activeModule.code.includes("Pascal browser editing")')
    command(page, 'undo')
    page.wait_for_function('code=>vb6Studio.activeModule.code===code', arg=before)
    # Designer-only changes must invalidate cached Pascal form declarations.
    page.evaluate('''()=>{
      vb6Studio.openDocument(vb6Studio.activeModule.id,'form');
      const c=vb6Studio.activeModule.form.controls.find(c=>c.name==='GreetingLabel');
      vb6Studio.designer.select([c.id]);vb6Studio.designer.deleteSelected();
    }''')
    missing = syntax_result(page)
    check(any('greetinglabel' in d['message'].lower() for d in missing['diagnostics']), missing)
    command(page, 'undo')
    restored = syntax_result(page)
    check(not restored['diagnostics'], restored)
    no_errors(page)
    return {'workerMode': restored['mode'], 'controlCompletion': ['Text', 'SelStart'],
            'designerInvalidation': True, 'undoRestoredSource': True}


def grant_mcp(page):
    command(page, 'mcpAgentAccess')
    page.locator('.mcp-panel').get_by_role('tab', name='Agent access', exact=True).click()
    sharing = page.get_by_label('Enable MCP sharing', exact=True)
    if not sharing.is_checked():
        sharing.check()
        page.get_by_role('dialog').get_by_role('button', name='Enable sharing', exact=True).click()
        page.wait_for_function("!vb6Studio.documents.tools.get('tool:mcp').operation")
    page.locator('.mcp-panel').get_by_role('tab', name='Agent permissions', exact=True).click()
    for scope in ('code', 'project', 'designer'):
        page.get_by_label('Agent scope ' + scope, exact=True).check()
    page.get_by_role('button', name='Grant selected permissions', exact=True).click()
    page.get_by_role('dialog', name='Authorize coding agents?', exact=True).get_by_role(
        'button', name='Authorize session', exact=True).click()
    page.wait_for_function('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active')
    mcp_harness.install_peer(page)


def mcp_call(page, name, values=None, write=False):
    return page.evaluate('''async ({name,values,write})=>{
      const args={...(values||{})};if(write)args.expectedRevision=vb6Studio.mcp.adapter.revision;
      const result=await agentClient.callTool('vb6.'+name,args);
      return result.structuredContent;
    }''', {'name': name, 'values': values, 'write': write})


def mcp_workflow(page):
    page.evaluate('vb6Studio.loadProject(VB6StudioAPI.newProject("PascalAgent"))')
    grant_mcp(page)
    mcp_call(page, 'project.new', {'name': 'PascalAgent', 'language': 'pascal'}, True)
    # Grants follow a project identity; explicitly authorize the new project.
    if not page.evaluate('vb6Studio.mcp.adapter.permissions.snapshot(vb6Studio.project.id).active'):
        grant_mcp(page)
    details = mcp_call(page, 'project.details')
    check([item['id'] for item in details['supportedLanguages']] == ['vb6', 'pascal'], details)
    mcp_call(page, 'module.add', {'name': 'SharedVB', 'kind': 'module', 'language': 'vb6'}, True)
    mcp_call(page, 'control.edit', {'module': 'Form1', 'action': 'add', 'name': 'Input1', 'type': 'TextBox'}, True)
    mcp_call(page, 'procedure.event', {'module': 'Form1', 'id': 'Input1', 'event': 'KeyPress'}, True)
    mcp_call(page, 'code.transform', {'module': 'Form1', 'action': 'format'}, True)
    mcp_call(page, 'module.metadata', {'module': 'Form1', 'sourcePath': 'src/Form1.pas'}, True)
    source = mcp_call(page, 'module.read', {'module': 'Form1'})
    check(source['language'] == 'pascal' and source['sourcePath'] == 'src/Form1.pas', source)
    check('procedure Input1_KeyPress(var KeyAscii: Integer)' in source['code'], source)
    check(page.evaluate('vb6Studio.project.modules.find(m=>m.name==="SharedVB").language') == 'vb6')
    no_errors(page)
    stale = page.evaluate('vb6Studio.mcp.adapter.revision')
    mcp_call(page, 'project.update', {'description': 'Revision guard qualification'}, True)
    rejected = page.evaluate('''async revision=>{
      try{await agentClient.callTool('vb6.code.transform',{module:'Form1',action:'format',expectedRevision:revision});return false;}
      catch(error){return /revision/i.test(error.message);}
    }''', stale)
    check(rejected, 'Stale MCP writes must be rejected')
    check(mcp_call(page, 'module.read', {'module': 'Form1'})['code'] == source['code'])
    return {'transport': 'real in-process MCP dispatcher', 'mutableEvent': 'var KeyAscii: Integer',
            'mixedLanguage': True, 'staleWriteRejected': True}


DEBUG_SOURCE = '''program DebugPascal;
var Counter: Integer;
    Values: array[1..2] of Integer;
begin
  Counter := 1;
  Values[1] := 4;
  Counter := Counter + Values[1];
  Counter := Counter + 1;
  Values[2] := Counter * 2;
  WriteLn(Counter);
end.
'''


def inspect(page, expression):
    return page.evaluate('''expression=>vb6Studio.requestRuntime('debugInspect',{
      expression,frameIndex:vb6Studio.debuggerWindows.frameIndex})''', expression)


def source_debugger(page):
    page.evaluate('''code=>{
      const p=VB6StudioAPI.newProject('PascalDebug',{language:'pascal'});
      p.modules=[{id:'pascal-main',name:'DebugPascal',kind:'module',language:'pascal',code}];
      p.startup='Sub Main';vb6Studio.loadProject(p);vb6Studio.openDocument('pascal-main','code');
      globalThis.pascalPauses=[];vb6Studio.on('pause',event=>pascalPauses.push(event));
    }''', DEBUG_SOURCE)
    enable_editor(page)
    no_errors(page)
    focus_code(page, 8)
    page.keyboard.press('F9')
    check(page.evaluate('vb6Studio.breakpoints.length') == 1)
    page.evaluate('''()=>{
      vb6Studio.breakpoints[0].condition='Counter = 5';vb6Studio.syncBreakpoints();
      vb6Studio.watches=['Values[1] + Counter'];
    }''')
    command(page, 'run')
    # Synchronize on the authored source pause, not the asynchronous initial
    # runtime-ready signal or a stale state from the previous command.
    page.wait_for_function('''()=>vb6Studio.runState==='paused'&&pascalPauses.length===1&&
      pascalPauses[0].source==='DebugPascal'&&pascalPauses[0].line===8''')
    pause = page.evaluate('pascalPauses[0]')
    check(pause['reason'] == 'breakpoint', pause)
    check(inspect(page, 'Counter')['value'] == '5')
    check(inspect(page, 'Values[1] + Counter')['value'] == '9')
    page.wait_for_function('''vb6Studio.watchValues.some(v=>
      v.expression==='Values[1] + Counter'&&v.value==='9')''')
    focus_code(page, 8)
    page.keyboard.press('F8')
    page.wait_for_function('''()=>vb6Studio.runState==='paused'&&pascalPauses.length===2&&
      pascalPauses[1].source==='DebugPascal'&&pascalPauses[1].line===9''')
    check(inspect(page, 'Counter')['value'] == '6')
    page.wait_for_function('''vb6Studio.watchValues.some(v=>
      v.expression==='Values[1] + Counter'&&v.value==='10')''')
    check(page.evaluate('vb6Studio.editor.execution.line') == 9)
    page.screenshot(path=str(REPORT / 'pascal-source-debugger.png'), animations='disabled')
    command(page, 'immediate')
    field = page.get_by_label('Immediate expression', exact=True)
    field.fill('Counter := Counter + 2')
    field.press('Enter')
    page.wait_for_function('vb6Studio.locals.some(v=>v.name.toLowerCase()==="counter"&&v.value==="8")')
    page.wait_for_function('''vb6Studio.watchValues.some(v=>
      v.expression==='Values[1] + Counter'&&v.value==='12')''')
    check(inspect(page, 'Counter div 3')['value'] == '2')
    check(inspect(page, '2 in [1..3]')['value'].lower() == 'true')
    command(page, 'run')
    page.wait_for_function('vb6Studio.output.includes("8")')
    check(page.evaluate('pascalPauses.length') == 2)
    return {'breakpointLine': 8, 'steppedLine': 9, 'conditionalBreakpoint': True,
            'watchValues': ['9', '10', '12'], 'typedImmediate': True, 'output': '8'}


def monaco_language(page):
    load_example(page)
    result = page.evaluate('''async()=>{
      const runtime=vb6Studio.advancedEditor.runtime,s=runtime.surfaces.get(vb6Studio.editor);
      const model=s.record.model,client=s.record.client,uri=s.record.uri;
      const tokens=VB6AdvancedMonaco.monaco.editor.tokenize("program Demo; {comment}",'pascal')[0];
      const symbols=await client.request('textDocument/documentSymbol',{textDocument:{uri}});
      const hints=await client.request('textDocument/inlayHint',{textDocument:{uri},
        range:{start:{line:0,character:0},end:{line:model.getLineCount()-1,character:0}}});
      return {language:model.getLanguageId(),uri,tokens,symbols,hints,
        synced:client.documents.get(uri).text===model.getValue()&&model.getValue()===vb6Studio.editor.text};
    }''')
    check(result['language'] == 'pascal' and result['synced'], result)
    check(any('keyword' in token['type'] for token in result['tokens']), result['tokens'])
    check(any('comment' in token['type'] for token in result['tokens']), result['tokens'])
    check('GreetButton_Click' in json.dumps(result['symbols']), result['symbols'])
    check(not any(' As ' in json.dumps(hint) for hint in result['hints'] or []), result['hints'])
    page.screenshot(path=str(REPORT / 'pascal-monaco-language.png'), animations='disabled')
    return {'language': result['language'], 'synchronized': result['synced'],
            'workerSymbols': True, 'pascalTokens': True, 'vbDeclarationInlays': False}


cases = [
    ('project language, shared designer and Pascal event generation', project_designer),
    ('form events, source round-trip and standalone HTML execution', forms_and_roundtrip),
    ('Number Lab catalog, Pascal units, validation, files and standalone execution', number_lab),
    ('source edits, control completion and real diagnostic worker invalidation', editing_and_diagnostics),
    ('MCP language, mixed modules, mutable events and revision guards', mcp_workflow),
    ('Pascal source breakpoints, stepping, watches and typed Immediate', source_debugger),
]
if args.advanced:
    cases.append(('Monaco Pascal tokens, worker symbols and synchronized document', monaco_language))

results = []
try:
    artifact_hash = hashlib.sha256(ARTIFACT.read_bytes()).hexdigest()
    with sync_playwright() as playwright:
        engine = getattr(playwright, args.browser)
        options = {'headless': True}
        if args.browser == 'chromium':
            options.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or engine.executable_path,
                           args=['--no-sandbox'])
        browser = engine.launch(**options)
        browser_version = browser.version
        for name, run in cases:
            if args.case and args.case.lower() not in name.lower():
                continue
            started = time.perf_counter()
            errors, requests = [], []
            result = {'name': name, 'passed': False}
            page = None
            try:
                page = studio(browser, errors, requests)
                result['detail'] = run(page)
                check(not errors, errors)
                network = [request for request in requests if request.startswith(('http:', 'https:'))]
                check(all(server and request.startswith(base_url + '/') for request in network), network)
                result['passed'] = True
                print('PASS', name, flush=True)
            except Exception as error:
                result.update(error=str(error), traceback=traceback.format_exc())
                print('FAIL', name, str(error), flush=True)
                if page:
                    try:
                        page.screenshot(path=str(REPORT / ('failure-' + str(len(results) + 1) + '.png')),
                                        animations='disabled', timeout=5000)
                    except Exception:
                        pass
            finally:
                result.update(pageErrors=errors, milliseconds=round((time.perf_counter() - started) * 1000, 2))
                results.append(result)
                for context in list(browser.contexts):
                    context.close()
        browser.close()
    report = {'browser': args.browser, 'browserVersion': browser_version, 'origin': args.origin,
              'editor': EDITOR, 'artifact': ARTIFACT.name, 'artifactSHA256': artifact_hash,
              'completeMatrixCell': not args.case and len(results) == len(cases), 'results': results,
              'passed': bool(results) and all(result['passed'] for result in results)}
    (REPORT / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': sum(result['passed'] for result in results), 'total': len(results),
                      'browser': args.browser, 'origin': args.origin, 'editor': EDITOR}), flush=True)
    raise SystemExit(0 if report['passed'] else 1)
finally:
    if server:
        server.shutdown()
        server.server_close()

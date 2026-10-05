#!/usr/bin/env python3
"""Debugger integration against the generated standalone IDE and exported apps.
No mocks, network dependencies, or claims of native VB6 binary certification.
"""
from pathlib import Path
import argparse
import json
import os
import shutil
import time
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/debugger-runtime'
HTML = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
RESULTS = []


def check(value, message='Assertion failed'):
    if not value:
        raise AssertionError(str(message))


def command(page, name):
    page.evaluate('(name)=>{void vb6Studio.command(name);}', name)


def project(page, code, classes=None, trapping='unhandled'):
    page.evaluate('''({code,classes,trapping})=>{
      const p=VB6StudioAPI.newProject('Debugger');
      p.modules=[{id:'main',name:'M',kind:'module',code},...(classes||[])];
      p.startup='Sub Main';p.settings.errorTrapping=trapping;
      vb6Studio.loadProject(p);vb6Studio.openDocument('main','code');
      globalThis.debugPauses=[];vb6Studio.on('pause',e=>debugPauses.push(e));
    }''', {'code': code, 'classes': classes, 'trapping': trapping})


def paused(page, count=1):
    page.wait_for_function('(n)=>vb6Studio.runState==="paused"&&debugPauses.length>=n', arg=count)
    return page.evaluate('debugPauses.at(-1)')


def inspect(page, expression, frame=None):
    return page.evaluate('''({expression,frame})=>vb6Studio.requestRuntime('debugInspect',{
      expression,frameIndex:frame??vb6Studio.debuggerWindows.frameIndex})''',
                        {'expression': expression, 'frame': frame})


def immediate(page, text, frame=None):
    return page.evaluate('''({text,frame})=>vb6Studio.requestRuntime('agentImmediate',{
      text,frameIndex:frame??vb6Studio.debuggerWindows.frameIndex,pauseId:vb6Studio.debuggerWindows.pauseId})''',
                        {'text': text, 'frame': frame})


def cursor(page, line, column=1):
    page.evaluate('''({line,column})=>{vb6Studio.editor.goToLine(line,column);vb6Studio.editor.input.focus();}''',
                  {'line': line, 'column': column})


def output(page, value):
    page.wait_for_function('(text)=>vb6Studio.output.includes(text)', arg=value)


def error_dialog(page):
    dialog = page.get_by_role('dialog', name='Microsoft Visual Basic', exact=True)
    dialog.wait_for()
    # Give the compositor a completed frame after hiding the cross-origin iframe;
    # DOM visibility alone does not synchronize headless Chromium's OOPIF hit test.
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    return dialog


def dismiss_error_for_debugging(page):
    dialog = error_dialog(page)
    dialog.get_by_role('button', name='Debug', exact=True).click()
    # Modal teardown restores focus asynchronously; shortcut input must target
    # the editor, not an outgoing dialog or the isolated runtime frame.
    dialog.wait_for(state='hidden')
    page.wait_for_function('document.activeElement===vb6Studio.editor.input')


def screenshot(page, name):
    page.screenshot(path=str(REPORT / (name + '.png')), caret='hide', animations='disabled')


def options(page):
    project(page, 'Sub Main()\nDebug.Print 1\nEnd Sub')
    command(page, 'options')
    page.get_by_role('tab', name='General', exact=True).click()
    select = page.get_by_label('Error Trapping', exact=True)
    check(select.locator('option').all_text_contents() == [
        'Break on All Errors', 'Break in Class Module', 'Break on Unhandled Errors'])
    check(select.input_value() == 'unhandled')
    select.select_option('all')
    page.get_by_role('button', name='OK', exact=True).click()
    check(page.evaluate('vb6Studio.project.settings.errorTrapping') == 'all')


def recover_fault(page):
    project(page, 'Sub Main()\nDim divisor As Long, result As Long\nresult = 12 / divisor\nDebug.Print result\nEnd Sub')
    page.keyboard.press('F5')
    info = paused(page)
    check(info['reason'] == 'error' and info['line'] == 3, info)
    dialog = error_dialog(page)
    check("Run-time error '11'" in dialog.inner_text())
    check(inspect(page, 'divisor')['value'] == '0')
    check(len(page.evaluate('vb6Studio.stack')) == 1)
    screenshot(page, 'retained-error-frame')
    dialog.get_by_role('button', name='Help', exact=True).click()
    check('retry the statement' in dialog.inner_text())
    dialog.get_by_role('button', name='Debug', exact=True).click()
    command(page, 'immediate')
    field = page.get_by_label('Immediate expression', exact=True)
    field.fill('divisor = 3')
    field.press('Enter')
    page.wait_for_function('vb6Studio.locals.some(v=>v.name.toLowerCase()==="divisor"&&v.value==="3")')
    page.keyboard.press('F5')
    output(page, '4')
    check(page.evaluate('debugPauses.length') == 1)
    check(dialog.count() == 0)
    check(page.evaluate('vb6Studio.runState') == 'running')


def handled_error(page):
    project(page, 'Sub Main()\nOn Error Resume Next\nErr.Raise 5, "test", "Handled error"\nDebug.Print Err.Number\nEnd Sub', trapping='all')
    command(page, 'run')
    info = paused(page)
    check(info['error']['handled'] and info['error']['trapping'] == 'all', info)
    dismiss_error_for_debugging(page)
    page.keyboard.press('F5')
    output(page, '5')
    check(page.evaluate('debugPauses.length') == 1)


def class_error(page):
    project(page, 'Sub Main()\nOn Error Resume Next\nDim item As New Thing\nitem.Fail\nDebug.Print Err.Number\nEnd Sub',
            [{'id': 'thing', 'name': 'Thing', 'kind': 'class',
              'code': 'Public Sub Fail()\nDim local As Long\nlocal = 7\nErr.Raise 6\nEnd Sub'}], 'class')
    command(page, 'run')
    info = paused(page)
    check(info['source'] == 'Thing' and info['line'] == 4, info)
    check([f['line'] for f in info['stack']] == [4, 4], info['stack'])
    check(inspect(page, 'local')['value'] == '7')
    check(inspect(page, 'item', 0)['type'] == 'Thing')
    error_dialog(page).get_by_role('button', name='End', exact=True).click()
    page.wait_for_function('vb6Studio.runState==="design"&&!vb6Studio.runtimeFrame')
    check(page.get_by_role('dialog').count() == 0)
    check(page.locator('.runtime-window').count() == 0)


def colon_steps(page):
    project(page, 'Sub Main()\nDim x As Long\nx = 1: x = 2: Debug.Print x\nEnd Sub')
    page.keyboard.press('F8')
    first = paused(page)
    check(first['line'] == 3 and first['column'] == 1, first)
    check(''.join(page.locator('.code-execution').all_text_contents()) == 'x = 1')
    check(inspect(page, 'x')['value'] == '0')
    cursor(page, 3)
    page.keyboard.press('F8')
    second = paused(page, 2)
    check(second['column'] == 8, second)
    check(''.join(page.locator('.code-execution').all_text_contents()) == 'x = 2')
    check(inspect(page, 'x')['value'] == '1')
    page.keyboard.press('Shift+F8')
    third = paused(page, 3)
    check(third['column'] == 15, third)
    check(inspect(page, 'x')['value'] == '2')
    screenshot(page, 'statement-level-stepping')
    page.keyboard.press('F5')
    output(page, '2')
    check(page.evaluate('debugPauses.length') == 3)


def run_to_cursor(page):
    project(page, 'Sub Main()\nDim x As Long\nx = 1: x = 2: Debug.Print x\nEnd Sub')
    cursor(page, 3, 8)
    page.keyboard.press('Control+F8')
    info = paused(page)
    check(info['reason'] == 'run-to-cursor' and info['column'] == 8, info)
    check(inspect(page, 'x')['value'] == '1')
    page.keyboard.press('F5')
    output(page, '2')
    check(page.evaluate('vb6Studio.breakpoints.length') == 0)


def set_next_statement(page):
    project(page, 'Sub Main()\nDim x As Long\nx = 1: x = 2: Debug.Print x\nEnd Sub')
    page.keyboard.press('F8')
    paused(page)
    cursor(page, 3, 15)
    page.keyboard.press('Control+F9')
    info = paused(page, 2)
    check(info['reason'] == 'set-next' and info['column'] == 15, info)
    check(inspect(page, 'x')['value'] == '0')
    page.keyboard.press('F5')
    output(page, '0')


def breakpoint_lines(page):
    project(page, 'Sub Main()\nDim x As Long\n\' comment\nx = 9\nDebug.Print x\nEnd Sub')
    cursor(page, 2)
    page.keyboard.press('F9')
    check(page.evaluate('vb6Studio.breakpoints.length') == 0)
    cursor(page, 3)
    page.keyboard.press('F9')
    check(page.evaluate('vb6Studio.breakpoints.length') == 0)
    cursor(page, 4)
    page.keyboard.press('F9')
    check(page.evaluate('vb6Studio.breakpoints[0].line') == 4)
    page.keyboard.press('F5')
    info = paused(page)
    check(info['reason'] == 'breakpoint' and info['line'] == 4, info)


def startup_watch(page):
    project(page, 'Sub Main()\nDim x As Long\nx = 1\nx = 2\nDebug.Print x\nEnd Sub')
    page.evaluate('''()=>{vb6Studio.watches=['x'];vb6Studio.debuggerWindows.watchDefinitions=[
      {id:'startup-watch',expression:'x',module:'M',procedure:'Main',mode:'change'}];}''')
    command(page, 'run')
    info = paused(page)
    check(info['reason'] == 'watch:x' and info['line'] == 4, info)
    check(inspect(page, 'x')['value'] == '1')


def live_error_settings(page):
    project(page, 'Sub Main()\nOn Error Resume Next\nErr.Raise 5\nDebug.Print Err.Number\nEnd Sub')
    page.keyboard.press('F8')
    paused(page)
    command(page, 'options')
    page.get_by_role('tab', name='General', exact=True).click()
    page.get_by_label('Error Trapping', exact=True).select_option('all')
    page.get_by_role('button', name='OK', exact=True).click()
    page.get_by_role('dialog').wait_for(state='hidden')
    page.keyboard.press('F5')
    info = paused(page, 2)
    check(info['reason'] == 'error', info)
    dismiss_error_for_debugging(page)
    page.keyboard.press('F5')
    output(page, '5')


def error_modal_isolation(page):
    project(page, 'Sub Main()\nOn Error Resume Next\nErr.Raise 5\nDebug.Print Err.Number\nEnd Sub', trapping='all')
    command(page, 'run')
    paused(page)
    dialog = error_dialog(page)
    check(dialog.evaluate('(d)=>d.tagName==="DIALOG"&&d.matches(":modal")'))
    page.wait_for_function('document.activeElement?.textContent==="Debug"')
    # Even an explicit attempt to focus the sandbox cannot escape browser modality.
    command(page, 'showRuntime')
    check(page.evaluate('''()=>{
      vb6Studio.runtimeFrame.focus();
      return !!document.activeElement.closest('dialog:modal');
    }'''))
    dialog.get_by_role('button', name='Help', exact=True).click()
    check(dialog.evaluate('(d)=>d.matches(":modal")'))
    dismiss_error_for_debugging(page)
    page.keyboard.press('F5')
    output(page, '5')
    check(page.locator('dialog:modal').count() == 0)
    check(page.evaluate('!vb6Studio.root.closest("[inert]")'))
    command(page, 'stop')
    page.wait_for_function('vb6Studio.runState==="design"')
    command(page, 'run')
    paused(page, 2)
    error_dialog(page)
    page.keyboard.press('Escape')
    page.get_by_role('dialog').wait_for(state='hidden')
    check(page.evaluate('vb6Studio.runState') == 'paused')
    page.wait_for_function('document.activeElement===vb6Studio.editor.input')
    page.keyboard.press('F5')
    output(page, '5')


def caller_frame(page):
    project(page, 'Sub Main()\nDim n As Long\nn = 10\nWorker n\nDebug.Print n\nEnd Sub\nSub Worker(ByRef value As Long)\nStop\nvalue = value + 1\nEnd Sub')
    command(page, 'run')
    info = paused(page)
    check([f['line'] for f in info['stack']] == [4, 8], info['stack'])
    command(page, 'locals')
    page.get_by_label('Locals stack frame', exact=True).select_option('0')
    page.wait_for_function('vb6Studio.debuggerWindows.frameIndex===0&&vb6Studio.locals.some(v=>v.name.toLowerCase()==="n")')
    immediate(page, 'n = 20', 0)
    check(inspect(page, 'value', 1)['value'] == '20')
    command(page, 'showNextStatement')
    check(page.evaluate('vb6Studio.editor.cursor().line') == 8)
    page.keyboard.press('Control+Shift+F8')
    info = paused(page, 2)
    check(info['line'] == 5 and info['reason'] == 'step', info)
    check(inspect(page, 'n')['value'] == '21')
    page.keyboard.press('F5')
    output(page, '21')


def release_semantics(page):
    project(page, 'Private n As Long\nSub Main()\nDebug.Assert Bump()\nDebug.Print n\nStop\nDebug.Print 99\nEnd Sub\nFunction Bump() As Boolean\nn = n + 1\nBump = False\nEnd Function')
    html = page.evaluate('VB6StudioAPI.exportApplication(vb6Studio.project,{persist:false})')
    page.set_content(html)
    page.wait_for_function('globalThis.vb6Application?.vm.state==="stopped"')
    check(page.locator('.vb-runtime-console').inner_text().strip() == '0')
    check(page.evaluate('vb6Application.vm.options.debuggerEnabled') is False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--filter', default='')
    args = parser.parse_args()
    REPORT.mkdir(parents=True, exist_ok=True)
    cases = [('Classic Error Trapping options', options),
             ('Retained unhandled error and Immediate repair', recover_fault),
             ('Break on All Errors delivers Resume Next once', handled_error),
             ('Break in Class Module retains callers and End resets', class_error),
             ('F8 and Shift F8 highlight individual colon statements', colon_steps),
             ('Ctrl F8 Run to Cursor starts in design mode', run_to_cursor),
             ('Ctrl F9 redirects to a same-line statement', set_next_statement),
             ('F9 rejects declarations and comments', breakpoint_lines),
             ('Break on Change watch is installed before startup', startup_watch),
             ('Error Trapping can change during a live pause', live_error_settings),
             ('Error dialog isolates sandbox input and releases on Escape', error_modal_isolation),
             ('Caller locals, ByRef edits, and Step Out', caller_frame),
             ('Shipped apps omit Assert evaluation and reset at Stop', release_semantics)]
    with sync_playwright() as playwright:
        engine = os.environ.get('VB6_BROWSER', 'chromium')
        launch = {'headless': True}
        if engine == 'chromium':
            launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
        browser = getattr(playwright, engine).launch(**launch)
        version = browser.version
        for name, test in cases:
            if args.filter and args.filter.lower() not in name.lower():
                continue
            page = browser.new_page(viewport={'width': 1440, 'height': 960})
            page.set_default_timeout(10000)
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('https:', 'http:')) else None)
            start = time.perf_counter()
            try:
                page.set_content(HTML)
                page.wait_for_function('!!globalThis.vb6Studio?.debuggerWindows')
                test(page)
                check(not errors, errors)
                check(not requests, requests)
                RESULTS.append({'name': name, 'passed': True, 'milliseconds': round((time.perf_counter()-start)*1000)})
                print('PASS', name, flush=True)
            except Exception as error:
                RESULTS.append({'name': name, 'passed': False, 'error': str(error)})
                print('FAIL', name, str(error), flush=True)
                traceback.print_exc(limit=4)
                try:
                    screenshot(page, 'failure-' + str(len(RESULTS)))
                except Exception:
                    pass
            finally:
                page.close()
        browser.close()
    report = {'browser': engine, 'version': version, 'passed': sum(r['passed'] for r in RESULTS),
              'failed': sum(not r['passed'] for r in RESULTS), 'tests': RESULTS}
    (REPORT / (engine + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'tests'}))
    raise SystemExit(1 if report['failed'] else 0)


if __name__ == '__main__':
    main()

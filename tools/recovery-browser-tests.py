#!/usr/bin/env python3
"""New recovery validation. This test file was not recovered historical source.
Runs the reconstructed standalone bytes in Chromium and records each outcome.
"""
import json, os, shutil, sys, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/recovery'; REPORT.mkdir(exist_ok=True,parents=True)
HTML=(ROOT/'dist/VB6-Studio-Web.html').read_text()
results=[]; metrics={}
def check(value,message='Assertion failed'):
    if not value: raise AssertionError(message)
def boot(browser):
    p=browser.new_page(viewport={'width':1440,'height':960})
    p.set_default_timeout(4500); p._errors=[]
    p.on('pageerror',lambda e:p._errors.append(str(e)))
    p.set_content(HTML);p.wait_for_function('typeof vb6Studio!=="undefined" && !!vb6Studio.ideTools')
    return p
def command(p,name):p.evaluate('(id)=>{vb6Studio.command(id);}',name)
def case(browser,name,fn):
    p=None;t=time.perf_counter()
    try:
        p=boot(browser);detail=fn(p);check(not p._errors,str(p._errors))
        results.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-t)*1000,2),'details':detail}); print('PASS',name,flush=True)
    except Exception as e:
        results.append({'name':name,'passed':False,'milliseconds':round((time.perf_counter()-t)*1000,2),'error':str(e)})
        print('FAIL',name,str(e),flush=True);traceback.print_exc(limit=2)
        if p:
            try:p.screenshot(path=str(REPORT/('failed-'+str(len(results))+'.png')))
            except:pass
    finally:
        if p:p.close()
def startup(p):
    info=p.evaluate('({docking:vb6Studio.docking.model.windows.size,bars:vb6Studio.commandBars.model.bars.length,debugWindows:[...vb6Studio.debuggerWindows.views.keys()],nativeWindow:vb6Studio.docking.model.windows.has("nativeDebugger"),tools:!!vb6Studio.ideTools,editor:!!vb6Studio.editor.intelligence})')
    check(info['docking']>=12 and info['bars']==4 and info['editor']);
    check(set(info['debugWindows'])=={'immediate','locals','watch','callStack','breakpoints','errors','output','evaluation','executingSource'},str(info));
    check(info['nativeWindow'],'Native debugger must retain its separate dock window');return info
def floating(p):
    p.evaluate('window.savedPanel=vb6Studio.projectPanel;vb6Studio.docking.float("project")')
    check(p.evaluate('vb6Studio.docking.group("project").edge')=='float')
    caption=p.locator('[data-dock-window="project"] .tool-caption')
    caption.focus();p.keyboard.press('Control+Enter')
    check(p.evaluate('vb6Studio.docking.group("project").edge')=='right')
    check(p.evaluate('savedPanel===vb6Studio.projectPanel && savedPanel.isConnected'))
def tabs(p):
    p.evaluate('vb6Studio.docking.dock("project","right",vb6Studio.docking.group("properties").id)')
    p.locator('.dock-tabbar [data-window-id="project"]').click()
    p.locator('.dock-tabbar [data-window-id="project"]').focus()
    p.keyboard.press('ArrowRight')
    check(p.evaluate('vb6Studio.docking.group("project").active')=='properties')
    check(p.locator('[data-dock-window="properties"]').is_visible())
    p.screenshot(path=str(REPORT/'docked-tabs.png'))
def edges(p):
    for edge in ['left','right','top','bottom']:
        p.evaluate('(edge)=>vb6Studio.docking.dock("project",edge)',edge)
        check(p.evaluate('vb6Studio.docking.group("project").edge')==edge)
    before=p.evaluate('vb6Studio.docking.model.sizes.bottom')
    p.get_by_label('Resize bottom dock',exact=True).focus();p.keyboard.press('ArrowUp')
    check(p.evaluate('vb6Studio.docking.model.sizes.bottom')==before+8)
def layout(p):
    data=p.evaluate('()=>{const m=vb6Studio.docking,s=m.snapshot();m.float("properties");m.show("project",false);m.restore(s);return [s,m.snapshot()];}')
    check(data[0]==data[1])
def named_layout(p):
    command(p,'saveWindowLayout');p.locator('.ide-dialog input').fill('Recovered layout');p.get_by_role('button',name='OK',exact=True).click()
    check(p.evaluate('!!vb6Studio.namedLayouts["Recovered layout"]'))
    command(p,'manageWindowLayouts');check(p.get_by_label('Saved layouts').inner_text()=='Recovered layout');p.locator('.ide-dialog').get_by_role('button',name='Close',exact=True).click()
def toolbar(p):
    p.evaluate('vb6Studio.commandBars.show("edit",true);vb6Studio.commandBars.dock("edit","left")')
    check(p.locator('[data-command-bar="edit"]').is_visible())
    check(p.locator('[data-command-bar="edit"]').get_attribute('data-dock')=='left')
    p.evaluate('vb6Studio.commandBars.dock("edit","float")')
    check(p.locator('[data-command-bar="edit"]').get_attribute('data-dock')=='float')
    p.evaluate('window.barSnapshot=vb6Studio.commandBars.snapshot();vb6Studio.commandBars.show("edit",false);vb6Studio.commandBars.restore(barSnapshot)')
    check(p.locator('[data-command-bar="edit"]').is_visible())
    p.screenshot(path=str(REPORT/'floating-toolbar.png'))
def custombar(p):
    data=p.evaluate('()=>{const b=vb6Studio.commandBars,m=b.model,x=m.create("Recovery tools");m.insert(x.id,"save");m.insert(x.id,"|");m.insert(x.id,"quickWatch");b.render();return {id:x.id,items:x.items};}')
    check(data['items']==['save','|','quickWatch'])
    check(p.get_by_role('toolbar',name='Recovery tools toolbar',exact=True).is_visible())
    command(p,'customizeToolbars');check(p.locator('.ide-dialog').is_visible());p.keyboard.press('Escape')
def options_cancel(p):
    before=p.evaluate('JSON.stringify({a:vb6Studio.appearance,s:vb6Studio.project.settings})')
    command(p,'options');check(p.get_by_role('tab',name='Editor',exact=True).is_visible())
    p.get_by_label('Tab width',exact=True).fill('9')
    p.get_by_role('tab',name='Editor Format',exact=True).click()
    p.get_by_label('Editor font',exact=True).select_option('monospace')
    p.screenshot(path=str(REPORT/'options-format.png'))
    p.get_by_role('button',name='Cancel',exact=True).click()
    check(p.evaluate('JSON.stringify({a:vb6Studio.appearance,s:vb6Studio.project.settings})')==before)
def options_apply(p):
    command(p,'options');p.get_by_label('Tab width',exact=True).fill('8')
    p.get_by_role('tab',name='Docking',exact=True).click();p.get_by_label('Dockable Properties',exact=True).uncheck()
    p.get_by_role('button',name='OK',exact=True).click()
    check(p.evaluate('vb6Studio.project.settings.tabWidth')==8)
    check(p.evaluate('vb6Studio.docking.group("properties").edge')=='float')
def add_procedure(p):
    original=p.evaluate('vb6Studio.activeModule.code');command(p,'addProcedure')
    p.get_by_label('Procedure name',exact=True).fill('RecoveredAction')
    p.get_by_label('Procedure type',exact=True).select_option('Sub')
    p.get_by_role('button',name='OK',exact=True).click()
    check('Public Sub RecoveredAction()' in p.evaluate('vb6Studio.activeModule.code'))
    command(p,'undo');check(p.evaluate('vb6Studio.activeModule.code')==original)
def attributes(p):
    command(p,'procedureAttributes');p.get_by_label('Procedure description',exact=True).fill('Recovered metadata')
    p.get_by_label('Help context ID',exact=True).fill('71');p.get_by_role('button',name='OK',exact=True).click()
    check('Recovered metadata' in p.evaluate('JSON.stringify(vb6Studio.activeModule.attributes)'))
def palette(p):
    before=p.evaluate('vb6Studio.activeModule.form.properties.BackColor');command(p,'colorPalette')
    p.get_by_label('Palette #ff0000',exact=True).click();check(p.evaluate('vb6Studio.activeModule.form.properties.BackColor')==255)
    command(p,'undo');check(p.evaluate('vb6Studio.activeModule.form.properties.BackColor')==before)
def debug_panes(p):
    for name in ['immediate','locals','watch','callStack','breakpoints','errors','output','evaluation']:
        p.evaluate('(n)=>vb6Studio.showDebug(n)',name)
        check(p.locator('[data-dock-window="'+name+'"]').is_visible(),name)
    p.evaluate('vb6Studio.docking.float("locals");vb6Studio.showDebug("watch")')
    check(p.locator('[data-dock-window="locals"]').is_visible())
    p.screenshot(path=str(REPORT/'debug-tools.png'))
def watch_dialog(p):
    command(p,'addWatch');p.get_by_label('Watch expression to add').fill('counter')
    p.get_by_label('Watch type').select_option('change');p.get_by_role('button',name='OK',exact=True).click()
    defs=p.evaluate('vb6Studio.debuggerWindows.snapshot()')
    check(any(w['expression']=='counter' and w['mode']=='change' for w in defs))
def large_input(p):
    info=p.evaluate('''()=>{const project=VB6StudioAPI.newProject("LargeRecovered");project.modules[0].code=Array.from({length:50000},(_,i)=>"' line "+(i+1)).join("\\n");const start=performance.now();vb6Studio.loadProject(project);vb6Studio.openDocument(project.modules[0].id,"code");vb6Studio.editor.goToLine(49995,5);return {loadMs:performance.now()-start,lineCount:vb6Studio.editor.lines.length,windowLines:vb6Studio.editor.input.value.split("\\n").length,virtual:vb6Studio.editor.activePane.virtualizer.active,line:vb6Studio.editor.cursor().line};}''')
    check(info['lineCount']==50000 and info['line']==49995 and info['virtual'] and info['windowLines']<=256,str(info))
    before=p.evaluate('vb6Studio.activeModule.code');p.keyboard.type('x')
    check(p.evaluate('vb6Studio.history.undoStack.at(-1).kind')=='patch')
    command(p,'undo');check(p.evaluate('vb6Studio.activeModule.code')==before)
    command(p,'redo');check(p.evaluate('vb6Studio.activeModule.code')!=before)
    metrics['50000LineEditor']=info;p.screenshot(path=str(REPORT/'large-editor.png'));return info
def completions(p):
    p.evaluate('()=>{const pr=VB6StudioAPI.newProject("Completion");pr.modules[0].code="Private Sub Form_Load()\\n    Dim localNumber As Long\\n    localN\\nEnd Sub";vb6Studio.loadProject(pr);vb6Studio.openDocument(pr.modules[0].id,"code");vb6Studio.editor.goToLine(3,11);}')
    command(p,'listMembers');check('localNumber' in p.evaluate('vb6Studio.editor.completionItems'))
    p.keyboard.press('Enter');check('    localNumber' in p.evaluate('vb6Studio.activeModule.code'))
def bookmark_keys(p):
    p.evaluate('()=>{const pr=VB6StudioAPI.newProject("Bookmarks");pr.modules[0].code="Private Sub Form_Load()\\nDim a As Long\\na = 1\\nEnd Sub";vb6Studio.loadProject(pr);vb6Studio.openDocument(pr.modules[0].id,"code",1);vb6Studio.toggleBookmark(pr.modules[0].id,2);vb6Studio.toggleBookmark(pr.modules[0].id,3);vb6Studio.editor.input.focus();}')
    p.keyboard.press('Control+Alt+F2');check(p.evaluate('vb6Studio.editor.cursor().line')==2)
    p.keyboard.press('Control+Alt+F2');check(p.evaluate('vb6Studio.editor.cursor().line')==3)
    p.keyboard.press('Control+Alt+Shift+F2');check(p.evaluate('vb6Studio.editor.cursor().line')==2)
def debug_inspection(p):
    p.evaluate('''()=>{const pr=VB6StudioAPI.newProject("DebugRecovered");pr.modules[0].code=`Private Sub Form_Load()
Dim parentValue As Long
parentValue = 3
Dim result As Long
result = Inner(parentValue)
Debug.Print result
End Sub
Private Function Inner(ByVal value As Long) As Long
Dim localValue As Long
localValue = value * 2
Inner = localValue
End Function`;vb6Studio.loadProject(pr);vb6Studio.breakpoints=[{module:pr.modules[0].name,line:11}];vb6Studio.run();}''')
    p.wait_for_function('vb6Studio.runState==="paused"',timeout=8000);command(p,'locals')
    res=p.evaluate('vb6Studio.requestRuntime("debugInspect",{expression:"localValue",frameIndex:1})');check(res['value']=='6',str(res))
    row=p.locator('[data-dock-window="locals"] .debug-value-row[data-expression="localvalue"]');row.wait_for();row.dblclick()
    p.locator('.ide-dialog input').fill('19');p.get_by_role('button',name='OK',exact=True).click()
    p.wait_for_function('vb6Studio.locals.some(r=>r.name==="localvalue" && r.value==="19")')
    p.evaluate('vb6Studio.debuggerWindows.selectFrame(0)');check(p.evaluate('vb6Studio.locals.some(r=>r.name==="parentvalue" && r.value==="3")'))
    command(p,'quickWatch');p.get_by_label('Quick Watch expression',exact=True).fill('parentValue')
    p.get_by_role('button',name='Recalculate',exact=True).click()
    p.wait_for_function('document.querySelector(".debug-quick-status")?.textContent === "3"')
    p.screenshot(path=str(REPORT/'quick-watch.png'));p.locator('.ide-dialog').get_by_role('button',name='Close',exact=True).click()
    p.evaluate('vb6Studio.appearance.notifyStateLoss=false');command(p,'stop');p.wait_for_function('vb6Studio.runState==="design"')
def themes(p):
    for theme in ['classic','standard','contrast']:
        p.evaluate('(t)=>{vb6Studio.appearance.theme=t;vb6Studio.applyAppearance();vb6Studio.commandBars.show("debug",true);}',theme)
        check(p.locator('[data-command-bar="debug"]').is_visible())
        p.screenshot(path=str(REPORT/('recovered-'+theme+'.png')))
CASES=[('All recovered subsystems boot',startup),('Float/redock keeps live panel and keyboard action',floating),('Docked tabs and keyboard selection',tabs),('All four docking edges and keyboard splitter',edges),('Atomic layout round trip',layout),('Named-layout dialogs',named_layout),('Toolbar edge/float/restore',toolbar),('Custom toolbar model and customization dialog',custombar),('Options changes cancel without mutation',options_cancel),('Options apply and undockable window',options_apply),('Add Procedure through UI and undo',add_procedure),('Procedure metadata through UI',attributes),('Color palette applies and undoes',palette),('Eight independent debugger panes',debug_panes),('Break-on-change watch dialog',watch_dialog),('50000-line virtual input and compact undo/redo',large_input),('Declaration-aware completion commit',completions),('Recovered bookmark shortcut routing',bookmark_keys),('Caller frame, typed edit and Quick Watch',debug_inspection),('Recovered tools in three themes',themes)]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    version=browser.version
    for name,fn in CASES:case(browser,name,fn)
    browser.close()
passed=sum(x['passed'] for x in results);report={'kind':'new-recovery-validation','browser':version,'passed':passed,'failed':len(results)-passed,'metrics':metrics,'tests':results,'limitations':['Headless Chromium using inline loading, not native file navigation.','Screenshot evidence is not a native VB6 pixel comparison.','Worker diagnostics are tested separately in the 0.5.0 finalization suite; no full COM/native parity claim.']}
(REPORT/'recovery-browser.json').write_text(json.dumps(report,indent=2));print(f'{passed} passed; {len(results)-passed} failed.',flush=True)
sys.exit(0 if passed==len(results) else 1)

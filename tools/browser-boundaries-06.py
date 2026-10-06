#!/usr/bin/env python3
"""0.6 regression: real emitted IDE/runtime bytes, not mocked tool surfaces.
Screenshots are implementation evidence, not native VB6 pixel certification.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os, shutil, sys, time, traceback, argparse
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/boundaries-06';REPORT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'dist/VB6-Studio-Web.html').read_text()
MDI=(ROOT/'dist/examples/mdi.html').read_text()
RESULTS=[]; BROWSER=None

def check(value,message='Assertion failed'):
    if not value:raise AssertionError(str(message))
def cmd(p,name):p.evaluate('(id)=>{vb6Studio.command(id);}',name)
def boot(runtime=False):
    p=BROWSER.new_page(viewport={'width':1440,'height':960});p.set_default_timeout(6500);p._errors=[];p._requests=[]
    p.on('pageerror',lambda e:p._errors.append(str(e)))
    p.on('request',lambda r:p._requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
    p.set_content(MDI if runtime else HTML)
    if runtime:p.wait_for_function('!!globalThis.vb6Application?.vm && vb6Application.forms.filter(f=>f.shown).length===3')
    else:p.wait_for_function('!!globalThis.vb6Studio?.openResourceEditor')
    return p

def case(name,fn,runtime=False):
    p=None;start=time.perf_counter()
    try:
        p=boot(runtime);result=fn(p);check(not p._errors,p._errors);check(not p._requests,p._requests)
        RESULTS.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2),'details':result});print('PASS',name,flush=True)
    except Exception as error:
        RESULTS.append({'name':name,'passed':False,'milliseconds':round((time.perf_counter()-start)*1000,2),'error':str(error)});print('FAIL',name,str(error),flush=True);traceback.print_exc(limit=3)
        if p:
            try:p.screenshot(path=str(REPORT/('failed-'+str(len(RESULTS))+'.png')))
            except:pass
    finally:
        if p:p.close()
def shot(p,name):p.mouse.move(2,2);p.screenshot(path=str(REPORT/(name+'.png')),caret='hide',animations='disabled')
def resource(p):cmd(p,'resourceEditor');p.locator('.resource-editor').wait_for();p.evaluate('window.resourceTool=vb6Studio.documents.tools.get("tool:resources")')
def add_string(p,text='Hello, resources!'):
    p.get_by_role('button',name='Add String',exact=True).click();p.get_by_label('Resource value',exact=True).fill(text);p.get_by_role('button',name='Apply Resource',exact=True).click()

def res_transaction(p):
    resource(p);add_string(p,'Zażółć gęślą jaźń — Unicode 😀');check(p.get_by_label('Resource value',exact=True).input_value()=='Zażółć gęślą jaźń — Unicode 😀')
    cmd(p,'undo');check(p.get_by_label('Resource value',exact=True).input_value()=='New string');cmd(p,'redo');check('Unicode' in p.get_by_label('Resource value',exact=True).input_value());shot(p,'resource-editor')
    return p.evaluate('({entries:vb6Studio.project.resources.entries.length,dirty:vb6Studio.dirty})')
def res_hex(p):
    resource(p);p.get_by_role('button',name='Add Data',exact=True).click();p.get_by_label('Resource value',exact=True).fill('00 80 FF 20');p.get_by_role('button',name='Apply Resource',exact=True).click()
    check(p.evaluate('vb6Studio.project.resources.entries[0].data')=='AID/IA==')
    p.get_by_label('Resource value',exact=True).fill('GG');p.get_by_role('button',name='Apply Resource',exact=True).click();check('hexadecimal' in p.locator('.resource-editor [role=status]').inner_text());check(p.evaluate('vb6Studio.project.resources.entries[0].data')=='AID/IA==')
    p.get_by_role('button',name='Revert Resource',exact=True).click();check(p.get_by_label('Resource value',exact=True).input_value()=='00 80 FF 20')
def res_stale(p):
    resource(p);add_string(p);p.get_by_label('Resource value',exact=True).fill('stale text')
    p.evaluate('vb6Studio.project.resources=VB6StudioAPI.setResourceString(vb6Studio.project.resources,101,"external")')
    p.get_by_role('button',name='Apply Resource',exact=True).click();check('changed outside' in p.locator('.resource-editor [role=status]').inner_text())
    p.get_by_role('button',name='Revert Resource',exact=True).click();check(p.get_by_label('Resource value',exact=True).input_value()=='external')
def res_export(p):
    resource(p);add_string(p,'Exported string Ω')
    with p.expect_download() as event:p.get_by_role('button',name='Export .res…',exact=True).click()
    data=Path(event.value.path()).read_bytes();check(len(data)>32)
    p.locator('.resource-editor input[accept=".res"]').set_input_files({'name':'Roundtrip.res','mimeType':'application/octet-stream','buffer':data})
    p.wait_for_function('vb6Studio.project.resources.fileName==="Roundtrip.res"');check(p.get_by_label('Resource value',exact=True).input_value()=='Exported string Ω')
    output=p.evaluate('Array.from(VB6StudioAPI.writeRES(vb6Studio.project.resources))');check(bytes(output)==data);return {'bytes':len(data),'byteIdentical':True}
def res_native_project(p):
    resource(p);add_string(p);info=p.evaluate(r'''async()=>{const files=await VB6StudioAPI.importFiles([['Native.vbp','Type=Exe\nResFile32="App.res"\nModule=Main; Main.bas\nName="Native"'], ['Main.bas','Sub Main()\nEnd Sub'], ['App.res',VB6StudioAPI.writeRES(vb6Studio.project.resources)]]);return {entries:files.project.resources.entries.length,name:files.project.resources.fileName};}''');check(info['entries']==1 and info['name']=='App.res',info)

def res_opaque(p):
    p.evaluate('vb6Studio.project.resources=VB6StudioAPI.setResource(null,{type:6,name:2,language:0,data:"AQ=="})');resource(p)
    check('Opaque string table' in p.get_by_label('Project resources',exact=True).inner_text());check(p.get_by_label('Resource value',exact=True).input_value()=='01')
    with p.expect_download() as event:p.get_by_role('button',name='Export Data…',exact=True).click()
    check(Path(event.value.path()).read_bytes()==b'\x01')
def res_dirty_select(p):
    resource(p);add_string(p,'first');p.get_by_role('button',name='Add String',exact=True).click();p.get_by_label('Resource value',exact=True).fill('pending')
    p.get_by_label('Project resources',exact=True).locator('[data-index="0"]').click();check(p.get_by_label('Resource ID',exact=True).input_value()=='102');check('Apply or Revert' in p.locator('.resource-editor [role=status]').inner_text())
def res_data_file(p):
    resource(p);p.get_by_role('button',name='Add Data',exact=True).click();data=bytes(range(256))*300
    p.locator('.resource-editor input[type=file]').nth(1).set_input_files({'name':'Data.bin','mimeType':'application/octet-stream','buffer':data});p.wait_for_function('resourceTool.content.readOnly')
    check(len(p.get_by_label('Resource value',exact=True).input_value())<200000)
    with p.expect_download() as event:p.get_by_role('button',name='Export Data…',exact=True).click()
    check(Path(event.value.path()).read_bytes()==data);return {'bytes':len(data),'previewBound':65536}
def res_project_change(p):
    resource(p);add_string(p);p.get_by_label('Resource value',exact=True).fill('old pending');p.evaluate('vb6Studio.loadProject(VB6StudioAPI.newProject("Other"))')
    check(p.locator('.resource-editor').count()==0);check(p.evaluate('resourceTool.alive') is False);check(p.evaluate('vb6Studio.project.resources===undefined'))
def res_runtime_guard(p):
    resource(p);add_string(p);p.evaluate('vb6Studio.run()');p.wait_for_function('vb6Studio.runState==="running"')
    p.evaluate('resourceTool.guard(()=>resourceTool.addString())');check('Stop execution' in p.evaluate('resourceTool.status.textContent'));check(p.evaluate('vb6Studio.project.resources.entries.length')==1)
def res_virtual(p):
    p.evaluate('''()=>{const entries=[];for(let i=0;i<4000;i++)entries.push({type:10,name:i,language:0,data:'AQ=='});vb6Studio.project.resources={fileName:'Many.res',entries};}''');resource(p)
    check(p.evaluate('resourceTool.list.items.length')==4000);check(p.get_by_label('Project resources',exact=True).locator('.tool-list-row').count()<40)
    p.get_by_label('Project resources',exact=True).focus();p.keyboard.press('End');check(p.get_by_label('Resource ID',exact=True).input_value()=='3999')
def tool_themes(p):
    resource(p);add_string(p,'Theme-aware resources')
    for theme in ['classic','standard','contrast']:
        p.evaluate('(theme)=>{vb6Studio.appearance.theme=theme;vb6Studio.applyAppearance();}',theme);check(p.get_by_label('Resource value',exact=True).is_visible());shot(p,'resource-'+theme)

def res_profile(p):
    resource(p);add_string(p,'Preserved resource');p.evaluate('''()=>{vb6Studio.objectBrowser();vb6Studio.openResourceEditor();window.profile06=vb6Studio.captureWindowLayout();vb6Studio.closeDocument('tool:resources');vb6Studio.closeDocument('tool:object-browser');vb6Studio.applyWindowLayout(profile06);}''');check(p.locator('.resource-editor').is_visible());check(p.get_by_label('Resource value',exact=True).input_value()=='Preserved resource');check(p.evaluate('vb6Studio.documents.mdi.active')=='tool:resources');check(p.evaluate('vb6Studio.documents.tools.has("tool:object-browser")'))
def res_profile_foreign(p):
    resource(p);add_string(p);p.evaluate('window.oldProfile06=vb6Studio.captureWindowLayout();vb6Studio.loadProject(VB6StudioAPI.newProject("Foreign"));vb6Studio.applyWindowLayout(oldProfile06)');check(p.locator('.resource-editor').count()==0)

def debug_project(p):
    code='''Option Explicit
Private counter As Long
Private Sub Form_Load()
    Dim local As Long
    local = 4
    Debug.Print local, counter
End Sub
Private Function Bump(ByRef value As Long) As Long
    counter = counter + 1
    value = value + 3
    Bump = value
End Function
Private Function Forever() As Long
    On Error Resume Next
    Do
        counter = counter + 1
    Loop
End Function
Private Function Ask() As Long
    Ask = MsgBox("Evaluated dialog", vbOKCancel, "Debugger evaluation")
End Function
Private Function Fail() As Long
    Err.Raise 44, "Evaluation", "Expected evaluation failure"
End Function'''
    p.evaluate('''code=>{const project=VB6StudioAPI.newProject('Debug06');project.modules[0].code=code;vb6Studio.loadProject(project);vb6Studio.breakpoints=[{module:project.modules[0].name,line:6},{module:project.modules[0].name,line:9}];vb6Studio.run();}''',code)
    p.wait_for_function('vb6Studio.runState==="paused"',timeout=12000);cmd(p,'evaluateExpression');p.get_by_label('Evaluation expression',exact=True).wait_for();return code

def do_eval(p,expression):
    p.get_by_label('Evaluation expression',exact=True).fill(expression);p.locator('[data-dock-window=evaluation]').get_by_role('button',name='Evaluate',exact=True).click()
    p.wait_for_function('!vb6Studio.debuggerWindows.evaluationBusy');return p.evaluate('vb6Studio.debuggerWindows.evaluationOutput.textContent')
def debug_function(p):
    debug_project(p);check(do_eval(p,'Bump(local)')=='Bump(local) = 7');check(p.evaluate('vb6Studio.runState')=='paused')
    data=p.evaluate('vb6Studio.requestRuntime("debugInspect",{expression:"local",frameIndex:0})');check(data['value']=='7',data);check(p.evaluate('vb6Studio.stack.length')==1);check(p.evaluate('vb6Studio.runtimeWindow.classList.contains("minimized")'));shot(p,'explicit-evaluation')
def debug_readonly(p):
    debug_project(p);result=p.evaluate('''async()=>{try{return await vb6Studio.requestRuntime('debugInspect',{expression:'Bump(local)',frameIndex:0});}catch(e){return {error:e.message};}}''');check('procedure' in result.get('error','').lower(),result);check(do_eval(p,'local')=='local = 4')
def debug_budget(p):
    debug_project(p);p.get_by_label('Evaluation instruction limit',exact=True).fill('40');result=do_eval(p,'Forever()');check('instruction limit' in result,result);check(p.evaluate('vb6Studio.runState')=='paused');check(do_eval(p,'local')=='local = 4')
def debug_cancel(p):
    debug_project(p);p.get_by_label('Evaluation instruction limit',exact=True).fill('10000000');p.get_by_label('Evaluation time limit in milliseconds',exact=True).fill('30000');p.get_by_label('Evaluation expression',exact=True).fill('Forever()')
    pane=p.locator('[data-dock-window=evaluation]');pane.get_by_role('button',name='Evaluate',exact=True).click();p.wait_for_function('vb6Studio.evaluating');pane.get_by_role('button',name='Cancel Evaluation',exact=True).click();p.wait_for_function('!vb6Studio.debuggerWindows.evaluationBusy');check('cancelled' in p.evaluate('vb6Studio.debuggerWindows.evaluationOutput.textContent').lower());check(do_eval(p,'local')=='local = 4')
def debug_dialog(p):
    debug_project(p);p.get_by_label('Evaluation expression',exact=True).fill('Ask()');p.locator('[data-dock-window=evaluation]').get_by_role('button',name='Evaluate',exact=True).click()
    f=p.frame_locator('.runtime-window iframe');f.get_by_role('dialog',name='Debugger evaluation',exact=True).wait_for();f.get_by_role('button',name='OK',exact=True).click();p.wait_for_function('!vb6Studio.debuggerWindows.evaluationBusy');check(p.evaluate('vb6Studio.debuggerWindows.evaluationOutput.textContent')=='Ask() = 1')
def debug_dialog_cancel(p):
    debug_project(p);p.get_by_label('Evaluation time limit in milliseconds',exact=True).fill('1500');p.get_by_label('Evaluation expression',exact=True).fill('Ask()');p.locator('[data-dock-window=evaluation]').get_by_role('button',name='Evaluate',exact=True).click();p.wait_for_function('!vb6Studio.debuggerWindows.evaluationBusy');check('time limit' in p.evaluate('vb6Studio.debuggerWindows.evaluationOutput.textContent'));check(do_eval(p,'local')=='local = 4');check(p.frame_locator('.runtime-window iframe').get_by_role('dialog',name='Debugger evaluation',exact=True).count()==0)
def debug_error(p):
    debug_project(p);check('Expected evaluation failure' in do_eval(p,'Fail()'));check(do_eval(p,'Bump(local)')=='Bump(local) = 7')
def debug_docking(p):
    debug_project(p);p.evaluate('vb6Studio.docking.float("evaluation")');check(p.evaluate('vb6Studio.docking.group("evaluation").edge')=='float');check(do_eval(p,'local')=='local = 4')
def live_linear(p):
    old=debug_project(p);p.evaluate('text=>vb6Studio.editor.setValue(text)',old.replace('    Debug.Print local, counter','    counter = 900\n    Debug.Print local, counter\n    Debug.Print local + 1'))
    result=p.evaluate('vb6Studio.applyCodeChanges()');check(result is not False);check(do_eval(p,'local')=='local = 4');p.evaluate('vb6Studio.breakpoints=[];vb6Studio.sendRuntime("breakpoints",{breakpoints:[]});vb6Studio.sendRuntime("resume")')
    p.wait_for_function('vb6Studio.output.join("\\n").includes("4 0")');check('5' in p.evaluate('vb6Studio.output.join("\\n")'))
def live_reject(p):
    old=debug_project(p);p.evaluate('text=>vb6Studio.editor.setValue(text)',old.replace('    Debug.Print local, counter','    If local > 0 Then\n    Debug.Print local, counter\n    End If'))
    result=p.evaluate('''async()=>{try{await vb6Studio.applyCodeChanges();return 'accepted';}catch(e){return e.message;}}''');check('Restart required' in result,result);check(p.evaluate('vb6Studio.runState')=='paused')
def iface_export(p):
    text='''Option Explicit
DefInt A-Z
Sub Main()
Dim item As New Item, view As IValue
Set view = item
view.Value = 17
Dim total
total = view.Value
Debug.Print total, TypeOf item Is IValue, item Is view
On Error Resume Next
total = 32768
Debug.Print Err.Number
End Sub'''
    project={'id':'interface-export','name':'InterfaceExport','startup':'Sub Main','modules':[{'id':'main','name':'MainModule','kind':'module','code':text},{'id':'contract','name':'IValue','kind':'class','code':'Public Property Get Value() As Long\nEnd Property\nPublic Property Let Value(ByVal value As Long)\nEnd Property'},{'id':'item','name':'Item','kind':'class','code':'Implements IValue\nPrivate stored As Long\nPrivate Property Get IValue_Value() As Long\nIValue_Value = stored\nEnd Property\nPrivate Property Let IValue_Value(ByVal value As Long)\nstored = value\nEnd Property'}]}
    exported=p.evaluate('project=>VB6StudioAPI.exportApplication(project)',project);p.set_content(exported);p.wait_for_function('!!globalThis.vb6Application');out=p.locator('.vb-runtime-console').inner_text();check(out.strip()=='17 True True\n6',out);return out

def mdi_ready(p):
    info=p.evaluate('({shown:vb6Application.forms.filter(f=>f.shown).length,active:vb6Application.mdi.parent.ActiveForm.formObject.props.Caption,screen:vb6Application.vm.library.get("screen").ActiveForm.formObject.props.Caption,children:vb6Application.mdi.children.filter(c=>c.shown).map(c=>({text:c.controlMap.get("txtdocument").Text,parent:c.node.parentElement.className}))})')
    check(info['shown']==3 and info['active']=='Document 2' and info['screen']=='Document 2',info);check(all('native resource string' in c['text'] and c['parent']=='vb-mdi-client' for c in info['children']),info);shot(p,'mdi-runtime');return info

def mdi_menu(p):
    p.locator('.vb-mdi-parent > .vb-form-menu').get_by_role('menuitem',name='File',exact=True).click();p.get_by_role('menuitem',name='New document',exact=True).click();p.wait_for_function('vb6Application.mdi.children.filter(c=>c.shown).length===3')
    p.locator('.vb-mdi-parent > .vb-form-menu').get_by_role('menuitem',name='Window',exact=True).click();p.get_by_role('menuitemcheckbox',name='1 Document 1',exact=True).click();p.wait_for_function('vb6Application.mdi.active.props.Caption==="Document 1"')
def mdi_tiles(p):
    p.evaluate('vb6Application.mdi.arrange(1)');info=p.evaluate('vb6Application.mdi.children.filter(c=>c.shown).map(c=>({left:c.props.Left,top:c.props.Top,width:c.node.offsetWidth,height:c.node.offsetHeight}))');check(info[0]['left']==info[1]['left']==0 and info[1]['top']>0,info)
    p.evaluate('vb6Application.mdi.arrange(0)');info=p.evaluate('vb6Application.mdi.children.filter(c=>c.shown).map(c=>c.props.Left)');check(info[0]==0 and info[1]==330,info)
def mdi_window_state(p):
    f=p.locator('.vb-mdi-child:not([hidden])').last;f.locator(':scope > .vb-form-title').get_by_role('button',name='Maximize',exact=True).click();check(p.evaluate('vb6Application.mdi.active.WindowState')==2)
    f.locator(':scope > .vb-form-title').get_by_role('button',name='Restore',exact=True).click();check(p.evaluate('vb6Application.mdi.active.WindowState')==0)
    f.locator(':scope > .vb-form-title').get_by_role('button',name='Minimize',exact=True).click();check(p.evaluate('vb6Application.mdi.active.WindowState')==1);p.evaluate('vb6Application.mdi.arrange(3)');f.locator(':scope > .vb-form-title').get_by_role('button',name='Restore',exact=True).click();check(p.evaluate('vb6Application.mdi.active.WindowState')==0)
def mdi_unload_cancel(p):
    f=p.locator('.vb-mdi-child:not([hidden])').last;f.get_by_role('checkbox',name='Prevent closing this document',exact=True).check()
    p.locator('.vb-mdi-parent > .vb-form-title').get_by_role('button',name='Close',exact=True).click();p.wait_for_timeout(100);check(p.evaluate('vb6Application.forms.filter(f=>f.shown).length')==3)
    f.get_by_role('checkbox',name='Prevent closing this document',exact=True).uncheck();p.locator('.vb-mdi-parent > .vb-form-title').get_by_role('button',name='Close',exact=True).click();p.wait_for_function('vb6Application.forms.every(f=>!f.shown)')
def mdi_child_cancel(p):
    f=p.locator('.vb-mdi-child:not([hidden])').last;f.get_by_role('checkbox',name='Prevent closing this document',exact=True).check();f.locator(':scope > .vb-form-title').get_by_role('button',name='Close',exact=True).click();p.wait_for_timeout(100);check(p.evaluate('vb6Application.mdi.children.filter(f=>f.shown).length')==2)
    f.get_by_role('checkbox',name='Prevent closing this document',exact=True).uncheck();f.locator(':scope > .vb-form-title').get_by_role('button',name='Close',exact=True).click();p.wait_for_function('vb6Application.mdi.children.filter(f=>f.shown).length===1');check(p.evaluate('vb6Application.mdi.active.props.Caption')=='Document 1')
def mdi_resize_cancel(p):
    p.evaluate('vb6Application.mdi.arrange(0);window.beforeBounds=JSON.stringify(vb6Application.mdi.active.props)');edge=p.locator('.vb-mdi-child:not([hidden])').last.locator('.vb-form-grip-se');box=edge.bounding_box();p.mouse.move(box['x']+2,box['y']+2);p.mouse.down();p.mouse.move(box['x']-80,box['y']-40,steps=6);p.keyboard.press('Escape');p.mouse.up();check(p.evaluate('JSON.stringify(vb6Application.mdi.active.props)===beforeBounds'))
def mdi_resize(p):
    p.evaluate('vb6Application.mdi.arrange(0);window.oldWidth=vb6Application.mdi.active.props.ClientWidth');edge=p.locator('.vb-mdi-child:not([hidden])').last.locator('.vb-form-grip-se');box=edge.bounding_box();p.mouse.move(box['x']+2,box['y']+2);p.mouse.down();p.mouse.move(box['x']-70,box['y']-40,steps=6);p.mouse.up();check(p.evaluate('vb6Application.mdi.active.props.ClientWidth<oldWidth'));p.wait_for_function('vb6Application.mdi.active.controlMap.get("txtdocument").Width>0')
def mdi_keyboard(p):
    p.locator('.vb-mdi-child:not([hidden])').last.locator(':scope > .vb-form-title').focus();p.keyboard.press('Control+F6');check(p.evaluate('vb6Application.mdi.active.props.Caption')=='Document 1');p.keyboard.press('Control+F4');p.wait_for_function('vb6Application.mdi.children.filter(f=>f.shown).length===1')
def mdi_narrow(p):
    p.set_viewport_size({'width':390,'height':844});p.wait_for_timeout(150);r=p.locator('.vb-mdi-parent').bounding_box();check(r['x']>=0 and r['x']+r['width']<=391,r);shot(p,'mdi-narrow')
def mdi_theme(p):
    p.evaluate('VB6Runtime.RuntimeAPI.applyTheme(document.body,"contrast")');shot(p,'mdi-high-contrast');check(p.locator('.vb-mdi-child:not([hidden])').count()==2)
def mdi_designer(p):
    p.evaluate('vb6Studio.loadProject(VB6StudioAPI.newProject("DesignMDI"))');cmd(p,'addMDIForm');p.wait_for_function('vb6Studio.project.modules.some(m=>m.form?.type==="MDIForm")');check(p.evaluate('vb6Studio.activeModule.form.type')=='MDIForm');check('MDIForm_Load' in p.evaluate('vb6Studio.activeModule.code'));shot(p,'mdi-designer');cmd(p,'undo');check(p.evaluate('vb6Studio.project.modules.some(m=>m.form?.type==="MDIForm")') is False)
def mdi_ide_export(p):
    p.evaluate('vb6Studio.loadProject(VB6StudioAPI.EXAMPLES.find(e=>e.id==="mdi").create())');p.evaluate('vb6Studio.run()');p.wait_for_function('vb6Studio.runState==="running"');p.frame_locator('.runtime-window iframe').locator('.vb-mdi-child:not([hidden])').last.wait_for();check(p.frame_locator('.runtime-window iframe').locator('.vb-mdi-child:not([hidden])').count()==2)

def main():
    global BROWSER
    parser=argparse.ArgumentParser();parser.add_argument('--filter',default='');args=parser.parse_args()
    tests=[('Resource strings apply undo and redo',res_transaction,False),('Resource hexadecimal validation is transactional',res_hex,False),('Resource drafts reject stale writes',res_stale,False),('Native resource chooser import and download round trip',res_export,False),('VBP resource-file references import their binary data',res_native_project,False),('Malformed string tables remain exportable opaque data',res_opaque,False),('Dirty resource drafts retain their selection',res_dirty_select,False),('Binary resource file import preserves full data behind bounded preview',res_data_file,False),('Project switches dispose stale resource tools',res_project_change,False),('Running-project resource edits are rejected',res_runtime_guard,False),('4000-entry resource lists have bounded rows',res_virtual,False),('Resource Editor follows all three classic themes',tool_themes,False),('Window profiles reopen project modeless tools and active Resource Editor',res_profile,False),('Foreign-project profiles do not reopen resource tools',res_profile_foreign,False),('Explicit function evaluation preserves paused locals and skips breakpoints',debug_function,False),('Automatic inspection cannot execute source procedures',debug_readonly,False),('Evaluation instruction budgets survive Resume Next',debug_budget,False),('Evaluation cancellation restores paused execution',debug_cancel,False),('Explicit evaluation can interact with runtime dialogs',debug_dialog,False),('Timed-out evaluated dialogs close without losing the pause',debug_dialog_cancel,False),('Source evaluation failure leaves the debugger usable',debug_error,False),('Evaluation remains usable as a floating tool',debug_docking,False),('Live linear insertion remaps paused source without rerunning earlier code',live_linear,False),('Unsafe live control-flow edits reject atomically',live_reject,False),('Standalone export runs interfaces identity and DefType declarations',iface_export,False),('Runtime MDI child startup resource strings and active identity',mdi_ready,True),('Runtime WindowList activates dynamically created instances',mdi_menu,True),('Runtime MDI tiling and cascade change actual child geometry',mdi_tiles,True),('Runtime MDI minimize maximize and restore state',mdi_window_state,True),('MDI parent unloading is cancelled atomically by a child',mdi_unload_cancel,True),('Child close cancellation retains sibling and active form state',mdi_child_cancel,True),('Runtime MDI resize rolls back on Escape',mdi_resize_cancel,True),('Runtime MDI pointer resizing updates child layout',mdi_resize,True),('Runtime MDI keyboard cycling and close',mdi_keyboard,True),('Runtime MDI remains within a narrow viewport',mdi_narrow,True),('Runtime MDI uses the shared high-contrast theme',mdi_theme,True),('Add MDIForm designer command integrates with undo',mdi_designer,False),('MDI example runs inside the IDE isolated iframe',mdi_ide_export,False)]
    with sync_playwright() as pw:
        BROWSER=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox']);version=BROWSER.version
        for name,fn,runtime in tests:
            if not args.filter or args.filter.lower() in name.lower():case(name,fn,runtime)
        BROWSER.close()
    report={'browser':version,'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'tests':RESULTS}
    (REPORT/'browser-boundaries-06.json').write_text(json.dumps(report,indent=2)+'\n');print(f'{report["passed"]} passed; {report["failed"]} failed.',flush=True);return bool(report['failed'])
if __name__=='__main__':sys.exit(main())

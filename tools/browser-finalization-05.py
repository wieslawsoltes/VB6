#!/usr/bin/env python3
"""Integrated editor/workspace/diagnostics regression suite for 0.5.0.
Uses the emitted single-file app, not a mocked editor. Screenshots are our
implementation only; no assertion of native VB6 pixel equivalence is made.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os, shutil, sys, time, traceback, argparse
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/finalization-05';REPORT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'dist/VB6-Studio-Web.html').read_text()
RESULTS=[];METRICS={};BROWSER=None

def check(value,message='Assertion failed'):
    if not value: raise AssertionError(str(message))
def cmd(p,id):p.evaluate('(id)=>{vb6Studio.command(id);}',id)
def boot(fallback=False):
    p=BROWSER.new_page(viewport={'width':1440,'height':960});p.set_default_timeout(7000);p._errors=[];p._requests=[]
    p.on('pageerror',lambda e:p._errors.append(str(e)))
    p.on('request',lambda r:p._requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
    if fallback:p.evaluate('window.Worker=undefined')
    # Full IDE parsing is separate from the seven-second action deadline.
    p.set_content(HTML,wait_until='domcontentloaded',timeout=60000)
    p.wait_for_function('!!globalThis.vb6Studio?.captureWindowLayout',timeout=60000);return p

def case(name,fn,fallback=False):
    p=None;start=time.perf_counter()
    try:
        p=boot(fallback);details=fn(p);check(not p._errors,p._errors);check(not p._requests,p._requests)
        RESULTS.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2),'details':details});print('PASS',name,flush=True)
    except Exception as e:
        RESULTS.append({'name':name,'passed':False,'milliseconds':round((time.perf_counter()-start)*1000,2),'error':str(e)});print('FAIL',name,str(e),flush=True);traceback.print_exc(limit=3)
        if p:
            try:p.screenshot(path=str(REPORT/('failed-'+str(len(RESULTS))+'.png')))
            except:pass
    finally:
        if p:p.close()

def source(p,text,other=None):
    p.evaluate('''({text,other})=>{const pr=VB6StudioAPI.newProject("EditorLab");pr.id="editor-lab";pr.modules[0].id="main";pr.modules[0].code=text;if(other!==null)pr.modules.push({id:"other",name:"OtherModule",kind:"module",code:other});vb6Studio.loadProject(pr);vb6Studio.openDocument("main","code");vb6Studio.editor.input.focus();}''',{'text':text,'other':other})
def idle(p):p.wait_for_function('!vb6Studio.syntaxDiagnostics.pending',timeout=18000)
def shot(p,name):idle(p);p.mouse.move(2,2);p.screenshot(path=str(REPORT/(name+'.png')),caret='hide',animations='disabled')

def worker(p):
    idle(p);info=p.evaluate('({mode:vb6Studio.syntaxDiagnostics.mode,metrics:vb6Studio.syntaxDiagnostics.metrics,errors:vb6Studio.diagnostics})');check(info['mode']=='worker',info);check(not info['errors']);return info

def diagnostics_live(p):
    source(p,'Private Sub Form_Load()\nDim value As\nEnd Sub');p.evaluate('window.focusBefore=document.activeElement');idle(p)
    info=p.evaluate('({diagnostics:vb6Studio.diagnostics,focus:document.activeElement===focusBefore,panels:vb6Studio.docking.snapshot(),gutters:document.querySelectorAll(".gutter-line.has-error").length})')
    check(info['diagnostics'][0]['line']==2,info);check(info['focus']);check(info['gutters']==1,info)
    check(p.evaluate('vb6Studio.docking.model.windows.get("errors").hidden'))
    cmd(p,'nextDiagnostic');check(p.evaluate('vb6Studio.editor.cursor().line')==2);shot(p,'diagnostics');return info['diagnostics']

def latest(p):
    source(p,'Private Sub Form_Load()\nEnd Sub');idle(p)
    p.evaluate('()=>{for(let n=0;n<10;n++)vb6Studio.editor.setValue("Private Sub Form_Load()\\nDim bad As\\nEnd Sub");vb6Studio.editor.setValue("Private Sub Form_Load()\\nDim good As Long\\ngood = 2\\nEnd Sub");}')
    idle(p);check(p.evaluate('vb6Studio.diagnostics.length')==0)
    return p.evaluate('vb6Studio.syntaxDiagnostics.metrics')

def fallback(p):
    source(p,'Private Sub Form_Load()\nDim value As\nEnd Sub');idle(p);check(p.evaluate('vb6Studio.syntaxDiagnostics.mode')=='fallback');check(p.evaluate('vb6Studio.diagnostics[0].line')==2);return p.evaluate('vb6Studio.syntaxDiagnostics.metrics')

def disabled(p):
    source(p,'Private Sub Form_Load()\nDim value As\nEnd Sub');idle(p);p.evaluate('()=>{vb6Studio.appearance.autoSyntaxCheck=false;vb6Studio.applyAppearance();vb6Studio.editor.setValue("Private Sub X()\\nDim bad As\\nEnd Sub");}')
    p.wait_for_timeout(400);check(not p.evaluate('vb6Studio.syntaxDiagnostics.pending'));check(p.evaluate('vb6Studio.diagnostics.length')==0)
    p.evaluate('()=>{vb6Studio.checkSyntax();}');check(p.evaluate('vb6Studio.diagnostics.length')>0)

def data_cache(p):
    idle(p);before=p.evaluate('vb6Studio.syntaxDiagnostics.metrics.cacheHits');p.evaluate('()=>{vb6Studio.markDirty();}');idle(p);check(p.evaluate('vb6Studio.syntaxDiagnostics.metrics.cacheHits')>before)

def cut_line(p):
    text='one\ntwo\nthree';source(p,text);p.evaluate('vb6Studio.editor.goToLine(2,2)');p.keyboard.press('Control+y')
    check(p.evaluate('vb6Studio.editor.text')=='one\nthree');check(p.evaluate('vb6Studio.sourceClipboard.text')=='two\n');cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')==text)

def tab_selection(p):
    source(p,'one\ntwo\nthree');p.evaluate('vb6Studio.editor.selectGlobal(0,4)');p.keyboard.press('Tab');check(p.evaluate('vb6Studio.editor.text')=='    one\ntwo\nthree');cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')=='one\ntwo\nthree')

def replace_all(p):
    text="' needle needle\n"*50000;source(p,text)
    m=p.evaluate('''()=>{const e=vb6Studio.editor;e.findInput.value="needle";e.replaceInput.value="$&literal";const start=performance.now();e.replace(true);return {milliseconds:performance.now()-start,count:e.findResult.textContent,undo:vb6Studio.history.undoStack.at(-1).kind,rows:e.input.value.split("\\n").length};}''')
    check(m['count']=='100000 replaced',m);check(m['rows']<=256);check(p.evaluate('vb6Studio.editor.text.includes("$&literal")'));cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')==text)
    METRICS['100000LiteralReplacements']=m;return m

def undo_boundaries(p):
    source(p,"' needle needle");p.evaluate('vb6Studio.editor.goToLine(1,16)');p.keyboard.type('x');p.evaluate('()=>{const e=vb6Studio.editor;e.findInput.value="needle";e.replaceInput.value="word";e.replace(true);}')
    cmd(p,'undo');check('needlex' in p.evaluate('vb6Studio.editor.text'));cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')=="' needle needle")

def find_cache(p):
    source(p,'needle\none\nneedle\ntwo\nneedle');p.evaluate('()=>{const e=vb6Studio.editor;e.findInput.value="needle";e.selectGlobal(0);e.find();e.find();e.find();}')
    check(p.evaluate('vb6Studio.editor.selectionBounds()')=={'start':22,'end':28});check(p.evaluate('vb6Studio.editor.findIndex.scans')==1)
    p.keyboard.press('Shift+F4');check(p.evaluate('vb6Studio.editor.selectionBounds()')=={'start':0,'end':6})

def large_completion(p):
    text="' padding\n"*49995+'Private Sub Form_Load()\nDim localAlpha As Long, localBeta As Long\nlocal\nEnd Sub'
    source(p,text);p.evaluate('()=>{vb6Studio.editor.goToLine(49998,6);vb6Studio.editor.complete();}')
    check(p.evaluate('vb6Studio.editor.activePane.virtualizer.active'));items=p.evaluate('vb6Studio.editor.completionItems');check('localAlpha' in items and 'localBeta' in items,items)
    p.keyboard.press('ArrowDown');selected=p.evaluate('vb6Studio.editor.completionItems[vb6Studio.editor.completionIndex]');p.keyboard.press('Enter');check(p.evaluate('vb6Studio.editor.lines[49997]')==selected)
    shot(p,'large-editor-completion');return {'candidates':items,'selected':selected}

def large_selection(p):
    text="' row\n"*50000;source(p,text);p.evaluate('()=>{const e=vb6Studio.editor;e.toggleSplit(true,.45);e.activatePane(e.secondary);e.selectGlobal(100,200000);e.toggleSplit(false);}')
    check(p.evaluate('({start:vb6Studio.editor.selectionBounds().start,end:vb6Studio.editor.selectionBounds().end})')=={'start':100,'end':200000});p.evaluate('vb6Studio.editor.edit("copy")');check(len(p.evaluate('vb6Studio.sourceClipboard.text'))==199900)

def readonly(p):
    source(p,'Private Sub Form_Load()\nEnd Sub');before=p.evaluate('vb6Studio.editor.text');p.evaluate('()=>{const e=vb6Studio.editor;e.setReadOnly(true);e.selectGlobal(0,10);e.transformBlock(x=>"BAD"+x);e.cutLine();e.setValue("BAD");e.edit("delete");}')
    check(p.evaluate('vb6Studio.editor.text')==before)

def clipboard(p):
    source(p,'first source','second source');p.evaluate('()=>{vb6Studio.editor.selectGlobal(0,5);vb6Studio.editor.edit("copy");vb6Studio.openDocument("other","code");vb6Studio.editor.selectGlobal(0,6);}')
    p.evaluate('vb6Studio.editor.edit("paste")');check(p.evaluate('vb6Studio.editor.text')=='first source');cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')=='second source')

def stale_clipboard(p):
    source(p,'abcdef');p.evaluate('''()=>{Object.defineProperty(navigator,"clipboard",{configurable:true,value:{readText:()=>new Promise(r=>window.clipboardRelease=r)}});vb6Studio.editor.selectGlobal(0,3);window.pasteJob=vb6Studio.editor.pasteClipboard();vb6Studio.editor.selectGlobal(5);clipboardRelease("X");}''')
    p.evaluate('window.pasteJob');check(p.evaluate('vb6Studio.editor.text')=='abcdef')

def dnd(p):
    source(p,'first source','second source');info=p.evaluate('''()=>{const i=vb6Studio,e=i.editor;e.selectGlobal(0,5);let drag=i.sourceDrag.makeDrag(e,e.activePane);i.openDocument("other","code");const ok=i.sourceDrag.apply(drag,{editor:i.editor,pane:i.editor.activePane},0,false);return {ok,codes:i.project.modules.map(m=>m.code),count:i.history.undoStack.length};}''')
    check(info['ok'],info);check(info['codes']==[' source','firstsecond source'],info);check(info['count']==1,info);cmd(p,'undo');check(p.evaluate('vb6Studio.project.modules.map(m=>m.code)')==['first source','second source']);cmd(p,'redo');check(p.evaluate('vb6Studio.project.modules.map(m=>m.code)')==info['codes'])

def stale_drop(p):
    source(p,'first source','second source');info=p.evaluate('''()=>{const i=vb6Studio,e=i.editor;e.selectGlobal(0,5);const drag=i.sourceDrag.makeDrag(e,e.activePane);e.setValue("changed");i.openDocument("other","code");return {ok:i.sourceDrag.apply(drag,{editor:i.editor,pane:i.editor.activePane},0,false),codes:i.project.modules.map(m=>m.code)};}''');check(not info['ok']);check(info['codes']==['changed','second source'])

def same_drop(p):
    source(p,'first source');p.evaluate('()=>{const i=vb6Studio,e=i.editor;e.selectGlobal(0,5);let drag=i.sourceDrag.makeDrag(e,e.activePane);i.sourceDrag.apply(drag,{editor:e,pane:e.activePane},12,false);}')
    check(p.evaluate('vb6Studio.editor.text')==' sourcefirst');cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')=='first source')

def pointer_drag(p):
    source(p,'abcdef ghijkl');p.evaluate('vb6Studio.editor.selectGlobal(0,3)');coords=p.evaluate('()=>{const e=vb6Studio.editor,r=e.input.getBoundingClientRect();return {x:r.x+3+e.characterWidth,y:r.y+8,target:r.x+3+12*e.characterWidth};}')
    p.mouse.move(coords['x'],coords['y']);p.mouse.down();p.mouse.move(coords['target'],coords['y'],steps=10);p.mouse.up();check(p.evaluate('vb6Studio.editor.text')=='def ghijkabcl',p.evaluate('vb6Studio.editor.text'));cmd(p,'undo');check(p.evaluate('vb6Studio.editor.text')=='abcdef ghijkl')

def pointer_cancel(p):
    source(p,'abcdef ghijkl');p.evaluate('vb6Studio.editor.selectGlobal(0,3)');coords=p.evaluate('()=>{const e=vb6Studio.editor,r=e.input.getBoundingClientRect();return {x:r.x+3+e.characterWidth,y:r.y+8,target:r.x+3+12*e.characterWidth};}')
    p.mouse.move(coords['x'],coords['y']);p.mouse.down();p.mouse.move(coords['target'],coords['y'],steps=8);p.keyboard.press('Escape');p.mouse.up();check(p.evaluate('vb6Studio.editor.text')=='abcdef ghijkl');check(p.locator('.source-drag-ghost').count()==0)

def profile(p):
    source(p,"' first\n' second\nPrivate Sub Form_Load()\nEnd Sub",'Public Sub Other()\nEnd Sub');info=p.evaluate('''()=>{const i=vb6Studio,e=i.editor;e.toggleSplit(true,.37);e.selectGlobal(2,7);e.activatePane(e.secondary);e.setViewMode("procedure");e.goToLine(3,2);e.selectGlobal(20,25);i.commandBars.show("edit",true);i.commandBars.dock("edit","left");i.docking.float("properties");window.savedProfile=i.captureWindowLayout();e.toggleSplit(false);i.commandBars.show("edit",false);i.docking.dock("properties","right");i.applyWindowLayout(savedProfile);return {panes:e.panes.length,ratio:e.splitRatio,selected:e.selectionBounds(),active:e.panes.indexOf(e.activePane),toolbar:i.commandBars.model.get("edit"),dock:i.docking.group("properties").edge};}''')
    check(info['panes']==2 and info['ratio']==.37 and info['active']==1,info);check(info['selected']=={'start':20,'end':25},info);check(info['toolbar']['visible'] and info['toolbar']['dock']=='left');check(info['dock']=='float');shot(p,'workspace-restored')

def profile_atomic(p):
    p.evaluate('window.beforeLayout=JSON.stringify({d:vb6Studio.docking.snapshot(),b:vb6Studio.commandBars.snapshot()})')
    msg=p.evaluate('()=>{let s=vb6Studio.captureWindowLayout();s.commandBars.bars[0].items.push("BAD");try{vb6Studio.applyWindowLayout(s);}catch(e){return e.message;}}');check('toolbar' in msg.lower());check(p.evaluate('JSON.stringify({d:vb6Studio.docking.snapshot(),b:vb6Studio.commandBars.snapshot()})===beforeLayout'))

def import_layouts(p):
    count=p.evaluate('()=>{const s=vb6Studio.captureWindowLayout();return vb6Studio.importWindowLayouts(JSON.stringify({version:2,layouts:{Coding:s,Debugging:s}}));}');check(count==2);cmd(p,'manageWindowLayouts');check(p.get_by_role('button',name='Import…',exact=True).is_visible());check(p.get_by_label('Saved layouts',exact=True).locator('option').count()==2);p.locator('.ide-dialog').get_by_role('button',name='Close',exact=True).click()

def import_file(p):
    data=p.evaluate('JSON.stringify({version:2,layouts:{Imported:vb6Studio.captureWindowLayout()}})');cmd(p,'manageWindowLayouts')
    p.locator('.layout-manager input[type=file]').set_input_files({'name':'layout.json','mimeType':'application/json','buffer':data.encode()});p.wait_for_function('!!vb6Studio.namedLayouts.Imported');check('Imported 1 layout' in p.locator('.layout-manager [role=status]').inner_text());shot(p,'layout-manager');p.locator('.ide-dialog').get_by_role('button',name='Close',exact=True).click()

def cross_project(p):
    p.evaluate('window.savedOther=vb6Studio.captureWindowLayout()');source(p,'current source');p.evaluate('vb6Studio.applyWindowLayout(savedOther)');check(p.evaluate('vb6Studio.editor.text')=='current source');check(p.evaluate('vb6Studio.docs.every(d=>d.id==="main")'))

def dock_focus(p):
    p.evaluate('()=>{const m=vb6Studio.docking;m.dock("project","right",m.group("properties").id);}');p.locator('[data-window-id=project]').focus();p.evaluate('vb6Studio.docking.render()');check(p.evaluate('document.activeElement.dataset.windowId')=='project')

def toolbar_focus(p):
    p.get_by_label('Designer zoom',exact=True).focus();p.evaluate('vb6Studio.commandBars.render()');check(p.evaluate('document.activeElement===vb6Studio.zoomSelect'));p.keyboard.press('ArrowDown');check(p.get_by_label('Designer zoom',exact=True).input_value()!='1')

def dock_escape(p):
    p.evaluate('()=>{vb6Studio.docking.float("properties");window.beforeBounds={...vb6Studio.docking.group("properties").bounds};vb6Studio.docking.keyboardBounds("properties",false);}')
    p.keyboard.press('ArrowLeft');p.keyboard.press('Escape');check(p.evaluate('JSON.stringify(vb6Studio.docking.group("properties").bounds)===JSON.stringify(beforeBounds)'));check(p.evaluate('vb6Studio.docking.cancelInteraction===null'))

def toolbar_blur(p):
    p.evaluate('()=>{vb6Studio.commandBars.dock("edit","float");window.barBefore={...vb6Studio.commandBars.model.get("edit")};vb6Studio.commandBars.keyboardMove("edit");}')
    p.keyboard.press('ArrowRight');p.evaluate('window.dispatchEvent(new Event("blur"))');check(p.evaluate('vb6Studio.commandBars.model.get("edit").x===barBefore.x'));check(p.evaluate('vb6Studio.commandBars.cancelInteraction===null'))

def mdi_escape(p):
    source(p,"' source");before=p.locator('.mdi-active').bounding_box();title=p.locator('.mdi-active > .document-title');r=title.bounding_box();p.mouse.move(r['x']+180,r['y']+10);p.mouse.down();p.mouse.move(r['x']+245,r['y']+64,steps=8);p.keyboard.press('Escape');p.mouse.up();check(p.locator('.mdi-active').bounding_box()==before);check(p.evaluate('vb6Studio.documents.mdi.cancelInteraction===null'))

def dock_pointer_cancel(p):
    before=p.evaluate('JSON.stringify(vb6Studio.docking.snapshot())');h=p.locator('[data-dock-window=project] .tool-caption');r=h.bounding_box();p.mouse.move(r['x']+75,r['y']+8);p.mouse.down();p.mouse.move(600,420,steps=10);p.keyboard.press('Escape');p.mouse.up();check(p.evaluate('JSON.stringify(vb6Studio.docking.snapshot())')==before)

def narrow(p):
    p.evaluate('()=>{vb6Studio.commandBars.dock("edit","float");vb6Studio.docking.float("properties");}');p.set_viewport_size({'width':390,'height':844});p.wait_for_timeout(100)
    info=p.evaluate('()=>[...document.querySelectorAll(".dock-floating:not([hidden]),.command-bar-floating:not([hidden])")].map(n=>{let r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})');check(all(r['x']>=-1 and r['right']<=391 and r['y']>=0 and r['bottom']<=845 for r in info),info);shot(p,'narrow-workspace')

def debugger_source(p):
    source(p,'Private Sub Form_Load()\nDim parentValue As Long\nparentValue = 3\nDim result As Long\nresult = Inner(parentValue)\nDebug.Print result\nEnd Sub\nPrivate Function Inner(ByVal value As Long) As Long\nDim localValue As Long\nlocalValue = value * 2\nInner = localValue\nEnd Function')
    p.evaluate('()=>{vb6Studio.breakpoints=[{module:vb6Studio.activeModule.name,line:11}];vb6Studio.run();}');p.wait_for_function('vb6Studio.runState==="paused"',timeout=12000)

def data_tip(p):
    debugger_source(p);p.evaluate('()=>{vb6Studio.openDocument("main","code");vb6Studio.editor.goToLine(11,10);}')
    data=p.evaluate('vb6Studio.editor.assistance.showAt(vb6Studio.editor.text.lastIndexOf("localValue")+3)');check(data and data['value']=='6',data);check('6' in p.locator('.source-data-tip').inner_text());check(p.evaluate('()=>{const v=vb6Studio.editor.activePane.viewport.getBoundingClientRect(),t=vb6Studio.editor.assistance.tip.getBoundingClientRect();return t.x>=v.x&&t.right<=v.right&&t.y>=v.y&&t.bottom<=v.bottom;}'));shot(p,'paused-data-tip');cmd(p,'stop');p.wait_for_function('vb6Studio.runState==="design"&&!document.querySelector(".source-data-tip")')

def tip_no_getter(p):
    debugger_source(p);p.evaluate('()=>{window.inspectCount=0;window.originalInspect=vb6Studio.debuggerWindows.inspect.bind(vb6Studio.debuggerWindows);vb6Studio.debuggerWindows.inspect=async expr=>{inspectCount++;return originalInspect(expr);};}')
    result=p.evaluate('vb6Studio.editor.assistance.showAt(vb6Studio.editor.text.indexOf("Inner(parent")+2)');check(result is None);check(p.evaluate('inspectCount')==0)
    p.evaluate('vb6Studio.debuggerWindows.selectFrame(0)');result=p.evaluate('vb6Studio.editor.assistance.showAt(vb6Studio.editor.text.lastIndexOf("localValue")+3)');check(result is None);check(p.evaluate('inspectCount')==0)

def stale_tip(p):
    debugger_source(p);p.evaluate('''()=>{vb6Studio.debuggerWindows.inspect=()=>new Promise(resolve=>window.tipRelease=resolve);window.tipJob=vb6Studio.editor.assistance.showAt(vb6Studio.editor.text.lastIndexOf("localValue")+3);vb6Studio.editor.assistance.hide();tipRelease({value:"STALE",type:"Long"});}''');p.evaluate('tipJob');check(p.locator('.source-data-tip').count()==0)

def saved_session(p):
    source(p,"' "+"source line\n"*200,"Public Sub X()\nEnd Sub")
    data=p.evaluate('''()=>{const i=vb6Studio,e=i.editor;e.toggleSplit(true,.6);e.selectGlobal(10,23);e.activatePane(e.secondary);e.selectGlobal(101,113);e.input.scrollTop=125;i.docking.float("properties");i.commandBars.show("edit",true);return {project:i.project,layout:i.layoutSnapshot()};}''')
    q=boot()
    try:
        q.evaluate('''data=>{const i=vb6Studio;i.restoreLayout(data.layout);i.loadProject(data.project);i.restoreDocuments();i.applyAppearance();}''',data)
        check(q.evaluate('vb6Studio.editor.panes.length')==2)
        check(q.evaluate('vb6Studio.editor.splitRatio')==.6)
        check(q.evaluate('({start:vb6Studio.editor.selectionBounds().start,end:vb6Studio.editor.selectionBounds().end})')=={'start':101,'end':113})
        check(q.evaluate('vb6Studio.docking.group("properties").edge')=='float')
        check(q.evaluate('vb6Studio.commandBars.model.get("edit").visible'))
        check(not q._errors,q._errors)
    finally:q.close()

def no_op_edits(p):
    source(p,'unchanged source')
    p.evaluate('()=>{const e=vb6Studio.editor;e.setValue(e.text);e.findInput.value="not-present";e.replaceInput.value="replacement";e.replace(true);}')
    check(p.evaluate('vb6Studio.history.undoStack.length')==0)

def clean_status(p):
    idle(p);check('✓' in p.get_by_label('Syntax check status').inner_text());shot(p,'ide-ready')

def main():
    global BROWSER
    parser=argparse.ArgumentParser();parser.add_argument('--filter',default='');args=parser.parse_args()
    tests=[('Worker-backed automatic syntax diagnostics',worker,False),('Source diagnostics update gutters without stealing focus',diagnostics_live,False),('Rapid edits publish only the newest source diagnostics',latest,False),('Blocked or absent Workers use the between-module fallback',fallback,True),('Disabled automatic diagnostics preserve explicit syntax checks',disabled,False),('Unchanged modules reuse the diagnostic cache',data_cache,False),('Ctrl+Y cuts the logical line and undo restores it',cut_line,False),('Tab at a line boundary does not indent the following line',tab_selection,False),('100000 literal replacements use one undoable operation',replace_all,False),('Bulk replacement does not coalesce into preceding typing',undo_boundaries,False),('Find reuses indexed matches and Shift+F4 wraps',find_cache,False),('Completion keyboard navigation works in a 50000-line module',large_completion,False),('Split collapse preserves selections outside the native input window',large_selection,False),('Read-only editor commands cannot alter source',readonly,False),('Shared clipboard supports cross-module paste',clipboard,False),('Asynchronous paste rejects a stale selection',stale_clipboard,False),('Cross-module text moves undo and redo atomically',dnd,False),('Stale text drops cannot delete or overwrite source',stale_drop,False),('Same-document text moves preserve logical offsets',same_drop,False),('Real pointer text dragging moves a selected span',pointer_drag,False),('Escape cancels pointer text drag without source changes',pointer_cancel,False),('Named profile restores toolbars, docking and split selections',profile,False),('Invalid profile is rejected before any window changes',profile_atomic,False),('Imported layout collections retain every registered tool',import_layouts,False),('Actual layout JSON file import updates the manager',import_file,False),('Cross-project profiles do not replace unrelated document views',cross_project,False),('Dock-tab focus survives live layout rendering',dock_focus,False),('Toolbar rendering preserves a focused zoom control',toolbar_focus,False),('Keyboard floating dock movement rolls back on Escape',dock_escape,False),('Toolbar keyboard move cancels and cleans up on blur',toolbar_blur,False),('MDI pointer drag rolls back on Escape',mdi_escape,False),('Dock pointer drag rolls back on Escape',dock_pointer_cancel,False),('Narrow viewport retains reachable floating tools',narrow,False),('Paused Data Tips inspect live frame storage without execution',data_tip,False),('Data Tips reject unrelated call frames before inspection',tip_no_getter,False),('Late Data Tip results cannot reopen dismissed tooltips',stale_tip,False),('New IDE instance restores serialized split views and window placement',saved_session,False),('No-op source edits do not create undo records',no_op_edits,False),('Completed automatic checks have a stable accessible status',clean_status,False)]
    with sync_playwright() as pw:
        BROWSER=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox']);version=BROWSER.version
        for name,fn,fallback_mode in tests:
            if not args.filter or args.filter.lower() in name.lower():case(name,fn,fallback_mode)
        BROWSER.close()
    report={'browser':version,'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'metrics':METRICS,'tests':RESULTS}
    (REPORT/'browser-finalization-05.json').write_text(json.dumps(report,indent=2)+'\n')
    (REPORT/'browser-finalization-05.md').write_text('# 0.5.0 integrated browser validation\n\n'+f'{report["passed"]} passed; {report["failed"]} failed.\n\n'+'\n'.join(f'- {"PASS" if r["passed"] else "FAIL"}: {r["name"]}'+(' — '+r.get('error','') if not r['passed'] else '') for r in RESULTS)+'\n')
    print(f'{report["passed"]} passed; {report["failed"]} failed.',flush=True);return bool(report['failed'])
if __name__=='__main__':sys.exit(main())

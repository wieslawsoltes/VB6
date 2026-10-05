#!/usr/bin/env python3
"""Geometry, theme, native-style interactions and source-view regression checks.

Screenshots are of this implementation. They are NOT native VB6 golden images.
Use --update-goldens / --check-goldens for same-environment release regression.
Requires npm run build, Python Playwright, Pillow, and Chromium.
"""
from __future__ import annotations
import argparse, contextlib, hashlib, importlib.util, io, json, os, platform, shutil, subprocess, sys, time, traceback
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];REPORTS=ROOT/'reports';SHOTS=REPORTS/'visual';SHOTS.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'dist/VB6-Studio-Web.html').read_text();JS=(ROOT/'dist/vb6-runtime.js').read_text();CSS=(ROOT/'dist/vb6-controls.css').read_text()
FIXTURES=json.loads(subprocess.check_output(['node',str(ROOT/'tools/visual-fixtures.mjs')],text=True));RESULTS=[];IMAGES={};ENV={};BROWSER=None

def check(value,message='Assertion failed'):
    if not value: raise AssertionError(message)

def case(name,fn):
    start=time.perf_counter()
    try:
        details=fn();RESULTS.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2),'details':details});print('PASS',name,flush=True)
    except Exception as error:
        RESULTS.append({'name':name,'passed':False,'milliseconds':round((time.perf_counter()-start)*1000,2),'error':str(error)});print('FAIL',name,':',error,flush=True);traceback.print_exc(limit=2)

@contextlib.contextmanager
def page_for(kind='ide',fixture=None,size=(1280,900),dpr=1,touch=False,theme='classic',forced=None):
    page=BROWSER.new_page(viewport={'width':size[0],'height':size[1]},device_scale_factor=dpr,has_touch=touch,forced_colors=forced or 'none');page.set_default_timeout(7000);page._errors=[];page._requests=[]
    page.on('pageerror',lambda e:page._errors.append(str(e)));page.on('request',lambda r:page._requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
    try:
        if kind=='ide':
            page.set_content(HTML);page.wait_for_function('!!window.vb6Studio');page.evaluate('theme=>{vb6Studio.appearance.theme=theme;vb6Studio.applyAppearance();}',theme)
            if fixture:page.evaluate('p=>vb6Studio.loadProject(p)',FIXTURES[fixture])
        else:
            page.set_content('<!doctype html><html><head><style>'+CSS+'</style></head><body></body></html>');page.add_script_tag(content=JS)
            project=json.loads(json.dumps(FIXTURES[fixture or 'scroll']));project['settings']['theme']=theme
            page.evaluate('p=>{window.vb6Application=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});window.startPromise=vb6Application.start();}',project);page.wait_for_function('vb6Application.vm.state === "running"');page.wait_for_timeout(80)
        page.wait_for_timeout(80);yield page
        check(not page._errors,'Browser errors: '+str(page._errors));check(not page._requests,'Network requests: '+str(page._requests))
    finally:page.close()

def cmd(page,name):page.evaluate('name=>{vb6Studio.command(name);}',name)
def frame(page):return page.locator('.mdi-active')
def input_of(page):return page.locator('.mdi-active textarea[data-active-editor="true"]')
def colors(page,selector):return page.locator(selector).evaluate('(n)=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopColor})')
def screenshot(page,name):
    page.wait_for_function('!globalThis.vb6Studio?.syntaxDiagnostics?.pending',timeout=20000);page.mouse.move(2,2);page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');a=page.screenshot(caret='hide',animations='disabled');b=page.screenshot(caret='hide',animations='disabled');image=Image.open(io.BytesIO(a)).convert('RGB');diff=ImageChops.difference(image,Image.open(io.BytesIO(b)).convert('RGB'));changed=image.width*image.height-ImageChops.lighter(ImageChops.lighter(diff.getchannel('R'),diff.getchannel('G')),diff.getchannel('B')).histogram()[0]
    (SHOTS/(name+'.png')).write_bytes(a);IMAGES[name]={'sha256':hashlib.sha256(a).hexdigest(),'width':image.width,'height':image.height,'repeatChangedPixels':changed};check(changed==0,'Non-repeatable own screenshot '+name+': '+str(changed)+' changed pixels');return IMAGES[name]

def test_shell():
    with page_for() as p:
        geometry=p.evaluate('Object.fromEntries(["app-title","menubar","toolbar","statusbar"].map(c=>{let r=document.querySelector("."+c).getBoundingClientRect();return [c,{x:r.x,y:r.y,width:r.width,height:r.height}]}))')
        check(geometry['app-title']['height']==20,geometry);check(geometry['menubar']['height']==21,geometry);check(geometry['toolbar']['height']==29,geometry);check(p.locator('.menubar > button').count()==10);check(not p.locator('.document-tabs').is_visible());check(p.locator('.tree-row[aria-expanded]').first.get_attribute('aria-expanded')=='true');check(not p.locator('.debug-tabs').is_visible());check(p.locator('.mdi-window').count()==1);check(p.locator('.toolbox-grid button svg').count()==21);check(colors(p,'[data-command-bar=standard]')['background']=='rgb(192, 192, 192)');screenshot(p,'classic-designer');return geometry

def test_options():
    with page_for() as p:
        before=p.evaluate('JSON.stringify({appearance:vb6Studio.appearance,settings:vb6Studio.project.settings})');cmd(p,'options');d=p.get_by_role('dialog',name='Options');check(p.locator('#studio').evaluate('(n)=>n.inert'))
        p.get_by_role('tab',name='Editor Format',exact=True).click();check(p.get_by_label('Editor font',exact=True).is_visible());p.get_by_label('Editor font',exact=True).select_option('Consolas');p.get_by_role('tab',name='Editor Format',exact=True).press('ArrowRight');check(p.get_by_role('tab',name='General',exact=True).get_attribute('aria-selected')=='true');p.get_by_label('IDE theme',exact=True).select_option('contrast');screenshot(p,'options-general');d.get_by_role('button',name='Cancel',exact=True).click();check(before==p.evaluate('JSON.stringify({appearance:vb6Studio.appearance,settings:vb6Studio.project.settings})'));check(not p.locator('#studio').evaluate('(n)=>n.inert'))

def test_theme_apply():
    with page_for() as p:
        cmd(p,'options');p.get_by_role('tab',name='General',exact=True).click();p.get_by_label('IDE theme',exact=True).select_option('contrast');p.get_by_label('Application theme',exact=True).select_option('standard');p.get_by_role('dialog',name='Options').get_by_role('button',name='OK',exact=True).click();check(p.locator('html').get_attribute('data-vb-theme')=='contrast');check(p.evaluate('vb6Studio.project.settings.theme')=='standard');check(colors(p,'[data-command-bar=standard]')['background']=='rgb(0, 0, 0)');check(colors(p,'.designer-form .vb-form-content')['background']=='rgb(212, 208, 200)');check(p.evaluate('vb6Studio.history.undoStack.at(-1).label')=='Options');screenshot(p,'independent-ide-app-themes')

def test_property_color():
    with page_for() as p:
        original=p.evaluate('vb6Studio.activeModule.form.properties.BackColor');field=p.locator('input[data-property=BackColor]');field.focus();field.press('Alt+ArrowDown');popup=p.get_by_role('dialog',name='Color palette');popup.wait_for();check(popup.locator('[data-system-color]').count()==25);screenshot(p,'system-color-palette');popup.get_by_role('tab',name='Palette',exact=True).click();check(popup.get_by_role('option').filter(visible=True).count()==48);popup.get_by_role('option',name='&H000000FF&',exact=True).click();check(p.evaluate('vb6Studio.activeModule.form.properties.BackColor')==255);check(colors(p,'.designer-form .vb-form-content')['background']=='rgb(255, 0, 0)');cmd(p,'undo');check(p.evaluate('vb6Studio.activeModule.form.properties.BackColor')==original)

def test_property_cancel():
    with page_for() as p:
        field=p.locator('input[data-property=Caption]');old=field.input_value();field.fill('Cancelled text');field.press('Escape');check(p.evaluate('vb6Studio.activeModule.form.properties.Caption')==old);field=p.locator('input[data-property=Caption]');field.fill('Committed text');field.press('Enter');check(p.evaluate('vb6Studio.activeModule.form.properties.Caption')=='Committed text');check(not p.locator('.property-row[data-property=BackColor] .property-edit-button').is_visible());p.get_by_role('tab',name='Categorized',exact=True).click();check(p.locator('.property-group').count()>=4);group=p.locator('.property-group').first;group.click();check(p.locator('.property-group').first.get_attribute('aria-expanded')=='false')

def test_property_font():
    with page_for() as p:
        original=p.evaluate('vb6Studio.activeModule.form.properties.FontName');p.locator('.property-row[data-property=Font] .property-name').dblclick(position={'x':55,'y':8});d=p.get_by_role('dialog',name='Font',exact=True);d.get_by_label('Font name',exact=True).fill('Courier New');d.get_by_label('Font size',exact=True).fill('11');d.get_by_label('Bold',exact=True).check();screenshot(p,'font-editor');d.get_by_role('button',name='OK',exact=True).click();check(p.evaluate('vb6Studio.activeModule.form.properties.FontName')=='Courier New');check(p.evaluate('vb6Studio.activeModule.form.properties.FontBold')==-1);cmd(p,'undo');check(p.evaluate('vb6Studio.activeModule.form.properties.FontName')==original)

def test_property_keyboard():
    with page_for() as p:
        p.locator('.property-grid').focus();p.keyboard.press('Home');check(p.evaluate('vb6Studio.inspector.activeKey')=='Name');p.keyboard.press('ArrowDown');check(p.evaluate('vb6Studio.inspector.activeKey')=='BackColor');p.keyboard.press('F2');check(p.evaluate('document.activeElement.dataset.property')=='BackColor');p.keyboard.press('Escape');split=p.locator('.property-column-resizer');before=p.evaluate('vb6Studio.inspector.column');split.focus();split.press('ArrowRight');check(p.evaluate('vb6Studio.inspector.column')>before);check(split.get_attribute('role')=='separator')

def test_menu_stack():
    with page_for() as p:
        p.locator('[data-menu=Format]').click();menu=p.locator('.classic-menu').first;menu.get_by_role('menuitem',name='Align',exact=True).hover();p.wait_for_function('document.querySelectorAll(".classic-menu").length===2');check(p.locator('.classic-menu').first.is_visible());check(p.locator('.classic-menu [aria-expanded=true]').count()==1);screenshot(p,'retained-submenus');p.keyboard.press('Escape');check(p.locator('.classic-menu').count()==1);p.keyboard.press('Escape');check(p.locator('.classic-menu').count()==0);check(p.evaluate('document.activeElement.dataset.menu')=='Format')

def test_menu_keyboard():
    with page_for() as p:
        p.keyboard.press('F10');check(p.evaluate('document.activeElement.dataset.menu')=='File');p.keyboard.press('ArrowRight');check(p.evaluate('document.activeElement.dataset.menu')=='Edit');p.keyboard.press('ArrowDown');p.keyboard.press('End');check(p.evaluate('document.activeElement.closest(".classic-menu")!==null'));p.keyboard.press('Escape');p.keyboard.press('Alt+t');check(p.locator('.classic-menu').count()==1);p.locator('[data-menu=Window]').hover();check(p.locator('[data-menu=Window]').get_attribute('aria-expanded')=='true');p.keyboard.press('Escape')

def test_menu_bounds():
    with page_for(size=(390,760),touch=True) as p:
        p.locator('[data-menu=Format]').click();p.locator('.classic-menu').first.get_by_role('menuitem',name='Align',exact=True).hover();p.wait_for_function('document.querySelectorAll(".classic-menu").length===2');rects=p.locator('.classic-menu').evaluate_all('(nodes)=>nodes.map(n=>{let r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}})');check(len(rects)==2,rects);check(all(r['x']>=0 and r['right']<=390 and r['y']>=0 and r['bottom']<=760 for r in rects),rects);screenshot(p,'narrow-retained-menus');return rects

def test_mdi_live():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4,5)');selection=p.evaluate('vb6Studio.editor.input.selectionStart');p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[1].id,"code")');input_of(p).fill('Option Explicit\nPublic x As Long\n');p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code")');check(p.evaluate('vb6Studio.editor.input.selectionStart')==selection);check('Alpha' in input_of(p).input_value());check(p.evaluate('vb6Studio.project.modules[1].code')=='Option Explicit\nPublic x As Long\n');check(p.locator('.mdi-window').count()==3);screenshot(p,'live-mdi-code')

def test_mdi_tiling():
    with page_for(fixture='editor') as p:
        p.evaluate('()=>{for(let i=2;i<5;i++){const m={id:"extra"+i,name:"Module"+i,kind:"module",code:"Option Explicit\\n"};vb6Studio.project.modules.push(m);vb6Studio.openDocument(m.id,"code");}vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.openDocument(vb6Studio.project.modules[1].id,"code");vb6Studio.documents.mdi.arrange("vertical");}')
        rects=p.locator('.mdi-window').evaluate_all('(nodes)=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}}).sort((a,b)=>a.x-b.x)');check(len(rects)==6);check(all(rects[i]['right']<=rects[i+1]['x']+1 for i in range(len(rects)-1)),rects);p.evaluate('vb6Studio.documents.mdi.arrange("horizontal")');rects=p.locator('.mdi-window').evaluate_all('(nodes)=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:r.y,bottom:r.bottom}}).sort((a,b)=>a.y-b.y)');check(all(rects[i]['bottom']<=rects[i+1]['y']+1 for i in range(len(rects)-1)),rects)

def test_mdi_buttons():
    with page_for() as p:
        before=frame(p).bounding_box();frame(p).get_by_role('button',name='Minimize document',exact=True).click();check(frame(p).get_attribute('class').find('mdi-minimized')>=0);frame(p).get_by_role('button',name='Restore document',exact=True).click();check(frame(p).bounding_box()==before);frame(p).get_by_role('button',name='Maximize document',exact=True).click();check(frame(p).get_attribute('class').find('mdi-maximized')>=0);frame(p).get_by_role('button',name='Restore document',exact=True).click();check(frame(p).bounding_box()==before);p.keyboard.press('Control+F10');check('mdi-maximized' in frame(p).get_attribute('class'));p.keyboard.press('Control+F10')

def test_mdi_move_resize():
    with page_for() as p:
        header=frame(p).locator('.document-title');box=header.bounding_box();old=frame(p).bounding_box();p.mouse.move(box['x']+200,box['y']+8);p.mouse.down();p.mouse.move(box['x']+240,box['y']+38);p.mouse.up();new=frame(p).bounding_box();check(new['x']==old['x']+40 and new['y']==old['y']+30,(old,new));handle=frame(p).locator('.mdi-resize-se');r=handle.bounding_box();p.mouse.move(r['x']+2,r['y']+2);p.mouse.down();p.mouse.move(r['x']+32,r['y']+22);p.mouse.up();check(frame(p).bounding_box()['width']==new['width']+30);snapshot=p.evaluate('vb6Studio.documents.mdi.snapshot()');p.evaluate('vb6Studio.documents.mdi.arrange("cascade")');p.evaluate('s=>vb6Studio.documents.mdi.restoreSnapshot(s)',snapshot);check(frame(p).bounding_box()['x']==new['x'])

def test_mdi_keyboard():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.openDocument(vb6Studio.project.modules[1].id,"code")');old=p.evaluate('vb6Studio.activeDoc.key');p.keyboard.press('Control+F6');check(p.evaluate('vb6Studio.activeDoc.key')!=old);count=p.locator('.mdi-window').count();p.keyboard.press('Control+F4');check(p.locator('.mdi-window').count()==count-1);p.evaluate('vb6Studio.documents.mdi.keyboardBounds(vb6Studio.documents.mdi.windows.get(vb6Studio.activeDoc.key),"move")');before=frame(p).bounding_box();p.keyboard.press('ArrowRight');p.keyboard.press('Escape');check(frame(p).bounding_box()==before)

def test_panels():
    with page_for() as p:
        p.locator('.project-panel > .tool-caption button[title="Hide window"]').click();check(not p.locator('.project-panel').is_visible());check(p.locator('.properties-panel').is_visible());check(p.locator('.layout-panel').is_visible());cmd(p,'projectExplorer');check(p.locator('.project-panel').is_visible());header=p.locator('.properties-panel > .tool-caption');header.focus();header.press('Control+Enter');check('panel-floating' in p.locator('.properties-panel').get_attribute('class'));check(p.locator('.project-panel').is_visible());screenshot(p,'floating-properties');header.press('Control+Enter');check('panel-floating' not in p.locator('.properties-panel').get_attribute('class'))

def test_new_project_tabs():
    with page_for() as p:
        cmd(p,'new');d=p.get_by_role('dialog',name='New Project',exact=True);check(d.get_by_role('tab').count()==3);d.get_by_role('tab',name='Existing',exact=True).click();check(d.get_by_role('tabpanel').filter(visible=True).count()==1);d.get_by_role('tab',name='Recent',exact=True).click();check(d.get_by_role('tabpanel').filter(visible=True).count()==1);d.get_by_role('tab',name='New',exact=True).click();check(d.get_by_role('option').count()==16);check(d.get_by_role('option',name='Runtime Workbench',exact=True).count()==1);check(all(d.get_by_role('option',name=name,exact=True).count()==1 for name in ('SQLite Customers','REST Customers','Public REST Users','GraphQL and OData')));screenshot(p,'new-project');d.get_by_role('option',name='Standard EXE',exact=True).dblclick();p.wait_for_function('vb6Studio.activeModule.form.controls.length===0');check(p.locator('.ide-modal-cover').count()==0)

def test_code_procedure():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4)');frame(p).get_by_role('button',name='Procedure View',exact=True).click();check('Alpha' in input_of(p).input_value() and 'Beta' not in input_of(p).input_value());before=p.evaluate('vb6Studio.activeModule.code');input_of(p).fill('Private Sub Alpha()\n    Debug.Print "edited"\nEnd Sub\n');after=p.evaluate('vb6Studio.activeModule.code');check(after.startswith('Option Explicit\n\n'));check(after[after.index('Private Sub Beta'):]==before[before.index('Private Sub Beta'):]);p.keyboard.press('Control+z');check(p.evaluate('vb6Studio.activeModule.code')==before);p.keyboard.press('Control+Shift+z');check('edited' in p.evaluate('vb6Studio.activeModule.code'));screenshot(p,'procedure-view')

def test_code_declarations():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4);vb6Studio.editor.setViewMode("procedure")');frame(p).get_by_label('Procedure',exact=True).select_option('');check(input_of(p).input_value()=='Option Explicit\n');input_of(p).fill('Option Explicit\nDim Counter As Long\n');check(p.evaluate('vb6Studio.activeModule.code').startswith('Option Explicit\nDim Counter As Long\n\nPrivate Sub Alpha'));p.evaluate('vb6Studio.editor.goToLine(8)');check('Beta' in input_of(p).input_value())

def test_code_split():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4);vb6Studio.editor.setViewMode("procedure")');frame(p).locator('.code-split-grip').dblclick();check(frame(p).locator('textarea.source-input').count()==2);frame(p).locator('[data-code-pane=lower] textarea').focus();p.evaluate('vb6Studio.editor.goToLine(8)');check('Beta' in input_of(p).input_value());check('Alpha' in frame(p).locator('[data-code-pane=upper] textarea').input_value());input_of(p).fill('Private Sub Beta()\n    Debug.Print "split edit"\nEnd Sub\n');check('split edit' in p.evaluate('vb6Studio.activeModule.code'));check('Alpha' in frame(p).locator('[data-code-pane=upper] textarea').input_value());screenshot(p,'split-procedure-views');split=frame(p).locator('.code-pane-splitter');split.focus();before=int(split.get_attribute('aria-valuenow'));split.press('ArrowDown');check(int(split.get_attribute('aria-valuenow'))>before);split.dblclick();check(frame(p).locator('textarea.source-input').count()==1);check('split edit' in input_of(p).input_value())

def test_code_search_projection():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4);vb6Studio.editor.setViewMode("procedure");vb6Studio.editor.showFind(true)');frame(p).get_by_label('Find what',exact=True).fill('beta token');frame(p).get_by_label('Find what',exact=True).press('Enter');check(p.evaluate('vb6Studio.editor.cursor().line')==8);check('Beta' in input_of(p).input_value());frame(p).get_by_label('Replace with',exact=True).fill('replaced');frame(p).get_by_role('button',name='Replace',exact=True).click();check('replaced' in p.evaluate('vb6Studio.activeModule.code'));frame(p).get_by_label('Find what',exact=True).fill('Private');frame(p).get_by_label('Replace with',exact=True).fill('Public');frame(p).get_by_role('button',name='All',exact=True).click();check(p.evaluate('vb6Studio.activeModule.code.match(/Public Sub/g).length')==2)

def test_code_breakpoint_projection():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(8);vb6Studio.editor.setViewMode("procedure")');p.keyboard.press('F9');check(p.evaluate('vb6Studio.breakpoints[0].line')==8);check(frame(p).locator('.gutter-line[data-line="8"]').get_attribute('class').find('has-breakpoint')>=0);p.evaluate('vb6Studio.editor.setExecution({module:vb6Studio.activeModule.name,line:8})');check(frame(p).locator('.gutter-line[data-line="8"]').get_attribute('class').find('has-execution')>=0);check(frame(p).locator('.execution-line').count()==1);screenshot(p,'projected-breakpoint')

def test_code_selection():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.goToLine(4);vb6Studio.editor.input.setSelectionRange(41,55);vb6Studio.editor.cursorChanged()');check(frame(p).locator('.code-selection').count()>0);style=frame(p).locator('.code-selection').first.evaluate('(n)=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})');check(style=={'color':'rgb(255, 255, 255)','background':'rgb(0, 0, 128)'},style);screenshot(p,'native-style-code-selection')

def test_code_readonly():
    with page_for(fixture='editor') as p:
        p.evaluate('vb6Studio.openDocument(vb6Studio.project.modules[0].id,"code");vb6Studio.editor.toggleSplit(true);vb6Studio.editor.setReadOnly(true)');check(frame(p).locator('textarea.source-input[readonly]').count()==2);before=p.evaluate('vb6Studio.activeModule.code');p.evaluate('vb6Studio.editor.replaceSelection("blocked");vb6Studio.editor.setValue("blocked")');check(p.evaluate('vb6Studio.activeModule.code')==before);p.evaluate('vb6Studio.editor.setReadOnly(false)');check(frame(p).locator('textarea.source-input[readonly]').count()==0)

def test_code_split_large():
    with page_for(fixture='editor') as p:
        p.evaluate('()=>{vb6Studio.project.modules[1].code=Array.from({length:20000},(_,i)=>"\' source "+i).join("\\n");vb6Studio.openDocument(vb6Studio.project.modules[1].id,"code");vb6Studio.editor.toggleSplit(true);vb6Studio.editor.goToLine(10000);vb6Studio.editor.secondary.input.focus();vb6Studio.editor.goToLine(19990);}')
        check(p.evaluate('vb6Studio.editor.cursor().line')==19990);check(frame(p).locator('.syntax-line').count()<90);check(p.evaluate('vb6Studio.editor.primary.input.scrollTop')!=p.evaluate('vb6Studio.editor.secondary.input.scrollTop'));return {'logicalLines':20000,'paintedLines':frame(p).locator('.syntax-line').count()}

def test_runtime_menu():
    with page_for('runtime','menus') as p:
        p.get_by_role('menuitem',name='File',exact=True).click();p.locator('.classic-menu').get_by_role('menuitem',name='Nested',exact=False).hover();p.wait_for_function('document.querySelectorAll(".classic-menu").length===2');check(p.locator('.classic-menu [aria-disabled=true]').count()==1);screenshot(p,'runtime-cascading-menu');p.locator('.classic-menu').last.get_by_role('menuitem',name='Apply',exact=False).click();p.wait_for_function('vb6Application.forms[0].controlMap.get("status").Caption === "Applied"');check(p.locator('.classic-menu').count()==0)

def test_runtime_message():
    with page_for('runtime','menus') as p:
        p.evaluate('()=>{window.result=null;vb6Application.msgBox("Keep this dialog open until a choice is made.",4+16+256,"Confirm").then(v=>window.result=v)}');d=p.get_by_role('dialog',name='Confirm',exact=True);check(p.evaluate('vb6Application.stage.inert'));check(d.locator('.vb-message-symbol svg').count()==1);check(p.evaluate('document.activeElement.textContent')=='No');p.keyboard.press('Escape');check(d.is_visible());check(p.evaluate('result') is None);screenshot(p,'runtime-message-box');p.keyboard.press('Enter');p.wait_for_function('result===7');check(not p.evaluate('vb6Application.stage.inert'))

def test_runtime_input_nested():
    with page_for('runtime','menus') as p:
        p.evaluate('()=>{window.result=null;vb6Application.inputBox("Name:","Input","").then(v=>window.result=v)}');d=p.get_by_role('dialog',name='Input',exact=True);p.keyboard.press('Escape');p.wait_for_function('result===""');check(not p.evaluate('vb6Application.stage.inert'));p.evaluate('()=>{vb6Application.msgBox("First",0,"First");vb6Application.msgBox("Second",1,"Second")}');check(p.locator('.vb-modal-shade').count()==2);p.keyboard.press('Escape');check(p.locator('.vb-modal-shade').count()==1);check(p.evaluate('vb6Application.stage.inert'));p.keyboard.press('Escape');check(p.locator('.vb-modal-shade').count()==0);check(not p.evaluate('vb6Application.stage.inert'))

def test_scroll_keyboard():
    with page_for('runtime','scroll') as p:
        h=p.locator('[data-control=HBar]');v=p.locator('[data-control=VBar]');check(h.get_attribute('role')=='scrollbar');check(h.locator('input[type=range]').count()==0);h.focus();h.press('ArrowRight');p.wait_for_function('vb6Application.forms[0].controlMap.get("hbar").Value===2');h.press('PageDown');p.wait_for_function('vb6Application.forms[0].controlMap.get("hbar").Value===22');h.press('End');p.wait_for_function('vb6Application.forms[0].controlMap.get("hbar").Value===100');v.focus();v.press('ArrowDown');p.wait_for_function('vb6Application.forms[0].controlMap.get("vbar").Value===98');check(v.get_attribute('aria-valuenow')=='98');screenshot(p,'classic-scroll-bars')

def test_scroll_drag():
    with page_for('runtime','scroll') as p:
        h=p.locator('[data-control=HBar]');thumb=h.locator('.vb-scroll-thumb');r=thumb.bounding_box();p.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);p.mouse.down();p.mouse.move(r['x']+r['width']/2+80,r['y']+r['height']/2,steps=8);p.mouse.up();p.wait_for_function('vb6Application.forms[0].controlMap.get("trace").Caption.endsWith("C")');trace=p.evaluate('vb6Application.forms[0].controlMap.get("trace").Caption');check('S' in trace,trace);check(trace.count('C')==1,trace);h.focus();h.press('Home');p.wait_for_function('vb6Application.forms[0].controlMap.get("hbar").Value===0');h.locator('[aria-label="Scroll right"]').click();p.wait_for_function('vb6Application.forms[0].controlMap.get("hbar").Value===2')

def test_combo_widget():
    with page_for('runtime','widgets') as p:
        c=p.locator('[data-control=Editable]');field=c.get_by_role('combobox');check(c.locator('datalist').count()==0);check(c.get_by_role('button',name='Open list').is_visible());field.focus();field.press('Alt+ArrowDown');popup=p.get_by_role('listbox',name='Editable items');popup.wait_for();check(popup.get_by_role('option').count()==3);screenshot(p,'classic-combo-popup');field.press('ArrowDown');field.press('Escape');check(p.evaluate('vb6Application.forms[0].controlMap.get("editable").ListIndex')==0);field.press('F4');field.press('ArrowDown');field.press('Enter');p.wait_for_function('vb6Application.forms[0].controlMap.get("result").Caption==="Beta"');check(field.input_value()=='Beta');check(field.get_attribute('aria-expanded')=='false');field.fill('Custom');p.wait_for_function('vb6Application.forms[0].controlMap.get("editable").Text==="Custom"');check(p.evaluate('vb6Application.forms[0].controlMap.get("editable").ListIndex')==-1)

def test_combo_styles():
    with page_for('runtime','widgets') as p:
        field=p.locator('[data-control=Choice]').get_by_role('combobox');check(field.get_attribute('readonly') is not None);field.focus();field.press('t');check(field.input_value()=='Two');field.press('Alt+ArrowDown');p.get_by_role('listbox',name='Choice items').get_by_role('option',name='Three',exact=True).click();check(field.input_value()=='Three');simple=p.locator('[data-control=Simple]');check(simple.get_by_role('listbox').is_visible());simple.get_by_role('option',name='Blue',exact=True).click();check(simple.get_by_role('combobox').input_value()=='Blue');check(simple.get_by_role('listbox').is_visible());screenshot(p,'classic-combo-styles')

def test_combo_large():
    with page_for('runtime','widgets',size=(390,760),theme='contrast') as p:
        p.evaluate('()=>{const c=vb6Application.forms[0].controlMap.get("editable");c.items=Array.from({length:10000},(_,i)=>"Item "+i);c.props.ListIndex=0;c.refresh()}');field=p.locator('[data-control=Editable]').get_by_role('combobox');field.focus();field.press('F4');field.press('End');popup=p.get_by_role('listbox',name='Editable items');check(popup.get_by_role('option').count()<30);check(popup.get_by_role('option',name='Item 9999',exact=True).is_visible());r=popup.bounding_box();check(r['x']>=0 and r['x']+r['width']<=390);field.press('Enter');check(p.evaluate('vb6Application.forms[0].controlMap.get("editable").ListIndex')==9999)

def test_stepper_widget():
    with page_for('runtime','widgets') as p:
        spin=p.locator('[data-control=Spin]');check(spin.get_attribute('role')=='spinbutton');check(spin.locator('input[type=number]').count()==0);spin.focus();spin.press('ArrowUp');p.wait_for_function('vb6Application.forms[0].controlMap.get("spin").Value===4');spin.get_by_role('button',name='Increment',exact=True).click();p.wait_for_function('vb6Application.forms[0].controlMap.get("spin").Value===5');spin.get_by_role('button',name='Increment',exact=True).click();check(p.evaluate('vb6Application.forms[0].controlMap.get("spin").Value')==5);p.evaluate('vb6Application.forms[0].controlMap.get("spin").Wrap=-1');spin.get_by_role('button',name='Increment',exact=True).click();p.wait_for_function('vb6Application.forms[0].controlMap.get("spin").Value===0');check(spin.get_attribute('aria-valuenow')=='0');screenshot(p,'classic-updown-control');p.evaluate('vb6Application.forms[0].controlMap.get("spin").Enabled=0');p.wait_for_function('document.querySelector("[data-control=Spin] button").disabled')

def test_tooltips():
    with page_for() as p:
        p.locator('[data-command=save]').first.hover();p.locator('.classic-tooltip').wait_for();check('Save Project' in p.locator('.classic-tooltip').inner_text());p.mouse.move(1000,860);p.wait_for_function('!document.querySelector(".classic-tooltip")');p.evaluate('vb6Studio.appearance.tooltips=false;vb6Studio.applyAppearance()');p.locator('[data-command=save]').first.hover();p.wait_for_timeout(800);check(p.locator('.classic-tooltip').count()==0);check(p.locator('[data-command=save]').first.get_attribute('title') is None)

def test_profile(theme):
    with page_for(theme=theme) as p:
        cmd(p,'viewCode');screenshot(p,theme+'-code');color=colors(p,'[data-command-bar=standard]')['background'];expected={'classic':'rgb(192, 192, 192)','standard':'rgb(212, 208, 200)','contrast':'rgb(0, 0, 0)'}[theme];check(color==expected,(color,expected));check(frame(p).locator('.source-editor').evaluate('(n)=>getComputedStyle(n).color')==('rgb(255, 255, 255)' if theme=='contrast' else 'rgb(0, 0, 0)'))
    with page_for('runtime','intrinsic',theme=theme,size=(1360,920)) as p:screenshot(p,theme+'-intrinsic-controls')
    with page_for('runtime','extended',theme=theme,size=(1360,920)) as p:
        p.wait_for_function('document.querySelector("[data-type=MSChart] canvas")');screenshot(p,theme+'-extended-controls')

def test_dpi():
    with page_for(dpr=2) as p:
        result=screenshot(p,'classic-designer-dpr2');check(result['width']==2560 and result['height']==1800);check(p.locator('.app-title').bounding_box()['height']==20);return result

def test_small():
    with page_for(size=(1024,768)) as p:
        check(p.evaluate('document.documentElement.scrollWidth')==1024);check(p.locator('.properties-panel').is_visible());screenshot(p,'classic-1024x768')
    with page_for(size=(390,760),touch=True) as p:
        check(p.evaluate('document.documentElement.scrollWidth')==390);cmd(p,'properties');check(p.locator('.properties-panel').is_visible());screenshot(p,'classic-mobile-inspector');cmd(p,'options');d=p.get_by_role('dialog',name='Options');r=d.bounding_box();check(r['x']>=0 and r['x']+r['width']<=390);d.get_by_role('button',name='Cancel',exact=True).tap()

def test_forced_colors():
    with page_for(forced='active') as p:
        check(p.evaluate('matchMedia("(forced-colors:active)").matches'));check(p.locator('.toolbox-grid svg').count()==21);screenshot(p,'forced-colors')

def test_export_theme():
    with page_for() as p:
        result=p.evaluate('()=>{const project=VB6StudioAPI.newProject("Themed");project.settings.theme="standard";return VB6StudioAPI.exportApplication(project)}');check('data-vb-theme="standard"' in result);check('<script src=' not in result);check('@font-face' not in result)
        with BROWSER.new_page(viewport={'width':900,'height':650}) as app:
            app.set_content(result);app.wait_for_function('!!window.vb6Application');check(app.evaluate('vb6Application.theme')=='standard');check(colors(app,'.vb-form-content')['background']=='rgb(212, 208, 200)');screenshot(app,'exported-standard-theme')

def main():
    global BROWSER,ENV
    ap=argparse.ArgumentParser();ap.add_argument('--update-goldens',action='store_true');ap.add_argument('--check-goldens',action='store_true');ap.add_argument('--filter',default='');args=ap.parse_args();chromium=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser');check(chromium,'Chromium is required')
    with sync_playwright() as pw:
        BROWSER=pw.chromium.launch(executable_path=chromium,args=['--no-sandbox']);ENV={'browser':BROWSER.version,'platform':platform.system(),'architecture':platform.machine(),'fontPolicy':'local fonts only; no font files bundled','nativeVB6ReferencePixels':False}
        tests=[('Classic combo popup, keyboard commit/cancel and VB events',test_combo_widget),('List-only type search and permanent simple combo list',test_combo_styles),('10,000-item combo popup virtualization and narrow theme bounds',test_combo_large),('Two-button UpDown pointer/keyboard, wrap and disabled state',test_stepper_widget),('Classic shell geometry, palette, toolbar glyphs and default chrome',test_shell),('Options tabs, keyboard navigation, modal inertness and Cancel transaction',test_options),('Independent IDE/application themes and undoable project settings',test_theme_apply),('OLE system-color palette, RGB swatches and undo',test_property_color),('Property Cancel followed by commit; categorized collapse and inactive editors',test_property_cancel),('Font dialog preview, atomic property update and undo',test_property_font),('Property grid navigation, F2 editing and keyboard column splitter',test_property_keyboard),('Retained cascading menus and Escape focus restoration',test_menu_stack),('F10/Alt menus and hover switching without duplicate popups',test_menu_keyboard),('Nested menu placement within a 390px touch viewport',test_menu_bounds),('Live MDI documents retain independent source buffers and selections',test_mdi_live),('Six MDI windows tile without overlap below normal resize minimum',test_mdi_tiling),('MDI minimize, maximize, restore and Ctrl+F10',test_mdi_buttons),('MDI pointer move/resize and serializable bounds restore',test_mdi_move_resize),('MDI Ctrl+F6/Ctrl+F4 and cancelled keyboard move',test_mdi_keyboard),('Independent panel visibility and keyboard floating/docking',test_panels),('New Project New/Existing/Recent pages and template activation',test_new_project_tabs),('Procedure-only edits preserve surrounding source and undo/redo',test_code_procedure),('Declarations projection and navigation after source shifts',test_code_declarations),('Two live code projections, synchronized edits and split sizing',test_code_split),('Find/replace crosses projections with global source offsets',test_code_search_projection),('Projected gutter breakpoints and current execution use global lines',test_code_breakpoint_projection),('Selected source has native-style contrasting colors',test_code_selection),('Read-only guards apply to both code panes and edit APIs',test_code_readonly),('20,000-line split document retains bounded rendered lines',test_code_split_large),('Runtime cascading menus dispatch VB events and retain parents',test_runtime_menu),('Runtime MsgBox default button, icon, inertness and no invented Cancel',test_runtime_message),('InputBox empty Cancel and nested dialog focus/inert restoration',test_runtime_input_nested),('Classic scrollbars: keyboard, reversed ranges, ARIA and no range-input substitute',test_scroll_keyboard),('Classic scrollbar thumb Scroll/Change events and arrow click',test_scroll_drag),('Classic tooltip timing and genuine disabled tooltip behavior',test_tooltips),('DPR2 screenshot size and unchanged CSS-pixel geometry',test_dpi),('1024px and 390px layouts, touch inspector and constrained dialog',test_small),('System forced-colors rendering smoke',test_forced_colors),('Standalone export preserves application theme without external assets',test_export_theme)]
        for name,fn in tests:
            if not args.filter or args.filter.lower() in name.lower():case(name,fn)
        for theme in ['classic','standard','contrast']:
            if not args.filter or args.filter.lower() in ('IDE and intrinsic/extended control screenshots: '+theme).lower():case('IDE and intrinsic/extended control screenshots: '+theme,lambda theme=theme:test_profile(theme))
        BROWSER.close()
    golden=ROOT/'tests/visual-goldens.json';data={'environment':ENV,'images':IMAGES}
    if args.check_goldens:
        def compare():
            expected=json.loads(golden.read_text());check(expected['environment']==ENV,'Golden environment differs; use an explicitly reviewed update.');check(expected['images']==IMAGES,'Release screenshots differ from implementation goldens. These are not native VB6 goldens.');return {'images':len(IMAGES)}
        case('Same-environment implementation screenshot goldens',compare)
    passed=sum(r['passed'] for r in RESULTS);report={'environment':ENV,'passed':passed,'failed':len(RESULTS)-passed,'implementationScreenshotCount':len(IMAGES),'images':IMAGES,'tests':RESULTS};(REPORTS/'browser-visual-tests.json').write_text(json.dumps(report,indent=2));lines=['# Visual and interaction validation','',f'{passed} passed; {len(RESULTS)-passed} failed.','', '**Screenshots and goldens belong to this implementation, not native VB6.** Native pixel equivalence is not certified.','',f'Browser: {ENV["browser"]}. {len(IMAGES)} screenshot states.','']+[f'- {"PASS" if r["passed"] else "FAIL"} — {r["name"]}'+(' — '+r.get('error','') if not r['passed'] else '') for r in RESULTS];(REPORTS/'browser-visual-tests.md').write_text('\n'.join(lines)+'\n')
    if args.update_goldens and not args.filter and report['failed']==0:golden.write_text(json.dumps(data,indent=2)+'\n')
    print(f'\n{passed} passed; {report["failed"]} failed. {len(IMAGES)} implementation screenshots.');return int(report['failed']>0)
if __name__=='__main__':sys.exit(main())

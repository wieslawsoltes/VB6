#!/usr/bin/env python3
"""Real Chromium integration tests; no CDN, web server, or npm dependencies.

Requires Python Playwright and Chromium. Set CHROMIUM_PATH when Chromium is not
on PATH. Uses set_content so tests can also run in restricted local environments.
Run npm run build before invoking this suite. JSON and Markdown reports are saved
under reports/; --group runtime|ide|performance|mobile limits the test group.
"""
from __future__ import annotations
import argparse, json, os, platform, shutil, subprocess, sys, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'
SHOTS = REPORTS / 'screenshots'
RESULTS: list[dict] = []
METRICS: dict = {}
FIXTURES = json.loads(subprocess.check_output(['node', str(ROOT / 'tools/browser-fixtures.mjs')], text=True))
IDE_HTML = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
RUNTIME_JS = (ROOT / 'dist/vb6-runtime.js').read_text()
RUNTIME_CSS = (ROOT / 'dist/vb6-controls.css').read_text()


def check(condition, message='Assertion failed'):
    if not condition:
        raise AssertionError(message)


def case(name, fn):
    started = time.perf_counter()
    try:
        details = fn()
        RESULTS.append({'name': name, 'passed': True, 'milliseconds': round((time.perf_counter()-started)*1000, 2), 'details': details})
        print('PASS', name, flush=True)
    except Exception as e:
        RESULTS.append({'name': name, 'passed': False, 'milliseconds': round((time.perf_counter()-started)*1000, 2), 'error': str(e)})
        print('FAIL', name, '\n', e, flush=True)
        traceback.print_exc(limit=2)


def new_page(browser, size=(1440, 960), touch=False):
    page = browser.new_page(viewport={'width': size[0], 'height': size[1]}, has_touch=touch)
    page.set_default_timeout(4000)
    page._errors = []
    page._requests = []
    page.on('pageerror', lambda e: page._errors.append(str(e)))
    page.on('request', lambda request: page._requests.append(request.url) if request.url.startswith(('https:', 'http:')) else None)
    return page


def healthy(page):
    check(not page._errors, 'Browser script errors: '+str(page._errors))
    check(not page._requests, 'Unexpected network requests: '+str(page._requests))


def open_example(browser, name, size=(1100, 760), touch=False):
    page = new_page(browser, size, touch)
    page.set_content((ROOT / f'dist/examples/{name}.html').read_text())
    page.wait_for_function('typeof vb6Application !== "undefined"')
    healthy(page)
    return page


def open_fixture(browser, name):
    page = new_page(browser, (1100, 760))
    page.set_content('<!doctype html><html><head><style>'+RUNTIME_CSS+'</style></head><body></body></html>')
    page.add_script_tag(content=RUNTIME_JS)
    page.evaluate('p=>{globalThis.vb6Application=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});globalThis.startPromise=vb6Application.start();}', FIXTURES[name])
    page.wait_for_function('vb6Application.vm.state === "running"')
    page.wait_for_timeout(80)
    healthy(page)
    return page


def open_ide(browser):
    page = new_page(browser)
    page.set_content(IDE_HTML)
    page.wait_for_function('typeof vb6Studio !== "undefined"')
    healthy(page)
    return page


def start_ide(page):
    page.locator('[data-command="run"]').first.click()
    page.wait_for_function('vb6Studio.runState !== "design"')
    frame = page.frames[1]
    frame.wait_for_function('typeof vb6Application !== "undefined" || typeof VB6Runtime !== "undefined"')
    return frame


def stop_ide(page):
    page.locator('[data-command="stop"]').first.click()
    page.wait_for_function('vb6Studio.runState === "design"')


def runtime_tests(browser):
    for name in ['orders','calculator','clock','graphics','data','controls','language','events','richtext']:
        def smoke(name=name):
            page = open_example(browser, name)
            check(page.evaluate('vb6Application.vm.state') in ['running','stopped'])
            error = page.evaluate('vb6Application.vm.lastError?.message || null')
            if name != 'language':
                check(error is None, str(error))
            if name in ['orders','graphics','controls','events']:
                page.screenshot(path=str(SHOTS / f'application-{name}.png'))
            result = {'htmlBytes': (ROOT / f'dist/examples/{name}.html').stat().st_size}
            page.close()
            return result
        case('Standalone startup: '+name, smoke)

    def orders():
        page = open_example(browser,'orders')
        check(page.locator('[data-control="lblTotal"]').inner_text() == '$107.00')
        page.locator('[data-control="txtQuantity"] input').fill('2')
        page.locator('[data-control="cmdAdd"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lbltotal").Caption === "$143.00"')
        page.wait_for_function('document.querySelectorAll(\'[data-control="lstItems"] option\').length === 5')
        page.locator('[data-control="cmdRemove"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lstitems").ListCount === 4')
        page.wait_for_function('document.querySelectorAll(\'[data-control="lstItems"] option\').length === 4')
        healthy(page);page.close()
    case('Order form: nested controls, typed events, add/remove and totals', orders)

    def invalid_quantity():
        page = open_example(browser,'orders')
        page.locator('[data-control="txtQuantity"] input').fill('0')
        page.locator('[data-control="cmdAdd"]').click()
        page.locator('.vb-modal-shade').wait_for()
        check('quantity' in page.locator('.vb-modal-shade').inner_text().lower())
        page.locator('.vb-modal-shade button').last.click()
        check(page.locator('[data-control="lstItems"] option').count() == 4)
        healthy(page);page.close()
    case('Order validation: actual VB MsgBox blocks the handler', invalid_quantity)

    def save_order():
        page = open_example(browser,'orders')
        page.locator('[data-control="cmdSave"]').click()
        page.wait_for_timeout(150)
        files = page.evaluate('vb6Application.vm.fs.snapshot().files')
        check(len(files)>0, str(files))
        check('1001' in json.dumps(files), str(files))
        healthy(page);page.close()
    case('Order save: sequential VB file I/O writes the private filesystem', save_order)

    def calculator():
        page = open_example(browser,'calculator')
        for text in ['7','+','5','=']:
            page.get_by_role('button',name=text,exact=True).click()
        page.wait_for_timeout(100)
        check(page.locator('[data-control="txtDisplay"] input').input_value() == '12')
        healthy(page);page.close()
    case('Calculator: indexed control-array event arguments evaluate 7 + 5', calculator)

    def timer():
        page = open_fixture(browser,'timer')
        page.wait_for_function('Number(vb6Application.forms[0].controlMap.get("lblticks").Caption) >= 2')
        page.locator('[data-control="cmdPause"]').click()
        page.wait_for_timeout(100)
        first = page.locator('[data-control="lblTicks"]').inner_text()
        page.wait_for_timeout(180)
        check(page.locator('[data-control="lblTicks"]').inner_text()==first)
        healthy(page);page.close()
    case('Timer: queued events tick and stop when disabled', timer)

    def common_controls():
        page = open_example(browser,'controls')
        check(page.locator('.vb-tree-row').count()==6)
        check(page.locator('.vb-lv-row').count()==3)
        page.get_by_text('Main Form',exact=True).click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("statusbar1").SimpleText.includes("Main Form")')
        page.locator('[data-control="Slider1"] input').fill('73')
        page.locator('[data-control="Slider1"] input').dispatch_event('input')
        page.wait_for_function('Number(vb6Application.forms[0].controlMap.get("progressbar1").Value) === 73')
        check('General' in page.locator('[data-control="TabStrip1"]').inner_text())
        healthy(page);page.close()
    case('Common controls: populated tree/list/tab collections and slider events', common_controls)

    def dynamic_events():
        page = open_example(browser,'events')
        controls=page.locator('[data-control="cmdAction"]')
        check(controls.count()==5)
        check(page.locator('[data-control="lblDynamic"]').count()==1)
        controls.nth(3).click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblcount").Caption === "Total: 4"')
        controls.nth(4).click()
        page.wait_for_timeout(100)
        check(page.locator('[data-control="lblCount"]').inner_text()=='Total: 4')
        check('cancel' in page.locator('[data-control="lblStatus"]').inner_text().lower())
        page.locator('[data-control="cmdRemove"]').click()
        page.wait_for_function("document.querySelectorAll('[data-control=cmdAction]').length === 4")
        check(controls.count()==4)
        healthy(page);page.close()
    case('Custom WithEvents/ByRef cancellation and dynamic Load/Unload/Controls.Add', dynamic_events)

    def grid_edit():
        page=open_example(browser,'data')
        cell=page.locator('.vb-grid [data-row="1"][data-col="1"]')
        cell.dblclick();editor=page.locator('.vb-grid td input');editor.fill('Edited customer');editor.press('Enter')
        page.wait_for_function('document.querySelector(\'.vb-grid [data-row="1"][data-col="1"]\').textContent==="Edited customer"')
        page.locator('[data-control="cmdSort"]').click()
        page.wait_for_timeout(120)
        check(page.locator('.vb-grid tbody tr').count()>=5)
        healthy(page);page.close()
    case('Data grid: in-cell editing and in-memory recordset rebinding',grid_edit)

    def modal():
        page=open_fixture(browser,'modal')
        page.locator('[data-control="cmdShow"]').click()
        page.locator('[data-control="cmdOK"]').wait_for(state='visible')
        page.wait_for_function("document.querySelector('[data-control=\"lblState\"]').textContent==='before'")
        check(page.evaluate('vb6Application.forms[0].node.inert') is True)
        page.locator('[data-control="cmdOK"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstate").Caption === "after"')
        check(page.evaluate('vb6Application.forms[0].node.inert') is False)
        healthy(page);page.close()
    case('Modal form: owner inertness, queued click, unload and synchronous return',modal)

    def doevents():
        page=open_fixture(browser,'cancel')
        page.locator('[data-control="cmdStart"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstate").Caption === "busy"')
        page.locator('[data-control="cmdCancel"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstate").Caption === "cancelled"')
        healthy(page);page.close()
    case('DoEvents: UI input cancels a running VB loop without freezing the page',doevents)

    def all_controls():
        page=open_fixture(browser,'controls')
        check(page.evaluate('vb6Application.forms[0].controls.length')==38)
        check(page.evaluate('vb6Application.vm.lastError === null || vb6Application.vm.lastError === undefined'))
        healthy(page);page.close()
        return {'offeredTypes':FIXTURES['types']}
    case('All 38 offered browser control types initialize without script errors',all_controls)

    def boundary():
        page=open_example(browser,'controls')
        result=page.evaluate('''async()=>{const errors=[];for(const expr of ['?TreeView1.node','?TreeView1.vm','?TreeView1.constructor','?TreeView1.Nodes.items']){try{await vb6Application.vm.immediate(expr);errors.push('allowed');}catch(e){errors.push(e.number);}}return errors;}''')
        check(result==[438,438,438,438],str(result))
        healthy(page);page.close()
    case('Runtime adapter boundary denies DOM, VM, constructor and implementation fields',boundary)


def ide_tests(browser):
    def shell():
        page=open_ide(browser)
        check(page.locator('.menubar > button').count()==10)
        check(page.locator('.project-tree [data-module]').count()==2)
        check(page.locator('.property-grid .property-row').count()>=16)
        count=page.locator('.property-grid .property-row').count()
        page.locator('.property-grid .font-expander').click()
        check(page.locator('.property-grid .property-row.font-child').count()>=4)
        check(page.locator('.property-grid .property-row').count()>count)
        page.screenshot(path=str(SHOTS/'ide-designer.png'))
        page.locator('[data-menu="File"]').click()
        check(page.get_by_text('New Project...',exact=False).count()>0 or page.locator('.ide-popup-menu').count()>0)
        page.keyboard.press('Escape');healthy(page);page.close()
    case('Classic IDE shell: menus, toolbox, project explorer, inspector and form',shell)

    def designer():
        page=open_ide(browser)
        before=page.evaluate('vb6Studio.activeModule.form.controls.length')
        page.locator('[data-control-type="CommandButton"]').dblclick()
        check(page.evaluate('vb6Studio.activeModule.form.controls.length')==before+1)
        new_name=page.evaluate('vb6Studio.designer.selected()[0].name')
        field=page.locator('.property-grid [aria-label="Caption"]');field.fill('Browser button');field.press('Enter')
        check(page.locator('.designer-pane [data-control="'+new_name+'"]').inner_text()=='Browser button')
        page.locator('[data-command="undo"]').click()
        check(page.locator('.designer-pane [data-control="'+new_name+'"]').inner_text()!='Browser button')
        page.locator('[data-command="redo"]').click()
        check(page.locator('.designer-pane [data-control="'+new_name+'"]').inner_text()=='Browser button')
        healthy(page);page.close()
    case('Designer: add control, edit property, undo and redo through UI',designer)

    def move_control():
        page=open_ide(browser)
        control=page.locator('.designer-pane [data-control="cmdNew"]')
        before=page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.name==="cmdNew").properties.Left')
        box=control.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+40,y-16,steps=8);page.mouse.up()
        after=page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.name==="cmdNew").properties.Left')
        check(after!=before, f'Control failed to move: {before} -> {after}')
        page.keyboard.press('ArrowRight')
        check(page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.name==="cmdNew").properties.Left')>after)
        healthy(page);page.close()
    case('Designer: pointer dragging with twip snapping and keyboard movement',move_control)

    def source():
        page=open_ide(browser)
        page.locator('.designer-pane [data-control="cmdAdd"]').dblclick()
        check(page.evaluate('vb6Studio.activeDoc.view')=='code')
        check(page.evaluate('vb6Studio.editor.cursor().line')==16)
        page.screenshot(path=str(SHOTS/'ide-code.png'))
        page.keyboard.press('Control+f');page.locator('[aria-label="Find what"]').fill('quantity');page.locator('[aria-label="Find what"]').press('Enter')
        check(page.evaluate('vb6Studio.editor.input.value.slice(vb6Studio.editor.input.selectionStart,vb6Studio.editor.input.selectionEnd)').lower()=='quantity')
        page.keyboard.press('Escape')
        page.evaluate('vb6Studio.editor.goToLine(16,5)')
        page.keyboard.press('Control+Space')
        check(page.locator('.completion-item').count()>0)
        page.keyboard.press('Escape');healthy(page);page.close()
    case('Editor: designer event navigation, real source search and completion',source)

    def run_sandbox():
        page=open_ide(browser);frame=start_ide(page)
        frame.wait_for_function('typeof vb6Application !== "undefined"')
        check(page.locator('iframe').get_attribute('sandbox')=='allow-scripts allow-downloads allow-modals')
        check(frame.evaluate('(()=>{try{return parent.document.body.textContent;}catch(e){return e.name;}})()')=='SecurityError')
        page.evaluate('window.postMessage({channel:"vb6-runtime",token:vb6Studio.bridgeToken,type:"state",state:"paused"},"*")')
        page.wait_for_timeout(60);check(page.evaluate('vb6Studio.runState')=='running')
        frame.locator('[data-control="txtQuantity"] input').fill('2');frame.locator('[data-control="cmdAdd"]').click()
        frame.wait_for_function('vb6Application.forms[0].controlMap.get("lbltotal").Caption === "$143.00"')
        page.screenshot(path=str(SHOTS/'ide-running.png'))
        stop_ide(page);check(len(page.frames)==1)
        healthy(page);page.close()
    case('IDE run/stop: opaque-origin iframe, denied parent DOM and rejected spoofed message',run_sandbox)

    def debugger():
        page=open_ide(browser)
        page.evaluate('p=>vb6Studio.loadProject(p)',FIXTURES['debug'])
        page.evaluate('vb6Studio.breakpoints=[{module:"Form1",line:5,condition:"n = 7"}];vb6Studio.watches=["n * 6"];vb6Studio.syncBreakpoints()')
        start_ide(page)
        page.wait_for_function('vb6Studio.runState === "paused" && vb6Studio.locals.some(x=>x.name.toLowerCase()==="n")')
        check(any(v['name'].lower()=='n' and str(v['value'])=='7' for v in page.evaluate('vb6Studio.locals')))
        check(page.evaluate('vb6Studio.stack.at(-1).line')==5)
        check(page.locator('.properties-panel > .tool-caption').inner_text().startswith('Properties - Form1'))
        page.evaluate("vb6Studio.showDebug('Locals')");page.screenshot(path=str(SHOTS/'ide-debugger.png'))
        page.evaluate("vb6Studio.showDebug('Immediate')");field=page.locator('[aria-label="Immediate expression"]');field.fill('? n * 6');field.press('Enter')
        page.wait_for_function('vb6Studio.immediateOutput.some(s=>String(s).trim()==="42")')
        field=page.locator('[aria-label="Immediate expression"]');field.fill('n = 11');field.press('Enter');page.wait_for_timeout(70)
        page.keyboard.press('F8')
        page.wait_for_function('vb6Studio.runState === "paused" && vb6Studio.stack.at(-1)?.line === 6')
        check(any(v['name'].lower()=='n' and str(v['value'])=='13' for v in page.evaluate('vb6Studio.locals')))
        page.keyboard.press('F5');page.wait_for_function('vb6Studio.runState === "running"')
        frame=page.frames[1];frame.wait_for_function('typeof vb6Application !== "undefined" && vb6Application.forms[0].controlMap.get("lblstate").Caption === "13"')
        frame.wait_for_function("document.querySelector('[data-control=\"lblState\"]')?.textContent === '13'")
        check(frame.locator('[data-control="lblState"]').inner_text()=='13')
        stop_ide(page);healthy(page);page.close()
    case('Debugger: conditional breakpoint, correct source, locals, Immediate mutation and step',debugger)

    def live_edit():
        page=open_ide(browser)
        page.evaluate('p=>vb6Studio.loadProject(p)',FIXTURES['debug'])
        page.evaluate('vb6Studio.breakpoints=[{module:"Form1",line:5}];vb6Studio.syncBreakpoints()')
        start_ide(page);page.wait_for_function('vb6Studio.runState === "paused" && vb6Studio.stack.at(-1)?.line === 5')
        check(not page.evaluate('vb6Studio.editor.input.readOnly'))
        # Use the public textarea and its actual DOM event, not direct VM patch calls.
        page.evaluate("""()=>{const e=vb6Studio.editor.input;e.value=e.value.replace('n = n + 2','n = n + 20');e.dispatchEvent(new Event('input',{bubbles:true}));}""")
        page.wait_for_function('vb6Studio.pendingEdits === true')
        page.keyboard.press('F8');page.wait_for_function('vb6Studio.runState === "paused" && vb6Studio.stack.at(-1)?.line === 6')
        check(any(v['name'].lower()=='n' and v['value']=='27' for v in page.evaluate('vb6Studio.locals')))
        page.evaluate('vb6Studio.editor.goToLine(5,1)')
        page.keyboard.press('Control+F9');page.wait_for_function('vb6Studio.stack.at(-1)?.line === 5')
        page.keyboard.press('F8');page.wait_for_function('vb6Studio.stack.at(-1)?.line === 6')
        check(any(v['name'].lower()=='n' and v['value']=='47' for v in page.evaluate('vb6Studio.locals')))
        page.keyboard.press('F5');frame=page.frames[1]
        frame.wait_for_function('typeof vb6Application !== "undefined" && vb6Application.forms[0].controlMap.get("lblstate").Caption === "47"')
        frame.wait_for_function("document.querySelector('[data-control=\"lblState\"]')?.textContent === '47'")
        check(page.evaluate('vb6Studio.pendingEdits')==False)
        stop_ide(page);healthy(page);page.close()
    case('Live debugger: edit paused source, automatic apply, step and Set Next Statement',live_edit)

    def downloads():
        page=open_ide(browser)
        with page.expect_download() as download_info: page.locator('[data-command="save"]').first.click()
        download=download_info.value;save=REPORTS/'saved-project.vb6web';download.save_as(save)
        data=json.loads(save.read_text());check(data['modules'][0]['name']=='frmOrders')
        with page.expect_download() as download_info: page.locator('[data-command="exportHTML"]').first.click()
        exported=REPORTS/'exported-app.html';download_info.value.save_as(exported)
        app=new_page(browser,(1100,760));app.set_content(exported.read_text());app.wait_for_function('typeof vb6Application !== "undefined"')
        check(app.locator('[data-control="lblTotal"]').inner_text()=='$107.00');healthy(app);app.close()
        healthy(page);page.close()
        return {'projectBytes':save.stat().st_size,'exportedBytes':exported.stat().st_size}
    case('File actions: downloadable lossless project and independent runnable HTML export',downloads)

    def injection():
        page=open_ide(browser)
        html=page.evaluate('p=>VB6StudioAPI.exportApplication(p)',FIXTURES['injection'])
        app=new_page(browser);app.set_content(html);app.wait_for_function('typeof vb6Application !== "undefined"')
        check(app.evaluate('typeof globalThis.injected')=='undefined');healthy(app);healthy(page);app.close();page.close()
    case('Export injection guard: VB string containing closing script tags remains inert',injection)


def performance_tests(browser):
    def source():
        page=open_ide(browser)
        stats=page.evaluate('''()=>{const p=VB6StudioAPI.newProject("LargeSource");p.modules[0].code=Array.from({length:20000},(_,i)=>"' comment line "+(i+1)).join("\\n");const t=performance.now();vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,"code");vb6Studio.editor.goToLine(19990,5);return {loadMs:performance.now()-t,lines:vb6Studio.editor.lines.length,cursor:vb6Studio.editor.cursor(),gutterNodes:document.querySelectorAll('.gutter-line').length,sourceCharacters:p.modules[0].code.length};}''')
        check(stats['lines']==20000);check(stats['cursor']['line']==19990);check(stats['gutterNodes']<100)
        page.keyboard.type('x')
        check(page.evaluate('vb6Studio.history.undoStack.at(-1).kind')=='patch')
        changed=page.evaluate('vb6Studio.activeModule.code');page.evaluate('()=>{vb6Studio.command("undo");}');check(page.evaluate('vb6Studio.activeModule.code')!=changed);page.evaluate('()=>{vb6Studio.command("redo");}');check(page.evaluate('vb6Studio.activeModule.code')==changed)
        METRICS['sourceEditor']=stats;healthy(page);page.close();return stats
    case('Large source: 20,000-line indexing, bounded gutter DOM and source-only undo',source)

    def virtualized():
        page=open_example(browser,'controls')
        stats=page.evaluate('''()=>{const f=vb6Application.forms[0],tree=f.controlMap.get('treeview1'),list=f.controlMap.get('listview1');tree.Nodes.Clear();list.ListItems.Clear();const t=performance.now();for(let i=0;i<10000;i++){tree.Nodes.Add(undefined,0,'','Tree row '+i);list.ListItems.Add(undefined,'','List row '+i);}return {populateMs:performance.now()-t,treeCount:tree.Nodes.Count,listCount:list.ListItems.Count};}''')
        page.wait_for_timeout(150)
        stats.update(page.evaluate('({treeDOM:document.querySelectorAll(".vb-tree-row").length,listDOM:document.querySelectorAll(".vb-lv-row").length})'))
        check(stats['treeCount']==10000 and stats['listCount']==10000)
        check(stats['treeDOM']<50 and stats['listDOM']<50, str(stats))
        METRICS['virtualizedCollections']=stats;healthy(page);page.close();return stats
    case('Tree/List virtualization: 10,000 items each with bounded rendered rows',virtualized)

    def grid():
        page=open_example(browser,'data')
        stats=page.evaluate('''()=>{const g=vb6Application.forms[0].controlMap.get('grdcustomers');g.DataSource=null;const t=performance.now();g.Rows=10000;g.Cols=1000;g.setIndexed('TextMatrix',[9999,999],'last-cell');return {resizeMs:performance.now()-t,rows:g.Rows,columns:g.Cols};}''')
        page.wait_for_timeout(120)
        stats.update(page.evaluate('({cells:document.querySelectorAll(".vb-grid td").length,tableWidth:document.querySelector(".vb-grid table").scrollWidth})'))
        check(stats['cells']<500,str(stats));check(stats['columns']==1000)
        page.evaluate('const e=document.querySelector(".vb-grid-scroll");e.scrollLeft=e.scrollWidth;e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"))')
        page.wait_for_timeout(150)
        check(page.locator('.vb-grid [data-row="9999"][data-col="999"]').inner_text()=='last-cell')
        METRICS['virtualizedGrid']=stats;healthy(page);page.close();return stats
    case('Grid virtualization: 10,000 × 1,000 logical cells, last row and column reachable',grid)

    def canvas():
        page=open_example(browser,'graphics');page.wait_for_timeout(150)
        stats=page.evaluate('''()=>{const c=vb6Application.forms[0].controls.find(c=>c.type==='PictureBox');return {secureContext:isSecureContext,webGPUAPI:!!navigator.gpu,backend:c?.graphics?.backend||c?.surface?.backend||'inspect',canvases:document.querySelectorAll('canvas').length};}''')
        check(stats['canvases']>=1)
        METRICS['graphicsEnvironment']=stats;healthy(page);page.close();return stats
    case('Graphics example draws with available fallback; GPU capability recorded, not assumed',canvas)


def mobile_tests(browser):
    def runtime():
        page=open_example(browser,'orders',(390,844),True)
        bounds=page.locator('.vb-form').first.bounding_box()
        check(bounds['x']>=-1 and bounds['x']+bounds['width']<=391,str(bounds))
        page.locator('[data-control="txtQuantity"] input').fill('2');page.locator('[data-control="cmdAdd"]').tap()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lbltotal").Caption === "$143.00"')
        page.screenshot(path=str(SHOTS/'mobile-application.png'));healthy(page);page.close()
        return bounds
    case('390px touch viewport: scaled standalone form and working touch events',runtime)

    def ide():
        page=new_page(browser,(390,844),True);page.set_content(IDE_HTML);page.wait_for_function('typeof vb6Studio !== "undefined"')
        width=page.evaluate('document.documentElement.scrollWidth');check(width<=390,str(width))
        page.locator('[data-command="properties"]').first.tap();page.wait_for_timeout(100)
        page.screenshot(path=str(SHOTS/'mobile-ide.png'));healthy(page);page.close()
    case('390px touch viewport: IDE shell fits and properties drawer opens',ide)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--group',choices=['all','runtime','ide','performance','mobile'],default='all');args=parser.parse_args()
    REPORTS.mkdir(exist_ok=True);SHOTS.mkdir(exist_ok=True)
    executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
    started=time.time()
    with sync_playwright() as p:
        kwargs={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if executable: kwargs['executable_path']=executable
        browser=p.chromium.launch(**kwargs)
        version=browser.version
        for group,fn in [('runtime',runtime_tests),('ide',ide_tests),('performance',performance_tests),('mobile',mobile_tests)]:
            if args.group in ['all',group]: fn(browser)
        browser.close()
    failed=sum(not r['passed'] for r in RESULTS)
    report={'group':args.group,'browser':version,'platform':platform.platform(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'seconds':round(time.time()-started,2),'passed':len(RESULTS)-failed,'failed':failed,'metrics':METRICS,'tests':RESULTS,'limitations':['Headless Chromium only; Firefox, Safari and physical mobile devices not validated.','Navigation restrictions require inline set_content; native file:// persistence and download launch behavior are not browser-navigation tested.','This environment does not provide a validated secure WebGPU context. Canvas fallback is exercised; hardware GPU execution is not certified.','Timings are single-run observations, not cross-machine performance guarantees.']}
    suffix='' if args.group=='all' else '-'+args.group
    (REPORTS/f'browser-tests{suffix}.json').write_text(json.dumps(report,indent=2))
    lines=['# Browser integration validation','',f"Chromium {version} · {report['passed']} passed · {failed} failed · {report['seconds']} seconds",'','## Checks','']
    lines += [f"- {'PASS' if r['passed'] else 'FAIL'} — {r['name']} ({r['milliseconds']} ms)"+(f"\n  {r['error']}" if not r['passed'] else '') for r in RESULTS]
    lines += ['','## Observed measurements','','```json',json.dumps(METRICS,indent=2),'```','','## Scope and limitations','']+['- '+s for s in report['limitations']]
    (REPORTS/f'browser-tests{suffix}.md').write_text('\n'.join(lines)+'\n')
    print(f"\n{report['passed']} passed; {failed} failed. Report: reports/browser-tests{suffix}.json",flush=True)
    return 1 if failed else 0

if __name__=='__main__': sys.exit(main())

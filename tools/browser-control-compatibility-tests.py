#!/usr/bin/env python3
"""Actual VB parser/VM/host controls, pointer/keyboard input and lifecycle checks.

The fixture imports the production RuntimeAPI. CSS is the current built artifact,
not test overrides. Every attempt, including failures, is retained separately.
"""
from __future__ import annotations
import argparse, datetime, hashlib, json, os, platform, shutil, subprocess, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--browser',choices=['chromium','firefox','webkit'],default=os.environ.get('VB6_BROWSER','chromium'))
args=parser.parse_args()
STAMP=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
OUT=ROOT/'reports/control-compatibility'/args.browser/STAMP;OUT.mkdir(parents=True,exist_ok=True)
CSS=(ROOT/'dist/studio.css').read_text()
BUNDLE=subprocess.check_output(['node','--input-type=module','-e',"import {bundle} from './tools/bundle.mjs'; console.log(bundle('tests/fixtures/controls-compatibility.js','ControlTests'));"],cwd=ROOT,text=True)
RESULTS=[];ERRORS=[];ASSERTIONS=0;METRICS={}
def check(value,message):
    global ASSERTIONS
    ASSERTIONS+=1
    if not value:raise AssertionError(message)
def case(name,fn):
    start=time.perf_counter();before=ASSERTIONS
    try:
        detail=fn();RESULTS.append({'name':name,'passed':True,'assertions':ASSERTIONS-before,'details':detail,'ms':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
    except Exception as error:
        RESULTS.append({'name':name,'passed':False,'assertions':ASSERTIONS-before,'error':str(error),'traceback':traceback.format_exc()});print('FAIL',name,str(error),flush=True)
        for i,context in enumerate(browser.contexts):
            for j,page in enumerate(context.pages):
                try:page.screenshot(path=str(OUT/f'failure-{len(RESULTS)}-{i}-{j}.png'))
                except Exception:pass
    finally:
        for context in list(browser.contexts):
            for page in context.pages:
                try:
                    messages=page.evaluate('globalThis.messages?.filter(m=>m.type==="error")||[]')
                    ERRORS.extend({'case':name,'runtime':message} for message in messages)
                    page.evaluate('globalThis.app?.dispose()')
                except Exception as error:ERRORS.append({'case':name,'cleanup':str(error)})
            context.close()
def scene(name='setup',dpr=1):
    page=browser.new_page(viewport={'width':1280,'height':900},device_scale_factor=dpr)
    page.set_default_timeout(12000)
    page.on('pageerror',lambda error:ERRORS.append({'script':str(error)}))
    page.set_content('<!doctype html><meta charset="utf-8"><style>'+CSS+'</style><body></body>')
    page.add_script_tag(content=BUNDLE);result=page.evaluate('ControlTests.'+name+'()');check(result['state']=='running',str(result));return page

def settle(page):page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')
def caption(page,value):page.wait_for_function('(value)=>controls.Output.Caption===value',arg=value)
def edit(page,value):
    page.locator('[data-control="Edit"]').click();field=page.locator('.vb-item-label-editor');field.wait_for();field.fill(value);field.press('Enter');page.wait_for_selector('.vb-item-label-editor',state='detached')

with sync_playwright() as p:
    launch={'headless':True}
    if args.browser=='chromium':
        launch['args']=['--no-sandbox']
        if executable:=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'):launch['executable_path']=executable
    browser=getattr(p,args.browser).launch(**launch)
    METRICS.update(browser=browser.version,engine=args.browser,platform=platform.platform(),fixtureSha256=hashlib.sha256(BUNDLE.encode()).hexdigest(),cssSha256=hashlib.sha256(CSS.encode()).hexdigest())

    def list_state():
        page=scene();result=page.evaluate('''()=>{const t=controls.Tags;return {items:t.items,data:t.itemData,index:t.ListIndex,text:t.Text,newIndex:t.NewIndex};}''')
        check(result=={'items':['Alpha','Zulu'],'data':[10,90],'index':1,'text':'Zulu','newIndex':0},str(result))
        page.locator('[data-control="Tags"] select').select_option('0');page.wait_for_function('controls.Tags.ListIndex===0')
        page.evaluate('controls.Tags.AddItem("Beta")');settle(page)
        check(page.evaluate('[controls.Tags.Text,controls.Tags.ItemData(0),controls.Tags.NewIndex]')==['Alpha',10,1],'Sorted insertion detached metadata')
        page.evaluate('controls.Tags.RemoveItem(1)');settle(page)
        check(page.evaluate('controls.Tags.Text')=='Alpha','Removal detached selected item');return result
    case('sorted intrinsic list metadata and selection survive real selection/insertion/removal',list_state)

    def tree_navigation():
        page=scene();page.locator('[data-control="Tree"] .vb-tree-label').filter(has_text='Root').click();caption(page,'Node:root')
        page.keyboard.press('ArrowDown');caption(page,'Node:alpha');page.keyboard.press(' ');caption(page,'NodeCheck:alpha:True')
        page.keyboard.press('ArrowLeft');caption(page,'Node:root');page.keyboard.press('ArrowLeft');settle(page)
        check(page.locator('[data-control="Tree"] .vb-tree-row').count()==1,'Collapsed descendants remain realized')
        page.evaluate('controls.Tree.Nodes.Item("gamma").EnsureVisible()');settle(page)
        check(page.evaluate('controls.Tree.SelectedItem.Key')=='root','EnsureVisible selected its target')
        page.keyboard.press('End');caption(page,'Node:gamma')
        row=page.locator('[data-control="Tree"] .vb-tree-row[aria-selected="true"]');check(row.get_attribute('aria-level')=='2','Hierarchy ARIA level')
        page.evaluate('controls.Tree.Nodes.Remove("root")');settle(page);check(page.evaluate('[controls.Tree.Nodes.Count,controls.Tree.SelectedItem]')==[0,None],'Removed subtree retains selection')
    case('TreeView expand/collapse, checkboxes, hierarchy and nonselecting EnsureVisible',tree_navigation)

    def list_keyboard():
        page=scene();page.locator('[data-control="List"] .vb-lv-label').filter(has_text='Alpha').click();caption(page,'Item:alpha')
        page.keyboard.press('Control+ArrowDown');settle(page)
        result=page.evaluate('''()=>({selected:controls.List.SelectedItem.Key,active:controls.List.viewport.getAttribute('aria-activedescendant'),focus:controls.List.collectionView.focused.Key})''')
        check(result['selected']=='alpha' and result['focus']=='beta',str(result))
        page.keyboard.press('Control+ ');settle(page)
        check(page.evaluate('[...controls.List.ListItems.selection].map(x=>x.Key)')==['alpha','beta'],'Ctrl+Space did not add focused item')
        page.keyboard.press('Shift+ArrowDown');caption(page,'Item:gamma');check(page.evaluate('[...controls.List.ListItems.selection].map(x=>x.Key)')==['beta','gamma'],'Shift range mismatch')
        page.keyboard.press(' ');caption(page,'ItemCheck:gamma:True');page.keyboard.press('Control+a');settle(page)
        check(page.evaluate('controls.List.ListItems.selection.size')==3,'Select all failed');return result
    case('ListView keyboard focus, extended selection, checkbox and select-all contracts',list_keyboard)

    def headers_images():
        page=scene();page.locator('[data-control="List"] [role="columnheader"]').first.click();caption(page,'Column:name')
        check(page.evaluate('[controls.List.Sorted,controls.List.ListItems.Item(1).Text]')==[0,'Alpha'],'ColumnClick silently sorts')
        page.evaluate('''()=>{const image=controls.Images.ListImages.Add(undefined,'dot','data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="red"/></svg>'));controls.List.SmallIcons=controls.Images;controls.List.ListItems.Item('alpha').SmallIcon='dot';controls.List.ListItems.Item('alpha').ListSubItems.Item(1).ReportIcon='dot';}''');settle(page)
        images=page.locator('[data-control="List"] [data-index="1"] img:not([hidden])');check(images.count()==2,'Primary and subitem image bindings')
        page.wait_for_function("""Array.from(controls.List.node.querySelectorAll('[data-index="1"] img:not([hidden])')).every(i=>i.complete&&i.naturalWidth===16)""")
        old=images.first.get_attribute('src');page.evaluate('controls.Images.ListImages.Item("dot").Picture="data:image/svg+xml,"+encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>\')');settle(page)
        check(images.first.get_attribute('src')!=old,'Image replacement did not invalidate consumers')
        handle=page.locator('[data-control="List"] .vb-lv-resize').first;box=handle.bounding_box();width=page.evaluate('controls.List.ColumnHeaders.Item(1).Width')
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+40,box['y']+box['height']/2,steps=5);page.mouse.up();settle(page)
        check(page.evaluate('controls.List.ColumnHeaders.Item(1).Width')>width+400,'Header pointer resizing failed')
        page.evaluate('controls.Images.dispose()');settle(page);check(page.locator('[data-control="List"] [data-index="1"] img:not([hidden])').count()==0,'Disposed image list remains rendered')
    case('ListView column events, capture resizing and reactive ImageList/subitem images',headers_images)

    def labels():
        page=scene();page.locator('[data-control="List"] .vb-lv-label').filter(has_text='Beta').click();edit(page,'normalize');check(page.evaluate('[controls.List.SelectedItem.Text,controls.Edit.Tag]')==['Normalized','Returned'],'ByRef rename or reentrant StartLabelEdit failed')
        edit(page,'reject');check(page.evaluate('controls.List.SelectedItem.Text')=='Normalized','Cancelled label was applied')
        edit(page,'mutate');check(page.evaluate('controls.List.SelectedItem.Text')=='External change','Concurrent application edit was overwritten')
        check('changed during label editing' in page.evaluate('controls.List.LastControlError'),'Concurrent edit was not diagnosed')
        page.evaluate('controls.List.Tag="cancel-before"');page.locator('[data-control="Edit"]').click();caption(page,'Edited:mutate');settle(page);check(page.locator('.vb-item-label-editor').count()==0,'BeforeLabelEdit cancellation ignored')
        page.evaluate('controls.List.Tag=""');edit(page,'remove');check(page.evaluate('controls.List.ListItems.Count')==2,'Removal in callback was resurrected')
    case('label editing: native reentrancy, ByRef normalization/cancel and concurrent mutation/removal',labels)

    def automatic_label():
        page=scene();label=page.locator('[data-control="List"] .vb-lv-label').filter(has_text='Alpha');label.click();caption(page,'Item:alpha');page.wait_for_timeout(650);label.click();field=page.locator('.vb-item-label-editor');field.wait_for();field.press('Escape')
        page.evaluate('controls.List.LabelEdit=1');settle(page);page.keyboard.press('F2');page.wait_for_timeout(700);check(page.locator('.vb-item-label-editor').count()==0,'Manual LabelEdit allows automatic F2 edit')
        page.locator('[data-control="Edit"]').click();field.wait_for();check(field.input_value()=='Alpha','Manual StartLabelEdit not allowed');field.press('Escape')
    case('automatic slow-click label editing and explicit-only manual label mode',automatic_label)

    for mode in range(4):
        def large_list(mode=mode):
            page=scene();page.evaluate('''mode=>{const c=controls.List;c.ListItems.batch(()=>{c.ListItems.Clear();for(let i=0;i<50000;i++)c.ListItems.Add(undefined,'k'+i,'Item '+i);});c.View=mode;c.ListItems.Item(1).Selected=true;}''',mode);settle(page)
            page.locator('[data-control="List"] .vb-virtual-viewport').focus();page.keyboard.press('End');page.wait_for_function('controls.List.SelectedItem?.Key==="k49999"');settle(page)
            result=page.evaluate('''()=>{const c=controls.List,rows=[...c.spacer.children],selected=c.spacer.querySelector('[aria-selected="true"]'),m=new MutationObserver(()=>{});m.observe(c.spacer,{subtree:true,childList:true});for(let i=0;i<10;i++)c.collectionView.paint();const mutations=m.takeRecords().length;m.disconnect();return {count:c.ListItems.Count,realized:c.collectionView.rows.size,label:selected?.textContent,aria:selected?.getAttribute('aria-setsize'),mutations,stable:rows.every((row,i)=>row===c.spacer.children[i]),scrollX:c.viewport.scrollLeft,scrollY:c.viewport.scrollTop};}''')
            check(result['count']==50000 and result['realized']<180,str(result));check('Item 49999' in result['label'] and result['aria']=='50000',str(result));check(result['stable'] and result['mutations']==0,str(result))
            page.screenshot(path=str(OUT/f'list-mode-{mode}.png'));return result
        case(f'ListView mode {mode}: 50,000 items, bounded realization and retained visible rows',large_list)

    def tree_large():
        page=scene();page.evaluate('''()=>{const c=controls.Tree;c.Nodes.batch(()=>{c.Nodes.Clear();for(let i=0;i<12000;i++)c.Nodes.Add(undefined,undefined,'n'+i,'Node '+i);});c.Nodes.Item(1).Selected=true;}''');settle(page)
        page.locator('[data-control="Tree"] .vb-virtual-viewport').focus();page.keyboard.press('End');page.wait_for_function('controls.Tree.SelectedItem?.Key==="n11999"');settle(page)
        result=page.evaluate('({count:controls.Tree.Nodes.Count,realized:controls.Tree.collectionView.rows.size,last:controls.Tree.node.querySelector("[aria-selected=true]").textContent})');check(result['count']==12000 and result['realized']<30 and 'Node 11999' in result['last'],str(result));return result
    case('TreeView: 12,000 roots and bounded last-item keyboard navigation',tree_large)

    def grid_navigation():
        page=scene('setupPanels');grid='[data-control="Grid"]';page.locator(grid+' [data-row="2"][data-col="1"]').click();page.keyboard.press('ArrowDown');page.wait_for_function('controls.Grid.Row===4');page.keyboard.press('Shift+ArrowRight');page.wait_for_function('controls.Grid.ColSel===2')
        check(page.locator(grid+' [data-row="3"]').count()==0,'Hidden row was realized')
        page.keyboard.press('Control+End');page.wait_for_function('controls.Grid.Row===9999&&controls.Grid.Col===99');settle(page)
        check(page.locator(grid+' [data-row="9999"][data-col="99"]').inner_text()=='Last','Last cell not realized')
        result=page.evaluate('''()=>{const g=controls.Grid,origin=g.viewport.getBoundingClientRect(),fixed=g.table.querySelector('[data-row="0"][data-col="0"]').getBoundingClientRect();return {rows:g.Rows,cols:g.Cols,cells:g.table.querySelectorAll('[data-row][data-col]').length,fixedX:fixed.left-origin.left,fixedY:fixed.top-origin.top};}''')
        check(result['cells']<300 and abs(result['fixedX'])<5 and abs(result['fixedY'])<5,str(result));page.screenshot(path=str(OUT/'grid-last-cell.png'));return result
    case('10,000-by-100 grid: two-axis virtualization, hidden rows, range selection and sticky headers',grid_navigation)

    def grid_edit():
        page=scene('setupPanels');cell=page.locator('[data-control="OtherGrid"] [data-row="1"][data-col="1"]');cell.dblclick();field=page.locator('.vb-grid-editor');field.wait_for();check(field.input_value()=='Original','Cell editing opened wrong coordinate');field.fill('Edited');field.press('Enter');page.wait_for_function('controls.OtherGrid.TextMatrix(1,1)==="Edited"')
        cell.dblclick();field.wait_for();field.fill('Cancel');field.press('Escape');page.wait_for_selector('.vb-grid-editor',state='detached');check(page.evaluate('controls.OtherGrid.TextMatrix(1,1)')=='Edited','Escape committed cell edit')
        result=page.evaluate('''()=>{const c=controls.OtherGrid,node=c.table.querySelector('[data-row="1"][data-col="1"]');c.ColSel=2;c.refresh();return {retained:node===c.table.querySelector('[data-row="1"][data-col="1"]'),height:c.RowHeight(1),position:c.RowPos(2)};}''');check(result['retained'],str(result));return result
    case('grid real double-click editing, Escape cancellation and retained selection cells',grid_edit)

    def toolbar_status():
        page=scene('setupPanels');toolbar='[data-control="Tools"]'
        page.locator(toolbar+' [data-key="check"] .vb-toolbar-button').click();caption(page,'Button:check:1')
        page.locator(toolbar+' [data-key="a"] .vb-toolbar-button').click();page.locator(toolbar+' [data-key="b"] .vb-toolbar-button').click();caption(page,'Button:b:1');check(page.evaluate('[controls.Tools.Buttons.Item("a").Value,controls.Tools.Buttons.Item("b").Value]')==[0,1],'Group not exclusive')
        check(page.locator(toolbar+' [data-key="separator"] button:visible').count()==0,'Separator is interactive')
        page.locator(toolbar+' [data-key="drop"] .vb-toolbar-dropdown').click();page.wait_for_selector('.vb-popup-menu');page.keyboard.press('End');page.keyboard.press('Enter');caption(page,'Menu:second');check(page.locator('.vb-popup-menu').count()==0,'Dropdown did not close')
        page.locator('[data-control="Status"] [data-key="two"]').dblclick();caption(page,'DoublePanel:two')
        page.evaluate('controls.Status.Panels.Item("two").Alignment=1');settle(page);check(page.locator('[data-control="Status"] [data-key="two"]').evaluate('(n)=>getComputedStyle(n).justifyContent')=='center','Panel alignment uses ListView enum instead of panel enum')
        page.evaluate('controls.Status.Style=1;controls.Status.SimpleText="Simple mode"');settle(page);check(page.locator('[data-control="Status"]').inner_text()=='Simple mode','Simple status mode not applied')
    case('toolbar styles/group/menu input and status panel/double-click/alignment/simple modes',toolbar_status)

    def popup_ownership():
        page=scene('setupPanels');page.locator('[data-control="Tools"] [data-key="drop"] .vb-toolbar-dropdown').click();page.wait_for_selector('.vb-popup-menu');page.evaluate('controls.Tools.Buttons.Remove("drop")');page.wait_for_selector('.vb-popup-menu',state='detached')
        check(page.evaluate('controls.Tools.Buttons.Count')==6,'Removing popup owner failed');page.evaluate('app.dispose()');settle(page);check(page.locator('.vb-popup-menu').count()==0,'Disposed host retains menu')
    case('toolbar popup ownership closes on collection removal and host disposal',popup_ownership)

    def dates():
        page=scene('setupDates');page.wait_for_function('controls.Callback.input.value.includes("Day 29")&&controls.Calendar.Tag!==""');check(page.evaluate('controls.Calendar.Tag')=='70','GetDayBold callback range is not unique visible days')
        field=page.locator('[data-control="Picker"] .vb-date-input');field.fill('2024-02-30 at 13:07:09');field.press('Enter');page.wait_for_function('controls.Picker.input.getAttribute("aria-invalid")==="true"');check(page.evaluate('[controls.Picker.Month,controls.Picker.Day]')==[2,29],'Invalid calendar date was normalized silently');field.press('Escape')
        page.locator('[data-control="SetDate"]').click();page.wait_for_function('controls.SetDate.Tag==="Returned"');check(page.evaluate('[controls.Picker.Year,controls.Picker.Month,controls.Picker.Day]')==[2025,2,28],'VB year assignment did not clamp leap day')
        page.locator('[data-control="Picker"] .vb-date-check').uncheck();caption(page,'Null date');check(page.evaluate('controls.Picker.Value') is None,'Nullable picker not Null')
        page.locator('[data-control="Picker"] .vb-date-check').check();page.wait_for_function('controls.Picker.Value!==null');check(page.evaluate('controls.Picker.Day')==28,'Nullable picker lost previous date')
        page.locator('[data-control="Picker"] .vb-date-arrow').click();page.wait_for_selector('.vb-date-popup');page.keyboard.press('ArrowRight');page.wait_for_function('controls.Picker.Month===3&&controls.Picker.Day===1');page.keyboard.press('Escape');page.wait_for_selector('.vb-date-popup',state='detached')
        day=page.locator('[data-control="Calendar"] .vb-calendar-day[data-date="2024-03-05"]:not(.trailing)');day.dblclick();caption(page,'Double:5');page.keyboard.press('Shift+ArrowRight');page.wait_for_function('controls.Output.Tag==="2"');check(page.locator('[data-control="Calendar"] [data-date="2024-03-03"]:not(.trailing)').evaluate('(n)=>getComputedStyle(n).fontWeight')=='700','GetDayBold Boolean array did not paint')
        page.screenshot(path=str(OUT/'date-controls.png'))
    case('dates: VB callbacks/typed Null, leap clamp, invalid input, popup keyboard and contiguous range',dates)

    def date_bounds_lifetime():
        page=scene('setupDates');page.evaluate('''()=>{const c=controls.Picker;c.MinDate=new Date(2024,1,29);c.MaxDate=new Date(2024,1,29,23,59,59);c.UpDown=-1;c.CustomFormat='yyyy-MM-dd';}''');settle(page)
        field=page.locator('[data-control="Picker"] .vb-date-input');field.click();field.evaluate('(n)=>n.setSelectionRange(8,10)');page.locator('[data-control="Picker"] [aria-label="Increment date field"]').click();settle(page);check(page.evaluate('controls.Picker.Day')==29,'Field step escaped upper bound')
        page.evaluate('controls.Picker.UpDown=0');settle(page);page.locator('[data-control="Picker"] .vb-date-arrow').click();page.wait_for_selector('.vb-date-popup');page.evaluate('controls.Picker.Visible=0');page.wait_for_selector('.vb-date-popup',state='detached');check(page.evaluate('controls.Picker.Value.getDate()')==29,'Hiding picker changed value')
        page.evaluate('controls.Calendar.MonthRows=3;controls.Calendar.MonthColumns=4');settle(page);check(page.locator('[data-control="Calendar"] .vb-calendar-panel').count()==12,'Maximum panel layout not realized')
        page.evaluate('app.dispose()');settle(page);check(page.locator('.vb-date-popup').count()==0,'Disposed host retains calendar')
    case('bounded date stepping, twelve-month layout and hidden/disposed popup ownership',date_bounds_lifetime)

    def color_dialog():
        page=scene('setupDialogs');page.locator('[data-control="ColorButton"]').click();field=page.get_by_label('Color hexadecimal');field.wait_for();field.fill('#123456');page.get_by_role('button',name='OK',exact=True).click();caption(page,'Color:5649426');check(page.evaluate('controls.Dialog.Color')==0x563412,'RGB to OLE COLORREF conversion')
        page.evaluate('controls.Dialog.CancelError=-1');page.locator('[data-control="ColorButton"]').click();field.wait_for();field.fill('#ffffff');page.get_by_role('button',name='Cancel',exact=True).click();caption(page,'Error:32755');check(page.evaluate('controls.Dialog.Color')==0x563412,'Cancelled color applied')
    case('CommonDialog color uses owned UI, OLE RGB conversion and CancelError without mutation',color_dialog)

    def font_dialog():
        page=scene('setupDialogs');page.locator('[data-control="FontButton"]').click();field=page.get_by_label('Font name',exact=True);field.wait_for();field.fill('Courier New');page.get_by_label('Font size',exact=True).fill('18');page.get_by_label('Bold',exact=True).check();page.get_by_role('button',name='OK',exact=True).click();page.wait_for_function('controls.Output.Caption.startsWith("Font:Courier New:18:")');check(page.evaluate('[controls.Dialog.FontName,controls.Dialog.FontSize,controls.Dialog.FontBold]')==['Courier New',18,-1],'Font result not applied atomically')
        page.locator('[data-control="FontButton"]').click();field.wait_for();field.fill('');page.get_by_role('button',name='OK',exact=True).click();page.get_by_role('alert').wait_for();check(page.evaluate('controls.Dialog.FontName')=='Courier New','Invalid font edit partially committed');page.get_by_role('button',name='Cancel',exact=True).click();page.wait_for_selector('.vb-common-font',state='detached')
        page.screenshot(path=str(OUT/'font-result.png'))
    case('CommonDialog font editor commits once, rejects invalid input and retains cancellation state',font_dialog)

    def input_guards():
        page=scene();result=page.evaluate('''()=>{const c=controls.Tags,before=c.ListIndex;c.Enabled=0;c.input.selectedIndex=0;c.input.dispatchEvent(new Event('change',{bubbles:true}));const disabled=c.ListIndex===before;c.Enabled=-1;app.vm.state='paused';c.input.selectedIndex=0;c.input.dispatchEvent(new Event('change',{bubbles:true}));const paused=c.ListIndex===before;app.vm.state='running';return {disabled,paused};}''');check(result['disabled'] and result['paused'],str(result));return result
    case('disabled and paused intrinsic input cannot bypass programmatic state guards',input_guards)

    case('no uncaught browser/runtime errors',lambda:check(not ERRORS,json.dumps(ERRORS)))
    browser.close()
report={'results':RESULTS,'metrics':METRICS,'errors':ERRORS,'summary':{'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'assertions':ASSERTIONS},'scope':'Production browser control behavior, not complete native OCX/Win32 pixel or API parity.'}
(OUT/'report.json').write_text(json.dumps(report,indent=2));(OUT.parent/'latest.json').write_text(json.dumps({'attempt':STAMP,'report':str(OUT.relative_to(ROOT)/'report.json'),'summary':report['summary']},indent=2));print(json.dumps(report['summary']),flush=True)
raise SystemExit(0 if all(r['passed'] for r in RESULTS) else 1)

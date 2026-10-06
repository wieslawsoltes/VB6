#!/usr/bin/env python3
"""Real-origin, offline Chromium integration for optional form layout."""
import functools, http.server, json, os, shutil, threading, time, traceback, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports'/'layout';REPORT.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
results=[]
CONTENT=os.environ.get('VB6_LAYOUT_SET_CONTENT')=='1'
fixture={'schema':1,'id':'layout-project','name':'LayoutTest','startup':'Form1','settings':{'anchoring':False,'renderer':'canvas2d','snapToGrid':False},'modules':[{'id':'module','name':'Form1','kind':'form','code':'Option Explicit\n','form':{'id':'form','name':'Form1','type':'Form','properties':{'Name':'Form1','Caption':'Layout test','ClientWidth':9000,'ClientHeight':6000,'Width':9120,'Height':6450,'ScaleMode':1,'StartUpPosition':0,'Left':150,'Top':150},'controls':[{'id':'button','name':'Button1','type':'CommandButton','parent':None,'properties':{'Name':'Button1','Caption':'Resize me','Left':300,'Top':300,'Width':1500,'Height':450}},{'id':'frame','name':'Frame1','type':'Frame','parent':None,'properties':{'Name':'Frame1','Caption':'Nested','Left':3000,'Top':1000,'Width':3000,'Height':2000}},{'id':'child','name':'Child1','type':'TextBox','parent':'Frame1','properties':{'Name':'Child1','Left':300,'Top':400,'Width':1500,'Height':450}}],'menus':[]}}]}
def check(value,message):
    if not value: raise AssertionError(message)
def case(name,fn):
    start=time.perf_counter()
    try:
        details=fn();results.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2),'details':details});print('PASS',name,flush=True)
    except Exception as e:
        results.append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),flush=True);traceback.print_exc(limit=3)
def runtime(page,enabled=True,code='Option Explicit\n',nested=False):
    p=json.loads(json.dumps(fixture));p['settings']['anchoring']=enabled;p['modules'][0]['code']=code
    for c in p['modules'][0]['form']['controls']:c['properties']['Anchor']=15 if c['type']=='Frame' else 10
    if CONTENT:
        page.goto('about:blank');page.set_content('<!doctype html><style>'+(ROOT/'dist/vb6-controls.css').read_text()+'</style>');page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
    else:
        page.goto(BASE+'/tests/fixtures/layout-runtime.html');page.add_style_tag(url=BASE+'/dist/vb6-controls.css');page.add_script_tag(url=BASE+'/dist/vb6-runtime.js')
    page.evaluate('''async p=>{globalThis.host=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});await host.start();globalThis.form=host.forms[0];globalThis.button=form.controls.find(c=>c.model.name==='Button1');globalThis.frame=form.controls.find(c=>c.model.name==='Frame1');globalThis.child=form.controls.find(c=>c.model.name==='Child1');}''',p)
    return p
with sync_playwright() as pw:
    browser_name=os.environ.get('VB6_BROWSER','chromium')
    launch={'headless':True}
    if browser_name=='chromium': launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox','--disable-gpu'])
    browser=getattr(pw,browser_name).launch(**launch)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(8000)
    def disabled():
        runtime(page,False)
        values=page.evaluate('''async()=>{let err;try{await host.vm.getMember(button,'Anchor')}catch(e){err=e.number}const before=button.Left;form.props.ClientWidth+=1200;form.refresh();return {has:Object.hasOwn(button,'Anchor'),raw:Object.hasOwn(button.props,'Anchor'),err,left:button.Left,before,methods:Object.hasOwn(form,'PerformLayout')};}''')
        check(not values['has'] and not values['raw'] and not values['methods'],str(values));check(values['err']==438 and values['left']==values['before'],str(values));return values
    case('default-off runtime hides dormant properties, constants and layout methods',disabled)
    def enabled():
        runtime(page)
        values=page.evaluate('''()=>{form.ClientWidth=10200;form.ClientHeight=6900;const changed={left:button.Left,top:button.Top,childLeft:child.Left,childTop:child.Top,width:frame.Width,height:frame.Height};for(let n=0;n<100;n++){form.ClientWidth=15000;form.ClientWidth=8000;}form.ClientWidth=9000;form.ClientHeight=6000;return {changed,restored:[button.Left,button.Top,child.Left,child.Top],authored:host.project.modules[0].form.controls[0].properties.Left};}''')
        check(values['changed']=={'left':1500,'top':1200,'childLeft':1500,'childTop':1300,'width':4200,'height':2900},str(values));check(values['restored']==[300,300,300,400] and values['authored']==300,str(values));return values
    case('runtime synchronous nested resize and drift-free restore',enabled)
    def edits():
        runtime(page)
        values=page.evaluate('''()=>{form.ClientWidth=10000;button.Move(500,600,1800,600);form.ClientWidth=11000;const moved=button.Left;button.Anchor=5;form.ClientWidth=12000;const fixed=button.Left;button.Dock=5;const dock=[button.Left,button.Top,button.Width,button.Height];button.Anchor=10;form.ClientWidth=13000;return {moved,fixed,dock,anchor:button.Anchor,dockReset:button.Dock,left:button.Left};}''')
        check(values['moved']==1500 and values['fixed']==1500,str(values));check(values['dock']==[0,0,12000,6000] and values['dockReset']==0 and values['left']==1000,str(values));return values
    case('Move, changing anchors and Dock rebase intentionally',edits)
    def suspension():
        runtime(page)
        values=page.evaluate('''()=>{form.SuspendLayout();form.SuspendLayout();form.ClientWidth=12000;const suspended=button.Left;form.ResumeLayout();const nested=button.Left;form.ResumeLayout(false);const deferred=button.Left;form.PerformLayout();return {suspended,nested,deferred,left:button.Left};}''')
        check(values=={'suspended':300,'nested':300,'deferred':300,'left':3300},str(values));return values
    case('nested SuspendLayout/ResumeLayout and explicit PerformLayout',suspension)
    def code():
        runtime(page,True,'''Option Explicit
Private Sub Form_Load()
  Button1.Anchor = vbAnchorBottom Or vbAnchorRight
  Me.ClientWidth = 12000
  Frame1.Width = 4500
End Sub
''')
        values=page.evaluate('({left:button.Left,child:child.Left,width:frame.Width,state:host.vm.state})')
        check(values['left']==3300 and values['child']==1800 and values['state']=='running',str(values));return values
    case('VB code executes optional Anchor constants and parent geometry',code)
    def dynamic():
        runtime(page)
        values=page.evaluate('''()=>{const c=form.Controls.Add('VB.TextBox','Added',frame);c.Move(100,100,1000,400);c.Anchor=10;frame.Width+=600;const first=c.Left;form.Controls.Remove(c);frame.Width+=500;return {first,removed:c.disposed,count:form.layoutController.engine.count};}''')
        check(values=={'first':700,'removed':True,'count':3},str(values));return values
    case('dynamic controls register, rebase and unregister without stale nodes',dynamic)
    def reparent():
        runtime(page)
        values=page.evaluate("""()=>{const original=JSON.stringify(host.project),buffers=form.layoutController.engine.rects;button.Width+=150;const reused=buffers===form.layoutController.engine.rects;button.Container=frame;const before=button.Left;frame.Width+=450;const moved=button.Left;const nested=form.Controls.Add('VB.Frame','Inner',frame);let error;try{frame.Container=nested}catch(e){error=e.number}return {before,moved,reused,error,parent:button.Container===frame,authored:JSON.stringify(host.project)===original};}""")
        check(values['moved']==values['before']+450 and values['reused'] and values['error']==380 and values['parent'] and values['authored'],str(values));return values
    case('runtime reparenting, cycle rejection and incremental property buffers',reparent)
    def pointer_resize():
        runtime(page)
        page.locator('.vb-form-grip-se').first.hover();page.mouse.down();page.mouse.move(700,510);page.keyboard.press('Escape');page.mouse.up()
        check(page.evaluate('[form.props.ClientWidth,button.Left]').__eq__([9000,300]),'Cancelled drag changed anchor baseline')
        handle=page.locator('.vb-form-grip-se').first.bounding_box();page.mouse.move(handle['x']+handle['width']/2,handle['y']+handle['height']/2);page.mouse.down();page.mouse.move(handle['x']+handle['width']/2+80,handle['y']+handle['height']/2+50,steps=4);page.mouse.up()
        values=page.evaluate('({width:form.props.ClientWidth,height:form.props.ClientHeight,left:button.Left,top:button.Top})');check(values=={'width':10200,'height':6750,'left':1500,'top':1050},str(values));return values
    case('real form resize pointer capture and Escape restoration',pointer_resize)
    def exported():
        p=json.loads(json.dumps(fixture));p['settings']['anchoring']=True;p['modules'][0]['form']['controls'][0]['properties']['Anchor']=10
        html=subprocess.run(['node','--input-type=module','-e',"import {exportApplication} from './src/exporter/exporter.js';import fs from 'node:fs';process.stdout.write(exportApplication(JSON.parse(fs.readFileSync(0,'utf8')),{persist:false}));"],cwd=ROOT,input=json.dumps(p),text=True,capture_output=True,check=True).stdout
        (REPORT/'exported.html').write_text(html)
        if CONTENT: page.goto('about:blank');page.set_content(html)
        else: page.goto(BASE+'/reports/layout/exported.html')
        page.wait_for_function('globalThis.vb6Application?.forms?.length===1')
        values=page.evaluate("""()=>{const f=vb6Application.forms[0],b=f.controls[0];f.ClientWidth=10500;const direct=b.Left;f.WindowState=2;globalThis.maxBaseline={width:f.props.ClientWidth,left:b.Left};return {direct,enabled:f.anchoring};}""")
        page.set_viewport_size({'width':1200,'height':800});page.wait_for_function('vb6Application.forms[0].props.ClientWidth!==maxBaseline.width')
        responsive=page.evaluate("""()=>{const f=vb6Application.forms[0],b=f.controls[0];return Math.abs((b.Left-maxBaseline.left)-(f.props.ClientWidth-maxBaseline.width))<1e-6;}""")
        check(values['direct']==1800 and values['enabled'] and responsive,str(values));page.set_viewport_size({'width':1440,'height':1000});return {**values,'maximizedResponsive':responsive}
    case('self-contained exported HTML and maximized host resizing',exported)
    def ui():
        (page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text()) if CONTENT else page.goto(BASE+'/dist/index.html'));page.wait_for_function('typeof vb6Studio!=="undefined"');page.evaluate('p=>vb6Studio.loadProject(p)',fixture);page.evaluate('vb6Studio.designer.select(["button"])')
        check(page.locator('[data-property="Anchor"]').count()==0,'Anchor leaked while off')
        check(not page.evaluate('vb6Studio.designerMenu().some(i=>i?.id==="anchoring")'),'Menu leaked')
        page.evaluate('void vb6Studio.optionsDialog()');page.get_by_role('tab',name='General',exact=True).click();page.get_by_label('Enable anchoring and automatic layout (this project)').check();page.get_by_role('button',name='OK',exact=True).click()
        check(page.evaluate('vb6Studio.project.settings.anchoring') is True,'Option not persisted')
        page.evaluate('vb6Studio.designer.select(["button"])')
        page.locator('.property-row[data-property=Anchor] .property-name').click()
        page.get_by_role('button',name='Edit Anchor',exact=True).click();page.get_by_role('button',name='Bottom, Right',exact=True).click();page.get_by_role('button',name='OK',exact=True).click()
        check(page.evaluate('vb6Studio.activeModule.form.controls[0].properties.Anchor')==10,'Diagram did not save')
        check(page.locator('[data-anchor-edge]').count()==2,'Designer guide mismatch')
        page.evaluate('vb6Studio.designer.select([]);vb6Studio.setProperty("ClientWidth",10200)')
        check(page.evaluate('vb6Studio.activeModule.form.controls[0].properties.Left')==1500,'Inspector resize did not solve')
        page.evaluate('void vb6Studio.command("undo")');check(page.evaluate('vb6Studio.activeModule.form.controls[0].properties.Left')==300,'Undo not exact')
        page.evaluate('vb6Studio.designer.select(["child"]);vb6Studio.setProperty("Anchor",10);vb6Studio.designer.select(["frame"])')
        old_child=page.evaluate('vb6Studio.activeModule.form.controls[2].properties.Left')
        page.locator('[aria-label="Form designer"]').focus();page.keyboard.press('Shift+ArrowRight')
        check(page.evaluate('vb6Studio.activeModule.form.controls[2].properties.Left')==old_child+120,'Keyboard container resizing did not anchor children')
        page.evaluate('vb6Studio.designer.select(["button","child"]);vb6Studio.setProperties({MinimumWidth:400,MaximumWidth:600});vb6Studio.setProperties({MinimumWidth:900,MaximumWidth:1200})')
        check(page.evaluate('vb6Studio.designer.selected().every(c=>c.properties.MinimumWidth===900&&c.properties.MaximumWidth===1200)'), 'Atomic multi-edit failed')
        page.evaluate('vb6Studio.designer.select(["button"])')
        page.screenshot(path=str(REPORT/'designer-anchoring.png'))
        return {'toggle':True,'diagram':True,'guides':True,'undo':True}
    case('Options, property diagram, guides, resize and Undo in classic IDE',ui)
    def off_again():
        page.evaluate('void vb6Studio.optionsDialog()');page.get_by_role('tab',name='General',exact=True).click();page.get_by_label('Enable anchoring and automatic layout (this project)').uncheck();page.get_by_role('button',name='OK',exact=True).click();page.evaluate('vb6Studio.designer.select(["button"])')
        check(page.locator('[data-property="Anchor"]').count()==0,'Property not hidden');check(page.locator('[data-anchor-edge]').count()==0,'Guides not hidden');check(page.evaluate('vb6Studio.activeModule.form.controls[0].properties.Anchor')==10,'Dormant metadata was deleted')
    case('disabling hides tools and properties without erasing authored metadata',off_again)
    browser.close()
server.shutdown()
(REPORT/f'browser-{browser_name}.json').write_text(json.dumps({'browser':browser_name,'origin':'set_content' if CONTENT else 'http','results':results},indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)

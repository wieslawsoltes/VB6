#!/usr/bin/env python3
"""Opt-in auto-layout: actual IDE widgets, pointer gestures and exported runtime.
HTTP is the default. Opaque-origin memory mode is only a local fallback, explicitly
labelled in the evidence and never substituted for CI's real-origin tests.
"""
import functools, http.server, json, os, shutil, subprocess, threading, time, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ENGINE=os.environ.get('VB6_BROWSER','chromium')
MEMORY=os.environ.get('VB6_TEST_TRANSPORT')=='memory'
REPORT=ROOT/'reports'/'auto-layout'/ENGINE
FIXTURE=r'''enabled=>{const A=VB6StudioAPI,p=A.newProject('AutoLayout'),m=p.modules[0];p.settings.anchoring=enabled;p.settings.renderer='canvas2d';p.settings.snapToGrid=false;m.code='Option Explicit\n';Object.assign(m.form.properties,{ClientWidth:10500,ClientHeight:6600,Width:10620,Height:7050});
const frame=A.createControl('Frame','Panel1',300,300),target=A.createControl('Frame','Target1',5100,300);frame.id='frame';target.id='target';Object.assign(frame.properties,{Caption:'Auto layout',Width:4200,Height:2100,LayoutMode:1,LayoutGap:180,LayoutPadding:180});Object.assign(target.properties,{Caption:'Drop here',Width:3600,Height:2700,LayoutMode:2,LayoutGap:120,LayoutPadding:180});
const children=['A','B','C'].map((name,i)=>{const c=A.createControl('CommandButton',name,300+i*1200,300);c.id=name.toLowerCase();c.parent='Panel1';c.nativeParentId='frame';Object.assign(c.properties,{Caption:name,Width:900,Height:450});return c;});m.form.controls=[frame,...children,target];vb6Studio.loadProject(p);vb6Studio.designer.select(['frame']);return p;}'''
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
class AutoLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();options={'headless':True}
        if ENGINE=='chromium':
            path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if path:options['executable_path']=path
            options['args']=['--no-sandbox','--disable-gpu']
        cls.browser=getattr(cls.pw,ENGINE).launch(**options)
    @classmethod
    def tearDownClass(cls):
        (REPORT/'results.json').write_text(json.dumps({'browser':ENGINE,'transport':'memory' if MEMORY else 'http','results':cls.results},indent=2))
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.start=time.perf_counter();self.errors=[];self.passed=False
        self.context=self.browser.new_context(viewport={'width':1600,'height':1050},color_scheme='light');self.context.set_default_timeout(8000)
        self.page=self.context.new_page();self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        if MEMORY:self.page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        else:self.page.goto(self.base+'/dist/index.html')
        self.page.wait_for_function('globalThis.vb6Studio?.autoLayout');self.page.evaluate(FIXTURE,True)
    def tearDown(self):
        self.results.append({'name':self._testMethodName,'passed':self.passed and not self.errors,'pageErrors':self.errors,'milliseconds':round((time.perf_counter()-self.start)*1000,2)})
        (REPORT/'results.json').write_text(json.dumps({'browser':ENGINE,'transport':'memory' if MEMORY else 'http','results':self.results},indent=2))
        self.context.close();self.assertEqual(self.errors,[])
    def done(self):self.passed=True
    def field(self,key):return self.page.locator(f'[data-auto-property="{key}"]')
    def select(self,ids):self.page.evaluate('ids=>vb6Studio.designer.select(ids)',ids)
    def props(self,id):return self.page.evaluate('id=>vb6Studio.activeModule.form.controls.find(c=>c.id===id).properties',id)
    def command(self,id):self.page.evaluate('id=>{void vb6Studio.command(id)}',id)
    def change(self,changes):self.page.evaluate('changes=>vb6Studio.autoLayout.apply(changes)',changes)
    def point(self,id):
        return self.page.evaluate('id=>{const v=vb6Studio.designer.formView.controls.find(c=>c.model.id===id),r=v.node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};}',id)
    def spacing_point(self):
        # Loading a form can return before the MDI document is visible in WebKit.
        # A raw bounding_box() does not wait for visibility. Hover uses normal
        # actionability checks (visible, stable and receiving pointer events),
        # and reacquires the current handle after any selection-overlay refresh.
        handle=self.page.locator('[data-layout-space="LayoutGap"]').first
        handle.hover()
        box=handle.bounding_box()
        self.assertIsNotNone(box,'The actionable gap handle must have visible bounds')
        self.assertGreater(box['width'],0);self.assertGreater(box['height'],0)
        return box['x']+box['width']/2,box['y']+box['height']/2
    def test_default_off_and_options_enable_reflow(self):
        self.page.evaluate(FIXTURE,False);self.assertEqual(self.page.locator('.auto-layout-panel').count(),0)
        self.assertFalse(self.page.evaluate('vb6Studio.docking.model.windows.has("auto-layout")'))
        self.assertFalse(self.page.evaluate('vb6Studio.menu("View").some(i=>i?.id==="autoLayoutPanel")'))
        before=self.props('a')['Left'];self.assertEqual(before,300)
        self.page.evaluate('void vb6Studio.optionsDialog()');self.page.get_by_role('tab',name='General',exact=True).click()
        self.page.get_by_label('Enable anchoring and automatic layout (this project)').check();self.page.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(self.page.locator('.auto-layout-panel').count(),1);self.assertEqual(self.props('a')['Left'],180);self.assertTrue(self.page.evaluate('vb6Studio.project.settings.anchoring'))
        self.done()
    def test_disable_hides_panel_menu_guides_and_preserves_data(self):
        self.change({'LayoutGridColumns':'1fr 2fr','LayoutMode':5})
        self.page.evaluate('void vb6Studio.optionsDialog()');self.page.get_by_role('tab',name='General',exact=True).click();self.page.get_by_label('Enable anchoring and automatic layout (this project)').uncheck();self.page.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(self.page.locator('.auto-layout-panel,.auto-layout-guides').count(),0);self.assertEqual(self.props('frame')['LayoutGridColumns'],'1fr 2fr');self.assertFalse(self.page.evaluate('vb6Studio.docking.model.windows.has("auto-layout")'))
        self.command('autoLayoutPanel');self.assertEqual(self.page.locator('.auto-layout-panel').count(),0);self.done()
    def test_shift_a_wraps_with_one_undo_and_exact_redo(self):
        self.select(['a','b']);before=self.page.evaluate('JSON.stringify(vb6Studio.project)');count=self.page.evaluate('vb6Studio.history.undoStack.length')
        self.page.locator('[aria-label="Form designer"]').focus();self.page.keyboard.press('Shift+A')
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].name'),'LayoutFrame1');self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        after=self.page.evaluate('JSON.stringify(vb6Studio.project)');self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.command('redo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),after);self.done()
    def test_panel_grid_tracks_fill_and_clearing_implicit_rows(self):
        self.field('LayoutMode').select_option('5');self.page.locator('.auto-layout-section').filter(has_text='Grid tracks and placement').locator('summary').click()
        self.field('LayoutGridColumns').fill('1fr 2fr');self.field('LayoutGridColumns').press('Enter');self.field('LayoutGridRows').fill('1fr 2fr');self.field('LayoutGridRows').press('Enter')
        self.field('LayoutGridRows').fill('');self.field('LayoutGridRows').press('Enter');self.assertEqual(self.props('frame')['LayoutGridRows'],'')
        self.select(['a','b','c']);self.field('LayoutWidthMode').select_option('2');self.assertEqual(self.props('a')['Width'],1220);self.assertEqual(self.props('b')['Width'],2440)
        self.select(['frame']);self.page.screenshot(path=str(REPORT/'auto-layout-panel.png'));self.assertEqual(self.page.locator('.auto-grid-cell').count(),3);self.done()
    def test_panel_alignment_mixed_values_and_atomic_invalid_change(self):
        self.page.get_by_role('button',name='Bottom right',exact=True).click();self.assertEqual(self.props('frame')['LayoutJustify'],2);self.assertEqual(self.props('frame')['LayoutAlignItems'],2)
        self.select(['a']);self.change({'MinimumWidth':500});self.select(['a','b']);self.assertEqual(self.field('MinimumWidth').get_attribute('data-mixed'),'true')
        original=self.page.evaluate('JSON.stringify(vb6Studio.project)');message=self.page.evaluate('()=>{try{vb6Studio.autoLayout.apply({MinimumWidth:1400,MaximumWidth:900});}catch(e){return e.message;}}');self.assertIn('MaximumWidth',message);self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),original);self.done()
    def test_run_and_lock_disable_mutations(self):
        before=self.page.evaluate('JSON.stringify(vb6Studio.project)');self.page.evaluate('vb6Studio.designer.locked=true;vb6Studio.autoLayout.sync()');self.assertTrue(self.field('LayoutMode').is_disabled());self.assertFalse(self.page.evaluate('vb6Studio.autoLayout.apply({LayoutMode:5})'));self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
        self.page.evaluate('vb6Studio.designer.locked=false;vb6Studio.runState="running";vb6Studio.autoLayout.sync()');self.assertTrue(self.field('LayoutMode').is_disabled());self.page.evaluate('vb6Studio.runState="design"');self.done()
    def test_keyboard_reordering_and_parent_selection(self):
        self.select(['b']);self.page.locator('[aria-label="Form designer"]').focus();self.page.keyboard.press('ArrowLeft')
        self.assertLess(self.props('b')['Left'],self.props('a')['Left']);self.command('autoLayoutParent');self.assertEqual(self.page.evaluate('[...vb6Studio.designer.selection]'),['frame']);self.done()
    def test_spacing_pointer_preview_cancel_commit_and_undo(self):
        before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
        count=self.page.evaluate('vb6Studio.history.undoStack.length')
        x,y=self.spacing_point()
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y,steps=3)
        self.page.wait_for_function('vb6Studio.designer.formView.controls.find(v=>v.model.id==="b").props.Left>vb6Studio.activeModule.form.controls.find(c=>c.id==="b").properties.Left')
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before,'Preview must not modify authored data')
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertEqual(self.props('frame')['LayoutGap'],180)
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count)
        x,y=self.spacing_point()
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y,steps=3);self.page.mouse.up()
        self.assertEqual(self.props('frame')['LayoutGap'],480)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        self.command('undo');self.assertEqual(self.props('frame')['LayoutGap'],180)
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
        self.done()
    def test_padding_keyboard_and_hide_guides(self):
        handle=self.page.locator('[data-layout-space="LayoutPaddingLeft"]');handle.focus();handle.press('ArrowRight');self.assertEqual(self.props('frame')['LayoutPaddingLeft'],195)
        self.page.get_by_label('Show layout guides',exact=True).uncheck();self.assertEqual(self.page.locator('[data-layout-space]').count(),0);self.page.get_by_label('Show layout guides',exact=True).check();self.assertGreater(self.page.locator('[data-layout-space]').count(),0);self.done()
    def test_drag_reorder_then_reparent_with_exact_undo(self):
        self.select(['b']);a=self.point('a');b=self.point('b');before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
        self.page.mouse.move(b['x'],b['y']);self.page.mouse.down();self.page.mouse.move(a['x']-a['width']/2+3,a['y'],steps=5);self.page.mouse.up();self.assertLess(self.props('b')['Left'],self.props('a')['Left'])
        self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
        self.select(['b']);b=self.point('b');target=self.point('target');self.page.mouse.move(b['x'],b['y']);self.page.mouse.down();self.page.mouse.move(target['x'],target['y'],steps=6);self.page.mouse.up()
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.id==="b").parent'),'Target1');self.assertEqual(self.props('b')['Left'],180);self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()
    def test_drag_cancel_does_not_publish_authored_geometry(self):
        self.select(['b']);before=self.page.evaluate('JSON.stringify(vb6Studio.project)');b=self.point('b');t=self.point('target');self.page.mouse.move(b['x'],b['y']);self.page.mouse.down();self.page.mouse.move(t['x'],t['y'],steps=5);self.page.keyboard.press('Escape');self.page.mouse.up();self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.assertEqual(self.page.locator('.auto-drag-ghost,.auto-drop-container').count(),0);self.done()
    def test_add_control_reflows_and_undo_preserves_existing_layout(self):
        self.select([]);self.change({'LayoutMode':2,'LayoutGap':150,'LayoutPadding':120});before=self.page.evaluate('JSON.stringify(vb6Studio.project)');self.page.evaluate('vb6Studio.addControl("CommandButton")')
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].properties.Left'),120);self.assertGreater(self.page.evaluate('vb6Studio.designer.selected()[0].properties.Top'),300);self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()
    def test_theme_colors_apply_to_panel_and_guides_not_app(self):
        app=self.page.evaluate('getComputedStyle(vb6Studio.designer.formView.node).backgroundColor');before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
        for theme in ['fluent-dark','macos26','x11-cde-dark','classic']:
            self.page.evaluate('theme=>{vb6Studio.appearance.theme=theme;vb6Studio.applyAppearance();vb6Studio.designer.renderSelection();}',theme)
            self.assertEqual(self.page.evaluate('getComputedStyle(vb6Studio.designer.formView.node).backgroundColor'),app);self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
            self.assertTrue(self.page.evaluate('()=>{const a=getComputedStyle(vb6Studio.root).getPropertyValue("--vb-selection").trim(),b=getComputedStyle(document.querySelector(".auto-layout-guides")).getPropertyValue("--vb-selection").trim();return a===b&&!!a;}'))
        self.done()
    def test_runtime_text_hug_suspend_and_grid_code(self):
        project=self.page.evaluate(r'''()=>{const A=VB6StudioAPI,p=A.newProject('RuntimeLayout'),m=p.modules[0];p.settings.anchoring=true;p.settings.renderer='canvas2d';const c=A.createControl('Label','Label1',300,300);c.id='label';Object.assign(c.properties,{Caption:'Hi',LayoutWidthMode:1,LayoutHeightMode:1});m.form.controls=[c];m.code='Option Explicit\nPrivate Sub Form_Load()\nMe.LayoutMode = vbLayoutGrid\nMe.LayoutGridColumns = "1fr"\nEnd Sub\n';return p;}''')
        self.page.goto('about:blank') if MEMORY else self.page.goto(self.base+'/tests/fixtures/layout-runtime.html')
        if MEMORY:self.page.set_content('<!doctype html><style>'+(ROOT/'dist/vb6-controls.css').read_text()+'</style>');self.page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
        else:self.page.add_style_tag(url=self.base+'/dist/vb6-controls.css');self.page.add_script_tag(url=self.base+'/dist/vb6-runtime.js')
        self.page.evaluate('async p=>{globalThis.host=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});await host.start();}',project)
        values=self.page.evaluate('''()=>{const f=host.forms[0],c=f.controls[0],width=c.Width;f.SuspendLayout();c.Caption='A much longer intrinsic caption';const held=c.Width;f.ResumeLayout();const grown=c.Width;c.FontSize=24;const large=c.Width;const d=f.Controls.Add('VB.TextBox','Added');d.Visible=-1;d.LayoutWidthMode=2;d.LayoutHeightMode=1;d.Text='A long dynamic field';const fills=d.Width===f.ClientWidth;return {width,held,grown,large,fills,mode:f.LayoutMode,codeState:host.vm.state,source:host.project.modules[0].form.controls[0].properties.Caption};}''')
        self.assertEqual(values['held'],values['width']);self.assertGreater(values['grown'],values['width']);self.assertGreater(values['large'],values['grown']);self.assertTrue(values['fills']);self.assertEqual(values['mode'],5);self.assertEqual(values['source'],'Hi');self.assertEqual(values['codeState'],'running');self.done()
    def test_dynamic_control_removal_releases_layout_wrappers(self):
        if MEMORY:self.page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
        else:self.page.add_script_tag(url=self.base+'/dist/vb6-runtime.js')
        result=self.page.evaluate('''async()=>{const p=structuredClone(vb6Studio.project);p.modules[0].code='Option Explicit\\n';const root=document.createElement('div');document.body.append(root);const h=new VB6Runtime.RuntimeAPI.ApplicationHost(p,root,{persist:false});await h.start();const f=h.forms[0],before=f.layoutController.wrapped.size;for(let i=0;i<100;i++){const c=f.Controls.Add('VB.CommandButton','Transient'+i);c.Visible=-1;f.Controls.Remove(c);}const result={before,after:f.layoutController.wrapped.size,records:f.layoutController.records.size,controls:f.controls.length};h.dispose();root.remove();return result;}''')
        self.assertEqual(result['after'],result['before']);self.assertEqual(result['records'],result['controls']);self.done()
    def test_self_contained_html_preserves_advanced_responsive_layout(self):
        self.change({'LayoutMode':5,'LayoutGridColumns':'1fr 2fr'});self.select(['a','b','c']);self.change({'LayoutWidthMode':2});project=self.page.evaluate('vb6Studio.project')
        code="import {exportApplication} from './src/exporter/exporter.js';import fs from 'node:fs';process.stdout.write(exportApplication(JSON.parse(fs.readFileSync(0,'utf8')),{persist:false}));"
        html=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,input=json.dumps(project),text=True,capture_output=True,check=True).stdout;(REPORT/'advanced-export.html').write_text(html)
        if MEMORY:self.page.goto('about:blank');self.page.set_content(html)
        else:self.page.goto(self.base+f'/reports/auto-layout/{ENGINE}/advanced-export.html')
        self.page.wait_for_function('globalThis.vb6Application?.forms?.length===1')
        values=self.page.evaluate('''()=>{const f=vb6Application.forms[0],p=f.controls.find(c=>c.model.id==='frame'),a=f.controls.find(c=>c.model.id==='a'),b=f.controls.find(c=>c.model.id==='b');const old=[a.Width,b.Width];p.Width+=900;return {old,next:[a.Width,b.Width],enabled:f.anchoring};}''')
        self.assertEqual(values,{'old':[1220,2440],'next':[1520,3040],'enabled':True});self.page.screenshot(path=str(REPORT/'advanced-export.png'));self.done()
if __name__=='__main__':unittest.main(verbosity=2)

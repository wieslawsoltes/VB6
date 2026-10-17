#!/usr/bin/env python3
"""Figma workspace acceptance: real IDE widgets and source/runtime invariants.
HTTP and file are real-origin checks in CI. The explicitly labelled memory mode
is a local fallback only; it does not claim storage, HTTP or file-URL coverage.
"""
import functools, http.server, json, os, shutil, threading, time, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
ENGINE=os.environ.get('VB6_BROWSER','chromium')
TRANSPORT=os.environ.get('VB6_TEST_TRANSPORT','http')
REPORT=ROOT/'reports'/'figma-workspace'/ENGINE/TRANSPORT
# Native AOT payloads make initial IDE parsing separate from the 8000 ms
# interaction deadline; readiness still requires the installed workspace API.
IDE_STARTUP_TIMEOUT_MS=60000
FIXTURE=r'''enabled=>{const A=VB6StudioAPI,p=A.newProject('FigmaFixture'),m=p.modules[0];p.settings.anchoring=enabled;p.settings.renderer='canvas2d';p.settings.snapToGrid=false;p.settings.showGrid=false;
Object.assign(m.form.properties,{ClientWidth:9000,ClientHeight:6000,Width:9120,Height:6450});m.code='Option Explicit\nPrivate Sub Command1_Click()\n    Command1.Caption = "Clicked"\nEnd Sub\n';
const frame=A.createControl('Frame','Frame1',450,450);frame.id='frame';Object.assign(frame.properties,{Caption:'Content',Width:6600,Height:3300});
const a=A.createControl('CommandButton','Command1',300,450),b=A.createControl('TextBox','Text1',2700,450),label=A.createControl('Label','Label1',450,4500),timer=A.createControl('Timer','Timer1',7500,4800);
a.id='button';b.id='text';label.id='label';timer.id='timer';for(const c of [a,b]){c.parent='Frame1';c.nativeParentId='frame';Object.assign(c.properties,{Width:1800,Height:450});}Object.assign(a.properties,{Caption:'Save',Anchor:5});Object.assign(b.properties,{Text:'Real VB6',Anchor:9});label.properties.Caption='A real VB6 form';m.form.controls=[frame,a,b,label,timer];vb6Studio.loadProject(p);return p;}'''
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
class FigmaWorkspace(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();options={'headless':True}
        if ENGINE=='chromium':
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:options['executable_path']=executable
            options['args']=['--no-sandbox','--disable-gpu']
        cls.browser=getattr(cls.pw,ENGINE).launch(**options)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.start=time.perf_counter();self.errors=[];self.passed=False
        self.context=self.browser.new_context(viewport={'width':1600,'height':1050},color_scheme='light');self.context.set_default_timeout(8000)
        self.page=self.context.new_page();self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.load();self.page.evaluate(FIXTURE,False)
    def load(self):
        if TRANSPORT=='memory':self.page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        # WebKit can leave a standalone document's load event pending after
        # the IDE is usable. Keep the real origin and await its actual API.
        else:self.page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri() if TRANSPORT=='file' else self.base+'/dist/index.html',wait_until='commit')
        self.page.wait_for_function('globalThis.vb6Studio?.figmaMode',polling=100,timeout=IDE_STARTUP_TIMEOUT_MS)
    def tearDown(self):
        if not self.passed or self.errors:
            try:self.page.screenshot(path=str(REPORT/(self._testMethodName+'-failure.png')),timeout=3000)
            except Exception:pass
        self.results.append({'name':self._testMethodName,'passed':self.passed and not self.errors,'pageErrors':self.errors,'milliseconds':round((time.perf_counter()-self.start)*1000,2)})
        (REPORT/'results.json').write_text(json.dumps({'browser':ENGINE,'transport':TRANSPORT,'results':self.results},indent=2));self.context.close();self.assertEqual(self.errors,[])
    def done(self):self.passed=True
    def enable(self,layout=False):
        if layout:self.page.evaluate(FIXTURE,True)
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"light",units:"px"})')
        self.page.locator('.figma-header').wait_for();self.page.wait_for_function('vb6Studio.figmaMode.viewports.get(vb6Studio.designer)?.state.x!==8');self.page.wait_for_timeout(60)
    def select(self,ids):
        self.page.evaluate('ids=>vb6Studio.designer.select(ids)',ids);self.page.wait_for_timeout(50)
    def props(self,id):return self.page.evaluate('id=>vb6Studio.activeModule.form.controls.find(c=>c.id===id).properties',id)
    def snapshot(self):return self.page.evaluate('JSON.stringify(vb6Studio.project)')
    def field(self,key):return self.page.locator('[data-figma-property="'+key+'"]')
    def change(self,locator,value):locator.fill(str(value));locator.press('Tab');self.page.wait_for_timeout(80)
    def test_01_normal_options_opt_in_cancel_and_accept(self):
        self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.enabled'));before=self.snapshot()
        self.page.evaluate('void vb6Studio.command("options")');dialog=self.page.get_by_role('dialog',name='Options',exact=True)
        dialog.get_by_role('tab',name='General',exact=True).click();dialog.get_by_label('Workspace mode',exact=True).select_option('figma');dialog.get_by_role('button',name='Cancel',exact=True).click()
        self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.enabled'));self.assertEqual(self.snapshot(),before)
        self.page.evaluate('void vb6Studio.command("options")');dialog=self.page.get_by_role('dialog',name='Options',exact=True)
        dialog.get_by_role('tab',name='General',exact=True).click();dialog.get_by_label('Workspace mode',exact=True).select_option('figma');dialog.get_by_role('button',name='OK',exact=True).click()
        self.page.wait_for_function('vb6Studio.figmaMode.enabled');self.assertFalse(self.page.evaluate('vb6Studio.project.settings.anchoring'));self.done()
    def test_02_workspace_never_changes_model_theme_history_or_classic_layout(self):
        before=self.snapshot();dock=self.page.evaluate('JSON.stringify(vb6Studio.docking.snapshot())');history=self.page.evaluate('vb6Studio.history.undoStack.length')
        style=self.page.evaluate('(()=>{const n=vb6Studio.designer.formView.controls.find(v=>v.model.id==="button").node,s=getComputedStyle(n);return [s.backgroundColor,s.color,s.fontFamily,s.fontSize]})()')
        self.enable();self.assertEqual(before,self.snapshot());self.assertEqual(history,self.page.evaluate('vb6Studio.history.undoStack.length'))
        self.assertEqual(style,self.page.evaluate('(()=>{const n=vb6Studio.designer.formView.controls.find(v=>v.model.id==="button").node,s=getComputedStyle(n);return [s.backgroundColor,s.color,s.fontFamily,s.fontSize]})()'))
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})');self.assertEqual(before,self.snapshot());self.assertEqual(dock,self.page.evaluate('JSON.stringify(vb6Studio.docking.snapshot())'))
        self.assertEqual(self.page.locator('.figma-header').count(),0);self.assertEqual(self.page.evaluate('vb6Studio.inspector.wrapper.parentNode===vb6Studio.propertiesPanel'),True);self.done()
    def test_03_assets_catalog_creates_real_vb_controls(self):
        self.enable();self.page.locator('.dock-tabbar [data-window-id="toolbox"]').click();self.page.get_by_label('Search VB6 controls').fill('commandbutton')
        button=self.page.locator('.toolbox-grid [data-control-type="CommandButton"]');self.assertTrue(button.is_visible());self.assertFalse(self.page.locator('.toolbox-grid [data-control-type="Timer"]').is_visible())
        button.dblclick();self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.filter(c=>c.type==="CommandButton").length'),2)
        self.page.get_by_label('Search VB6 controls').fill('timer');self.page.locator('.toolbox-grid [data-control-type="Timer"]').dblclick();self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.filter(c=>c.type==="Timer").length'),2);self.done()
    def test_04_compact_geometry_real_properties_units_and_undo(self):
        self.enable();self.select(['button']);self.change(self.field('Left'),100);self.assertEqual(self.props('button')['Left'],1500)
        self.change(self.field('Width'),160);self.assertEqual(self.props('button')['Width'],2400)
        self.page.get_by_label('Position units',exact=True).select_option('twips');self.page.wait_for_timeout(60);self.assertEqual(self.field('Width').input_value(),'2400')
        self.change(self.field('Height'),600);self.assertEqual(self.props('button')['Height'],600)
        self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(70);self.assertEqual(self.props('button')['Height'],450)
        caption=self.page.locator('.figma-all-properties input[data-property="Caption"]');self.change(caption,'Saved caption');self.assertEqual(self.props('button')['Caption'],'Saved caption');self.done()
    def test_05_layer_tree_search_multiselect_and_visibility(self):
        self.enable();self.page.locator('[data-layer-id="button"]').click();self.assertEqual(self.page.evaluate('[...vb6Studio.designer.selection]'),['button'])
        self.page.locator('[data-layer-id="text"]').click(modifiers=['Control']);self.assertEqual(set(self.page.evaluate('[...vb6Studio.designer.selection]')),{'button','text'})
        self.page.get_by_label('Search layers',exact=True).fill('Command1');self.assertEqual(self.page.locator('[data-layer-id]').count(),3)
        self.assertTrue(self.page.locator('[data-layer-id="frame"]').is_visible());self.page.get_by_label('Search layers',exact=True).fill('')
        row=self.page.locator('[data-layer-id="button"]');row.hover();row.get_by_role('button',name='Hide Command1',exact=True).click();self.assertEqual(self.props('button')['Visible'],0)
        self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(60);self.assertNotEqual(self.props('button')['Visible'],0);self.done()
    def test_06_mixed_anchor_axes_preserve_the_other_axis(self):
        self.enable(True);self.select(['button','text']);self.assertEqual(self.page.get_by_label('Horizontal constraint',exact=True).input_value(),'')
        self.page.get_by_label('Vertical constraint',exact=True).select_option('3');self.page.wait_for_timeout(70)
        self.assertEqual(self.props('button')['Anchor'],7);self.assertEqual(self.props('text')['Anchor'],11)
        self.page.get_by_label('Horizontal constraint',exact=True).select_option('3');self.page.wait_for_timeout(70)
        self.assertEqual(self.props('button')['Anchor'],15);self.assertEqual(self.props('text')['Anchor'],15);self.done()
    def test_07_all_layout_fields_are_live_and_roundtrip(self):
        self.enable(True);self.select(['frame'])
        self.page.locator('[data-auto-property="LayoutMode"]').select_option('1');self.page.wait_for_timeout(100)
        self.assertEqual(self.props('frame')['LayoutMode'],1)
        gap=self.page.locator('[data-auto-property="LayoutGap"]');self.change(gap,300);self.assertEqual(self.props('frame')['LayoutGap'],300)
        self.assertEqual(self.props('text')['Left']-self.props('button')['Left']-self.props('button')['Width'],300)
        self.page.locator('[data-auto-property="LayoutMode"]').select_option('5');self.page.wait_for_timeout(70)
        grid=self.page.locator('[data-auto-property="LayoutGridColumns"]');grid.evaluate('(n)=>{n.closest("details").open=true}');self.change(grid,'1fr 2fr');self.assertEqual(self.props('frame')['LayoutGridColumns'],'1fr 2fr')
        project=self.page.evaluate('VB6StudioAPI.normalizeProject(JSON.parse(JSON.stringify(vb6Studio.project)))');self.assertTrue(project['settings']['anchoring']);self.assertEqual(next(c for c in project['modules'][0]['form']['controls'] if c['id']=='frame')['properties']['LayoutGridColumns'],'1fr 2fr');self.done()
    def test_08_pan_zoom_hit_testing_and_escape_cancel(self):
        self.enable();before=self.snapshot();d=self.page.locator('.designer-scroll[data-figma-viewport]');box=d.bounding_box();x=box['x']+40;y=box['y']+45
        state=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state')
        self.page.mouse.move(x,y);self.page.mouse.down(button='middle');self.page.mouse.move(x+90,y+55,steps=5);self.page.mouse.up(button='middle')
        moved=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state');self.assertAlmostEqual(moved['x']-state['x'],90);self.assertAlmostEqual(moved['y']-state['y'],55)
        self.assertEqual(before,self.snapshot());self.page.keyboard.down('Control');self.page.mouse.wheel(0,-70);self.page.keyboard.up('Control');self.page.wait_for_timeout(70)
        self.assertGreater(self.page.evaluate('vb6Studio.designer.zoom'),state['zoom'])
        point=self.page.evaluate('(()=>{const r=vb6Studio.designer.formView.controls.find(v=>v.model.id==="button").node.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()');self.page.mouse.click(*point);self.assertEqual(self.page.evaluate('[...vb6Studio.designer.selection]'),['button'])
        current=self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state');self.page.mouse.move(x,y);self.page.mouse.down(button='middle');self.page.mouse.move(x+30,y+20);self.page.keyboard.press('Escape');self.page.mouse.up(button='middle');self.assertEqual(self.page.evaluate('vb6Studio.figmaMode.viewports.get(vb6Studio.designer).state'),current);self.done()
    def test_09_unselected_layer_drag_reparents_with_undo(self):
        self.enable(True);self.select(['button']);source=self.page.locator('[data-layer-id="label"]');target=self.page.locator('[data-layer-id="frame"]');source.drag_to(target)
        self.page.wait_for_timeout(80);self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.id==="label").parent'),'Frame1')
        self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(60);self.assertIsNone(self.page.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.id==="label").parent'))
        self.done()
    def test_10_layout_readonly_and_nonvisual_exclusion(self):
        self.enable(True);self.select(['timer']);self.assertFalse(self.page.locator('.figma-constraint-section').is_visible());self.assertFalse(self.page.locator('.figma-layout-content').is_visible())
        self.select(['button']);self.page.evaluate('vb6Studio.designer.locked=true;vb6Studio.figmaMode.sync()');self.assertTrue(self.field('Left').is_disabled());self.assertTrue(self.page.get_by_label('Horizontal constraint',exact=True).is_disabled())
        before=self.snapshot();self.page.evaluate('vb6Studio.figmaMode.chooseTool("CommandButton");vb6Studio.figmaMode.enableLayout()');self.assertEqual(before,self.snapshot());self.done()
    def test_11_new_project_designer_lifecycle_and_code(self):
        self.enable(True);old=self.page.evaluate('vb6Studio.figmaMode.viewports.size');self.page.evaluate(FIXTURE,False);self.page.wait_for_timeout(80);self.assertEqual(self.page.evaluate('vb6Studio.figmaMode.viewports.size'),old)
        # Workspace chrome is coalesced at the next rendering opportunity;
        # a click completing is not the completion boundary for that frame.
        self.page.get_by_role('button',name='Code',exact=True).click()
        expect(self.page.locator('.figma-canvas-toolbar')).not_to_be_visible()
        expect(self.page.locator('.mdi-window.mdi-active .code-pane')).to_be_visible()
        self.page.get_by_role('button',name='Design',exact=True).click()
        expect(self.page.locator('.figma-canvas-toolbar')).to_be_visible();self.done()
    def test_12_responsive_panels_and_dark_screenshots(self):
        self.enable(True);self.select(['frame']);self.page.screenshot(path=str(REPORT/'figma-light.png'),timeout=10000)
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"dark",units:"px"})');self.page.wait_for_timeout(80);self.page.screenshot(path=str(REPORT/'figma-dark.png'),timeout=10000)
        self.page.set_viewport_size({'width':700,'height':820});self.page.get_by_role('button',name='Toggle Layers sidebar',exact=True).click();self.assertTrue(self.page.locator('.figma-layer-tree').is_visible())
        self.page.get_by_role('button',name='Toggle Design sidebar',exact=True).click();self.assertTrue(self.page.locator('.figma-design-inspector').is_visible());self.assertFalse(self.page.locator('.figma-layer-tree').is_visible());self.page.screenshot(path=str(REPORT/'figma-narrow.png'),timeout=10000);self.done()
    @unittest.skipIf(TRANSPORT=='memory','Opaque-origin memory transport does not support persistence testing')
    def test_13_preferences_and_independent_dock_profiles_survive_reload(self):
        before=self.page.evaluate('JSON.stringify(vb6Studio.docking.snapshot())');self.enable();self.page.evaluate('vb6Studio.persist()');self.page.reload(wait_until='commit');self.page.wait_for_function('globalThis.vb6Studio?.figmaMode?.enabled',polling=100,timeout=IDE_STARTUP_TIMEOUT_MS);self.assertEqual(self.page.get_by_label('Position units',exact=True).input_value(),'px')
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"});vb6Studio.persist()');self.page.reload(wait_until='commit');self.page.wait_for_function('globalThis.vb6Studio?.figmaMode',polling=100,timeout=IDE_STARTUP_TIMEOUT_MS);self.assertFalse(self.page.evaluate('vb6Studio.figmaMode.enabled'));self.assertEqual(before,self.page.evaluate('JSON.stringify(vb6Studio.docking.snapshot())'));self.done()
    def test_14_runtime_still_executes_vb6_and_exports_no_workspace_chrome(self):
        self.enable();html=self.page.evaluate('VB6StudioAPI.exportApplication(vb6Studio.project,{persist:false})');self.assertNotIn('figma-canvas-toolbar',html);self.assertNotIn('figma-workspace-options',html)
        runtime=self.context.new_page();runtime.on('pageerror',lambda e:self.errors.append(str(e)));runtime.set_content(html);runtime.get_by_role('button',name='Save',exact=True).click();runtime.get_by_role('button',name='Clicked',exact=True).wait_for();runtime.close();self.done()

    def test_15_form_events_and_layer_rename_use_vb_symbols(self):
        self.enable();self.select([]);self.page.get_by_role('button',name='Edit VB6 events…',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Form — Events',exact=True);dialog.get_by_label('Event',exact=True).select_option('Load');dialog.get_by_role('button',name='View Code',exact=True).click()
        self.assertIn('Sub Form_Load()',self.page.evaluate('vb6Studio.activeModule.code'));self.assertNotIn('Sub Form1_Load()',self.page.evaluate('vb6Studio.activeModule.code'))
        self.page.get_by_role('button',name='Design',exact=True).click();row=self.page.locator('[data-layer-id="button"]');row.click();row.press('F2')
        name=self.page.get_by_label('Layer name',exact=True);self.assertTrue(name.evaluate('(n)=>document.activeElement===n'));self.change(name,'cmdSave')
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].name'),'cmdSave');self.assertIn('cmdSave_Click',self.page.evaluate('vb6Studio.activeModule.code'));self.done()
    def test_16_window_tile_and_single_canvas_preserve_document_functionality(self):
        self.enable();self.page.evaluate('void vb6Studio.command("tile")');self.page.wait_for_timeout(150)
        boxes=self.page.locator('.mdi-window:visible').evaluate_all('(nodes)=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})')
        self.assertGreaterEqual(len(boxes),2);self.assertTrue(any(b['x']!=boxes[0]['x'] or b['y']!=boxes[0]['y'] for b in boxes[1:]))
        self.page.evaluate('void vb6Studio.command("figmaSingleCanvas")');self.page.wait_for_timeout(80);self.assertEqual(self.page.locator('.mdi-window:visible').count(),1);self.done()
    def test_17_readonly_palette_and_accessible_anchor_hit_targets(self):
        self.enable(True);self.select(['button']);self.page.get_by_role('button',name='Anchor right',exact=True).click();self.assertEqual(self.props('button')['Anchor'],13)
        bounds=self.page.get_by_role('button',name='Anchor right',exact=True).bounding_box();self.assertGreaterEqual(bounds['width'],24);self.assertGreaterEqual(bounds['height'],24)
        self.page.evaluate('vb6Studio.runState="running";vb6Studio.autoLayout.sync();vb6Studio.figmaMode.sync()');self.assertTrue(self.page.get_by_role('button',name='Add auto layout (Shift+A)',exact=True).is_disabled());self.assertTrue(self.page.get_by_label('Layer name',exact=True).is_disabled())
        self.page.evaluate('vb6Studio.runState="design"');self.done()
    def test_18_classic_zoom_and_scroll_restore_after_layout_settles(self):
        self.page.evaluate('vb6Studio.designer.setZoom(2);vb6Studio.designer.root.scrollLeft=110;vb6Studio.designer.root.scrollTop=85')
        before=self.page.evaluate('[vb6Studio.designer.zoom,vb6Studio.designer.root.scrollLeft,vb6Studio.designer.root.scrollTop]');self.assertGreater(before[1],0)
        self.enable();self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})');self.page.wait_for_timeout(100)
        self.assertEqual(self.page.evaluate('[vb6Studio.designer.zoom,vb6Studio.designer.root.scrollLeft,vb6Studio.designer.root.scrollTop]'),before);self.assertEqual(self.page.get_by_label('Designer zoom',exact=True).input_value(),'2');self.done()
    def test_19_floating_menu_and_escape_sidebar_use_workspace_theme(self):
        self.enable();self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"dark"})');self.page.get_by_label('Canvas zoom',exact=True).click()
        menu=self.page.get_by_role('menu',name='Commands',exact=True);self.assertEqual(menu.evaluate('(n)=>getComputedStyle(n).backgroundColor'),'rgb(44, 44, 44)');self.assertEqual(menu.evaluate('(n)=>getComputedStyle(n).borderRadius'),'7px');self.page.keyboard.press('Escape')
        self.page.set_viewport_size({'width':700,'height':820});left=self.page.get_by_label('Toggle Layers sidebar',exact=True);left.click();expect(left).to_have_attribute('aria-expanded','true');self.page.keyboard.press('Escape');self.page.wait_for_timeout(60);expect(left).to_have_attribute('aria-expanded','false');self.assertFalse(self.page.locator('.figma-layer-tree').is_visible());self.done()
    def test_20_layout_keyboard_and_guides_survive_transformed_canvas(self):
        self.enable(True);self.select(['button','text']);before=self.snapshot();count=self.page.evaluate('vb6Studio.history.undoStack.length');designer=self.page.locator('.designer-scroll[data-figma-viewport]');designer.focus();designer.press('Shift+A')
        self.page.wait_for_timeout(80);self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].name'),'LayoutFrame1');self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(70);self.assertEqual(self.snapshot(),before);self.done()


    def test_21_explicit_layout_opt_in_solves_and_undoes_atomically(self):
        self.enable();self.select(['frame']);before=self.snapshot();count=self.page.evaluate('vb6Studio.history.undoStack.length')
        self.page.get_by_role('button',name='Enable auto layout and anchoring',exact=True).click();self.page.wait_for_timeout(80)
        self.assertTrue(self.page.evaluate('vb6Studio.project.settings.anchoring'));self.assertTrue(self.page.locator('.figma-layout-content').is_visible());self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        self.page.evaluate('void vb6Studio.command("undo")');self.page.wait_for_timeout(70);self.assertEqual(self.snapshot(),before);self.done()
    def test_22_invalid_dormant_layout_cannot_partially_enable_project(self):
        self.enable();self.page.evaluate('vb6Studio.activeModule.form.controls[0].properties.MinimumWidth=2000;vb6Studio.activeModule.form.controls[0].properties.MaximumWidth=1000')
        before=self.snapshot();self.page.get_by_role('button',name='Enable auto layout and anchoring',exact=True).click();dialog=self.page.get_by_role('dialog',name='Figma workspace',exact=True);dialog.wait_for()
        self.assertEqual(self.snapshot(),before);dialog.get_by_role('button',name='OK',exact=True).click();self.done()

if __name__=='__main__':unittest.main(verbosity=2)

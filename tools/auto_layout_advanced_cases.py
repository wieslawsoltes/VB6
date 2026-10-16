"""Advanced responsive-grid and masonry browser cases installed onto the base suite."""
import json
from auto_layout_browser_base import MEMORY, ROOT, REPORT

def grid_fixture(self):
    self.change({'LayoutMode':5,'LayoutGridColumns':'900 900 900 600','LayoutGridRows':'450 450 450'})

def test_empty_track_keyboard_resize_focus_limits_and_history(self):
    self.grid_fixture();before=self.page.evaluate('JSON.stringify(vb6Studio.project)');count=self.page.evaluate('vb6Studio.history.undoStack.length')
    handle=self.page.get_by_role('slider',name='Column 4 size',exact=True);handle.focus();self.page.keyboard.press('ArrowRight');self.page.keyboard.press('Shift+ArrowRight')
    self.assertEqual(float(handle.get_attribute('aria-valuenow')),735);self.assertEqual(self.page.evaluate('document.activeElement.getAttribute("aria-label")'),'Column 4 size')
    self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+2)
    self.command('undo');self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
    self.change({'LayoutGridColumns':'[900,900,900,{"size":600,"min":570,"max":630}]'})
    handle=self.page.get_by_role('slider',name='Column 4 size',exact=True);self.assertEqual(handle.get_attribute('aria-valuemax'),'630');handle.focus();self.page.keyboard.press('Shift+ArrowRight');self.assertEqual(float(handle.get_attribute('aria-valuenow')),630)
    self.done()

def test_empty_track_pointer_preview_cancel_commit_and_exact_undo(self):
    self.grid_fixture();before=self.page.evaluate('JSON.stringify(vb6Studio.project)');count=self.page.evaluate('vb6Studio.history.undoStack.length')
    handle=self.page.get_by_role('slider',name='Column 4 size',exact=True);handle.hover();box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y,steps=5)
    self.page.wait_for_function("document.querySelector('[aria-label=\"Column 4 size\"]').getAttribute('aria-valuenow')==='900'")
    self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
    self.page.keyboard.press('Escape');self.page.mouse.up();self.assertEqual(float(handle.get_attribute('aria-valuenow')),600);self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count)
    self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y,steps=5);self.page.mouse.up();self.assertEqual(float(handle.get_attribute('aria-valuenow')),900)
    self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1);self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_grid_child_arrows_move_cells_without_reordering(self):
    self.grid_fixture();self.select(['a','b']);before=self.page.evaluate('JSON.stringify(vb6Studio.project)');order=self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)')
    self.page.locator('[aria-label="Form designer"]').focus();self.page.keyboard.press('ArrowDown')
    self.assertEqual(self.props('a')['LayoutRow'],1);self.assertEqual(self.props('a')['LayoutColumn'],0);self.assertEqual(self.props('b')['LayoutRow'],1);self.assertEqual(self.props('b')['LayoutColumn'],1)
    self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)'),order);self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_grid_drag_to_empty_cell_retains_order_and_undo(self):
    self.grid_fixture();column=self.page.get_by_role('slider',name='Column 4 size',exact=True);row=self.page.get_by_role('slider',name='Row 3 size',exact=True);column.hover();x=column.bounding_box();y=row.bounding_box();target={'x':x['x']+x['width']/2-20,'y':y['y']+y['height']/2-15}
    self.select(['b']);before=self.page.evaluate('JSON.stringify(vb6Studio.project)');order=self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)');point=self.point('b')
    self.page.mouse.move(point['x'],point['y']);self.page.mouse.down();self.page.mouse.move(target['x'],target['y'],steps=8);self.page.mouse.up()
    self.assertEqual(self.props('b')['LayoutColumn'],3);self.assertEqual(self.props('b')['LayoutRow'],2);self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)'),order)
    self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_grid_packing_and_bounded_syntax_use_actual_panel_fields(self):
    self.field('LayoutMode').select_option('5');self.page.locator('.auto-layout-section').filter(has_text='Grid tracks and placement').locator('summary').click()
    self.field('LayoutGridColumns').fill('repeat(2, minmax(300, 1fr))');self.field('LayoutGridColumns').press('Enter');self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),2)
    # Column flow starts with one implicit row, so three children require a third column.
    self.field('LayoutGridAutoFlow').select_option('3')
    self.assertEqual(self.props('frame')['LayoutGridAutoFlow'],3);self.assertEqual(self.props('frame')['LayoutGridColumns'],'repeat(2, minmax(300, 1fr))');self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),3)
    self.page.screenshot(path=str(REPORT/'grid-track-authoring.png'));self.done()

def open_section(self,title):
    section=self.page.locator('.auto-layout-section').filter(has=self.page.locator('summary',has_text=title))
    if section.get_attribute('open') is None:section.locator('summary').click()

def set_text_field(self,key,value):
    self.field(key).fill(value);self.field(key).press('Enter')

def test_responsive_panel_variables_collapse_and_explicit_expansion(self):
    self.field('LayoutMode').select_option('5');self.open_section('Grid tracks and placement')
    self.set_text_field('LayoutGridColumns','repeat(auto-fit, minmax(var(--min, 1000), 1fr))')
    self.open_section('Responsive grid, direction and bindings');self.set_text_field('LayoutVariables','{"--min":800}')
    self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),3)
    self.set_text_field('LayoutGridColumns','repeat(auto-fill, minmax(var(--min), 1fr))')
    self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),4)
    self.assertEqual(self.page.get_by_role('slider',name='Column 4 size',exact=True).get_attribute('aria-disabled'),'true')
    before=self.page.evaluate('JSON.stringify(vb6Studio.project)');count=self.page.evaluate('vb6Studio.history.undoStack.length')
    self.command('autoLayoutExpandColumns');self.assertEqual(self.page.get_by_role('slider',name='Column 4 size',exact=True).get_attribute('aria-disabled'),'false')
    self.assertEqual(len(json.loads(self.props('frame')['LayoutGridColumns'])),4);self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
    self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_named_span_rtl_arrow_materialization_and_exact_undo(self):
    self.change({'LayoutMode':5,'LayoutGridColumns':'[start] 900 [middle] 900 [end] 900','LayoutGridRows':'450 450 450'})
    self.open_section('Responsive grid, direction and bindings');self.field('LayoutDirection').select_option('1')
    self.select(['a']);self.open_section('Responsive grid, direction and bindings');self.set_text_field('LayoutColumnStart','start');self.set_text_field('LayoutColumnEnd','end')
    before=self.page.evaluate('JSON.stringify(vb6Studio.project)');old=self.props('a')['Left'];order=self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)')
    self.page.locator('[aria-label="Form designer"]').focus();self.page.keyboard.press('ArrowLeft')
    self.assertEqual(self.props('a')['LayoutColumn'],1);self.assertEqual(self.props('a')['LayoutColumnSpan'],2);self.assertEqual(self.props('a')['LayoutColumnStart'],'');self.assertEqual(self.props('a')['LayoutColumnEnd'],'')
    self.assertLess(self.props('a')['Left'],old);self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)'),order)
    self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_rtl_lane_ruler_keyboard_pointer_sign_and_history(self):
    self.grid_fixture();self.change({'LayoutDirection':1});before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
    handle=self.page.get_by_role('slider',name='Column 4 size',exact=True);handle.focus();self.page.keyboard.press('ArrowLeft')
    self.assertEqual(float(handle.get_attribute('aria-valuenow')),615);self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
    handle.hover();box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2;count=self.page.evaluate('vb6Studio.history.undoStack.length')
    self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x-20,y,steps=5);self.page.mouse.up()
    self.assertEqual(float(handle.get_attribute('aria-valuenow')),900);self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
    self.command('undo');self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_masonry_panel_lane_rulers_and_alignment_board(self):
    self.field('LayoutMode').select_option('6');self.open_section('Grid tracks and placement');self.set_text_field('LayoutGridColumns','1000 1000')
    self.assertEqual([self.props(i)['Top'] for i in ['a','b','c']],[180,180,810]);self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),2);self.assertEqual(self.page.locator('[data-layout-track="rows"]').count(),0)
    handle=self.page.get_by_role('slider',name='Column 2 size',exact=True);handle.focus();self.page.keyboard.press('ArrowRight');self.assertEqual(float(handle.get_attribute('aria-valuenow')),1015)
    self.page.get_by_role('button',name='Bottom right',exact=True).click();self.assertEqual(self.props('frame')['LayoutAlignContent'],2);self.assertEqual(self.props('a')['Top'],840)
    self.page.screenshot(path=str(REPORT/'masonry-authoring.png'));self.done()

def test_horizontal_masonry_uses_row_rulers_and_stable_order(self):
    self.field('LayoutMode').select_option('7');self.open_section('Grid tracks and placement');self.set_text_field('LayoutGridRows','500 500')
    self.assertEqual([self.props(i)['Left'] for i in ['a','b','c']],[180,180,1260]);self.assertEqual(self.page.locator('[data-layout-track="rows"]').count(),2);self.assertEqual(self.page.locator('[data-layout-track="columns"]').count(),0)
    handle=self.page.get_by_role('slider',name='Row 2 size',exact=True);handle.focus();self.page.keyboard.press('ArrowDown');self.assertEqual(float(handle.get_attribute('aria-valuenow')),515)
    self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.id)'),['frame','a','b','c','target']);self.done()

def test_named_area_fields_and_invalid_template_transaction(self):
    self.change({'LayoutMode':5,'LayoutGridColumns':'1000 1000','LayoutGridRows':'450 450'})
    self.open_section('Responsive grid, direction and bindings');self.set_text_field('LayoutGridAreas','"head head" "left body"')
    self.select(['a']);self.open_section('Responsive grid, direction and bindings');self.set_text_field('LayoutArea','head')
    self.select(['b']);self.open_section('Responsive grid, direction and bindings');self.set_text_field('LayoutArea','body')
    self.assertEqual(self.props('a')['Top'],180);self.assertEqual(self.props('b')['Top'],810);self.assertEqual(self.props('b')['Left'],1360)
    self.select(['frame']);before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
    message=self.page.evaluate('()=>{try{vb6Studio.autoLayout.apply({LayoutGridAreas:\'"a a" "a b"\'});}catch(e){return e.message;}}')
    self.assertIn('rectang',message.lower());self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before);self.done()

def test_runtime_responsive_resize_tokens_and_failed_live_edit_recovery(self):
    self.change({'LayoutMode':5,'LayoutGridColumns':'repeat(auto-fill,minmax(var(--min,1000),1fr))'});self.select(['a','b','c']);self.change({'LayoutWidthMode':2})
    if MEMORY:self.page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
    else:self.page.add_script_tag(url=self.base+'/dist/vb6-runtime.js')
    values=self.page.evaluate('''async()=>{const p=structuredClone(vb6Studio.project),root=document.createElement('div');document.body.append(root);const h=new VB6Runtime.RuntimeAPI.ApplicationHost(p,root,{persist:false});await h.start();const f=h.forms[0],panel=f.controls.find(c=>c.model.id==='frame'),a=f.controls.find(c=>c.model.id==='a'),grid=()=>f.layoutController.engine.getGridLayout('frame'),initial=grid().columns.length;panel.Width=5100;const resized=grid().columns.length;panel.LayoutVariables='{"--min":2000}';const rebound=grid().columns.length,before=JSON.stringify(grid());let error='';try{panel.LayoutVariables='{"--min":"var(--min)"}';}catch(e){error=e.message;}const preserved=before===JSON.stringify(grid()),vars=panel.LayoutVariables;panel.LayoutVariables='{"--min":1000}';const recovered=grid().columns.length,source=p.modules[0].form.controls.find(c=>c.id==='frame').properties.Width;h.dispose();root.remove();return {initial,resized,rebound,preserved,vars,recovered,error,source};}''')
    self.assertEqual([values['initial'],values['resized'],values['rebound'],values['recovered']],[3,4,2,4]);self.assertTrue(values['preserved']);self.assertEqual(values['vars'],'{"--min":2000}');self.assertIn('Cyclic',values['error']);self.assertEqual(values['source'],4200);self.done()

def test_runtime_unicode_hug_text_and_deferred_layout(self):
    if MEMORY:self.page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
    else:self.page.add_script_tag(url=self.base+'/dist/vb6-runtime.js')
    values=self.page.evaluate('''async()=>{const A=VB6StudioAPI,p=A.newProject('UnicodeLayout');p.settings.anchoring=true;p.modules[0].code='Option Explicit\\n';const label=A.createControl('Label','Text1');Object.assign(label.properties,{Caption:'你好世界你好世界',Width:600,Height:300,FontSize:12,LayoutHeightMode:1});p.modules[0].form.controls=[label];const root=document.createElement('div');document.body.append(root);const h=new VB6Runtime.RuntimeAPI.ApplicationHost(p,root,{persist:false});await h.start();const f=h.forms[0],c=f.controls[0],wrapped=c.Height;f.SuspendLayout();c.Caption='abcdefghijklmno';const held=c.Height;f.ResumeLayout();const unbroken=c.Height;await new Promise(requestAnimationFrame);const text=c.node.textContent;h.dispose();root.remove();return {wrapped,held,unbroken,text};}''')
    self.assertEqual(values['wrapped'],values['held']);self.assertGreater(values['wrapped'],values['unbroken']);self.assertEqual(values['text'],'abcdefghijklmno');self.done()

ADVANCED_METHODS = (
    'grid_fixture',
    'open_section',
    'set_text_field',
    'test_empty_track_keyboard_resize_focus_limits_and_history',
    'test_empty_track_pointer_preview_cancel_commit_and_exact_undo',
    'test_grid_child_arrows_move_cells_without_reordering',
    'test_grid_drag_to_empty_cell_retains_order_and_undo',
    'test_grid_packing_and_bounded_syntax_use_actual_panel_fields',
    'test_horizontal_masonry_uses_row_rulers_and_stable_order',
    'test_masonry_panel_lane_rulers_and_alignment_board',
    'test_named_area_fields_and_invalid_template_transaction',
    'test_named_span_rtl_arrow_materialization_and_exact_undo',
    'test_responsive_panel_variables_collapse_and_explicit_expansion',
    'test_rtl_lane_ruler_keyboard_pointer_sign_and_history',
    'test_runtime_responsive_resize_tokens_and_failed_live_edit_recovery',
    'test_runtime_unicode_hug_text_and_deferred_layout',
)

def install(cls):
    for name in ADVANCED_METHODS:
        setattr(cls, name, globals()[name])
    return cls

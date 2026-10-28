#!/usr/bin/env python3
"""Real source glyphs, native input metrics and canonical VB6 properties.
The screenshot test samples the displayed keyword, not a hidden text node. Each
backend retains its normal policy; no render/readback is forced by assertions.
"""
import importlib.util
import io
import json
import unittest
from pathlib import Path
from PIL import Image
from playwright.sync_api import expect
spec = importlib.util.spec_from_file_location('figma_base', Path(__file__).with_name('figma-browser-tests.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
REQUIRED_GPU = base.os.environ.get('VB6_FIGMA_CODE_GPU', '')
if REQUIRED_GPU and REQUIRED_GPU not in ['webgpu','webgl2']:raise ValueError('Unknown required code renderer')
REPORT = base.REPORT / ('code-'+REQUIRED_GPU if REQUIRED_GPU else 'editor-properties')
base.REPORT = REPORT

class EditorProperties(base.FigmaWorkspace):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if REQUIRED_GPU:
            if base.ENGINE!='chromium':raise ValueError('Required GPU qualification uses the Chromium software-driver harness')
            cls.browser.close()
            cls.browser=cls.pw.chromium.launch(headless=True,
                executable_path=base.os.environ.get('CHROMIUM_PATH') or base.shutil.which('chromium') or cls.pw.chromium.executable_path,
                args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader',
                      '--use-angle=swiftshader','--use-vulkan=swiftshader',
                      '--enable-gpu','--ignore-gpu-blocklist','--enable-features=Vulkan',
                      '--use-webgpu-adapter=swiftshader','--disable-vulkan-surface','--disable-gpu-rasterization'])

    def open_code(self):
        self.page.get_by_role('button', name='Code', exact=True).click()
        expect(self.page.get_by_role('region', name='Code inspector')).to_be_visible()
        self.page.wait_for_function('vb6Studio.editor.primary.syntax.children.length>0')

    def property(self, key):
        return self.page.locator('.figma-property-section [data-property="'+key+'"]:is(input,select)')

    def section(self, key):
        return self.page.locator('[data-property-section="'+key+'"]')

    def source_metrics(self):
        return self.page.locator('.mdi-window.mdi-active .source-editor').evaluate("""n => {
          const input = getComputedStyle(n.querySelector('.source-input'));
          const syntax = getComputedStyle(n.querySelector('.syntax-layer'));
          const keys = ['fontFamily','fontSize','lineHeight','letterSpacing','tabSize',
                        'paddingTop','paddingRight','paddingBottom','paddingLeft'];
          return {background: input.backgroundColor,
                  input: Object.fromEntries(keys.map(k=>[k,input[k]])),
                  syntax: Object.fromEntries(keys.map(k=>[k,syntax[k]]))};
        }""")

    def assert_source_pixels(self, label, expected_rgb):
        editor=self.page.locator('.mdi-window.mdi-active .source-editor')
        token=editor.locator('.syntax-line').first.locator('.syn-keyword').first
        expect(token).to_have_text('Option')
        # Query the current syntax token and its geometry in the same page task;
        # source virtualization may replace the token between protocol calls.
        geometry=editor.evaluate("""root=>{const n=root.querySelector('.syntax-line .syn-keyword');
          if(!n?.isConnected)throw new Error('No connected syntax keyword');
          const r=n.getBoundingClientRect();return {
          x:r.x,y:r.y,width:r.width,height:r.height,color:getComputedStyle(n).color};}""")
        data=self.source_metrics()
        self.assertEqual(data['background'], 'rgba(0, 0, 0, 0)')
        self.assertEqual(data['input'],data['syntax'])
        self.assertGreater(geometry['width'],0);self.assertGreater(geometry['height'],0)
        # Expected colors come from the fixture/contract, independently of CSSOM
        # color serialization. Preserve raw metrics even if screenshot fails.
        evidence={'metrics':data,'keyword':geometry,'expectedRGB':list(expected_rgb),
                  'renderer':self.page.evaluate('vb6Studio.rendering.getStats()')}
        (REPORT/(label+'.json')).write_text(json.dumps(evidence,indent=2))
        png=self.page.screenshot(path=str(REPORT/(label+'.png')),caret='hide',timeout=10000)
        image=Image.open(io.BytesIO(png)).convert('RGB')
        rgb=expected_rgb
        r=geometry;crop=image.crop((int(r['x']),int(r['y']),int(r['x']+r['width']+1),int(r['y']+r['height']+1)))
        # Rasterizer antialiasing differs by engine. Require actual interior
        # keyword-colored pixels; the opaque broken overlay has zero of these.
        ink=sum(1 for p in (crop.getpixel((x,y)) for y in range(crop.height) for x in range(crop.width)) if max(abs(p[i]-rgb[i]) for i in range(3))<=20)
        evidence['inkPixels']=ink
        (REPORT/(label+'.json')).write_text(json.dumps(evidence,indent=2))
        self.assertGreater(ink,10,'Displayed code must contain keyword glyphs, not an opaque input overlay')

    def test_source_overlay_does_not_cover_highlighted_code(self):
        self.enable();self.open_code()
        before=self.snapshot()
        for backend in ([REQUIRED_GPU] if REQUIRED_GPU else ['html','canvas2d']):
            self.page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"],text:"native"})',backend)
            self.assertEqual(self.page.evaluate('vb6Studio.rendering.backend'),backend)
            for scheme in ['light','dark']:
                self.page.evaluate('scheme=>vb6Studio.figmaMode.configure({mode:"figma",scheme})',scheme)
                self.assert_source_pixels('code-'+backend+'-'+scheme,(23,80,173) if scheme=='light' else (145,183,255))
                self.assertEqual(self.page.evaluate('vb6Studio.rendering.backend'),backend)
        # Rendering policy is IDE-only. Neither mode nor colors edit the source.
        self.assertEqual(before,self.snapshot());self.done()

    def test_typing_undo_selection_and_split_share_real_source(self):
        self.enable();self.open_code();before=self.page.evaluate('vb6Studio.activeModule.code')
        source=self.page.get_by_role('textbox',name='Visual Basic source code',exact=True)
        source.click();source.press('Control+End');self.page.keyboard.insert_text("' Zażółć 😀\n")
        self.assertTrue(self.page.evaluate('vb6Studio.activeModule.code').endswith("' Zażółć 😀\n"))
        self.page.get_by_role('button',name='Undo',exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.code'),before)
        self.page.get_by_role('button',name='Split code editor',exact=True).click()
        lower=self.page.get_by_role('textbox',name='Visual Basic source code, lower pane',exact=True)
        expect(lower).to_be_visible();lower.click();lower.press('Control+End');self.page.keyboard.insert_text("' split edit\n")
        self.assertEqual(source.input_value(),lower.input_value())
        self.assertEqual(lower.input_value(),self.page.evaluate('vb6Studio.activeModule.code'))
        self.page.get_by_role('button',name='Split code editor',exact=True).click();expect(lower).to_have_count(0)
        self.done()

    def test_outline_live_search_goto_and_form_context(self):
        self.page.evaluate('vb6Studio.editor.setValue(vb6Studio.activeModule.code+"\\nPrivate Function Compute() As Long\\n    Compute = 42\\nEnd Function\\n")')
        self.enable();self.open_code()
        expect(self.page.locator('[data-layer-id="button"]')).to_be_visible()
        search=self.page.get_by_label('Search code outline',exact=True);search.fill('Compute function')
        option=self.page.get_by_role('option',name='Compute — Function — line 6',exact=True)
        expect(option).to_be_visible();option.click()
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'),6)
        self.page.get_by_label('Code view mode',exact=True).select_option('procedure')
        text=self.page.get_by_role('textbox',name='Visual Basic source code',exact=True).input_value()
        self.assertIn('Function Compute',text);self.assertNotIn('Sub Command1_Click',text)
        self.page.get_by_label('Code view mode',exact=True).select_option('module')
        self.page.get_by_label('Go to code line',exact=True).fill('3');self.page.get_by_role('button',name='Go to line',exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'),3)
        self.page.locator('[data-layer-id="text"]').click()
        self.assertEqual(self.page.evaluate('vb6Studio.activeDoc.view'),'form')
        self.assertEqual(self.page.evaluate('[...vb6Studio.designer.selection]'),['text']);self.done()

    def test_code_find_line_numbers_and_classic_restoration(self):
        self.enable();self.open_code()
        self.page.get_by_role('button',name='Find in code',exact=True).click()
        expect(self.page.locator('.mdi-active .editor-find')).to_be_visible()
        self.page.get_by_label('Code line numbers',exact=True).check()
        self.assertTrue(self.page.evaluate('vb6Studio.project.settings.lineNumbers'))
        self.assertTrue(self.page.evaluate('vb6Studio.editor.showLineNumbers'))
        source=self.page.get_by_role('textbox',name='Visual Basic source code',exact=True)
        source.focus();source.press('Control+Home');source.press('Shift+ArrowRight')
        bounds=self.page.evaluate('vb6Studio.editor.selectionBounds()')
        before=self.page.evaluate('vb6Studio.activeModule.code')
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.selectionBounds()'),bounds)
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.code'),before)
        self.assertEqual(self.source_metrics()['input'],self.source_metrics()['syntax'])
        self.assertEqual(self.page.locator('.figma-code-inspector').count(),0);self.done()

    def test_real_content_appearance_typography_and_single_transaction_font(self):
        self.enable();self.select(['button'])
        for key in ['Caption','BackColor','ForeColor','FontName','FontSize','FontBold']:
            expect(self.property(key)).to_be_visible()
        self.change(self.property('Caption'),'Save now');self.assertEqual(self.props('button')['Caption'],'Save now')
        self.change(self.property('BackColor'),'#123456');self.assertEqual(self.props('button')['BackColor'],0x563412)
        self.property('FontBold').select_option('-1');self.assertEqual(self.props('button')['FontBold'],-1)
        before=self.props('button');count=self.page.evaluate('vb6Studio.history.undoStack.length')
        self.page.get_by_role('button',name='Edit Font',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Font',exact=True)
        dialog.get_by_label('Font name',exact=True).fill('Courier New');dialog.get_by_label('Font size',exact=True).fill('12')
        dialog.get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(self.props('button')['FontName'],'Courier New');self.assertEqual(self.props('button')['FontSize'],12)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),count+1)
        self.page.get_by_role('button',name='Undo',exact=True).click();self.assertEqual(self.props('button'),before)
        self.page.screenshot(path=str(REPORT/'expanded-properties.png'));self.done()

    def test_property_search_expand_collapse_and_keyboard(self):
        self.enable();self.select(['button'])
        search=self.page.get_by_label('Search VB6 properties',exact=True)
        search.fill('appearance color');expect(self.property('BackColor')).to_be_visible();expect(self.property('ForeColor')).to_be_visible()
        expect(self.property('Caption')).to_have_count(0)
        search.press('Enter');self.assertEqual(self.page.evaluate('document.activeElement.dataset.property'),'BackColor')
        search.fill('no such field');expect(self.page.get_by_text('No matching properties.',exact=True)).to_be_visible()
        search.press('Escape');expect(self.property('Caption')).to_be_visible()
        self.page.get_by_role('button',name='Collapse property sections',exact=True).click()
        expect(self.property('Caption')).not_to_be_visible()
        self.section('content').locator('summary').press('Enter');expect(self.property('Caption')).to_be_visible()
        self.page.get_by_role('button',name='Expand property sections',exact=True).click();expect(self.property('Enabled')).to_be_visible()
        self.done()

    def test_mixed_values_bulk_edit_and_enum_undo(self):
        self.enable();self.select(['button','text'])
        self.assertEqual(self.property('BackColor').input_value(),'')
        self.assertEqual(self.property('BackColor').get_attribute('aria-description'),'Multiple different values')
        before=self.snapshot();self.change(self.property('BackColor'),'#abcdef')
        for id in ['button','text']:self.assertEqual(self.props(id)['BackColor'],0xefcdab)
        self.page.get_by_role('button',name='Undo',exact=True).click();self.assertEqual(self.snapshot(),before)
        self.page.get_by_label('Search VB6 properties',exact=True).fill('Enabled');self.property('Enabled').select_option('0')
        for id in ['button','text']:self.assertEqual(self.props(id)['Enabled'],0)
        self.done()

    def test_invalid_numeric_and_escape_do_not_mutate_model(self):
        self.enable();self.select(['button']);before=self.snapshot()
        self.change(self.property('FontSize'),'not a number')
        dialog=self.page.get_by_role('dialog',name='Invalid property value',exact=True);expect(dialog).to_be_visible()
        self.assertEqual(self.snapshot(),before);dialog.get_by_role('button',name='OK',exact=True).click()
        self.property('Caption').fill('discard');self.property('Caption').press('Escape');self.assertEqual(self.snapshot(),before)
        self.done()

    def test_stale_dialog_selection_and_readonly_edits_are_rejected(self):
        self.enable();self.select(['button']);before=self.props('button')
        self.page.get_by_role('button',name='Edit Caption',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Caption - Command1',exact=True);dialog.get_by_label('Property text').fill('stale')
        self.page.evaluate('vb6Studio.designer.select(["text"])')
        dialog.get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(self.props('button'),before);self.assertNotIn('Caption',self.props('text'))
        self.page.evaluate('vb6Studio.designer.locked=true;vb6Studio.inspector.render();vb6Studio.updateCommandState()')
        expect(self.property('Text')).to_be_disabled()
        self.page.evaluate('vb6Studio.designer.locked=false;vb6Studio.runState="running";vb6Studio.inspector.render()')
        expect(self.property('Text')).to_be_disabled();self.page.evaluate('vb6Studio.runState="design"');self.done()

    def test_timer_binding_and_window_properties_are_real(self):
        self.enable();self.select(['timer']);search=self.page.get_by_label('Search VB6 properties',exact=True)
        search.fill('Interval');self.change(self.property('Interval'),125);self.assertEqual(self.props('timer')['Interval'],125)
        self.select(['text']);search.fill('DataField');self.change(self.property('DataField'),'CustomerName');self.assertEqual(self.props('text')['DataField'],'CustomerName')
        self.select([]);search.fill('WindowState');self.property('WindowState').select_option('2')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.form.properties.WindowState'),2);self.done()

    def test_list_dialog_and_palette_keep_canonical_values(self):
        self.enable();self.page.evaluate('vb6Studio.addControl("ListBox")');self.page.wait_for_function('vb6Studio.inspector.targets[0].type==="ListBox"')
        self.page.get_by_role('button',name='Edit List',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='List - ListBox1',exact=True)
        dialog.get_by_label('Property text').fill('Alpha\nBeta\nZażółć');dialog.get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].properties.List'),['Alpha','Beta','Zażółć'])
        self.page.get_by_role('button',name='Edit BackColor',exact=True).click()
        palette=self.page.get_by_role('dialog',name='Color palette',exact=True);palette.get_by_role('tab',name='Palette',exact=True).click()
        palette.get_by_role('option',name='&H000000FF&',exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.designer.selected()[0].properties.BackColor'),255);self.done()

    def test_module_switch_drops_old_outline_and_restores_classic_grid(self):
        self.enable();self.open_code()
        self.page.evaluate('()=>{const p=VB6StudioAPI.newProject("Other"),m=p.modules[0];m.code="Option Explicit\\nPrivate Sub OtherEvent()\\nEnd Sub\\n";vb6Studio.loadProject(p);vb6Studio.openDocument(m.id,"code");}')
        expect(self.page.get_by_role('option',name='OtherEvent — Sub — line 2',exact=True)).to_be_visible()
        expect(self.page.get_by_role('option',name='Command1_Click — Sub — line 2',exact=True)).to_have_count(0)
        self.page.get_by_role('button',name='Open form designer',exact=True).click()
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertTrue(self.page.evaluate('vb6Studio.inspector.wrapper.parentNode===vb6Studio.propertiesPanel'))
        self.assertEqual(self.page.evaluate('vb6Studio.inspector.presentation??null'),None)
        expect(self.page.get_by_label('Selected object',exact=True)).to_be_visible();self.done()


    def test_code_actions_bookmarks_breakpoints_and_readonly(self):
        self.enable();self.open_code()
        self.page.get_by_label('Go to code line',exact=True).fill('3')
        self.page.get_by_role('button',name='Go to line',exact=True).click()
        self.page.get_by_role('button',name='Toggle code bookmark',exact=True).click()
        self.assertIn(3,self.page.evaluate('vb6Studio.activeModule.bookmarks'))
        self.page.get_by_role('button',name='Toggle code breakpoint',exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.breakpoints[0].line'),3)
        before=self.page.evaluate('vb6Studio.activeModule.code')
        self.page.get_by_role('button',name='Comment selection',exact=True).click()
        self.assertNotEqual(before,self.page.evaluate('vb6Studio.activeModule.code'))
        self.page.get_by_role('button',name='Undo',exact=True).click()
        self.assertEqual(before,self.page.evaluate('vb6Studio.activeModule.code'))
        self.page.evaluate('vb6Studio.editor.setReadOnly(true);vb6Studio.figmaMode.sync()')
        expect(self.page.get_by_role('button',name='Comment selection',exact=True)).to_be_disabled()
        expect(self.page.get_by_role('button',name='Format module',exact=True)).to_be_disabled()
        self.page.evaluate('vb6Studio.editor.setReadOnly(false)');self.done()

    def test_custom_editor_appearance_survives_workspace_and_split(self):
        self.page.evaluate('Object.assign(vb6Studio.appearance,{editorFont:"monospace",editorSize:18,codeColors:{keyword:"#bb4488",background:"#fafafa"}});vb6Studio.applyAppearance()')
        self.enable();self.open_code()
        self.assert_source_pixels('custom-code-appearance',(187,68,136))
        self.assertEqual(self.source_metrics()['input']['fontSize'],'18px')
        self.page.get_by_role('button',name='Split code editor',exact=True).click()
        data=self.page.locator('.mdi-active .source-editor').evaluate('n=>[...n.querySelectorAll(".source-input,.syntax-layer")].map(e=>[getComputedStyle(e).font,getComputedStyle(e).padding])')
        self.assertEqual(len(data),4);self.assertTrue(all(value==data[0] for value in data))
        self.done()

    def test_outline_is_windowed_for_large_modules(self):
        self.page.evaluate('vb6Studio.editor.setValue(Array.from({length:500},(_,i)=>"Private Sub P"+i+"()\\nEnd Sub").join("\\n"))')
        self.enable();self.open_code()
        self.assertLess(self.page.locator('.figma-code-symbol').count(),40)
        self.page.get_by_label('Search code outline',exact=True).fill('P499')
        expect(self.page.locator('.figma-code-symbol')).to_have_count(1)
        self.page.locator('.figma-code-symbol').click()
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'),999);self.done()


def load_tests(loader, standard_tests, pattern):
    names=['test_source_overlay_does_not_cover_highlighted_code'] if REQUIRED_GPU else [name for name in sorted(EditorProperties.__dict__) if name.startswith('test_')]
    return unittest.TestSuite(EditorProperties(name) for name in names)

if __name__ == '__main__':
    unittest.main(verbosity=2)

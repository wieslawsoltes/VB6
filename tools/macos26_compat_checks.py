"""macOS 26 compatibility acceptance through real controls, VB handlers and IDE.

Mixed into the application-theme runner so normal browser CI executes these
checks. The source fixture is owned; no Figma credentials or Apple assets are used.
"""
import json
from pathlib import Path
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'reports/application-themes/fixtures'


class MacOS26CompatibilityChecks:
    def macos26_runtime(self):
        self.load(FIXTURE / 'macos26-compat.html')
        self.page.wait_for_function('globalThis.vb6Application?.forms?.[0]?.controls?.length === 12')
        self.page.evaluate('''() => {
            window.compatControls=Object.fromEntries(vb6Application.forms[0].controls.map(c=>[c.model.name,c]));
            window.compatIdentity=vb6Application.forms[0].controls.map(c=>({control:c,node:c.node,input:c.input}));
        }''')
        return self.page

    def macos26_set(self, name, values):
        self.page.evaluate('([name,values])=>{const c=compatControls[name];for(const [key,value] of Object.entries(values))c.set(key,value);}', [name, values])

    def macos26_ide(self, xaml=False):
        ide = self.open_ide()
        project = json.loads((FIXTURE / 'macos26-compat.json').read_text())
        project['settings'].update(xaml=xaml, anchoring=xaml)
        if xaml:
            project['modules'][0]['code'] = ('Option Explicit\nPrivate Sub Save_Click()\n'
                '    ActionStatus.Caption = "saved:" & Search.Text & ":" & CStr(Notifications.Value)\nEnd Sub\n')
        ide.evaluate('p=>vb6Studio.loadProject(p)', project)
        return ide

    def macos26_import(self, ide):
        source = (FIXTURE / 'macos26-compat.xaml').read_text()
        ide.evaluate('vb6Studio.xaml.open() && true')
        with ide.expect_file_chooser() as chooser:
            ide.locator('[data-xaml-action="import"]').click()
        chooser.value.set_files({'name':'Form1.xaml','mimeType':'application/xml','buffer':source.encode()})
        expect(ide.locator('.xaml-input')).to_have_value(source)
        expect(ide.locator('.xaml-problems button')).to_have_count(0)
        return source

    def test_macos26_search_clear_escape_composition_disabled_and_readonly(self):
        page = self.macos26_runtime()
        search = page.get_by_role('searchbox', name='Search settings', exact=True)
        clear = page.locator('[data-control="Search"] .macos26-search-clear')
        status = page.locator('[data-control="SearchStatus"]')
        cancel = page.locator('[data-control="CancelStatus"]')
        search.fill('Keyboard search')
        expect(status).to_have_text('1:Keyboard search')
        search.press('Escape')
        expect(search).to_have_value('')
        expect(status).to_have_text('2:')
        expect(cancel).to_have_text('cancel 0')
        expect(search).to_be_focused()
        expect(clear).to_be_hidden()
        search.press('Escape')
        expect(cancel).to_have_text('cancel 1')
        search.fill('Pointer search')
        expect(status).to_have_text('3:Pointer search')
        clear.click()
        expect(status).to_have_text('4:')
        expect(search).to_have_value('')
        expect(search).to_be_focused()
        expect(clear).to_be_hidden()

        search.fill('日本語')
        expect(status).to_have_text('5:日本語')
        # Playwright cannot drive the platform IME. Dispatch its DOM composition
        # state and legacy 229 signal through the real input/form key handlers.
        search.evaluate('''e=>{
            e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'日本語'}));
            for(const key of ['Escape','Enter']){
                const composing=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,isComposing:true});
                const legacy=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,keyCode:229});
                if(!composing.isComposing||legacy.keyCode!==229||legacy.isComposing)
                    throw new Error('This browser did not construct the distinct IME regression signals');
                e.dispatchEvent(composing);
                e.dispatchEvent(legacy);
            }
            e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語'}));
        }''')
        page.wait_for_function('!vb6Application.vm.processing&&vb6Application.vm.eventQueue.length===0',polling=100)
        expect(search).to_have_value('日本語')
        expect(status).to_have_text('5:日本語')
        expect(cancel).to_have_text('cancel 1')
        expect(page.locator('[data-control="ActionStatus"]')).to_have_text('Not saved')
        search.press('Enter')
        expect(page.locator('[data-control="ActionStatus"]')).to_have_text('saved:日本語')
        self.macos26_set('Search', {'Enabled':0})
        expect(search).to_be_disabled()
        expect(clear).to_be_disabled()
        clear.evaluate('e=>e.click()')
        expect(status).to_have_text('5:日本語')
        self.macos26_set('Search', {'Enabled':-1, 'Locked':-1})
        expect(search).to_be_enabled()
        self.assertTrue(search.evaluate('e=>e.readOnly'))
        expect(clear).to_be_disabled()
        search.press('Escape')
        clear.evaluate('e=>e.click()')
        expect(search).to_have_value('日本語')
        expect(status).to_have_text('5:日本語')
        self.macos26_set('Search', {'Locked':0})
        expect(clear).to_be_enabled()
        search.press('Escape')
        expect(status).to_have_text('6:')
        self.record('macOS search emits one VB Change per clear, owns nonempty Escape, preserves IME text and respects disabled/read-only state')

    def test_macos26_palette_and_style_edits_preserve_input_selection_and_identity(self):
        page = self.macos26_runtime()
        search = page.locator('[data-control="Search"] input')
        search.fill('Retained search value')
        search.evaluate('e=>{e.focus();e.setSelectionRange(2,9,"backward");}')
        bounds = search.locator('..').bounding_box()
        saved = page.evaluate('JSON.stringify(vb6Application.project)')
        for theme in ('macos26-dark','classic','fluent','macos26'):
            self.theme(theme, {'reduceMotion':True})
            for style, size in (('automatic','mini'),('search','extraLarge')):
                self.macos26_set('Search', {'MacOSControlStyle':style,'MacOSControlSize':size})
                expect(search).to_have_attribute('role','searchbox') if style == 'search' else expect(search).not_to_have_attribute('role','searchbox')
                self.assertEqual(search.input_value(),'Retained search value')
                self.assertEqual(search.evaluate('e=>[e.selectionStart,e.selectionEnd,e.selectionDirection]'),[2,9,'backward'])
                expect(search).to_be_focused()
                self.assertEqual(search.locator('..').bounding_box(),bounds)
                self.assertTrue(page.evaluate('compatIdentity.every((v,i)=>v.control===vb6Application.forms[0].controls[i]&&v.node===v.control.node&&v.input===v.control.input)'))
                self.assertEqual(page.locator('[data-control="Search"] .macos26-search-clear').count(),1)
                self.assertEqual(page.locator('[data-control="Search"] .macos26-search-icon').count(),1)
                if style == 'automatic':
                    expect(page.locator('[data-control="Search"] .macos26-search-clear')).to_be_hidden()
            self.assertEqual(page.evaluate('JSON.stringify(vb6Application.project)'),saved)
        expect(page.locator('[data-control="SearchStatus"]')).to_have_text('1:Retained search value')
        self.record('macOS style, size and application theme changes retain the same control/input, focus, range direction and authored project')

    def test_macos26_semantic_colors_remain_live_and_explicit_same_color_unbinds(self):
        page = self.macos26_runtime()
        field = page.locator('[data-control="SemanticText"] input')
        for theme, foreground, background in (
            ('macos26','rgb(107, 107, 107)','rgb(255, 255, 255)'),
            ('macos26-dark','rgb(163, 163, 163)','rgb(30, 30, 30)'),
            ('classic','rgb(17, 34, 51)','rgb(68, 85, 102)'),
            ('macos26','rgb(107, 107, 107)','rgb(255, 255, 255)')):
            self.theme(theme, {'reduceMotion':True})
            expect(field).to_have_css('color',foreground)
            expect(field).to_have_css('background-color',background)
        # The numeric fallback is unchanged. Explicit assignment must still
        # remove the live binding, and must not remove the other paint binding.
        self.macos26_set('SemanticText', {'ForeColor':0x00332211})
        expect(field).to_have_css('color','rgb(17, 34, 51)')
        expect(field).to_have_css('background-color','rgb(255, 255, 255)')
        self.assertEqual(page.evaluate('compatControls.SemanticText.get("MacOSForegroundRole")'),'')
        self.assertEqual(page.evaluate('compatControls.SemanticText.get("MacOSBackgroundRole")'),'textBackgroundColor')
        self.macos26_set('SemanticText', {'BackColor':0x00665544})
        for theme in ('macos26-dark','classic','macos26'):
            self.theme(theme, {'reduceMotion':True})
            expect(field).to_have_css('color','rgb(17, 34, 51)')
            expect(field).to_have_css('background-color','rgb(68, 85, 102)')
        self.assertEqual(page.evaluate('compatControls.SemanticText.get("MacOSBackgroundRole")'),'')
        self.record('semantic roles track light/dark and Classic fallback; same-value explicit OLE edits remove each binding independently')

    def test_macos26_nested_semantic_scope_is_independent_of_parent_palette(self):
        page = self.macos26_runtime()
        page.evaluate('''()=>{
            const api=VB6Runtime.RuntimeAPI,model=structuredClone(vb6Application.project.modules[0].form);
            model.controls=model.controls.filter(c=>c.name==='SemanticText');model.id='nested-macos26';
            Object.assign(model.properties,{ClientWidth:5700,ClientHeight:1800,Left:0,Top:0});
            Object.assign(model.controls[0].properties,{Left:180,Top:180});
            const node=document.createElement('section');node.id='macos26-nested';
            node.style.cssText='position:absolute;left:840px;top:20px;width:420px;height:200px';
            document.querySelector('#app').append(node);
            const controller=new api.ApplicationThemeController(node);controller.apply({theme:'classic'});
            const form=new api.BrowserForm(model,{design:true,backend:'canvas2d'});node.append(form.node);
            window.compatNested={node,controller,form};
        }''')
        nested = page.locator('#macos26-nested [data-control="SemanticText"] input')
        outer = page.locator('.vb-app-stage [data-control="SemanticText"] input')
        try:
            for theme, foreground in (('macos26-dark','rgb(163, 163, 163)'),('macos26','rgb(107, 107, 107)')):
                self.theme(theme, {'reduceMotion':True})
                expect(nested).to_have_css('color','rgb(17, 34, 51)')
                expect(nested).to_have_css('background-color','rgb(68, 85, 102)')
                expect(outer).to_have_css('color',foreground)
            page.evaluate('compatNested.controller.apply({theme:"macos26-dark",reduceMotion:true})')
            expect(nested).to_have_css('color','rgb(163, 163, 163)')
            expect(nested).to_have_css('background-color','rgb(30, 30, 30)')
            self.theme('classic')
            expect(outer).to_have_css('color','rgb(17, 34, 51)')
            expect(nested).to_have_css('color','rgb(163, 163, 163)')
            self.assertEqual(page.locator('#app').get_attribute('data-vb-theme'),'classic')
        finally:
            page.evaluate('compatNested.form.dispose();compatNested.controller.dispose();compatNested.node.remove()')
        self.record('nested Classic and dark macOS semantic colors stop at their own application roots')

    def test_macos26_accessibility_switch_default_button_and_indeterminate_progress(self):
        page = self.macos26_runtime()
        search = page.get_by_role('searchbox', name='Search settings', exact=True)
        expect(search).to_have_attribute('placeholder','Filter settings')
        expect(search).to_have_attribute('aria-description','Type a setting name. Escape clears the search.')
        expect(page.locator('[data-control="Search"]')).to_have_attribute('data-macos-accessibility-identifier','settings-search')
        toggle = page.get_by_role('switch', name='Enable notifications', exact=True)
        expect(toggle).to_be_checked()
        toggle.press('Space')
        expect(toggle).not_to_be_checked()
        expect(toggle).to_have_attribute('aria-checked','false')
        expect(page.locator('[data-control="ToggleStatus"]')).to_have_text('0')
        search.fill('Keyboard default')
        search.press('Enter')
        expect(page.locator('[data-control="ActionStatus"]')).to_have_text('saved:Keyboard default')
        self.assertEqual(page.evaluate('compatControls.Save.Default'),0,'default appearance supplies form keyboard behavior')
        progress = page.get_by_role('progressbar', name='Import progress', exact=True)
        expect(progress).to_have_attribute('aria-description','Waiting for the next file')
        expect(progress).to_have_attribute('aria-valuemin','0')
        expect(progress).to_have_attribute('aria-valuemax','100')
        self.assertIsNone(progress.get_attribute('aria-valuenow'))
        fill = progress.locator('.vb-progress-fill')
        expect(fill).to_have_css('animation-name','none')
        self.assertGreater(fill.bounding_box()['width'],0,'reduced motion keeps a visible indeterminate indicator')
        self.assertLess(fill.bounding_box()['width'],progress.bounding_box()['width'])
        self.theme('macos26', {'reduceMotion':False})
        expect(fill).to_have_css('animation-name','macos26-progress')
        page.emulate_media(reduced_motion='reduce')
        expect(fill).to_have_css('animation-name','none')
        page.emulate_media(reduced_motion='no-preference')
        self.theme('macos26', {'reduceMotion':True})
        expect(fill).to_have_css('animation-name','none')
        indicator, track = fill.bounding_box(), fill.locator('..').bounding_box()
        self.assertAlmostEqual(indicator['x']+indicator['width']/2,track['x']+track['width']/2,delta=1,
                               msg='reduced-motion indeterminate fill rests at the middle of its real track')
        self.macos26_set('Progress', {'MacOSIndeterminate':0})
        expect(progress).to_have_attribute('aria-valuenow','42')
        self.assertAlmostEqual(fill.bounding_box()['width']/progress.bounding_box()['width'],0.42,delta=0.02)
        search = page.locator('[data-control="Search"] input')
        self.macos26_set('Search', {'MacOSAccessibilityLabel':'','MacOSAccessibilityHelp':'','MacOSAccessibilityIdentifier':'','PlaceholderText':'New filter'})
        expect(search).to_have_attribute('aria-label','Search')
        self.assertIsNone(search.get_attribute('aria-description'))
        self.assertIsNone(page.locator('[data-control="Search"]').get_attribute('data-macos-accessibility-identifier'))
        expect(search).to_have_attribute('placeholder','New filter')
        self.record('accessible search, switch keyboard event, default button Enter and progress determinate/indeterminate semantics remain usable')

    def test_macos26_invalid_runtime_appearance_is_rejected_before_mutation(self):
        page = self.macos26_runtime()
        results = page.evaluate('''()=>[
            ['Save','MacOSControlStyle','search'],['Search','MacOSMaterial','sidebar'],
            ['SemanticText','MacOSForegroundRole','unknownRole'],['Notifications','Value',2],
            ['Search','MacOSIndeterminate',-1],['Search','MultiLine',-1]
        ].map(([name,key,value])=>{
            const c=compatControls[name],before=JSON.stringify(c.props);let message='';
            try{c.set(key,value)}catch(error){message=error.message}
            return {name,key,message,unchanged:before===JSON.stringify(c.props)};
        })''')
        for result in results:
            self.assertTrue(result['message'],result)
            self.assertTrue(result['unchanged'],result)
        expect(page.get_by_role('switch', name='Enable notifications', exact=True)).to_be_checked()
        expect(page.get_by_role('searchbox', name='Search settings', exact=True)).to_have_value('Ready')
        self.record('invalid target styles, roles, mixed switches, indeterminate targets and multiline searches fail atomically')

    def test_macos26_inspector_enums_same_ole_edit_and_undo(self):
        ide = self.macos26_ide()
        ide.get_by_label('Selected object', exact=True).select_option('macos26-Search')
        size = ide.locator('select[data-property="MacOSControlSize"]')
        self.assertEqual(size.locator('option').evaluate_all('nodes=>nodes.map(n=>n.value)'),['mini','small','regular','large','extraLarge'])
        size.select_option('extraLarge')
        style = ide.locator('select[data-property="MacOSControlStyle"]')
        self.assertEqual(style.locator('option').evaluate_all('nodes=>nodes.map(n=>n.value)'),['automatic','search'])
        style.select_option('automatic')
        self.assertEqual(ide.evaluate('(()=>{const p=vb6Studio.activeModule.form.controls.find(c=>c.name==="Search").properties;return [p.MacOSControlSize,p.MacOSControlStyle];})()'),['extraLarge','automatic'])
        style.select_option('search')
        ide.get_by_label('Selected object', exact=True).select_option('macos26-SemanticText')
        foreground = ide.locator('input[data-property="ForeColor"]')
        original_number = ide.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.name==="SemanticText").properties.ForeColor')
        self.assertEqual(original_number,0x00332211)
        # A different textual spelling triggers a real change event while the
        # parsed OLE color is exactly equal to the stored fallback.
        foreground.fill(str(original_number))
        foreground.press('Enter')
        self.assertEqual(ide.evaluate('(()=>{const p=vb6Studio.activeModule.form.controls.find(c=>c.name==="SemanticText").properties;return [p.ForeColor,p.MacOSForegroundRole||"",p.MacOSBackgroundRole];})()'),[original_number,'','textBackgroundColor'])
        preview = ide.locator('.designer-form [data-control="SemanticText"] input')
        expect(preview).to_have_css('color','rgb(17, 34, 51)')
        ide.evaluate('()=>{void vb6Studio.command("undo");}')
        expect(ide.locator('select[data-property="MacOSForegroundRole"]')).to_have_value('secondaryLabelColor')
        expect(preview).to_have_css('color','rgb(107, 107, 107)')
        self.options(ide)
        dialog = ide.get_by_role('dialog', name='Options', exact=True)
        dialog.get_by_label('Application theme', exact=True).select_option('macos26-dark')
        dialog.get_by_role('button', name='OK', exact=True).click()
        expect(preview).to_have_css('color','rgb(163, 163, 163)')
        self.record('Inspector preserves string enums, same-OLE edits remove live roles, Undo restores them and designer follows app appearance')

    def test_macos26_xaml_import_designer_save_reload_and_run_real_alias_controls(self):
        ide = self.macos26_ide(xaml=True)
        self.macos26_import(ide)
        types = ide.evaluate('Object.fromEntries(vb6Studio.activeModule.form.controls.map(c=>[c.name,c.type]))')
        for name, kind in {'Layout':'PictureBox','Content':'PictureBox','Navigation':'TreeView','Search':'TextBox','Secret':'TextBox','Notifications':'CheckBox','Choices':'ComboBox','Counter':'UpDown','Meeting':'DTPicker','Progress':'ProgressBar','Pages':'SSTab','Save':'CommandButton'}.items():
            self.assertEqual(types[name],kind,name)
        self.assertNotIn('MenuItem',types.values())
        self.assertNotIn('TabItem',types.values())
        search_id = ide.evaluate('vb6Studio.activeModule.form.controls.find(c=>c.name==="Search").id')
        ide.get_by_label('Selected object', exact=True).select_option(search_id)
        placeholder = ide.locator('input[data-property="PlaceholderText"]')
        placeholder.fill('Find preferences');placeholder.press('Enter')
        ide.locator('select[data-property="MacOSControlSize"]').select_option('extraLarge')
        ide.locator('select[data-property="MacOSForegroundRole"]').select_option('labelColor')
        source = ide.locator('.xaml-input').input_value()
        self.assertIn('<mac:SearchField',source)
        self.assertIn('PlaceholderString="Find preferences"',source)
        self.assertIn('ControlSize="extraLarge"',source)
        self.assertIn('Foreground="{ThemeResource macOS.labelColor}"',source)
        self.assertIn('<!-- Keep this authored macOS vocabulary',source)
        self.assertNotIn('previousText',ide.evaluate('JSON.stringify(vb6Studio.activeModule.xaml)'))
        with ide.expect_download() as source_download:
            ide.locator('[data-xaml-action="download"]').click()
        self.assertEqual(Path(source_download.value.path()).read_text(),source)
        with ide.expect_download() as project_download:
            ide.locator('.xaml-input').press('Control+s')
        saved = json.loads(Path(project_download.value.path()).read_text())
        self.assertTrue(project_download.value.suggested_filename.endswith('.vb6web'))
        self.assertEqual(saved['modules'][0]['xaml']['appliedText'],source)
        ide.evaluate('p=>vb6Studio.loadProject(p)',saved)
        ide.evaluate('vb6Studio.xaml.open() && true')
        expect(ide.locator('.xaml-input')).to_have_value(source)
        expect(ide.locator('.xaml-problems button')).to_have_count(0)
        ide.locator('.xaml-input').press('F5')
        iframe = ide.locator('iframe[title="Running Visual Basic application"]').element_handle()
        frame = iframe.content_frame()
        frame.wait_for_function('globalThis.vb6Application?.forms?.length === 1')
        search = frame.get_by_role('searchbox', name='Search settings', exact=True)
        expect(search).to_have_attribute('placeholder','Find preferences')
        expect(frame.locator('[data-control="Secret"] input')).to_have_attribute('type','password')
        expect(frame.locator('[data-control="Meeting"] input')).to_have_value('2026-10-16')
        self.assertIsNone(frame.get_by_role('progressbar', name='Import progress', exact=True).get_attribute('aria-valuenow'))
        choices = frame.locator('[data-control="Choices"] input')
        expect(choices).to_have_value('Dark')
        frame.locator('[data-control="Choices"] .vb-combo-arrow').click()
        choices.press('End');choices.press('Enter')
        expect(choices).to_have_value('System')
        stepper = frame.locator('[data-control="Counter"][role="spinbutton"]')
        stepper.press('ArrowUp')
        expect(stepper).to_have_attribute('aria-valuenow','4')
        pages = frame.locator('[data-control="Pages"]')
        pages.get_by_role('tab', name='Advanced', exact=True).click()
        expect(frame.locator('[data-control="AdvancedPage"]')).to_be_visible()
        expect(frame.locator('[data-control="GeneralPage"]')).to_be_hidden()
        notifications = frame.get_by_role('switch', name='Enable notifications', exact=True)
        notifications.press('Space')
        expect(notifications).not_to_be_checked()
        search.fill('User change')
        frame.get_by_role('button', name='Save preferences', exact=True).click()
        expect(frame.locator('[data-control="ActionStatus"]')).to_have_text('saved:User change:0')
        self.assertEqual(frame.evaluate('vb6Application.forms[0].controls.find(c=>c.model.name==="Search").get("MacOSForegroundRole")'),'labelColor')
        ide.evaluate('()=>vb6Studio.stop(false)')
        self.record('macOS XAML file import, typed controls, alias-preserving Inspector edits, downloaded source/project, reload and real runtime events')

    def test_macos26_xaml_invalid_style_keeps_last_form_and_blocks_run(self):
        ide = self.macos26_ide(xaml=True)
        source = self.macos26_import(ide)
        before = ide.evaluate('JSON.stringify(vb6Studio.activeModule.form)')
        bad = source.replace('<mac:SearchField ', '<mac:SearchField ControlStyle="push" ',1)
        ide.locator('.xaml-input').fill(bad)
        expect(ide.locator('.xaml-problems')).to_contain_text('MacOSControlStyle')
        self.assertEqual(ide.evaluate('JSON.stringify(vb6Studio.activeModule.form)'),before)
        self.assertEqual(ide.evaluate('vb6Studio.activeModule.xaml.appliedText'),source)
        ide.locator('.xaml-input').press('F5')
        dialog = ide.get_by_role('dialog',name='XAML',exact=True)
        expect(dialog).to_be_visible()
        dialog.get_by_role('button',name='OK',exact=True).click()
        self.assertEqual(ide.evaluate('vb6Studio.runState'),'design')
        expect(ide.locator('.xaml-input')).to_have_value(bad)
        self.record('invalid macOS target/style combination retains the last valid form and prevents running an unapplied draft')

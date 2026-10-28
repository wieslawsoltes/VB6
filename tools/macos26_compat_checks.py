"""macOS 26 compatibility acceptance through real controls, VB handlers and IDE.

Mixed into the application-theme runner so normal browser CI executes these
checks. The source fixture is owned; no Figma credentials or Apple assets are used.
"""
import io
import json
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import expect
from stable_pixels import capture_stable_pixels

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'reports/application-themes/fixtures'


class MacOS26CompatibilityChecks:
    def macos26_runtime(self):
        self.load(FIXTURE / 'macos26-compat.html')
        self.page.wait_for_function('globalThis.vb6Application?.forms?.[0]?.controls?.length === 19')
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
                '    ActionStatus.Caption = "saved:" & Search.Text & ":" & CStr(Notifications.Value)\nEnd Sub\n'
                'Private Sub Sections_ButtonClick(ByVal Button As Object)\n'
                '    ActionStatus.Caption = "section:" & Button.Key & ":" & CStr(Button.Value)\nEnd Sub\n')
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
        geometry = search.evaluate('''input=>{
            const style=getComputedStyle(input),rect=input.getBoundingClientRect();
            const icon=input.parentElement.querySelector('.macos26-search-icon').getBoundingClientRect();
            return {padding:style.padding,expectedPadding:style.getPropertyValue('--macos26-SearchPadding').trim(),
                radius:style.borderRadius,expectedRadius:style.getPropertyValue('--macos26-CapsuleRadius').trim(),
                textLeft:rect.left+parseFloat(style.paddingLeft),iconRight:icon.right};
        }''')
        self.assertEqual(geometry['padding'],geometry['expectedPadding'])
        self.assertEqual(geometry['radius'],geometry['expectedRadius'])
        self.assertGreater(geometry['textLeft'],geometry['iconRight'])
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

    def test_macos26_placeholder_glyphs_preserve_disabled_and_other_palette_paint(self):
        page = self.macos26_runtime()
        self.macos26_set('Search', {'Text':''})
        self.macos26_set('Choices', {'Style':0,'ListIndex':-1,'Text':'','PlaceholderText':'Choose appearance'})
        page.evaluate('''()=>{
            const search=compatControls.Search.node;
            window.placeholderLocation={parent:search.parentNode,next:search.nextSibling};
            compatControls.Sidebar.childHost.append(search);
            document.activeElement?.blur();
        }''')
        page.mouse.move(1400,1600)
        fields = {name:page.locator(f'[data-control="{name}"] input') for name in ('Search','Choices')}

        def capture(field):
            # A disabled field can expose its final DOM state before Chromium's
            # rounded border/shadow paint settles. Stabilize each image without
            # consulting the reference; the full pixel comparison stays exact.
            return capture_stable_pixels(lambda:
                Image.open(io.BytesIO(field.screenshot(animations='disabled'))).convert('RGB'))

        def glyphs(field, color, case, rejected=None, opacity='1'):
            expect(field).to_have_value('')
            self.assertTrue(field.evaluate('e=>e.matches(":placeholder-shown")'),case)
            actual = capture(field)
            field.evaluate('e=>e.setAttribute("data-placeholder-paint-check","")')
            reference = page.add_style_tag(content='/* Independent placeholder paint reference. */')
            placeholder = field.get_attribute('placeholder')
            def reference_color(value):
                reference.evaluate('(e,css)=>{e.textContent=css;}',
                    '[data-placeholder-paint-check]::placeholder {color:'+value+'!important;opacity:'+opacity+'!important;}')
            try:
                # WebKit reports the input color for getComputedStyle(::placeholder).
                # Compare actual glyph pixels with an explicit reference on the same
                # retained field; no font, geometry, mask or tolerance is substituted.
                reference_color(color)
                expected = capture(field)
                self.assertIsNone(ImageChops.difference(actual,expected).getbbox(),case)
                field.evaluate('e=>e.placeholder=""')
                self.assertIsNotNone(ImageChops.difference(expected,capture(field)).getbbox(),case+' has painted glyphs')
                field.evaluate('(e,value)=>{e.placeholder=value;}',placeholder)
                if rejected:
                    reference_color(rejected)
                    self.assertIsNotNone(ImageChops.difference(expected,capture(field)).getbbox(),case+' rejects disabled ink')
            finally:
                field.evaluate('(e,value)=>{e.placeholder=value;e.removeAttribute("data-placeholder-paint-check");}',placeholder)
                reference.evaluate('e=>e.remove()')

        try:
            for theme, contrast in (('macos26',False),('macos26-dark',False),('macos26',True),
                                    ('macos26-dark',True),('classic',False),('fluent',False),('fluent-dark',False)):
                self.theme(theme,{'reduceMotion':True,'increaseContrast':contrast})
                for name, field in fields.items():
                    fallback = field.evaluate('''e=>{const s=getComputedStyle(e);return s.getPropertyValue('--winui-TextControlPlaceholderForeground').trim()||s.getPropertyValue('--vb-gray').trim();}''')
                    # The existing increased-contrast palette promotes secondary
                    # content to the primary control-label text role.
                    color = ({'macos26':'#272727','macos26-dark':'#dddddd'} if contrast else
                             {'macos26':'#6b6b6b','macos26-dark':'#a3a3a3'}).get(theme,fallback)
                    expect(field).to_be_enabled()
                    glyphs(field,color,f'{theme} contrast={contrast} enabled {name}',fallback if theme.startswith('macos26') else None)
                    self.macos26_set(name,{'Enabled':0})
                    expect(field).to_be_disabled()
                    glyphs(field,fallback,f'{theme} disabled {name}')
                    self.macos26_set(name,{'Enabled':-1})
                    expect(field).to_be_enabled()
                if theme.startswith('macos26'):
                    # A disabled container rejects input even though its child's
                    # own Enabled property/native input remain enabled.
                    self.macos26_set('Sidebar',{'Enabled':0})
                    page.wait_for_function('compatControls.Sidebar.node.classList.contains("disabled")')
                    expect(fields['Search']).to_be_enabled()
                    fallback = fields['Search'].evaluate('e=>getComputedStyle(e).getPropertyValue("--vb-gray").trim()')
                    glyphs(fields['Search'],fallback,f'{theme} disabled parent')
                    self.macos26_set('Sidebar',{'Enabled':-1})
                    page.wait_for_function('!compatControls.Sidebar.node.classList.contains("disabled")')
                    glyphs(fields['Search'],color,f'{theme} restored parent')
            self.theme('macos26',{'reduceMotion':True})
            page.emulate_media(forced_colors='active')
            if page.evaluate('matchMedia("(forced-colors:active)").matches'):
                for name, field in fields.items():
                    glyphs(field,'revert','forced colors enabled '+name,opacity='revert')
                    self.macos26_set(name,{'Enabled':0})
                    expect(field).to_be_disabled()
                    glyphs(field,'revert','forced colors disabled '+name,opacity='revert')
        finally:
            page.emulate_media(forced_colors='none')
            page.evaluate('''()=>{
                placeholderLocation.parent.insertBefore(compatControls.Search.node,placeholderLocation.next);
            }''')
        self.record('actual placeholder glyphs use macOS secondary ink in light/dark/increased contrast, retain disabled child/container paint, restore Classic/Fluent fallbacks and defer to forced colors')

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

    def test_macos26_borderless_picture_containers_keep_children_and_restore_borders(self):
        page = self.macos26_runtime()
        page.evaluate('''()=>{
            const parent=compatControls.Sidebar,source=compatControls.SemanticText;
            const model={...structuredClone(source.model),id:'picture-editor',name:'PictureEditor',parent:parent.model.name};
            Object.assign(model.properties,{Name:model.name,Left:180,Top:270,Width:5100,Height:1800,
                Text:'Nested editor',MultiLine:-1,MacOSForegroundRole:'',MacOSBackgroundRole:'',
                ForeColor:-2147483640,BackColor:-2147483643});
            window.pictureEditor=new VB6Runtime.RuntimeAPI.BrowserControl(model,
                {form:parent.form,vm:parent.vm,instance:parent.instance,backend:'canvas2d'});
            parent.childHost.append(pictureEditor.node);
            window.pictureIdentity={parent:parent.node,host:parent.childHost,child:pictureEditor.node,input:pictureEditor.input};
            window.pictureGeometry=[parent.props.Left,parent.props.Top,parent.props.Width,parent.props.Height,
                pictureEditor.props.Left,pictureEditor.props.Top,pictureEditor.props.Width,pictureEditor.props.Height];
        }''')
        parent = page.locator('[data-control="Sidebar"]')
        editor = parent.locator('[data-control="PictureEditor"] textarea')
        try:
            # An ordinary PictureBox retains its original default before any edit.
            expect(parent).to_have_css('border-top-width','2px')
            bounds = parent.bounding_box()
            editor.fill('Keep this text\nAcross border changes')
            editor.evaluate('e=>{e.focus();e.setSelectionRange(2,9,"backward");}')
            for theme in ('macos26','macos26-dark','classic'):
                self.theme(theme,{'reduceMotion':True})
                for style in (0,1,0):
                    self.macos26_set('Sidebar',{'BorderStyle':style})
                    for side in ('top','right','bottom','left'):
                        expect(parent).to_have_css('border-'+side+'-width','2px' if style else '0px')
                    self.assertEqual(parent.bounding_box(),bounds)
                    expect(editor).to_have_value('Keep this text\nAcross border changes')
                    expect(editor).to_be_focused()
                    self.assertEqual(editor.evaluate('e=>[e===pictureIdentity.input,e.selectionStart,e.selectionEnd,e.selectionDirection]'),[True,2,9,'backward'])
                    self.assertTrue(page.evaluate('''()=>{
                        const c=compatControls.Sidebar,e=pictureEditor;
                        return c.node===pictureIdentity.parent&&c.childHost===pictureIdentity.host&&
                            e.node===pictureIdentity.child&&e.node.parentElement===c.childHost&&!c.surface&&!e.surface&&
                            JSON.stringify([c.props.Left,c.props.Top,c.props.Width,c.props.Height,e.props.Left,e.props.Top,e.props.Width,e.props.Height])===JSON.stringify(pictureGeometry);
                    }'''))
                    child = editor.locator('..').bounding_box()
                    self.assertAlmostEqual(child['x']-bounds['x'],12+(2 if style else 0),delta=0.05)
                    self.assertAlmostEqual(child['y']-bounds['y'],18+(2 if style else 0),delta=0.05)
            self.assertEqual(page.evaluate('compatControls.Sidebar.model.properties.BorderStyle'),1)
        finally:
            page.evaluate('pictureEditor.dispose()')
        self.record('PictureBox BorderStyle 0→1→0 removes/restores real borders without replacing children, losing editor focus/selection or changing authored outer geometry')

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

    def test_macos26_segmented_single_multiple_and_momentary_dispatch_public_values_once(self):
        page = self.macos26_runtime()
        single = page.get_by_role('radiogroup',name='Single choice',exact=True)
        first = single.get_by_role('radio',name='First',exact=True)
        last = single.get_by_role('radio',name='Last',exact=True)
        status = page.locator('[data-control="SegmentStatus"]')
        expect(first).to_be_checked()
        expect(single.get_by_role('radio',name='Disabled',exact=True)).to_be_disabled()
        self.assertEqual(single.get_by_role('radio',name='Hidden',exact=True).count(),0)
        expect(first).to_have_attribute('title','First choice')
        first.press('ArrowRight')
        expect(last).to_be_focused()
        expect(last).to_be_checked()
        expect(first).not_to_be_checked()
        expect(status).to_have_text('1:single:last:1:0:1')
        last.press('Home')
        expect(first).to_be_focused()
        expect(status).to_have_text('2:single:first:1:1:0')
        first.press('End')
        expect(status).to_have_text('3:single:last:1:0:1')
        last.press('Enter')
        expect(status).to_have_text('4:single:last:1:0:1')
        expect(page.locator('[data-control="ActionStatus"]')).to_have_text('Not saved')
        last.evaluate('''e=>{for(const key of ['ArrowLeft','Enter']){
            e.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,isComposing:true}));
            e.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,keyCode:229}));
        }}''')
        single.locator('[data-toolbar-index="1"]').evaluate('e=>e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}))')
        single.locator('[data-toolbar-index="2"]').evaluate('e=>e.click()')
        self.macos26_set('Segments',{'Enabled':0})
        expect(last).to_be_disabled()
        last.evaluate('e=>e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}))')
        expect(status).to_have_text('4:single:last:1:0:1')

        multiple = page.get_by_role('group',name='Multiple choices',exact=True)
        a = multiple.get_by_role('button',name='First',exact=True)
        b = multiple.get_by_role('button',name='Last',exact=True)
        a.press('Space')
        expect(status).to_have_text('5:multiple:first:1:1:0')
        expect(a).to_have_attribute('aria-pressed','true')
        a.press('ArrowRight')
        expect(b).to_be_focused()
        expect(status).to_have_text('5:multiple:first:1:1:0')
        b.press('Enter')
        expect(status).to_have_text('6:multiple:last:1:1:1')
        expect(b).to_have_attribute('aria-pressed','true')
        b.press('Space')
        expect(status).to_have_text('7:multiple:last:0:1:0')
        expect(b).to_have_attribute('aria-pressed','false')
        actions = page.get_by_role('group',name='Related actions',exact=True)
        back = actions.get_by_role('button',name='First',exact=True)
        forward = actions.get_by_role('button',name='Last',exact=True)
        back.press('Enter')
        expect(status).to_have_text('8:momentary:first:0:0:0')
        back.press('ArrowRight')
        expect(forward).to_be_focused()
        forward.press('Space')
        expect(status).to_have_text('9:momentary:last:0:0:0')
        self.assertIsNone(forward.get_attribute('aria-pressed'))
        self.assertIsNone(forward.get_attribute('aria-checked'))
        expect(page.locator('[data-control="ActionStatus"]')).to_have_text('Not saved')
        self.record('segmented radio/check/action modes expose real VB values before one event, skip unavailable members, preserve IME and own Enter/Space')

    def test_macos26_segmented_live_collection_mutations_retain_identity_and_validate_atomically(self):
        page = self.macos26_runtime()
        single = page.get_by_role('radiogroup',name='Single choice',exact=True)
        page.evaluate('''()=>{
            window.segmentProject=JSON.stringify(vb6Application.project);
            window.segmentIdentity=compatControls.Segments.Buttons.items.map((item,i)=>({item,node:compatControls.Segments.node.querySelector(`[data-toolbar-index="${i}"]`)}));
            const c=compatControls.Segments,added=c.Buttons.Add(2,'inserted','Inserted',2);
            added.Value=1;c.Buttons.Item('first').Caption='Renamed';
        }''')
        inserted = single.get_by_role('radio',name='Inserted',exact=True)
        expect(inserted).to_be_checked()
        expect(single.get_by_role('radio',name='Renamed',exact=True)).not_to_be_checked()
        inserted.focus()
        for theme in ('macos26-dark','classic','fluent','macos26'):
            self.theme(theme,{'reduceMotion':True})
            expect(inserted).to_be_focused()
            self.assertTrue(page.evaluate('segmentIdentity.every(({item,node})=>compatControls.Segments.Buttons.items.includes(item)&&node===compatControls.Segments.node.querySelector(`[data-toolbar-index="${item.Index-1}"]`))'))
            self.assertEqual(page.evaluate('JSON.stringify(vb6Application.project)'),page.evaluate('segmentProject'))
        page.evaluate('compatControls.Segments.Buttons.Remove("inserted")')
        renamed = single.get_by_role('radio',name='Renamed',exact=True)
        last = single.get_by_role('radio',name='Last',exact=True)
        expect(inserted).to_have_count(0)
        expect(renamed).to_be_focused()
        page.evaluate('compatControls.Segments.Buttons.Item("first").Visible=0')
        expect(renamed).to_have_count(0)
        expect(last).to_be_focused()
        page.evaluate('compatControls.Segments.Buttons.Item("hidden").Value=1')
        expect(last).not_to_be_checked()
        self.assertEqual(page.evaluate('compatControls.Segments.Buttons.items.map(b=>b.Value)'),[0,0,1,0])
        errors = page.evaluate('''()=>{
            const c=compatControls.Segments,results=[];
            for(const change of [()=>c.Buttons.Add(undefined,'bad','Bad',3),()=>c.Buttons.Item('first').Style=1,()=>c.Buttons.Item('last').Value=2]){
                const before=JSON.stringify(c.Buttons.items);let number=0;try{change()}catch(error){number=error.number}
                results.push({number,unchanged:before===JSON.stringify(c.Buttons.items)});
            }
            c.set('MacOSControlStyle','automatic');c.Buttons.Add(undefined,'separator','',3);
            let number=0;try{c.set('MacOSControlStyle','segmented')}catch(error){number=error.number}
            results.push({number,unchanged:c.props.MacOSControlStyle==='automatic'});
            c.Buttons.Remove('separator');c.set('MacOSControlStyle','segmented');
            return results;
        }''')
        self.assertEqual(errors,[{'number':380,'unchanged':True}]*4)
        expect(page.locator('[data-control="SegmentStatus"]')).to_have_text('No segment action')
        self.assertEqual(page.evaluate('JSON.stringify(vb6Application.project)'),page.evaluate('segmentProject'))
        self.record('live segmented insertion/removal/rename/visibility keeps surviving objects and DOM, repairs focus and validates prospective collection and live style atomically')

    def test_macos26_segmented_tabs_keep_pages_flags_editors_and_authored_geometry(self):
        page = self.macos26_runtime()
        tabs = page.locator('[data-control="SegmentPages"]')
        header = tabs.locator('.vb-tab-header')
        general = tabs.get_by_role('tab',name='General',exact=True)
        advanced = tabs.get_by_role('tab',name='Advanced',exact=True)
        expect(tabs.get_by_role('tab',name='Disabled',exact=True)).to_be_disabled()
        self.assertEqual(tabs.get_by_role('tab',name='Hidden',exact=True).count(),0)
        self.assertEqual(header.bounding_box()['height'],24,'segmented presentation ignores classic TabsPerRow wrapping')
        bounds = tabs.bounding_box()
        page.evaluate('window.segmentTabButtons=[...compatControls.SegmentPages.tabHeader.children]')
        general.press('End')
        expect(advanced).to_be_focused()
        expect(advanced).to_have_attribute('aria-selected','true')
        self.assertEqual(page.evaluate('compatControls.SegmentPages.Tab'),3)
        editor = page.locator('[data-control="SegmentAdvanced"] input')
        expect(editor).to_be_visible()
        editor.fill('Retained advanced text')
        editor.evaluate('e=>{window.segmentPageEditor=e;e.setSelectionRange(2,9,"backward");}')
        self.macos26_set('SegmentPages',{'Tab':0})
        expect(general).to_be_focused()
        expect(editor).to_be_hidden()
        self.macos26_set('SegmentPages',{'Tab':3})
        expect(editor).to_have_value('Retained advanced text')
        self.assertEqual(editor.evaluate('e=>[e===segmentPageEditor,e.selectionStart,e.selectionEnd,e.selectionDirection]'),[True,2,9,'backward'])
        page.evaluate('compatControls.SegmentPages.setIndexed("TabCaption",[3],"Expert")')
        expect(tabs.get_by_role('tab',name='Expert',exact=True)).to_have_attribute('aria-selected','true')
        self.assertTrue(page.evaluate('segmentTabButtons.every((b,i)=>b===compatControls.SegmentPages.tabHeader.children[i])'))
        self.macos26_set('SegmentPages',{'MacOSControlStyle':'automatic'})
        expect(tabs).to_have_attribute('data-macos-control-style','automatic')
        self.assertEqual(header.bounding_box()['height'],72)
        self.macos26_set('SegmentPages',{'MacOSControlStyle':'segmented','TabOrientation':1,'MacOSMaterial':'sidebar'})
        expect(tabs).to_have_attribute('data-tab-orientation','1')
        self.assertEqual(header.bounding_box()['height'],24)
        self.assertEqual(tabs.bounding_box(),bounds)
        self.assertAlmostEqual(header.bounding_box()['y']+24,bounds['y']+bounds['height']-1,delta=1)
        result=page.evaluate('''()=>{const c=compatControls.SegmentPages,before=JSON.stringify(c.props);let number=0;try{c.set('TabOrientation',2)}catch(error){number=error.number}return {number,unchanged:before===JSON.stringify(c.props)}}''')
        self.assertEqual(result,{'number':380,'unchanged':True})
        # Construct through the same public BrowserControl used by compiled
        # forms, so initial TabStrip metadata is tested before any live edits.
        page.evaluate('''()=>{
            const source=compatControls.SegmentPages,model={id:'segmented-strip',name:'SegmentStrip',type:'TabStrip',properties:{...structuredClone(source.props),Tab:0,Left:5550,Top:3660,Height:420,TabOrientation:0,MacOSMaterial:'none'}};
            model.properties.Tabs[0].ToolTipText='General page';
            window.segmentStrip=new VB6Runtime.RuntimeAPI.BrowserControl(model,{vm:source.vm,instance:source.instance,form:source.form,backend:'canvas2d'});
            source.form.content.append(segmentStrip.node);
        }''')
        try:
            strip=page.locator('[data-control="SegmentStrip"]')
            expect(strip.get_by_role('tab',name='Disabled',exact=True)).to_be_disabled()
            self.assertEqual(strip.get_by_role('tab',name='Hidden',exact=True).count(),0)
            expect(strip.get_by_role('tab',name='General',exact=True)).to_have_attribute('title','General page')
            strip.get_by_role('tab',name='General',exact=True).press('ArrowRight')
            expect(strip.get_by_role('tab',name='Expert',exact=True)).to_have_attribute('aria-selected','true')
            self.assertEqual(page.evaluate('segmentStrip.Tab'),3)
        finally:
            page.evaluate('segmentStrip.dispose()')
        self.record('segmented SSTab preserves logical indices, disabled/hidden flags, existing editors, child bounds, tab identity and one-row top/bottom layout')

    def test_macos26_segmented_palette_focus_sizes_and_literal_colors(self):
        page = self.macos26_runtime()
        single = page.get_by_role('radiogroup',name='Single choice',exact=True)
        first = single.get_by_role('radio',name='First',exact=True)
        last = single.get_by_role('radio',name='Last',exact=True)
        bounds=single.bounding_box()
        for theme in ('macos26','macos26-dark'):
            self.theme(theme,{'reduceMotion':True,'increaseContrast':True})
            for size in ('mini','small','regular','large','extraLarge'):
                self.macos26_set('Segments',{'MacOSControlSize':size})
                expect(single).to_have_attribute('data-macos-control-size',size)
                self.assertEqual(single.bounding_box(),bounds)
                self.assertAlmostEqual(first.bounding_box()['width'],last.bounding_box()['width'],delta=0.05)
                self.assertNotEqual(first.evaluate('e=>getComputedStyle(e).backgroundColor'),last.evaluate('e=>getComputedStyle(e).backgroundColor'))
            first.press('ArrowRight')
            expect(last).to_be_focused()
            expect(last).to_have_css('outline-width','2px')
            last.press('Home')
            page.locator('[data-control="Segments"]').screenshot(path=str(FIXTURE.parent/(theme+'-segments.png')))
        self.macos26_set('Segments',{'BackColor':0x00332211,'ForeColor':0x00665544})
        for theme in ('macos26','macos26-dark','classic'):
            self.theme(theme,{'reduceMotion':True})
            expect(first).to_have_css('background-color','rgb(17, 34, 51)')
            expect(first).to_have_css('color','rgb(68, 85, 102)')
            expect(last).to_have_css('background-color','rgb(17, 34, 51)')
        self.macos26_set('Segments',{'BackColor':-2147483633,'ForeColor':-2147483640})
        self.theme('macos26')
        page.emulate_media(forced_colors='active')
        if page.evaluate('matchMedia("(forced-colors:active)").matches'):
            expect(first).to_have_css('border-top-width','1px')
            self.assertNotEqual(first.evaluate('e=>getComputedStyle(e).backgroundColor'),first.evaluate('e=>getComputedStyle(e).color'))
            first.press('ArrowRight')
            expect(last).to_have_css('outline-width','2px')
            expect(last).to_have_attribute('aria-checked','true')
        page.emulate_media(forced_colors='none')
        self.record('segmented light/dark/increased contrast/forced colors preserve authored dimensions and equal segments; explicit RGB survives state and palette changes')

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
        for name, kind in {'Layout':'PictureBox','Content':'PictureBox','Navigation':'TreeView','Search':'TextBox','Secret':'TextBox','Notifications':'CheckBox','Choices':'ComboBox','Counter':'UpDown','Meeting':'DTPicker','Progress':'ProgressBar','Sections':'Toolbar','Pages':'SSTab','Save':'CommandButton'}.items():
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
        sections = frame.get_by_role('radiogroup',name='Settings section',exact=True)
        expect(sections.get_by_role('radio',name='General',exact=True)).to_be_checked()
        sections.get_by_role('radio',name='Advanced',exact=True).click()
        expect(frame.locator('[data-control="ActionStatus"]')).to_have_text('section:advanced:1')
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

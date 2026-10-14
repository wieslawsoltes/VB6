"""X11 paint/state checks mixed into the existing HTTP/file browser matrix.

The pixel oracle checks owned, text-free edge strips at integer DPR, not a
self-generated golden screenshot. It does not certify native Motif font rasters.
"""
import io
import os
from pathlib import Path
from PIL import Image
from x11_overflow_checks import X11OverflowChecks

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
PALETTES = {
    'x11': {'face': '#bdbdb3', 'top': '#f2f2e8', 'bottom': '#66665c'},
    'x11-dark': {'face': '#343c3e', 'top': '#858f90', 'bottom': '#151d20'},
}
SHADOWS = '''e => (getComputedStyle(e).boxShadow.match(/(?:rgba?\\([^)]*\\)|[^,])+/g)||[]).map(s=>({
 color:(s.match(/rgba?\\([^)]*\\)/)||[])[0],
 offsets:s.replace(/rgba?\\([^)]*\\)/g,'').match(/-?[\\d.]+px/g),inset:s.includes('inset')
}))'''


def rgb(value):
    return 'rgb(' + ', '.join(str(int(value[i:i+2], 16)) for i in (1, 3, 5)) + ')'


def color_tuple(value):
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def style(node, name, pseudo=None):
    return node.evaluate('(e,[name,pseudo])=>getComputedStyle(e,pseudo)[name]', [name, pseudo])


def relief(test, node, theme, pressed=False):
    palette = PALETTES[theme]
    top, bottom = (palette['bottom'], palette['top']) if pressed else (palette['top'], palette['bottom'])
    expected = [
        {'color': rgb(top), 'offsets': ['2px', '2px', '0px', '0px'], 'inset': True},
        {'color': rgb(bottom), 'offsets': ['-2px', '-2px', '0px', '0px'], 'inset': True},
    ]
    actual = node.evaluate(SHADOWS)
    test.assertEqual(actual[:2], expected, f'{theme}: {style(node, "boxShadow")}')
    return actual


def press_without_click(page, node, check):
    node.hover()
    page.mouse.down()
    try:
        check()
    finally:
        # Do not activate an Options OK button while examining its armed state.
        page.mouse.move(1400, 990)
        page.mouse.up()


def keyboard_focus(page, node):
    node.focus()
    page.keyboard.press('Tab')
    page.keyboard.press('Shift+Tab')


def set_control(page, name, key, value):
    page.evaluate('''([name,key,value])=>{
 const c=vb6Application.forms[0].controls.find(c=>c.model.name===name);
 if(!c)throw Error('Missing fixture control '+name);c.set(key,value);c.Refresh();
}''', [name, key, value])


class X11IdeChecks(X11OverflowChecks):
    def test_x11_ide_relief_defaults_fields_and_indicators(self):
        for theme, palette in PALETTES.items():
            with self.subTest(theme=theme):
                self.direct_theme(theme)
                self.options()
                dialog = self.page.locator('.ide-dialog')
                try:
                    default = dialog.locator('.default-button').first
                    self.assertEqual(style(default, 'backgroundColor'), rgb(palette['face']))
                    self.assertEqual(len(relief(self, default, theme)), 5, 'Separate default ring and raised face')
                    default.hover()
                    self.assertEqual(style(default, 'backgroundColor'), rgb(palette['face']))
                    self.assertEqual(style(default, 'filter'), 'none')
                    self.assertEqual(len(relief(self, default, theme)), 5)
                    press_without_click(self.page, default, lambda: relief(self, default, theme, pressed=True))
                    keyboard_focus(self.page, default)
                    self.assertTrue(default.evaluate('e=>e===document.activeElement'))
                    self.assertEqual(style(default, 'outlineWidth'), '2px')
                    self.assertEqual(style(default, 'outlineOffset'), '-4px')
                    field = dialog.locator('select:visible:enabled').first
                    field.focus()
                    relief(self, field, theme, pressed=True)
                    self.assertEqual(style(field, 'outlineWidth'), '2px')
                    check = dialog.locator('input[type=checkbox]:visible:enabled').first
                    check.uncheck()
                    relief(self, check, theme)
                    check.focus()
                    self.page.keyboard.press('Space')
                    self.assertTrue(check.is_checked())
                    relief(self, check, theme, pressed=True)
                    check.evaluate('e=>e.indeterminate=true')
                    self.assertIn('repeating-linear-gradient', style(check, 'backgroundImage', '::after'))
                    check.evaluate('e=>{e.indeterminate=false;e.disabled=true;}')
                    self.assertNotEqual(style(check, 'backgroundColor', '::after'), style(check, 'backgroundColor'))
                finally:
                    if dialog.count() and dialog.is_visible():
                        dialog.get_by_role('button', name='Cancel', exact=True).click()
                self.record(theme, x11IdeDefaults=True, raisedHover=True, separateKeyboardFocus=True, nativeCheckbox=True)

    def test_x11_ide_menu_relief_and_disabled_state(self):
        for theme, palette in PALETTES.items():
            self.direct_theme(theme)
            self.page.get_by_role('menuitem', name='Edit', exact=True).click()
            menu = self.page.locator('.classic-menu:visible').last
            item = menu.locator('.popup-menu-item:not([aria-disabled=true])').first
            item.hover()
            relief(self, item, theme)
            self.assertEqual(style(item, 'backgroundColor'), rgb(palette['face']))
            self.assertEqual(style(menu, 'backgroundColor'), rgb(palette['face']))
            disabled = menu.locator('[aria-disabled=true]').first
            self.assertGreater(disabled.count(), 0)
            self.assertEqual(style(disabled, 'boxShadow'), 'none')
            self.assertNotEqual(style(disabled, 'textShadow'), 'none')
            self.page.keyboard.press('Escape')
            self.record(theme, x11MenuRelief=True, disabledEmboss=True)


class X11ApplicationChecks:
    def test_x11_application_component_states(self):
        for theme, palette in PALETTES.items():
            with self.subTest(theme=theme):
                self.theme(theme)
                button = self.page.locator('[data-control="CommandButton1"]')
                self.assertEqual(len(relief(self, button, theme)), 5)
                self.assertEqual(style(button, 'transitionDuration'), '0s')
                button.hover()
                self.assertEqual(len(relief(self, button, theme)), 5)
                set_control(self.page, 'Label1', 'Caption', 'Waiting')
                self.page.mouse.down()
                relief(self, button, theme, pressed=True)
                self.page.mouse.up()
                self.page.wait_for_function('document.querySelector("[data-control=Label1]").textContent==="Clicked"')
                set_control(self.page, 'CommandButton1', 'Enabled', 0)
                relief(self, button, theme)
                self.assertNotEqual(style(button, 'textShadow'), 'none')
                set_control(self.page, 'CommandButton1', 'Enabled', -1)
                field = self.page.locator('[data-control="TextBox1"] input')
                field.focus()
                relief(self, field, theme, pressed=True)
                self.assertEqual(style(field, 'outlineWidth'), '2px')
                self.assertEqual(style(field, 'outlineOffset'), '-4px')
                check = self.page.locator('[data-control="CheckBox1"] input')
                check.uncheck()
                relief(self, check, theme)
                self.assertEqual(style(check, 'backgroundImage'), 'none')
                self.assertEqual(style(check, 'borderTopWidth'), '0px')
                check.focus()
                self.page.keyboard.press('Space')
                self.assertTrue(check.is_checked())
                relief(self, check, theme, pressed=True)
                self.assertEqual(style(check, 'clipPath', '::after'), 'inset(0px)')
                self.assertEqual(style(check, 'width', '::after'), '9px')
                self.assertEqual(style(check, 'height', '::after'), '9px')
                set_control(self.page, 'CheckBox1', 'Value', 2)
                relief(self, check, theme, pressed=True)
                self.assertIn('repeating-linear-gradient', style(check, 'backgroundImage', '::after'))
                set_control(self.page, 'CheckBox1', 'Enabled', 0)
                self.assertEqual(style(check, 'backgroundImage', '::after'), 'none')
                self.assertEqual(style(check, 'backgroundColor', '::after'), self.rgb(self.palettes[theme]['colors']['gray']))
                set_control(self.page, 'CheckBox1', 'Enabled', -1)
                set_control(self.page, 'CheckBox1', 'Value', 1)
                radio = self.page.locator('[data-control="OptionButton1"] input')
                self.assertEqual(style(radio, 'borderRadius'), '0px')
                self.assertEqual(style(radio, 'borderRadius', '::after'), '0px')
                self.assertNotEqual(style(radio, 'transform'), 'none')
                relief(self, radio, theme, pressed=True)
                progress = self.page.locator('.vb-progress')
                self.assertEqual(style(progress, 'borderTopColor'), rgb(palette['bottom']))
                self.assertEqual(style(progress, 'borderBottomColor'), rgb(palette['top']))
                self.assertEqual(self.css('.vb-month th', 'color'), self.rgb(self.palettes[theme]['colors']['gray']))
                toolbar = self.page.locator('[data-control="Toolbar1"] button:enabled').first
                relief(self, toolbar, theme)
                press_without_click(self.page, toolbar, lambda: relief(self, toolbar, theme, pressed=True))
                relief(self, self.page.locator('[data-control="Data1"] button').first, theme)
                self.record(theme, x11RuntimeStates=True, realVBClick=True, keyboardActivation=True, darkCalendarInk=True)

    def test_x11_application_menu_caption_and_classic_reset(self):
        for theme, palette in PALETTES.items():
            self.theme(theme)
            menu_button = self.page.get_by_role('menuitem', name='File', exact=True)
            menu_button.hover()
            relief(self, menu_button, theme)
            self.assertEqual(style(menu_button, 'backgroundColor'), rgb(palette['face']))
            menu_button.click()
            action = self.page.get_by_role('menuitem', name='Action', exact=True)
            action.hover()
            relief(self, action, theme)
            self.assertEqual(style(action, 'backgroundColor'), rgb(palette['face']))
            self.page.keyboard.press('Escape')
            form = self.page.locator('.vb-form').first
            form.evaluate('e=>e.classList.add("vb-inactive")')
            try:
                caption = form.locator('.vb-form-title')
                relief(self, caption, theme)
                action_button = caption.locator('.vb-window-button').first
                self.assertEqual(style(action_button, 'color'), self.rgb(self.palettes[theme]['colors']['inactiveText']))
            finally:
                form.evaluate('e=>e.classList.remove("vb-inactive")')
            self.theme('classic')
            self.assertEqual(self.page.locator('#app').evaluate('e=>getComputedStyle(e).getPropertyValue("--app-check-rest-shadow").trim()'), '')
            self.assertEqual(self.css('[data-control="OptionButton1"] input', 'borderRadius'), '50%')
            self.record(theme, menuRoleNotSelectionFill=True, inactiveCaptionInk=True, classicReset=True)

    def test_x11_integer_dpr_edge_pixels_and_fractional_metrics(self):
        report = ROOT / 'reports' / 'application-themes' / ENGINE / 'x11-pixels'
        report.mkdir(parents=True, exist_ok=True)
        for dpr in (1, 1.25, 1.5, 2):
            context = self.browser.new_context(viewport={'width':1440, 'height':1000}, device_scale_factor=dpr)
            errors = []
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            try:
                self.load(ROOT / 'reports' / 'application-themes' / 'fixtures' / 'gallery.html', page)
                page.wait_for_function('typeof vb6Application==="object"')
                button = page.locator('[data-control="CommandButton1"]')
                baseline = button.bounding_box()
                for theme, palette in PALETTES.items():
                    page.evaluate('t=>vb6Application.setTheme(t)', theme)
                    page.wait_for_timeout(40)
                    bounds = button.bounding_box()
                    self.assertEqual((bounds['width'], bounds['height']), (baseline['width'], baseline['height']))
                    relief(self, button, theme)
                    for pressed in (False, True):
                        button.hover()
                        if pressed: page.mouse.down()
                        try:
                            relief(self, button, theme, pressed=pressed)
                            image = Image.open(io.BytesIO(button.screenshot(animations='disabled'))).convert('RGB')
                            image.save(report / f'{theme}-{dpr}-{"armed" if pressed else "raised"}.png')
                            if dpr in (1, 2):
                                top, bottom = (palette['bottom'], palette['top']) if pressed else (palette['top'], palette['bottom'])
                                # Literal expected colors, not pixels copied from a browser-produced golden.
                                # Stay away from text, focus, and diagonal shadow corner intersections.
                                for offset in range(2 * int(dpr)):
                                    for x in (image.width//4, image.width//2, image.width*3//4):
                                        self.assertEqual(image.getpixel((x, offset)), color_tuple(top), f'{theme}/{dpr} top {offset}')
                                        self.assertEqual(image.getpixel((x, image.height-1-offset)), color_tuple(bottom), f'{theme}/{dpr} bottom {offset}')
                                self.assertEqual(image.getpixel((image.width//2, 3*int(dpr))), color_tuple(palette['face']))
                        finally:
                            if pressed: page.mouse.up()
                    self.record(theme, dpr=dpr, metricParity=True, edgePixelsChecked=dpr in (1, 2))
                self.assertEqual(errors, [])
            finally:
                context.close()

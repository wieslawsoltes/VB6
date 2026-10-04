#!/usr/bin/env python3
"""Real top-level browser-window integration tests (HTTP and standalone file://).

Run after npm run build. Set VB6_BROWSER=firefox/webkit for additional engines;
CHROMIUM_PATH optionally selects a system Chromium, otherwise Playwright's build.
No test-only window implementation is used; detach is invoked by real UI clicks.
"""
import functools
import json
import http.server
import os
from pathlib import Path
import shutil
import threading
import unittest

from playwright.sync_api import sync_playwright, Error

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports' / 'browser-windows'
PROJECT = {'schema': 1, 'id': 'windows-test', 'name': 'WindowLab', 'startup': 'Sub Main',
           'settings': {'renderer': 'canvas2d'}, 'modules': [
    {'id': 'main', 'name': 'MainModule', 'kind': 'module', 'code':
     'Option Explicit\nPublic Sub Main()\n    Dim localNumber As Long\n    localNumber = 42\n    Debug.Print localNumber\nEnd Sub\n'},
    {'id': 'other', 'name': 'OtherModule', 'kind': 'module', 'code':
     'Option Explicit\nPublic Function Greeting() As String\n    Greeting = "hello"\nEnd Function\n'}]}

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class BrowserWindows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True, exist_ok=True)
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/dist/index.html'
        cls.pw = sync_playwright().start()
        engine = os.environ.get('VB6_BROWSER', 'chromium')
        options = {}
        if engine == 'chromium':
            path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if path:
                options['executable_path'] = path
            options.update(args=['--no-sandbox'], ignore_default_args=['--disable-popup-blocking'])
        cls.browser = getattr(cls.pw, engine).launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.context.set_default_timeout(6000)
        self.errors = []
        self.trace = []
        self.context.on('page', lambda page: page.on('pageerror', lambda error: self.errors.append(str(error))))
        self.page = self.context.new_page()
        self.boot_page(self.page)

    def boot_page(self, page):
        if os.environ.get('VB6_TEST_TRANSPORT') == 'memory':
            page.set_content((ROOT / 'dist' / 'VB6-Studio-Web.html').read_text())
        else:
            page.goto(self.url)
        page.wait_for_function('typeof vb6Studio === "object"')

    def tearDown(self):
        if self.trace:
            (REPORT / (self._testMethodName + '.json')).write_text(json.dumps(self.trace, indent=2))
        errors = self.errors[:]
        self.context.close()
        self.assertEqual(errors, [], 'Uncaught page errors')

    def closing_action(self, popup, action):
        # Firefox may acknowledge the page close before acknowledging its click.
        with popup.expect_event('close'):
            try:
                action()
            except Error as error:
                if not popup.is_closed() or 'closed' not in str(error):
                    raise

    def ready_popup(self, popup):
        popup.wait_for_selector('.browser-window-root[data-ready="true"]')
        popup.wait_for_function('''() => [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link.sheet) &&
            getComputedStyle(document.querySelector('.browser-window-content')).display === 'flex' ''')
        return popup

    def editor_trace(self, stage):
        self.trace.append(self.js('''stage => {const e=vb6Studio.editor,p=e.activePane,v=p.virtualizer;
          return {stage,cursor:e.cursor(),range:p.range,logical:v.logical,first:v.first,
            native:[p.input.selectionStart,p.input.selectionEnd],scroll:[p.input.scrollTop,v.rail.scrollTop],
            active:p.input.ownerDocument.activeElement?.className,
            undo:vb6Studio.history.undoStack.length,events:window.editorEvents||[]};}''', stage))

    def js(self, code, arg=None):
        return self.page.evaluate(code, arg)

    def command(self, name):
        self.js('name => { void vb6Studio.command(name); }', name)

    def count(self, n):
        self.page.wait_for_function('n => vb6Studio.browserWindows.windows.size === n', arg=n)

    def tool(self, name='Properties'):
        with self.page.expect_popup() as result:
            self.page.get_by_label(f'Float {name} in Browser Window', exact=True).click()
        popup = result.value
        return self.ready_popup(popup)

    def code(self, module='main'):
        self.js('p => { vb6Studio.loadProject(p); vb6Studio.openDocument("main", "code"); }', PROJECT)
        if module != 'main':
            self.js('id => { vb6Studio.openDocument(id, "code"); }', module)

    def document(self):
        with self.page.expect_popup() as result:
            self.page.locator('.mdi-active').get_by_label('Float document in Browser Window', exact=True).click()
        popup = result.value
        return self.ready_popup(popup)

    def local_command(self, popup, menu, command):
        popup.get_by_role('menuitem', name=menu, exact=True).click()
        popup.locator(f'[role=menu] [data-command="{command}"]').click()

    def test_blocked_popup_is_atomic(self):
        self.js('''() => { window.savedOpen = window.open; window.open = () => null;
          window.livePanel = vb6Studio.propertiesPanel; window.modelBefore = JSON.stringify(vb6Studio.docking.snapshot()); }''')
        self.page.get_by_label('Float Properties in Browser Window', exact=True).click()
        self.count(0)
        self.assertTrue(self.js('livePanel === vb6Studio.propertiesPanel && livePanel.ownerDocument === document && livePanel.isConnected'))
        self.assertTrue(self.js('modelBefore === JSON.stringify(vb6Studio.docking.snapshot())'))
        self.assertIn('blocked', self.page.locator('.status-message').inner_text())
        self.js('() => { window.open = savedOpen; }')
        self.tool()
        self.count(1)

    def test_setup_failure_rolls_back(self):
        self.js('''() => { const host=vb6Studio.browserWindows; window.originalDecorate=host.decorate;
          host.decorate=() => { throw new Error("Injected setup failure"); }; }''')
        self.page.get_by_label('Float Properties in Browser Window', exact=True).click()
        self.count(0)
        self.assertTrue(self.page.get_by_label('Selected object', exact=True).is_visible())
        self.assertIn('Injected setup failure', self.page.locator('.status-message').inner_text())
        self.js('() => { vb6Studio.browserWindows.decorate=originalDecorate; }')
        self.tool().close()
        self.count(0)
        self.local_command(self.page, 'Tools', 'options')
        self.assertTrue(self.page.locator('.ide-dialog').is_visible())
        self.page.keyboard.press('Escape')

    def test_live_group_identity_and_native_close(self):
        self.js('window.livePanel=vb6Studio.propertiesPanel')
        popup = self.tool()
        self.count(1)
        self.assertEqual(popup.evaluate('document.compatMode'), 'CSS1Compat')
        self.assertTrue(popup.evaluate('opener.livePanel === document.querySelector("[data-dock-window=properties]")'))
        self.assertEqual(popup.evaluate('typeof vb6Studio'), 'undefined')
        self.assertFalse(self.page.locator('[data-dock-window=properties]').count())
        self.js('vb6Studio.docking.render()')
        self.assertTrue(popup.get_by_label('Selected object', exact=True).is_visible())
        popup.screenshot(path=str(REPORT / 'properties.png'))
        popup.close()
        self.count(0)
        self.assertTrue(self.js('livePanel === vb6Studio.propertiesPanel && livePanel.ownerDocument === document && livePanel.isConnected'))
        self.assertTrue(self.js('!vb6Studio.browserWindows.timer'))

    def test_blocked_second_window_does_not_disturb_first(self):
        first = self.tool()
        self.js('() => { window.savedOpen=window.open; window.open=()=>null; }')
        self.page.get_by_label('Float Project Explorer in Browser Window', exact=True).click()
        self.count(1)
        self.assertFalse(first.is_closed())
        self.assertTrue(self.page.locator('[data-dock-window=project]').is_visible())
        self.js('() => { window.open=savedOpen; }')

    def test_duplicate_focus_and_repeated_return(self):
        for _ in range(3):
            popup = self.tool()
            popup.get_by_label('Float Properties in Browser Window', exact=True).click()
            self.count(1)
            self.assertEqual(len([p for p in self.context.pages if not p.is_closed()]), 2)
            self.closing_action(popup, lambda: popup.get_by_role('button', name='Return to IDE', exact=True).click())
            self.count(0)
            self.assertTrue(popup.is_closed())
        self.assertTrue(self.js('!vb6Studio.browserWindows.timer'))

    def test_linked_tabs_and_caption_menu_redock(self):
        self.js('vb6Studio.docking.dock("project", "right", "properties")')
        popup = self.tool('Project Explorer')
        self.assertEqual(popup.locator('[role=tablist][aria-label="Docked windows"] [role=tab]').count(), 2)
        popup.get_by_role('tab', name='Project Explorer', exact=True).click()
        self.assertTrue(popup.locator('[data-dock-window=project]').is_visible())
        popup.get_by_role('tab', name='Properties', exact=True).click()
        popup.locator('[data-dock-window=properties] .tool-caption').click(button='right')
        self.closing_action(popup, lambda: popup.get_by_role('menuitem', name='Return to IDE', exact=True).click())
        self.count(0)
        self.assertEqual(self.js('vb6Studio.docking.group("properties").id'), 'properties')

    def test_editor_source_undo_selection_and_close(self):
        self.code()
        self.js('window.liveInput=vb6Studio.editor.input; window.beforeCode=vb6Studio.activeModule.code')
        popup = self.document()
        self.assertTrue(popup.evaluate('opener.liveInput === document.querySelector(".source-input")'))
        source = popup.get_by_label('Visual Basic source code', exact=True)
        source.focus()
        popup.keyboard.press('Control+End')
        popup.keyboard.insert_text("\n' edited in popup\n")
        self.assertIn('edited in popup', self.js('vb6Studio.activeModule.code'))
        popup.keyboard.press('Control+z')
        self.assertTrue(self.js('beforeCode === vb6Studio.activeModule.code'))
        popup.keyboard.press('Control+Shift+z')
        self.assertIn('edited in popup', self.js('vb6Studio.activeModule.code'))
        source.evaluate('(input) => { input.focus(); input.setSelectionRange(2, 18, "backward"); }')
        self.closing_action(popup, lambda: popup.get_by_role('button', name='Return to IDE', exact=True).click())
        self.count(0)
        self.assertEqual(self.js('[liveInput.selectionStart,liveInput.selectionEnd,liveInput.selectionDirection]'), [2, 18, 'backward'])
        self.assertTrue(self.js('liveInput === vb6Studio.editor.input'))
        self.assertIn('edited in popup', self.js('vb6Studio.activeModule.code'))

    def test_large_editor_projection_and_scroll_survive(self):
        self.code()
        self.js(r'''() => { vb6Studio.project.modules[0].code="' line\n".repeat(50000);
          vb6Studio.renderAll(); vb6Studio.editor.goToLine(49980); }''')
        popup = self.document()
        self.editor_trace('detached')
        self.assertGreater(self.js('vb6Studio.editor.activePane.range.firstLine'), 49700)
        self.assertGreater(self.js('vb6Studio.editor.cursor().line'), 49900)
        self.assertLess(self.js('vb6Studio.editor.input.value.split("\\n").length'), 1024)
        popup.get_by_label('Visual Basic source code', exact=True).focus()
        self.editor_trace('focused')
        popup.keyboard.insert_text('edited')
        self.editor_trace('inserted')
        self.assertGreater(self.js('vb6Studio.editor.cursor().line'), 49900)
        self.assertEqual(self.js('vb6Studio.activeModule.code.split("\\n").length'), 50001)
        popup.keyboard.press('Control+z')
        self.editor_trace('undone')
        self.assertNotIn('edited', self.js('vb6Studio.activeModule.code'))
        self.assertGreater(self.js('vb6Studio.editor.cursor().line'), 49900)
        popup.close()
        self.count(0)
        self.assertGreater(self.js('vb6Studio.editor.cursor().line'), 49900)

    def test_completion_and_popup_keyboard_menus(self):
        self.code()
        self.js('''() => { vb6Studio.editor.setValue("Public Sub Main()\\n    Dim localNumber As Long\\n    localN\\nEnd Sub"); vb6Studio.editor.goToLine(3,11); }''')
        popup = self.document()
        popup.get_by_label('Visual Basic source code', exact=True).focus()
        popup.keyboard.press('Control+j')
        self.assertTrue(popup.get_by_role('listbox', name='List Members').is_visible())
        popup.keyboard.press('Enter')
        self.assertIn('    localNumber\nEnd Sub', self.js('vb6Studio.activeModule.code'))
        popup.keyboard.press('Alt+t')
        self.assertTrue(popup.locator('[role=menu]').is_visible())
        self.assertEqual(self.page.locator('[role=menu]').count(), 0)
        popup.keyboard.press('Escape')
        popup.keyboard.press('F10')
        self.assertEqual(popup.evaluate('document.activeElement.dataset.menu'), 'File')

    def test_popup_options_dialog_apply_and_cancel(self):
        popup = self.tool()
        self.local_command(popup, 'Tools', 'options')
        self.assertTrue(popup.locator('.ide-dialog').is_visible())
        self.assertTrue(self.js('!!vb6Studio.root.closest("[inert]")'))
        popup.get_by_label('Tab width', exact=True).fill('8')
        popup.get_by_role('button', name='OK', exact=True).click()
        self.assertEqual(self.js('vb6Studio.project.settings.tabWidth'), 8)
        self.assertFalse(self.js('!!vb6Studio.root.closest("[inert]")'))
        self.local_command(popup, 'Tools', 'options')
        popup.get_by_label('Tab width', exact=True).fill('9')
        popup.keyboard.press('Escape')
        self.assertEqual(self.js('vb6Studio.project.settings.tabWidth'), 8)

    def test_native_close_cancels_dialog_and_clears_inert(self):
        popup = self.tool()
        self.local_command(popup, 'Tools', 'options')
        self.assertTrue(self.js('!!vb6Studio.root.closest("[inert]")'))
        popup.close()
        self.count(0)
        self.assertFalse(self.js('!!vb6Studio.root.closest("[inert]")'))
        self.local_command(self.page, 'Tools', 'options')
        self.assertTrue(self.page.locator('.ide-dialog').is_visible())
        self.page.keyboard.press('Escape')

    def test_property_edits_color_picker_and_designer(self):
        designer = self.document()
        props = self.tool()
        props.locator('[data-property=Caption] input').fill('Detached Form')
        props.locator('[data-property=Caption] input').press('Enter')
        self.assertEqual(self.js('vb6Studio.activeModule.form.properties.Caption'), 'Detached Form')
        self.assertIn('Detached Form', designer.locator('.designer-plane').inner_text())
        props.locator('[data-property=BackColor] input').click()
        props.locator('[data-property=BackColor] button').last.click()
        self.assertTrue(props.get_by_role('dialog', name='Color palette').is_visible())
        self.assertEqual(self.page.locator('.property-color-popup').count(), 0)
        props.get_by_role('tab', name='Palette', exact=True).click()
        props.locator('.palette-color').nth(2).click()
        self.assertEqual(props.locator('.property-color-popup').count(), 0)
        self.assertTrue(designer.locator('canvas.graphics-surface').first.is_visible())
        control = designer.locator('[data-control=lblTitle]')
        control.click(position={'x': 12, 'y': 10})
        self.assertGreater(self.js('vb6Studio.designer.selection.size'), 0)
        self.assertNotEqual(props.get_by_label('Selected object', exact=True).input_value(), '')
        designer.screenshot(path=str(REPORT / 'designer.png'))

    def test_resize_and_theme_propagation(self):
        popup = self.tool()
        popup.set_viewport_size({'width': 780, 'height': 660})
        self.page.wait_for_function('vb6Studio.browserWindows.snapshot()[0].bounds.width === 780')
        popup.wait_for_function('document.querySelector(".browser-window-content > .dock-group").getBoundingClientRect().width > 760')
        box = popup.locator('.browser-window-content > .dock-group').bounding_box()
        self.assertGreater(box['width'], 760)
        self.js('vb6Studio.appearance.theme="contrast"; vb6Studio.applyAppearance()')
        popup.wait_for_function('document.documentElement.dataset.vbTheme === "contrast"')
        self.assertEqual(popup.locator('.browser-window-root').evaluate('(n)=>getComputedStyle(n).getPropertyValue("--vb-window").trim()'), '#000000')
        self.js('''() => {const style=document.createElement('style');style.textContent='.browser-window-root{--live-style-test:17px}';document.head.append(style);}''')
        popup.wait_for_function('getComputedStyle(document.querySelector(".browser-window-root")).getPropertyValue("--live-style-test").trim() === "17px"')

    def test_modeless_browser_and_resize(self):
        self.code()
        self.command('objectBrowser')
        popup = self.document()
        popup.get_by_label('Object Browser search', exact=True).fill('DateDiff')
        popup.get_by_role('button', name='Search', exact=True).click()
        self.assertIn('DateDiff', popup.get_by_label('Member definition', exact=True).inner_text())
        popup.set_viewport_size({'width': 1024, 'height': 740})
        self.assertGreater(popup.locator('.classic-object-browser').bounding_box()['width'], 1000)
        popup.get_by_label('Object Browser search', exact=True).focus()
        try:
            popup.keyboard.press('Control+F4')
        except Exception:
            if not popup.is_closed():
                raise
        self.count(0)
        self.assertFalse(self.js('vb6Studio.documents.tools.has("tool:object-browser")'))
        self.assertTrue(popup.is_closed())

    def test_toolbar_commands_and_return(self):
        self.code()
        self.page.get_by_label('Move Standard toolbar', exact=True).click(button='right')
        with self.page.expect_popup() as result:
            self.page.get_by_role('menuitem', name='Float in Browser Window', exact=True).click()
        popup = result.value
        self.count(1)
        self.assertTrue(popup.get_by_role('toolbar', name='Standard toolbar', exact=True).is_visible())
        self.assertFalse(self.page.locator('[data-command-bar=standard]').count())
        with popup.expect_download() as download:
            popup.locator('[data-command-bar=standard] [data-command=save]').click()
        self.assertTrue(download.value.suggested_filename.endswith('.vb6web'))
        self.closing_action(popup, lambda: popup.get_by_role('button', name='Return to IDE', exact=True).click())
        self.count(0)
        self.assertTrue(self.page.get_by_role('toolbar', name='Standard toolbar', exact=True).is_visible())

    def test_debugger_uses_same_runtime_and_f5_f8(self):
        self.code()
        popup = self.document()
        self.js('vb6Studio.breakpoints=[{module:"MainModule",line:4}]')
        popup.get_by_label('Visual Basic source code', exact=True).focus()
        popup.keyboard.press('F5')
        self.page.wait_for_function('vb6Studio.runState === "paused"')
        self.assertTrue(self.js('!!vb6Studio.runtimeFrame && vb6Studio.browserWindows.windows.size===1'))
        self.assertTrue(popup.locator('.source-input').is_visible())
        popup.get_by_label('Visual Basic source code', exact=True).focus()
        popup.keyboard.press('F8')
        self.page.wait_for_function('vb6Studio.runState === "paused" && vb6Studio.editor.execution?.line === 5')
        popup.keyboard.press('Shift+F5')
        self.page.wait_for_function('vb6Studio.runState === "design"')

    def test_immediate_tool_state_retained(self):
        self.code()
        self.js('vb6Studio.breakpoints=[{module:"MainModule",line:4}]')
        self.command('run')
        self.page.wait_for_function('vb6Studio.runState === "paused"')
        self.command('immediate')
        popup = self.tool('Immediate')
        self.js('vb6Studio.immediateInput.value="? 6 * 7"; vb6Studio.immediateInput.focus()')
        popup.keyboard.press('Enter')
        popup.wait_for_function('document.querySelector(".debug-body").textContent.includes("42")')
        popup.close()
        self.count(0)
        self.assertIn('42', self.page.locator('[data-dock-window=immediate]').inner_text())

    def test_layout_snapshot_and_gesture_restore(self):
        self.code()
        popup = self.document()
        props = self.tool()
        self.count(2)
        self.js('window.savedProfile=vb6Studio.captureWindowLayout()')
        self.assertEqual(self.js('savedProfile.browserWindows.length'), 2)
        self.js('vb6Studio.applyWindowLayout(savedProfile)')
        self.count(0)
        self.assertTrue(popup.is_closed() and props.is_closed())
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 2)
        self.page.get_by_role('menuitem', name='Window', exact=True).click()
        self.page.get_by_role('menuitem', name='Restore Browser Window', exact=True).click()
        with self.page.expect_popup() as result:
            self.page.get_by_role('menuitem', name='document:main:code', exact=True).click()
        result.value.wait_for_selector('.source-input')
        self.count(1)
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 1)

    def test_invalid_profile_atomic_and_cross_project_safe(self):
        self.code()
        popup = self.document()
        self.js('window.savedProfile=vb6Studio.captureWindowLayout(); window.bad=structuredClone(savedProfile);bad.browserWindows[0].bounds.width="bad"')
        self.assertTrue(self.js('''() => {try {vb6Studio.applyWindowLayout(bad);return false;} catch {return true;}}'''))
        self.count(1)
        self.assertFalse(popup.is_closed())
        self.js('savedProfile.projectId="unrelated";vb6Studio.applyWindowLayout(savedProfile)')
        self.count(0)
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 0)

    @unittest.skipIf(os.environ.get('VB6_TEST_TRANSPORT') == 'memory', 'Needs real navigation; exercised in HTTP CI')
    def test_reload_owner_offers_restore_without_popups(self):
        self.code()
        popup = self.document()
        self.js('vb6Studio.persist()')
        self.page.reload()
        self.page.wait_for_function('typeof vb6Studio === "object"')
        self.count(0)
        self.assertTrue(popup.is_closed())
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 1)
        self.assertTrue(self.page.get_by_label('Visual Basic source code', exact=True).is_visible())

    @unittest.skipIf(os.environ.get('VB6_TEST_TRANSPORT') == 'memory', 'Needs real navigation; exercised in HTTP CI')
    def test_popup_reload_and_navigation_return_live_node(self):
        self.code()
        for navigate in [False, True]:
            popup = self.document()
            try:
                popup.goto(self.url) if navigate else popup.reload()
            except Exception as error:
                # The host intentionally closes this window while navigation commits.
                if not popup.is_closed() and 'closed' not in str(error) and 'ERR_ABORTED' not in str(error):
                    raise
            self.count(0)
            self.assertTrue(self.page.get_by_label('Visual Basic source code', exact=True).is_visible())

    def test_hide_reset_and_project_replacement(self):
        popup = self.tool()
        self.js('vb6Studio.docking.show("properties",false)')
        self.count(0)
        self.assertTrue(popup.is_closed())
        self.js('vb6Studio.docking.show("properties",true)')
        popup = self.tool()
        self.command('resetLayout')
        self.count(0)
        self.assertTrue(popup.is_closed())
        self.code()
        popup = self.document()
        self.js('p => {vb6Studio.loadProject(p);}', PROJECT)
        self.count(0)
        self.assertTrue(popup.is_closed())

    def test_minimized_document_detaches_with_visible_client(self):
        self.code()
        self.js('vb6Studio.documents.mdi.minimize("main:code")')
        popup = self.document()
        self.assertTrue(popup.get_by_label('Visual Basic source code', exact=True).is_visible())
        self.assertGreater(popup.get_by_label('Visual Basic source code', exact=True).bounding_box()['height'], 30)
        self.closing_action(popup, lambda: popup.get_by_role('button', name='Return to IDE', exact=True).click())
        self.count(0)
        self.assertTrue(self.js('vb6Studio.documents.mdi.windows.get("main:code").minimized'))

    def test_open_from_popup_then_close_initiator(self):
        first = self.tool()
        first.get_by_role('menuitem', name='Window', exact=True).click()
        first.get_by_role('menuitem', name='Float Tool Group in Browser Window', exact=True).click()
        with first.expect_popup() as result:
            first.get_by_role('menuitem', name='Project Explorer', exact=True).click()
        second = result.value
        self.count(2)
        self.assertTrue(second.evaluate('opener.vb6Studio.browserWindows.windows.size===2'))
        first.close()
        self.count(1)
        self.assertFalse(second.is_closed())
        with second.expect_event('close'):
            self.page.close()
        self.assertTrue(second.is_closed())

    def test_two_ide_owners_are_isolated(self):
        first = self.tool()
        other = self.context.new_page()
        self.boot_page(other)
        with other.expect_popup() as result:
            other.get_by_label('Float Properties in Browser Window', exact=True).click()
        second = result.value
        self.assertTrue(first.evaluate('document.querySelector("[data-dock-window=properties]") === opener.vb6Studio.propertiesPanel'))
        self.assertTrue(second.evaluate('document.querySelector("[data-dock-window=properties]") === opener.vb6Studio.propertiesPanel'))
        self.trace.append({'stage': 'before owner close', 'owners': [page.evaluate('''() => ({url:location.href,
          main:typeof vb6Studio==='object',keys:typeof vb6Studio==='object'?[...vb6Studio.browserWindows.windows.keys()]:[],
          opener:!!opener,openerMain:!!opener&&typeof opener.vb6Studio==='object'})''') for page in self.context.pages]})
        with first.expect_event('close'):
            self.page.close()
        self.assertTrue(first.is_closed())
        self.assertFalse(second.is_closed())
        self.assertEqual(other.evaluate('vb6Studio.browserWindows.windows.size'), 1)

    @unittest.skipIf(os.environ.get('VB6_TEST_TRANSPORT') == 'memory', 'Needs real navigation; exercised in HTTP CI')
    def test_standalone_file_without_network(self):
        self.page.goto((ROOT / 'dist' / 'VB6-Studio-Web.html').as_uri())
        self.page.wait_for_function('typeof vb6Studio === "object"')
        requests = []
        self.context.on('request', lambda req: requests.append(req.url) if req.url.startswith(('http:', 'https:')) else None)
        popup = self.tool()
        self.assertTrue(popup.get_by_label('Selected object', exact=True).is_visible())
        self.local_command(popup, 'Tools', 'options')
        self.assertTrue(popup.locator('.ide-dialog').is_visible())
        popup.keyboard.press('Escape')
        popup.close()
        self.count(0)
        self.window_mode('mdi')
        self.local_command(self.page, 'Window', 'tile')
        self.assertEqual(self.page.locator('.mdi-window:visible').count(), 2)
        self.assertEqual(self.page.locator('[data-browser-detach]:visible').count(), 0)
        self.count(0)
        self.assertEqual(requests, [])

    def window_mode(self, mode, page=None):
        page = page or self.page
        page.get_by_role('menuitem', name='Window', exact=True).click()
        page.get_by_role('menuitem', name='Window Mode', exact=True).click()
        label = 'In-page MDI only' if mode == 'mdi' else 'MDI with optional browser windows'
        page.get_by_role('menuitemcheckbox', name=label, exact=True).click()

    def test_mdi_mode_options_apply_and_cancel(self):
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'hybrid')
        self.local_command(self.page, 'Tools', 'options')
        self.page.get_by_role('tab', name='Docking', exact=True).click()
        setting = self.page.get_by_label('IDE window mode', exact=True)
        self.assertEqual(setting.input_value(), 'hybrid')
        setting.select_option('mdi')
        self.page.get_by_role('button', name='Cancel', exact=True).click()
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'hybrid')
        self.local_command(self.page, 'Tools', 'options')
        self.page.get_by_role('tab', name='Docking', exact=True).click()
        self.page.get_by_label('IDE window mode', exact=True).select_option('mdi')
        self.page.screenshot(path=str(REPORT / 'mdi-window-setting.png'))
        self.page.get_by_role('button', name='OK', exact=True).click()
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'mdi')
        self.assertFalse(self.js('vb6Studio.browserWindows.enabled'))
        self.assertFalse(self.js('Object.hasOwn(vb6Studio.project.settings, "windowMode")'))
        self.local_command(self.page, 'Tools', 'options')
        self.page.get_by_role('tab', name='Docking', exact=True).click()
        self.assertEqual(self.page.get_by_label('IDE window mode', exact=True).input_value(), 'mdi')
        self.page.keyboard.press('Escape')

    def test_mdi_mode_invalid_options_do_not_return_windows(self):
        self.code()
        popup = self.document()
        self.local_command(popup, 'Tools', 'options')
        popup.get_by_role('tab', name='Docking', exact=True).click()
        popup.get_by_label('IDE window mode', exact=True).select_option('mdi')
        popup.get_by_role('tab', name='Editor', exact=True).click()
        popup.get_by_label('Tab width', exact=True).fill('0')
        popup.get_by_role('button', name='OK', exact=True).click()
        popup.get_by_role('dialog', name='Invalid value', exact=True).get_by_role('button', name='OK', exact=True).click()
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'hybrid')
        self.count(1)
        self.assertFalse(popup.is_closed())
        popup.keyboard.press('Escape')
        self.assertFalse(self.js('!!vb6Studio.root.closest("[inert]")'))

    def test_mdi_mode_blocks_all_detachment_paths(self):
        self.code()
        self.window_mode('mdi')
        self.js('''() => { window.popupCalls=0;window.open=()=>{popupCalls++;return null;}; }''')
        self.assertEqual(self.js('''() => {const i=vb6Studio,h=i.browserWindows;
          return [i.documents.mdi.detach('main:code'),i.docking.detach('properties'),
            i.commandBars.detach('standard'),i.restoreBrowserWindow('document:main:code'),
            h.detach('document:main:code',i.documents.mdi.windows.get('main:code').node)];}'''), [False] * 5)
        self.assertEqual(self.js('popupCalls'), 0)
        self.count(0)
        self.assertEqual(self.page.locator('[data-browser-detach]:visible').count(), 0)
        self.assertTrue(self.page.get_by_label('Visual Basic source code', exact=True).is_visible())
        self.page.locator('.mdi-active .mdi-system-menu').click()
        self.assertEqual(self.page.get_by_role('menuitem', name='Float in Browser Window', exact=True).get_attribute('aria-disabled'), 'true')
        self.page.keyboard.press('Escape')
        self.page.get_by_role('menuitem', name='Window', exact=True).click()
        self.assertEqual(self.page.get_by_role('menuitem', name='Float Document in Browser Window', exact=True).get_attribute('aria-disabled'), 'true')
        self.page.keyboard.press('Escape')
        self.js('() => {vb6Studio.openDocument("other", "code");}')
        self.assertEqual(self.page.locator('[data-browser-detach]:visible').count(), 0)
        self.assertTrue(self.page.locator('.mdi-active').get_by_label('Minimize document', exact=True).is_visible())

    def test_mdi_mode_move_resize_minimize_maximize_and_cycle(self):
        self.code('other')
        self.window_mode('mdi')
        self.js('''() => {const m=vb6Studio.documents.mdi,w=m.windows.get('other:code');
          w.rect={x:20,y:20,width:360,height:280};m.restore(w.key);}''')
        node = self.page.locator('[data-mdi-key="other:code"]')
        before = self.js('({...vb6Studio.documents.mdi.windows.get("other:code").rect})')
        title = node.locator('.document-title strong').bounding_box()
        self.page.mouse.move(title['x'] + 40, title['y'] + 7)
        self.page.mouse.down()
        self.page.mouse.move(title['x'] + 70, title['y'] + 31, steps=5)
        self.page.mouse.up()
        moved = self.js('({...vb6Studio.documents.mdi.windows.get("other:code").rect})')
        self.assertAlmostEqual(moved['x'], before['x'] + 30, delta=1)
        self.assertAlmostEqual(moved['y'], before['y'] + 24, delta=1)
        handle = node.locator('[data-edge=se]').bounding_box()
        x, y = handle['x'] + handle['width'] / 2, handle['y'] + handle['height'] / 2
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        self.page.mouse.move(x + 35, y + 25, steps=5)
        self.page.mouse.up()
        resized = self.js('({...vb6Studio.documents.mdi.windows.get("other:code").rect})')
        self.assertAlmostEqual(resized['width'], moved['width'] + 35, delta=1)
        self.assertAlmostEqual(resized['height'], moved['height'] + 25, delta=1)
        node.get_by_label('Minimize document', exact=True).click()
        self.assertTrue(self.js('vb6Studio.documents.mdi.windows.get("other:code").minimized'))
        node.get_by_label('Restore document', exact=True).click()
        node.get_by_label('Maximize document', exact=True).click()
        self.assertTrue(self.js('vb6Studio.documents.mdi.windows.get("other:code").maximized'))
        node.get_by_label('Restore document', exact=True).click()
        self.assertEqual(self.js('({...vb6Studio.documents.mdi.windows.get("other:code").rect})'), resized)
        self.page.keyboard.press('Control+Tab')
        self.assertEqual(self.js('vb6Studio.documents.mdi.active'), 'main:code')
        self.page.keyboard.press('Control+F4')
        self.assertFalse(self.js('vb6Studio.documents.mdi.windows.has("main:code")'))
        self.count(0)
        self.assertEqual(len(self.context.pages), 1)

    def test_mdi_mode_tile_and_cascade_remain_in_page(self):
        self.window_mode('mdi')
        self.local_command(self.page, 'Window', 'tile')
        self.assertEqual(self.js('vb6Studio.documents.mdi.windows.size'), 2)
        for command, axis in [('tileHorizontal', 'y'), ('tileVertical', 'x'), ('cascade', 'x')]:
            self.local_command(self.page, 'Window', command)
            rects = self.js('[...vb6Studio.documents.mdi.windows.values()].map(w=>({...w.rect}))')
            self.assertGreater(rects[1][axis], rects[0][axis])
            self.assertEqual(self.page.locator('.mdi-window:visible').count(), 2)
        self.local_command(self.page, 'Window', 'tile')
        self.page.screenshot(path=str(REPORT / 'in-page-mdi.png'))
        self.assertEqual(len(self.context.pages), 1)
        self.assertTrue(self.page.locator('.designer-plane').is_visible())
        self.assertTrue(self.page.get_by_label('Visual Basic source code', exact=True).is_visible())

    def test_mdi_mode_returns_all_windows_and_preserves_live_editing(self):
        self.code()
        editor = self.document()
        source = editor.get_by_label('Visual Basic source code', exact=True)
        source.focus()
        editor.keyboard.press('Control+End')
        editor.keyboard.insert_text("\n' retain on return\n")
        props = self.tool()
        self.page.get_by_label('Move Standard toolbar', exact=True).click(button='right')
        with self.page.expect_popup() as result:
            self.page.get_by_role('menuitem', name='Float in Browser Window', exact=True).click()
        toolbar = self.ready_popup(result.value)
        self.js('''() => {window.savedInput=vb6Studio.documents.editors.get('main').input;
          window.savedCode=vb6Studio.project.modules[0].code;
          window.savedHistory=vb6Studio.history.undoStack.length;}''')
        self.local_command(props, 'Tools', 'options')
        props.get_by_role('tab', name='Docking', exact=True).click()
        props.get_by_label('IDE window mode', exact=True).select_option('mdi')
        self.closing_action(props, lambda: props.get_by_role('button', name='OK', exact=True).click())
        self.count(0)
        self.assertTrue(editor.is_closed() and toolbar.is_closed())
        self.assertTrue(self.js('savedInput===vb6Studio.editor.input && savedInput.ownerDocument===document'))
        self.assertTrue(self.js('savedCode===vb6Studio.project.modules[0].code'))
        self.assertEqual(self.js('vb6Studio.history.undoStack.length'), self.js('savedHistory'))
        self.assertFalse(self.js('!!vb6Studio.root.closest("[inert]")'))
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 3)
        self.assertFalse(self.js('!!vb6Studio.browserWindows.timer'))
        self.page.get_by_label('Visual Basic source code', exact=True).focus()
        self.page.keyboard.press('Control+z')
        self.assertNotIn('retain on return', self.js('vb6Studio.project.modules[0].code'))
        self.window_mode('hybrid')
        self.count(0)
        self.assertEqual(len(self.context.pages), 1)
        self.page.get_by_role('menuitem', name='Window', exact=True).click()
        self.page.get_by_role('menuitem', name='Restore Browser Window', exact=True).click()
        with self.page.expect_popup() as result:
            self.page.get_by_role('menuitem', name='document:main:code', exact=True).click()
        self.ready_popup(result.value)
        self.count(1)

    def test_mdi_mode_named_layout_and_project_switch_do_not_override_preference(self):
        self.code()
        self.document()
        self.js('window.savedProfile=vb6Studio.captureWindowLayout()')
        self.window_mode('mdi')
        self.js('vb6Studio.applyWindowLayout(savedProfile)')
        self.count(0)
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'mdi')
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 1)
        self.assertFalse(self.js('vb6Studio.restoreBrowserWindow("document:main:code")'))
        self.assertTrue(self.js('''() => {try{vb6Studio.setWindowMode('unknown');return false;}catch{return true;}}'''))
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'mdi')
        self.js('p => {vb6Studio.loadProject(p);}', PROJECT)
        self.command('resetLayout')
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'mdi')
        self.assertFalse(self.js('vb6Studio.browserWindows.enabled'))
        self.assertEqual(self.js('vb6Studio.root.dataset.windowMode'), 'mdi')
        self.count(0)

    def test_hybrid_mode_keeps_mdi_and_detached_documents_together(self):
        self.code()
        popup = self.document()
        self.js('() => {vb6Studio.openDocument("other", "code");}')
        self.count(1)
        self.local_command(self.page, 'Window', 'tileVertical')
        self.assertTrue(self.page.locator('[data-mdi-key="other:code"]').is_visible())
        self.assertTrue(popup.locator('[data-mdi-key="main:code"]').is_visible())
        self.assertEqual(self.js('vb6Studio.documents.mdi.windows.size'), 2)
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'hybrid')
        self.window_mode('mdi')
        self.count(0)
        self.assertTrue(popup.is_closed())
        self.local_command(self.page, 'Window', 'tileHorizontal')
        self.assertEqual(self.page.locator('.mdi-window:visible').count(), 2)

    def test_mdi_mode_switch_preserves_paused_debugger(self):
        self.code()
        popup = self.document()
        self.js('vb6Studio.breakpoints=[{module:"MainModule",line:4}]')
        popup.get_by_label('Visual Basic source code', exact=True).focus()
        popup.keyboard.press('F5')
        self.page.wait_for_function('vb6Studio.runState==="paused" && vb6Studio.editor.execution?.line===4')
        self.js('window.savedRuntime=vb6Studio.runtimeFrame')
        self.closing_action(popup, lambda: self.window_mode('mdi', popup))
        self.count(0)
        self.assertTrue(self.js('vb6Studio.runtimeFrame===savedRuntime && vb6Studio.runState==="paused"'))
        self.page.get_by_label('Visual Basic source code', exact=True).focus()
        self.page.keyboard.press('F8')
        self.page.wait_for_function('vb6Studio.runState==="paused" && vb6Studio.editor.execution?.line===5')
        self.page.keyboard.press('Shift+F5')
        self.page.wait_for_function('vb6Studio.runState==="design"')

    @unittest.skipIf(os.environ.get('VB6_TEST_TRANSPORT') == 'memory', 'Needs real storage/reload; exercised in HTTP CI')
    def test_mdi_mode_persists_across_reload_with_pending_browser_layout(self):
        self.code()
        self.document()
        self.window_mode('mdi')
        self.js('vb6Studio.persist()')
        self.page.reload()
        self.page.wait_for_function('typeof vb6Studio === "object"')
        self.count(0)
        self.assertEqual(self.js('vb6Studio.appearance.windowMode'), 'mdi')
        self.assertEqual(self.js('vb6Studio.browserWindows.pending.size'), 1)
        self.assertFalse(self.js('vb6Studio.browserWindows.enabled'))
        self.assertEqual(self.page.locator('[data-browser-detach]:visible').count(), 0)
        self.assertTrue(self.page.get_by_label('Visual Basic source code', exact=True).is_visible())

if __name__ == '__main__':
    unittest.main(verbosity=2)

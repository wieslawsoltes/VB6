#!/usr/bin/env python3
"""Optional IDE theme integration: real DOM, Options, portals and browser windows.
No model/provider/network traffic is required. VB6_BROWSER selects the engine.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
MEMORY = os.environ.get('VB6_TEST_TRANSPORT') == 'memory'
REPORT = ROOT / 'reports' / 'ide-themes' / ENGINE
THEMES = ['fluent', 'fluent-dark', 'macos26', 'macos26-dark', 'x11', 'x11-dark', 'x11-cde', 'x11-cde-dark']
# Ignore absolute position: IDE caption metrics can change. Authored form/control
# sizes, relative coordinates, visual properties and runtime palettes must not.
SNAPSHOT = '''() => {
 const root=document.querySelector('.designer-form'),bounds=root.getBoundingClientRect();
 const fields=['font-family','font-size','line-height','color','background-color','border-top-color','border-top-width','border-radius','box-shadow','appearance','padding','color-scheme'];
 return [root,...root.querySelectorAll('*')].filter(e=>e.tagName!=='CANVAS').map(e=>{
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {tag:e.tagName,cls:e.getAttribute('class'),rect:(!r.width&&!r.height)?[0,0,0,0]:[r.x-bounds.x,r.y-bounds.y,r.width,r.height].map(n=>Math.round(n*100)/100),
   style:Object.fromEntries(fields.map(k=>[k,s.getPropertyValue(k)]))};
 });
}'''
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

class Themes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True, exist_ok=True)
        cls.results=[]
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}/dist/index.html'
        cls.pw=sync_playwright().start()
        options={}
        if ENGINE=='chromium':
            path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if path: options['executable_path']=path
            options['args']=['--no-sandbox']
        cls.browser=getattr(cls.pw,ENGINE).launch(**options)
    @classmethod
    def tearDownClass(cls):
        (REPORT/'results.json').write_text(json.dumps(cls.results, indent=2))
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.maxDiff=None
        self.context=self.browser.new_context(viewport={'width':1440,'height':1000},color_scheme='light')
        self.context.set_default_timeout(8000)
        self.errors=[]
        self.context.on('page',lambda p:p.on('pageerror',lambda e:self.errors.append(str(e))))
        self.page=self.context.new_page()
        if MEMORY: self.page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        else: self.page.goto(self.url)
        self.page.wait_for_function('typeof vb6Studio === "object"')
    def tearDown(self):
        self.context.close();self.assertEqual(self.errors,[],'Uncaught page errors')
    def record(self, name, **details):
        self.results.append({'test':self._testMethodName,'case':name,'transport':'memory' if MEMORY else 'http/file',**details})
    def command(self, name):
        self.page.evaluate('name=>{void vb6Studio.command(name);}',name)
    def options(self):
        self.page.get_by_role('menuitem',name='Tools',exact=True).click()
        self.page.locator('.classic-menu [data-command="options"]').click()
        self.page.get_by_role('tab',name='General',exact=True).click()
    def set_theme(self, theme):
        self.options();self.page.get_by_label('IDE theme',exact=True).select_option(theme)
        self.page.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
        self.page.wait_for_function('t=>document.documentElement.dataset.ideTheme===t',arg=theme)
        self.page.wait_for_timeout(130)
    def direct_theme(self, theme, **preferences):
        self.page.evaluate('a=>{Object.assign(vb6Studio.appearance,a);vb6Studio.applyAppearance();}',{'theme':theme,**preferences})
        self.page.wait_for_timeout(130)
    def test_all_theme_options_preserve_authored_form_and_project(self):
        before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
        undo=self.page.evaluate('vb6Studio.history.undoStack.length')
        baseline=self.page.evaluate(SNAPSHOT)
        for theme in THEMES:
            with self.subTest(theme=theme):
                self.set_theme(theme)
                self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
                self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),undo)
                after=self.page.evaluate(SNAPSHOT)
                # Include the first differing node in assertion output.
                self.assertEqual(len(after),len(baseline))
                for index,(old,new) in enumerate(zip(baseline,after)):
                    self.assertEqual(new,old,f'{theme} authored node {index}')
                self.assertEqual(self.page.locator('.designer-scroll').get_attribute('data-vb-theme'),'classic')
                self.page.screenshot(path=str(REPORT/f'{theme}-designer.png'))
                self.record(theme,authoredNodes=len(after),projectUnchanged=True)
        self.set_theme('classic')
        self.assertEqual(self.page.evaluate(SNAPSHOT),baseline)
    def test_cancel_preview(self):
        initial=self.page.evaluate('JSON.stringify(vb6Studio.appearance)')
        self.options();self.page.get_by_label('IDE theme',exact=True).select_option('macos26-dark')
        self.assertEqual(self.page.locator('.ide-theme-preview').get_attribute('data-preview-theme'),'macos26-dark')
        self.assertEqual(self.page.locator('html').get_attribute('data-ide-theme'),'classic')
        self.page.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click()
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.appearance)'),initial)
        self.record('Cancel leaves theme and appearance untouched')
    @unittest.skipIf(MEMORY, 'Real storage/reload requires an origin; memory transport has an opaque origin')
    def test_persistence_workspace_reload(self):
        self.set_theme('fluent-dark')
        self.page.evaluate('()=>{vb6Studio.persist();}')
        self.page.reload();self.page.wait_for_function('vb6Studio.appearance.theme==="fluent-dark"')
        self.assertEqual(self.page.locator('html').get_attribute('data-ide-theme'),'fluent-dark')
        self.record('Cancel and saved workspace restore')
    def test_system_appearance_accessibility_and_classic_restore(self):
        for base in ['fluent','macos26','x11','x11-cde']:
            self.direct_theme(base,followSystemTheme=True)
            self.page.emulate_media(color_scheme='dark')
            self.page.wait_for_function('t=>document.documentElement.dataset.ideTheme===t',arg=base+'-dark')
            self.assertEqual(self.page.evaluate('vb6Studio.appearance.theme'),base)
            self.page.emulate_media(color_scheme='light')
            self.page.wait_for_function('t=>document.documentElement.dataset.ideTheme===t',arg=base)
        self.direct_theme('macos26',followSystemTheme=False,reduceTransparency=True,reduceMotion=True)
        self.assertEqual(self.page.locator('.app-title').evaluate('(e)=>getComputedStyle(e).backdropFilter'),'none')
        self.assertEqual(self.page.locator('.menubar button').first.evaluate('(e)=>getComputedStyle(e).transitionDuration'),'0s')
        self.direct_theme('macos26-dark',reduceTransparency=False,reduceMotion=False)
        self.page.emulate_media(forced_colors='active',reduced_motion='reduce')
        self.assertEqual(self.page.locator('.app-title').evaluate('(e)=>getComputedStyle(e).backdropFilter'),'none')
        self.assertEqual(self.page.locator('.menubar button').first.evaluate('(e)=>getComputedStyle(e).transitionDuration'),'0s')
        self.page.screenshot(path=str(REPORT/'forced-colors.png'))
        self.page.emulate_media(forced_colors='none',reduced_motion='no-preference')
        self.set_theme('contrast');self.set_theme('classic')
        self.assertEqual(self.page.locator('html').get_attribute('data-vb-theme'),'classic')
        self.record('Four OS-scheme pairs, reduced effects, forced colors and classic restore')
    def test_editor_menus_property_palettes_and_controls(self):
        self.page.evaluate('()=>{vb6Studio.openDocument(vb6Studio.activeModule.id,"code");vb6Studio.appearance.codeColors={keyword:"#b1c8fa"};}')
        for theme in THEMES:
            self.direct_theme(theme)
            self.assertEqual(self.page.locator('.mdi-active .source-input').evaluate('(e)=>getComputedStyle(e).color'),'rgba(0, 0, 0, 0)')
            self.assertEqual(self.page.locator('.mdi-active .syn-keyword').first.evaluate('(e)=>getComputedStyle(e).color'),'rgb(177, 200, 250)')
            self.page.get_by_role('menuitem',name='Edit',exact=True).click()
            menu=self.page.locator('.classic-menu').last
            self.assertTrue(menu.is_visible())
            # Portal must use the same resolved palette despite its legacy data-vb-theme.
            self.assertEqual(menu.evaluate('(e)=>getComputedStyle(e).getPropertyValue("--vb-window").trim()'),self.page.locator('html').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--vb-window").trim()'))
            self.page.screenshot(path=str(REPORT/f'{theme}-editor-menu.png'))
            self.page.keyboard.press('Escape')
            self.record(theme,editorOverlayTransparent=True,customKeywordPreserved=True,menuPaletteMatches=True)
        self.command('viewForm')
        self.page.locator('.property-row[data-property="BackColor"]').click()
        # Properties exposes the palette through the small editor button.
        self.page.locator('.property-row[data-property="BackColor"] button').last.click()
        palette=self.page.get_by_role('dialog',name='Color palette',exact=True)
        self.assertTrue(palette.is_visible())
        self.assertEqual(palette.locator('[data-system-color="15"] .color-swatch').evaluate('(e)=>getComputedStyle(e).backgroundColor'),'rgb(192, 192, 192)')
        self.page.screenshot(path=str(REPORT/'property-palette.png'))
        self.page.keyboard.press('Escape')
        self.options()
        for theme in THEMES:
            self.page.get_by_label('IDE theme',exact=True).select_option(theme)
            self.assertEqual(self.page.get_by_label('Application theme',exact=True).locator('option').count(),11)
        checkbox=self.page.get_by_label('Follow system light/dark appearance',exact=True)
        # Programmatic focus retains pointer modality in Firefox. Exercise real
        # keyboard navigation, not engine-specific :focus-visible heuristics.
        checkbox.focus()
        self.page.keyboard.press('Shift+Tab')
        self.assertFalse(checkbox.evaluate('(e)=>e===e.ownerDocument.activeElement'))
        self.page.keyboard.press('Tab')
        self.assertTrue(checkbox.evaluate('(e)=>e===e.ownerDocument.activeElement'))
        self.assertTrue(checkbox.evaluate('(e)=>e.matches(":focus-visible")'))
        self.page.keyboard.press('Space');self.assertTrue(checkbox.is_checked())
        self.assertGreater(float(checkbox.evaluate('(e)=>parseFloat(getComputedStyle(e).outlineWidth)')),0)
        self.record('Keyboard Tab and Space',checkboxToggled=True,focusVisible=True)
        self.page.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click()
    def keyboard_focus(self, control):
        control.focus()
        self.page.keyboard.press('Shift+Tab');self.page.keyboard.press('Tab')
        self.assertTrue(control.evaluate('(e)=>e===e.ownerDocument.activeElement&&e.matches(":focus-visible")'))
    def color_contrast(self, control, foreground='color', background='backgroundColor'):
        return control.evaluate(r'''(e,[fg,bg])=>{
          const s=getComputedStyle(e),parse=c=>(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
          const luminance=c=>parse(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;})
            .reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
          const a=luminance(s[fg]),b=luminance(s[bg]);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        }''',[foreground,background])
    def test_filled_controls_and_template_selection(self):
        before=self.page.evaluate('JSON.stringify(vb6Studio.project)')
        self.direct_theme('fluent-dark',reduceMotion=True);self.options()
        primary=self.page.locator('.ide-dialog .default-button')
        checkbox=self.page.get_by_label('Follow system light/dark appearance',exact=True)
        for theme in THEMES:
            self.direct_theme(theme)
            self.keyboard_focus(primary)
            self.assertGreaterEqual(self.color_contrast(primary,'outlineColor'),3,theme+' primary focus contrast')
            self.assertGreater(float(primary.evaluate('(e)=>parseFloat(getComputedStyle(e).outlineWidth)')),0)
            # Space depresses a real primary button; release away from it so
            # the settings dialog remains open without invoking its action.
            self.page.keyboard.down('Space')
            self.assertGreaterEqual(self.color_contrast(primary),4.5,theme+' pressed text contrast')
            checkbox.focus();self.page.keyboard.up('Space')
            self.keyboard_focus(checkbox)
            was_checked=checkbox.is_checked();self.page.keyboard.press('Space')
            self.assertNotEqual(checkbox.is_checked(),was_checked)
            self.assertGreaterEqual(float(checkbox.evaluate('(e)=>parseFloat(getComputedStyle(e).outlineOffset)')),1)
            primary.evaluate('(e)=>e.disabled=true')
            self.assertEqual(primary.evaluate('(e)=>getComputedStyle(e).color'),self.page.locator('.ide-theme-note').evaluate('(e)=>{const p=e.ownerDocument.createElement("span");p.style.color="var(--vb-gray)";e.append(p);const c=getComputedStyle(p).color;p.remove();return c;}'))
            primary.evaluate('(e)=>e.disabled=false')
            self.record(theme,primaryFocusContrast=True,pressedTextContrast=True,checkedFocusOutside=True)
        self.page.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click()
        self.command('new')
        for theme in THEMES:
            self.direct_theme(theme)
            item=self.page.locator('.template-option.selected')
            item.hover();self.keyboard_focus(item)
            self.assertGreaterEqual(self.color_contrast(item),4.5,theme+' selected template')
            self.assertGreaterEqual(self.color_contrast(item,'outlineColor'),3,theme+' selected template focus')
            unselected=self.page.locator('.template-option:not(.selected)').first
            self.assertNotEqual(item.evaluate('(e)=>getComputedStyle(e).backgroundColor'),unselected.evaluate('(e)=>getComputedStyle(e).backgroundColor'))
            self.page.keyboard.press('ArrowRight')
            self.assertEqual(self.page.locator('.template-option.selected[aria-selected="true"]').count(),1)
            self.page.screenshot(path=str(REPORT/f'{theme}-template-selection.png'))
            self.record(theme,templateSelection=True,keyboardSelection=True)
        self.page.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click()
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'),before)
    def test_forced_colors_preserve_labels_arrows_and_focus(self):
        self.direct_theme('fluent-dark',reduceMotion=True);self.options()
        self.page.emulate_media(forced_colors='active')
        # Media emulation and the adjustment CSS property are independent:
        # WebKit 2227 exposes the media query but not forced-color-adjust.
        capabilities=self.page.evaluate('''()=>({
          media:matchMedia('(forced-colors: active)').matches,
          adjustment:CSS.supports('forced-color-adjust','none')
        })''')
        self.record('forced-colors capability',**capabilities)
        if not capabilities['media']:
            self.skipTest('This engine does not expose forced-colors media emulation')
        for theme in THEMES:
            self.direct_theme(theme)
            primary=self.page.locator('.ide-dialog .default-button');self.keyboard_focus(primary)
            if capabilities['adjustment']:
                for selector in ['.dialog-caption strong','.ide-theme-preview-title','.ide-theme-preview-selected','.ide-dialog .default-button']:
                    control=self.page.locator(selector)
                    self.assertEqual(control.evaluate('(e)=>getComputedStyle(e).forcedColorAdjust'),'none',theme+' '+selector)
            # The user owns the system palette. Verify its matched color pair,
            # not a numeric contrast target that would reject custom OS colors.
            self.assertTrue(primary.evaluate('''e=>{
              const p=e.ownerDocument.createElement('span');p.style.cssText='forced-color-adjust:none;color:HighlightText;background:Highlight';
              e.append(p);const expected=getComputedStyle(p),actual=getComputedStyle(e);
              const matches=actual.color===expected.color&&actual.backgroundColor===expected.backgroundColor&&actual.outlineColor===expected.color;
              p.remove();return matches;
            }'''))
            self.assertEqual(self.page.get_by_label('IDE theme',exact=True).evaluate('(e)=>getComputedStyle(e).appearance'),'auto')
            if capabilities['adjustment']:
                self.assertEqual(self.page.locator('html').evaluate('(e)=>getComputedStyle(e).forcedColorAdjust'),'auto')
                self.assertEqual(self.page.locator('.designer-form').evaluate('(e)=>getComputedStyle(e).forcedColorAdjust'),'auto')
            self.page.screenshot(path=str(REPORT/f'{theme}-forced-colors-controls.png'))
            self.record(theme,forcedColorAdjustSupported=capabilities['adjustment'],
                        nativeSelectArrow=True,systemColorPair=True,
                        runtimeAdjustmentVerified=capabilities['adjustment'])
        self.page.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click()
        self.page.emulate_media(forced_colors='none')
    def test_detached_windows_receive_live_theme_and_return(self):
        self.set_theme('fluent-dark')
        with self.page.expect_popup() as opened:
            self.page.get_by_label('Float Properties in Browser Window',exact=True).click()
        popup=opened.value
        popup.wait_for_function('document.documentElement.dataset.ideTheme==="fluent-dark"')
        self.assertTrue(popup.get_by_label('Selected object',exact=True).is_visible())
        for theme in THEMES+['classic','contrast']:
            self.direct_theme(theme)
            popup.wait_for_function('t=>document.documentElement.dataset.ideTheme===t',arg=theme)
            self.assertEqual(popup.locator('html').get_attribute('data-ide-theme-family'),self.page.locator('html').get_attribute('data-ide-theme-family'))
            self.record(theme,detachedSynchronized=True)
        self.direct_theme('macos26',followSystemTheme=True)
        self.page.emulate_media(color_scheme='dark')
        popup.wait_for_function('document.documentElement.dataset.ideTheme==="macos26-dark"')
        popup.screenshot(path=str(REPORT/'detached-properties.png'))
        popup.close()
        self.page.wait_for_function('vb6Studio.browserWindows.windows.size===0')
        self.assertTrue(self.page.get_by_label('Selected object',exact=True).is_visible())
    def test_modeless_tools_and_control_states(self):
        # These are real IDE tools, opened without connecting to any provider.
        tools=[('objectBrowser','.classic-object-browser'),('resourceEditor','.resource-editor'),
               ('dataEnvironment','.data-environment'),('codingAgents','.agent-panel'),('mcpAgentAccess','.mcp-panel')]
        for theme in THEMES:
            self.direct_theme(theme)
            for command,selector in tools:
                with self.subTest(theme=theme,tool=command):
                    self.command(command)
                    panel=self.page.locator(selector)
                    self.assertTrue(panel.is_visible())
                    palette=self.page.locator('html').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--vb-window").trim()')
                    self.assertEqual(panel.evaluate('(e)=>getComputedStyle(e).getPropertyValue("--vb-window").trim()'),palette)
                    fields=panel.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):visible,textarea:visible,select:visible')
                    if fields.count():
                        first=fields.first
                        self.assertNotEqual(first.evaluate('(e)=>getComputedStyle(e).color'),first.evaluate('(e)=>getComputedStyle(e).backgroundColor'))
                    self.page.screenshot(path=str(REPORT/f'{theme}-{command}.png'))
                    self.record(theme,modelessTool=command,paletteMatches=True)
            # Open each tool's tabs without altering permissions/connections.
            for command,selector in [('codingAgents','.agent-panel'),('mcpAgentAccess','.mcp-panel')]:
                self.command(command)
                tabs=self.page.locator(selector+' [role=tab]')
                for index in range(tabs.count()):
                    tabs.nth(index).click()
                    self.assertEqual(tabs.nth(index).get_attribute('aria-selected'),'true')
            self.assertFalse(self.page.evaluate('vb6Studio.mcp.adapter.enabled'))
            self.assertFalse(self.page.evaluate('vb6Studio.codingAgents.agent.busy'))
        self.command('locals');self.command('watch');self.command('callStack')
        self.assertTrue(self.page.get_by_role('listbox',name='Call stack frames',exact=True).is_visible())
        self.page.screenshot(path=str(REPORT/'debugger-panes.png'))

    def test_narrow_options(self):
        self.page.set_viewport_size({'width':600,'height':600})
        for theme in ['fluent-dark','macos26','x11-cde']:
            self.direct_theme(theme)
            self.options()
            self.page.get_by_label('IDE theme',exact=True).select_option(theme)
            self.page.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
            self.options()
            dialog=self.page.locator('.ide-dialog');box=dialog.bounding_box()
            self.assertGreaterEqual(box['x'],-1);self.assertLessEqual(box['x']+box['width'],601)
            self.assertGreaterEqual(box['y'],-1);self.assertLessEqual(box['y']+box['height'],601)
            self.page.screenshot(path=str(REPORT/f'{theme}-narrow-options.png'))
            dialog.get_by_role('button',name='Cancel',exact=True).click()
            self.record(theme,narrowDialogInsideViewport=True)
    @unittest.skipIf(MEMORY, 'File navigation unavailable in restricted memory transport; exercised by CI')
    def test_standalone_file(self):
        self.page.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri())
        self.page.wait_for_function('typeof vb6Studio==="object"')
        self.set_theme('macos26-dark')
        self.assertEqual(self.page.locator('html').get_attribute('data-ide-theme'),'macos26-dark')
        self.record('standalone file:// Options')

if __name__=='__main__':
    unittest.main(verbosity=2)

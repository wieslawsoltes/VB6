#!/usr/bin/env python3
"""WinUI XAML -> VB model -> standalone browser/IDE acceptance.

Runs real HTTP and file origins, compiled VB handlers and native input events.
No in-memory navigation or network asset substitute is an acceptance path here.
Native Windows pixel parity remains a separately documented acceptance target.
"""
from __future__ import annotations

import functools
import http.server
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import unittest
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
FIXTURE = ROOT / 'reports/winui3/fixtures'
REPORT = ROOT / 'reports/winui3' / ENGINE
BUILD_FIXTURE = r'''
import fs from 'node:fs';
import {winui3Gallery,WINUI3_GALLERY_XAML} from './tests/fixtures/winui3-gallery.mjs';
import {winui3LayoutGallery,WINUI3_LAYOUT_XAML} from './tests/fixtures/winui3-layout-gallery.mjs';
import {exportApplication} from './src/exporter/exporter.js';
import {compileProject} from './src/language/compiler.js';
import {WINUI3_REFERENCE} from './src/theme/winui3-resources.js';
const project=winui3Gallery(),compiled=compileProject(project);
if(!compiled.valid)throw new Error(JSON.stringify(compiled.diagnostics));
fs.mkdirSync('reports/winui3/fixtures',{recursive:true});
fs.writeFileSync('reports/winui3/fixtures/gallery.html',exportApplication(project,{persist:false}));
fs.writeFileSync('reports/winui3/fixtures/gallery.json',JSON.stringify(project));
fs.writeFileSync('reports/winui3/fixtures/gallery.xaml',WINUI3_GALLERY_XAML);
fs.writeFileSync('reports/winui3/fixtures/reference.json',JSON.stringify(WINUI3_REFERENCE));
fs.writeFileSync('reports/winui3/fixtures/graphics.html','<!doctype html><meta charset="utf-8"><title>WinUI Canvas acceptance</title>');
const layoutProject=winui3LayoutGallery(),layoutCompiled=compileProject(layoutProject);
if(!layoutCompiled.valid)throw new Error(JSON.stringify(layoutCompiled.diagnostics));
fs.writeFileSync('reports/winui3/fixtures/layout.html',exportApplication(layoutProject,{persist:false}));
fs.writeFileSync('reports/winui3/fixtures/layout.xaml',WINUI3_LAYOUT_XAML);
'''

# Independent expectations from the authored resource dictionaries in the fixture.
LIGHT_BRUSH = '#40201080'
DARK_BRUSH = '#406080c0'
CONTRAST_BRUSH = '#00ff0080'
SHADOW_BRUSH = '#2060a080'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class WinUI3Acceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The normal build must run first, as it does for the other browser suites.
        subprocess.run(['node', '--input-type=module', '-e', BUILD_FIXTURE], cwd=ROOT, check=True)
        REPORT.mkdir(parents=True, exist_ok=True)
        cls.results = []
        cls.project = json.loads((FIXTURE / 'gallery.json').read_text())
        cls.source = (FIXTURE / 'gallery.xaml').read_text()
        cls.reference = json.loads((FIXTURE / 'reference.json').read_text())
        cls.server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.pw = sync_playwright().start()
        options = {'headless': True}
        if ENGINE == 'chromium':
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            options['args'] = ['--no-sandbox']
        cls.browser = getattr(cls.pw, ENGINE).launch(**options)

    @classmethod
    def tearDownClass(cls):
        (REPORT / 'results.json').write_text(json.dumps({
            'browser': ENGINE, 'transport': 'HTTP and file origins',
            'reference': cls.reference, 'nativePixelParityCertified': False,
            'results': cls.results}, indent=2))
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.started = time.perf_counter()
        self.errors, self.requests = [], []
        self.passed = False
        self.context = self.browser.new_context(
            viewport={'width': 1440, 'height': 1100}, color_scheme='light',
            reduced_motion='reduce', device_scale_factor=1)
        self.context.set_default_timeout(10000)
        self.context.on('page', lambda page: page.on('pageerror', lambda error: self.errors.append(str(error))))
        self.context.on('request', lambda request: self.requests.append(request.url))
        self.page = self.context.new_page()
        self.load_runtime()

    def tearDown(self):
        external = [url for url in self.requests if urlparse(url).scheme in ('http', 'https')
                    and not url.startswith(self.base)]
        self.results.append({
            'name': self._testMethodName,
            'passed': self.passed and not self.errors and not external,
            'pageErrors': self.errors, 'externalRequests': external,
            'milliseconds': round((time.perf_counter() - self.started) * 1000, 2)})
        if not self.passed:
            try:
                self.page.screenshot(path=str(REPORT / (self._testMethodName + '-failure.png')))
            except Exception:
                pass
        self.context.close()
        self.assertEqual(self.errors, [], 'No uncaught browser errors')
        self.assertEqual(external, [], 'WinUI resources and exported apps are self-contained')

    def done(self):
        self.passed = True

    def load_runtime(self, file_origin=False, fixture='gallery.html'):
        self.page.goto((FIXTURE / fixture).as_uri() if file_origin
                       else self.base + 'reports/winui3/fixtures/' + fixture)
        self.page.wait_for_function('globalThis.vb6Application?.forms?.length === 1')
        self.page.evaluate('''() => {
            window.winuiControls=Object.fromEntries(vb6Application.forms[0].controls.map(c=>[c.model.name,c]));
            window.winuiIdentity=vb6Application.forms[0].controls.map(c=>({control:c,node:c.node,input:c.input}));
        }''')
        self.idle()

    def idle(self, page=None):
        (page or self.page).wait_for_function('''() => {
            const host=vb6Application;
            return host?.vm && !host.vm.processing && host.vm.eventQueue.length===0 &&
                host.forms.every(f=>!f.pending&&f.controls.every(c=>!c.pending));
        }''')

    def control(self, name):
        return self.page.locator(f'[data-control="{name}"]')

    def field(self, name):
        return self.control(name).locator('input')

    def theme(self, name):
        self.page.evaluate('name=>vb6Application.setTheme(name,{reduceMotion:true,reduceTransparency:true})', name)
        self.idle()

    def set_control(self, name, values):
        self.page.evaluate('''([name,values])=>{
            for(const [key,value] of Object.entries(values))winuiControls[name].set(key,value);
        }''', [name, values])
        self.idle()

    def expect_color(self, locator, property_name, color):
        # Browsers serialize alpha differently (e.g. #80 becomes .5 or .502).
        # Canonicalize the independent expected literal through the browser's
        # CSS parser, then still wait for the exact computed-paint endpoint.
        canonical = locator.evaluate('''(e,color)=>{
            const probe=e.ownerDocument.createElement('i');
            probe.style.cssText='position:absolute;pointer-events:none;forced-color-adjust:none';
            probe.style.color=color;e.ownerDocument.body.append(probe);
            const value=getComputedStyle(probe).color;probe.remove();return value;
        }''', color)
        expect(locator).to_have_css(property_name, canonical)

    def assert_identity(self):
        self.assertTrue(self.page.evaluate('''winuiIdentity.every((saved,index)=>
            saved.control===vb6Application.forms[0].controls[index] &&
            saved.node===saved.control.node && saved.input===saved.control.input)'''))

    def test_live_font_and_box_resources_remeasure_hug_wrapping_and_release_lifetime_state(self):
        self.load_runtime(fixture='layout.html')
        authored = self.page.evaluate('JSON.stringify(vb6Application.project)')
        native_fonts = self.page.evaluate('''() => Object.fromEntries(
            ['Hug','Wrapped','Fixed'].map(name=>[name,
                ['FontName','FontSize','FontBold'].map(key=>winuiControls[name].props[key])]))''')

        def geometry():
            # Layout publishes solved twips synchronously, then paints at the
            # next frame. Wait for both queues before inspecting actual glyphs.
            self.page.wait_for_function('''() => {
                const f=vb6Application.forms[0],l=f.layoutController;
                return !l.frame&&!l.paint.size&&!f.pending&&f.controls.every(c=>!c.pending);
            }''')
            return self.page.evaluate(r'''() => {
                const read=name=>{
                    const c=winuiControls[name],n=c.node,r=n.getBoundingClientRect(),s=getComputedStyle(n);
                    const text=[...n.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
                    let glyphs=[],visibleGlyphs=[],missingGlyphs=[];
                    if(text){const range=document.createRange();range.selectNode(text);
                        const rect=g=>({x:g.x-r.x,y:g.y-r.y,width:g.width,height:g.height});
                        glyphs=[...range.getClientRects()].map(rect);
                        // pre-wrap hangs trailing spaces. WebKit also returns
                        // a zero-width caret at the previous line's end for the
                        // next character; its bounding-box union spans both
                        // lines. Inspect positive-area glyph fragments, keeping
                        // complete line ranges for width/line-count checks.
                        for(let i=0;i<text.textContent.length;i++)if(/\S/u.test(text.textContent[i])){
                            range.setStart(text,i);range.setEnd(text,i+1);
                            const fragments=[...range.getClientRects()].filter(g=>g.width>0&&g.height>0);
                            if(!fragments.length)missingGlyphs.push(i);
                            visibleGlyphs.push(...fragments.map(rect));}}
                    return {x:r.x,y:r.y,width:r.width,height:r.height,glyphs,visibleGlyphs,missingGlyphs,
                        fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,
                        padding:['Left','Top','Right','Bottom'].map(side=>parseFloat(s['padding'+side])),
                        border:['Left','Top','Right','Bottom'].map(side=>parseFloat(s['border'+side+'Width'])),
                        modes:[c.props.LayoutWidthMode??0,c.props.LayoutHeightMode??0]};
                };
                return Object.fromEntries(['Scope','Flow','Hug','Wrapped','Fixed'].map(name=>[name,read(name)]));
            }''')

        def assert_box(snapshot, family, size, weight, padding, stroke, flow):
            outer, inner = snapshot['Scope'], snapshot['Flow']
            for actual, expected in zip((inner['x'] - outer['x'], inner['y'] - outer['y'],
                                         inner['width'], inner['height']), flow):
                self.assertAlmostEqual(actual, expected, delta=0.05, msg='Container padding and stroke inset exactly once')
            hug, wrapped, fixed = (snapshot[name] for name in ('Hug', 'Wrapped', 'Fixed'))
            self.assertIn(family, hug['fontFamily'])
            self.assertEqual(hug['fontSize'], f'{size}px')
            self.assertEqual(hug['fontWeight'], str(weight))
            self.assertEqual(hug['padding'], padding)
            self.assertEqual(hug['border'], stroke)
            self.assertEqual(hug['modes'], [1, 1])
            self.assertEqual(wrapped['modes'], [2, 1])
            self.assertEqual((fixed['width'], fixed['height']), (160, 44))
            self.assertEqual(len(hug['glyphs']), 1)
            horizontal = padding[0] + padding[2] + stroke[0] + stroke[2]
            # The browser's actual text Range is an independent size oracle;
            # this fails if measurement keeps the initial font or box chrome.
            self.assertAlmostEqual(hug['width'], hug['glyphs'][0]['width'] + horizontal, delta=0.15)
            self.assertGreaterEqual(hug['height'] + 0.1,
                                    hug['glyphs'][0]['height'] + padding[1] + padding[3] + stroke[1] + stroke[3])
            self.assertAlmostEqual(wrapped['width'], inner['width'], delta=0.05)
            self.assertAlmostEqual(wrapped['y'] - hug['y'], hug['height'] + 8, delta=0.05)
            self.assertAlmostEqual(fixed['y'] - wrapped['y'], wrapped['height'] + 8, delta=0.05)
            self.assertEqual(wrapped['missingGlyphs'], [], 'Every visible character has a measured glyph fragment')
            for glyph in wrapped['visibleGlyphs']:
                self.assertGreaterEqual(glyph['x'], -0.1)
                self.assertLessEqual(glyph['x'] + glyph['width'], wrapped['width'] + 0.15)
                self.assertGreaterEqual(glyph['y'], -0.1)
                self.assertLessEqual(glyph['y'] + glyph['height'], wrapped['height'] + 0.15)
            self.assert_identity()
            self.assertEqual(self.page.evaluate('JSON.stringify(vb6Application.project)'), authored)

        light = geometry()
        assert_box(light, 'Arial', 16, 400, [2, 3, 4, 5], [1, 2, 3, 4], [7, 10, 298, 322])
        self.theme('fluent-dark')
        dark = geometry()
        assert_box(dark, 'Courier New', 24, 700, [10, 7, 14, 9], [3, 4, 5, 6], [11, 4, 286, 338])
        self.assertGreater(dark['Hug']['width'], light['Hug']['width'] + 50)
        self.assertGreater(dark['Wrapped']['height'], light['Wrapped']['height'])
        self.assertGreater(len(dark['Wrapped']['glyphs']), len(light['Wrapped']['glyphs']))
        self.theme('fluent')
        self.assertEqual(geometry(), light, 'Returning to Light restores the same solved and painted geometry')
        self.assertEqual(self.page.evaluate('''() => Object.fromEntries(
            ['Hug','Wrapped','Fixed'].map(name=>[name,
                ['FontName','FontSize','FontBold'].map(key=>winuiControls[name].props[key])]))'''), native_fonts)

        # Explicit same-value native font edits release only that resource;
        # the remaining live family, weight and insets still remeasure correctly.
        self.theme('fluent-dark')
        self.page.evaluate('winuiControls.Hug.set("FontSize",winuiControls.Hug.FontSize)')
        self.idle()
        released = geometry()
        assert_box(released, 'Courier New', 16, 700, [10, 7, 14, 9], [3, 4, 5, 6], [11, 4, 286, 338])
        self.assertLess(released['Hug']['width'], dark['Hug']['width'])
        self.assertTrue(self.page.evaluate('''() => {
            const m=winuiControls.Hug.WinUI3;
            return !Object.hasOwn(m.properties,'FontSize')&&!Object.hasOwn(m.resources,'FontSize')&&
                Object.hasOwn(m.resources,'FontFamily')&&Object.hasOwn(m.resources,'Padding');
        }'''))

        self.set_control('Hug', {'WinUI3': None})
        removed = geometry()['Hug']
        for theme in ('fluent', 'fluent-dark'):
            self.theme(theme)
            current = geometry()['Hug']
            self.assertEqual((current['width'], current['height']), (removed['width'], removed['height']))
            self.assertEqual(current['fontSize'], '16px')
            self.assertEqual(current['fontWeight'], '400')
            self.assertIn('Arial', current['fontFamily'])
            self.assertEqual(current['modes'], [1, 1])
        self.assert_identity()
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Application.project)'), authored)

        # Dispose with layout and control painting queued. Form disposal tears
        # down its controller first, so each subsequent brush/metric cleanup
        # must tolerate that lifetime order and leave no repaint or listeners.
        lifecycle = self.page.evaluate('''() => {
            const form=vb6Application.forms[0],layout=form.layoutController;
            winuiControls.Wrapped.set('Caption','A final queued layout change');
            vb6Application.dispose();vb6Application.dispose();
            return {disposed:layout.disposed,frame:layout.frame,paint:layout.paint.size,records:layout.records.size,
                attached:form.node.isConnected,subscriptions:VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)};
        }''')
        self.assertEqual(lifecycle, {'disposed': True, 'frame': 0, 'paint': 0, 'records': 0,
                                    'attached': False, 'subscriptions': {'controls': 0, 'themeListeners': 0}})
        self.done()

    def test_live_resources_preserve_real_input_value_selection_and_authored_model(self):
        text = self.field('LiveText')
        text.fill('Retained draft')
        expect(self.control('TextStatus')).to_have_text('1:Retained draft')
        text.evaluate('e=>{e.focus();e.setSelectionRange(2,9,"backward");}')
        before = text.locator('..').bounding_box()
        authored = self.page.evaluate('JSON.stringify(vb6Application.project)')
        for theme, brush, ink in (
                ('fluent-dark', DARK_BRUSH, 'rgb(232, 237, 245)'),
                ('fluent', LIGHT_BRUSH, 'rgb(16, 32, 64)'),
                ('fluent-dark', DARK_BRUSH, 'rgb(232, 237, 245)'),
                ('fluent', LIGHT_BRUSH, 'rgb(16, 32, 64)')):
            self.theme(theme)
            # The unfocused sibling exposes normal brushes. Native TextBox
            # Focused resources deliberately replace its normal template paint.
            self.expect_color(self.field('PaintSample'), 'background-color', brush)
            expect(self.field('PaintSample')).to_have_css('color', ink)
            expect(text).to_have_value('Retained draft')
            expect(text).to_be_focused()
            self.assertEqual(text.evaluate('e=>[e.selectionStart,e.selectionEnd,e.selectionDirection]'), [2, 9, 'backward'])
            self.assertEqual(text.locator('..').bounding_box(), before)
            self.assert_identity()
            self.assertEqual(self.page.evaluate('JSON.stringify(vb6Application.project)'), authored)
        expect(self.control('TextStatus')).to_have_text('1:Retained draft')
        self.page.screenshot(path=str(REPORT / 'light-imported-gallery.png'))
        self.done()

    def test_alpha_is_composited_once_and_real_same_value_vb_assignment_releases_resource(self):
        self.page.mouse.move(1400, 1000)
        sample = self.field('PaintSample')
        self.expect_color(sample, 'background-color', LIGHT_BRUSH)
        # #80402010 over #FFF3F3F3 produces this color after one blend. A second
        # identically painted host/canvas would visibly darken the sample.
        pixels = Image.open(io.BytesIO(sample.screenshot())).convert('RGB')
        pixel = pixels.getpixel((pixels.width - 12, pixels.height // 2))
        for actual, expected in zip(pixel, (153, 137, 129)):
            self.assertAlmostEqual(actual, expected, delta=2)
        fallback = self.page.evaluate('winuiControls.PaintSample.BackColor')
        self.control('ReleaseColor').click()
        expect(self.control('ActionStatus')).to_have_text('VB color assigned')
        self.assertEqual(self.page.evaluate('winuiControls.PaintSample.BackColor'), fallback)
        for theme in ('fluent-dark', 'fluent'):
            self.theme(theme)
            expect(sample).to_have_css('background-color', 'rgb(64, 32, 16)')
            self.expect_color(self.field('LiveText'), 'background-color', DARK_BRUSH if theme.endswith('-dark') else LIGHT_BRUSH)
            expect(sample).to_have_css('color', 'rgb(232, 237, 245)' if theme.endswith('-dark') else 'rgb(16, 32, 64)')
        self.assert_identity()
        self.done()

    def test_resource_shadowing_and_nested_requested_theme_follow_native_precedence(self):
        for theme in ('fluent', 'fluent-dark', 'fluent'):
            self.theme(theme)
            self.expect_color(self.field('ShadowText'), 'background-color', SHADOW_BRUSH)
            self.expect_color(self.field('DarkText'), 'background-color', DARK_BRUSH)
            self.expect_color(self.field('LightText'), 'background-color', LIGHT_BRUSH)
            expect(self.control('DarkText')).to_have_attribute('data-winui-effective-theme', 'Dark')
            expect(self.control('LightText')).to_have_attribute('data-winui-effective-theme', 'Light')
        # A requested theme property edit repaints only its affected descendants.
        self.page.evaluate('''() => {
            const c=winuiControls.DarkScope,value=structuredClone(c.WinUI3);
            value.requestedTheme='Light';c.set('WinUI3',value);
        }''')
        self.expect_color(self.field('DarkText'), 'background-color', LIGHT_BRUSH)
        self.expect_color(self.field('LightText'), 'background-color', LIGHT_BRUSH)
        self.theme('fluent-dark')
        self.set_control('DarkScope', {'WinUI3': None})
        self.expect_color(self.field('DarkText'), 'background-color', DARK_BRUSH)
        self.expect_color(self.field('LightText'), 'background-color', LIGHT_BRUSH)
        self.set_control('LightScope', {'WinUI3': None})
        self.expect_color(self.field('LightText'), 'background-color', DARK_BRUSH)
        self.theme('contrast')
        for name in ('PaintSample', 'DarkText', 'LightText'):
            self.expect_color(self.field(name), 'background-color', CONTRAST_BRUSH)
            expect(self.control(name)).to_have_attribute('data-winui-effective-theme', 'HighContrast')
        self.expect_color(self.field('ShadowText'), 'background-color', SHADOW_BRUSH)
        self.assert_identity()
        self.done()

    def test_native_normal_foreground_uses_requested_theme_and_scoped_resources(self):
        # A control's native normal-state Foreground must use the same resource
        # scope as its PointerOver/Focused states. Legacy host-level OLE colors
        # produce unreadable black-on-dark or white-on-light nested inputs.
        for theme in ('fluent', 'fluent-dark', 'fluent'):
            self.theme(theme)
            self.page.mouse.move(1400, 1000)
            for name, expected in (('DarkText', '#ffffffff'),
                                   ('ScopeChoices', '#ffffffff'),
                                   ('LightText', '#000000e4')):
                field = self.field(name)
                self.expect_color(field, 'color', expected)
                field.hover()
                self.expect_color(field, 'color', expected)
                self.page.mouse.move(1400, 1000)
                self.expect_color(field, 'color', expected)
            self.expect_color(self.field('ShadowText'), 'color', '#5123a8')
        self.assert_identity()
        self.done()

    def test_child_textblock_keeps_explicit_foreground_when_parent_changes_state(self):
        self.page.mouse.move(1400, 1000)
        self.set_control('ShadowScope', {'WinUI3': {
            'version': 1, 'sourceType': 'Canvas',
            'properties': {'Foreground': '#FFFF0000'},
            'states': {'PointerOver': {'Foreground': '#FF00FF00'}}}})
        parent, child = self.control('ShadowScope'), self.control('ScopeHeading')
        expect(parent).to_have_css('color', 'rgb(255, 0, 0)')
        expect(child).to_have_css('color', 'rgb(0, 0, 255)')
        child.hover()
        expect(parent).to_have_css('color', 'rgb(0, 255, 0)')
        expect(child).to_have_css('color', 'rgb(0, 0, 255)')
        self.theme('fluent-dark')
        expect(child).to_have_css('color', 'rgb(0, 0, 255)')
        self.page.mouse.move(1400, 1000)
        expect(parent).to_have_css('color', 'rgb(255, 0, 0)')
        self.set_control('ShadowScope', {'WinUI3': None})
        expect(child).to_have_css('color', 'rgb(0, 0, 255)')
        self.assert_identity()
        self.done()

    def test_late_graphics_surface_follows_button_states_and_retains_drawn_commands(self):
        self.page.mouse.move(1400, 1000)
        self.page.evaluate('''async () => {
            const surface=winuiControls.StateButton.ensureSurface();
            window.retainedButtonCanvas=surface.canvas;
            surface.add('rect',[7,7,13,13],255,true);
            await surface.flush();
        }''')
        button = self.control('StateButton')

        def assert_painted_state(rgb):
            # The retained buffer and the final composed browser pixels are
            # independent of the CSS variable spelling used by the adapter.
            self.page.wait_for_function('''rgb=>{
                const p=winuiControls.StateButton.surface.readPixels(215,15,1,1).data;
                return rgb.every((value,index)=>Math.abs(p[index]-value)<=1);
            }''', arg=list(rgb))
            pixels = Image.open(io.BytesIO(button.screenshot())).convert('RGB')
            for actual, expected in zip(pixels.getpixel((pixels.width - 12, pixels.height // 2)), rgb):
                self.assertAlmostEqual(actual, expected, delta=2)
            self.assertEqual(self.page.evaluate('''() =>
                [...winuiControls.StateButton.surface.readPixels(10,10,1,1).data]'''), [255, 0, 0, 255])

        button.hover()
        assert_painted_state((190, 34, 102))
        self.page.mouse.down()
        try:
            assert_painted_state((102, 51, 153))
        finally:
            self.page.mouse.up()
        assert_painted_state((190, 34, 102))
        self.set_control('StateButton', {'Enabled': 0})
        assert_painted_state((120, 120, 120))
        self.theme('fluent-dark')
        assert_painted_state((120, 120, 120))
        self.set_control('StateButton', {'Enabled': -1, 'Caption': 'Retained caption'})
        assert_painted_state((190, 34, 102))
        self.assertTrue(self.page.evaluate('''() => {
            const c=winuiControls.StateButton;
            return c.surface.canvas===retainedButtonCanvas&&retainedButtonCanvas.parentElement===c.node;
        }'''))
        expect(button).to_have_text('Retained caption')
        # The caption must remain visible above the backing canvas. A DOM text
        # assertion alone would miss an opaque canvas covering every glyph.
        pixels = Image.open(io.BytesIO(button.screenshot())).convert('RGB')
        center = pixels.crop((24, 6, pixels.width - 24, pixels.height - 6))
        channels = center.tobytes()
        white_glyphs = sum(r > 200 and g > 150 and b > 200
                           for r, g, b in zip(channels[0::3], channels[1::3], channels[2::3]))
        self.assertGreater(white_glyphs, 30, 'Caption glyphs paint above retained background')

        text, rich = self.field('PaintSample'), self.control('RichDocument').get_by_role('textbox')
        text.fill('Surface input')
        rich.fill('Surface document')
        self.field('LiveText').focus()
        self.page.mouse.move(1400, 1000)
        self.theme('fluent')
        self.page.evaluate('''async () => {
            for(const name of ['PaintSample','RichDocument']) {
                const surface=winuiControls[name].ensureSurface();
                surface.add('rect',[7,7,13,13],255,true);await surface.flush();
            }
        }''')

        def assert_field_paint(name, rgba, blended):
            self.page.wait_for_function('''([name,rgba])=>{
                const p=winuiControls[name].surface.readPixels(215,15,1,1).data;
                return rgba.every((value,index)=>Math.abs(p[index]-value)<=1);
            }''', arg=[name, list(rgba)])
            pixels = Image.open(io.BytesIO(self.control(name).screenshot())).convert('RGB')
            for actual, expected in zip(pixels.getpixel((pixels.width - 12, pixels.height // 2)), blended):
                self.assertAlmostEqual(actual, expected, delta=2)
            self.assertEqual(self.page.evaluate('''name=>
                [...winuiControls[name].surface.readPixels(10,10,1,1).data]''', name), [255, 0, 0, 255])

        for theme, rgba, blended in (
                ('fluent', (64, 32, 16, 128), (153, 137, 129)),
                ('fluent-dark', (64, 96, 128, 192), (56, 80, 104))):
            self.theme(theme)
            for name in ('PaintSample', 'RichDocument'):
                assert_field_paint(name, rgba, blended)
        self.theme('fluent')
        text.focus()
        text.hover()
        self.page.mouse.down()
        try:
            expect(text).to_be_focused()
            self.assertTrue(self.control('PaintSample').evaluate('e=>e.matches(":active")'))
            assert_field_paint('PaintSample', (255, 255, 255, 255), (255, 255, 255))
            self.theme('fluent-dark')
            assert_field_paint('PaintSample', (30, 30, 30, 179), (31, 31, 31))
        finally:
            self.page.mouse.up()
        expect(text).to_have_value('Surface input')
        expect(rich).to_have_text('Surface document')
        self.assert_identity()
        self.done()

    def test_richeditbox_alpha_has_one_paint_plane_and_preserves_edited_document(self):
        editor = self.control('RichDocument').get_by_role('textbox', name='RichDocument', exact=True)
        retained = editor.element_handle()
        editor.fill('Retained rich draft')
        self.page.evaluate('''() => {
            const c=winuiControls.RichDocument;c.SelStart=0;c.SelLength=8;
            c.SelColor=255;c.SelFontName='Tahoma';c.SelFontSize=12;c.SelBold=0;
            c.SelStart=10;c.SelLength=5;
        }''')
        self.field('LiveText').focus()
        self.page.mouse.move(1400, 1000)
        capture = '''() => {
            const c=winuiControls.RichDocument;
            return JSON.stringify({state:c.rich.capture(),rtf:c.TextRTF,undo:c.rich.undoStack,redo:c.rich.redoStack});
        }'''
        history = self.page.evaluate(capture)
        for theme, brush, blended, ink, family, size, weight in (
                ('fluent', LIGHT_BRUSH, (153, 137, 129), 'rgb(16, 32, 64)', 'Arial', '14px', '400'),
                ('fluent-dark', DARK_BRUSH, (56, 80, 104), 'rgb(232, 237, 245)', 'Courier New', '20px', '700'),
                ('fluent', LIGHT_BRUSH, (153, 137, 129), 'rgb(16, 32, 64)', 'Arial', '14px', '400')):
            self.theme(theme)
            self.expect_color(editor, 'background-color', brush)
            pixels = Image.open(io.BytesIO(editor.screenshot())).convert('RGB')
            for actual, expected in zip(pixels.getpixel((pixels.width - 12, pixels.height - 12)), blended):
                self.assertAlmostEqual(actual, expected, delta=2)
            expect(editor).to_have_text('Retained rich draft')
            self.assertEqual(self.page.evaluate('winuiControls.RichDocument.get("Text")'), 'Retained rich draft')
            self.assertTrue(retained.evaluate('e=>e===winuiControls.RichDocument.input'))
            # Inspect the elements that paint the actual glyphs. Input color
            # alone cannot detect inline run styles stuck on an earlier theme.
            runs = editor.evaluate('''e=>{
                const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),runs=[];
                while(walker.nextNode())if(walker.currentNode.textContent) {
                    const s=getComputedStyle(walker.currentNode.parentElement);
                    runs.push({text:walker.currentNode.textContent,color:s.color,fontFamily:s.fontFamily,
                        fontSize:s.fontSize,fontWeight:s.fontWeight});
                }
                return runs;
            }''')
            explicit = next(run for run in runs if run['text'] == 'Retained')
            inherited = next(run for run in runs if run['text'] == ' rich draft')
            self.assertEqual(explicit['color'], 'rgb(255, 0, 0)')
            self.assertIn('Tahoma', explicit['fontFamily'])
            self.assertEqual((explicit['fontSize'], explicit['fontWeight']), ('16px', '400'))
            self.assertEqual(inherited['color'], ink)
            self.assertIn(family, inherited['fontFamily'])
            self.assertEqual((inherited['fontSize'], inherited['fontWeight']), (size, weight))
            self.assertEqual(self.page.evaluate(capture), history, 'Theme changes preserve rich document, selection, RTF and undo history')
        self.assert_identity()
        self.done()

    def test_open_combo_popup_tracks_requested_theme_and_disposes_with_its_control(self):
        choices = self.control('ScopeChoices')
        choices.locator('.vb-combo-arrow').click()
        popup = self.page.get_by_role('listbox', name='ScopeChoices items', exact=True)
        expect(popup).to_be_visible()
        expect(popup).to_have_attribute('data-winui-effective-theme', 'Dark')
        retained = popup.element_handle()
        dark = popup.evaluate('e=>getComputedStyle(e).backgroundColor')
        self.set_control('DarkScope', {'WinUI3': None})
        expect(popup).to_have_attribute('data-winui-effective-theme', 'Light')
        self.assertTrue(retained.evaluate('e=>e===document.querySelector(".vb-combo-popup")'))
        self.assertNotEqual(popup.evaluate('e=>getComputedStyle(e).backgroundColor'), dark)
        expect(self.control('LightText')).to_have_attribute('data-winui-effective-theme', 'Light')
        choices.locator('input').press('Escape')
        expect(popup).to_have_count(0)
        # VB preserves authored controls for the lifetime of their form. Use
        # its public dynamic-control API to exercise real removal with an open
        # popup, instead of bypassing that design-time lifetime contract.
        self.page.evaluate('''() => {
            const form=vb6Application.forms[0];
            const combo=form.Controls.Add('VB.ComboBox','TemporaryChoices',winuiControls.DarkScope);
            for(const [key,value] of Object.entries({Left:0,Top:0,Width:3000,Height:480,Visible:-1,
                WinUI3:structuredClone(winuiControls.ScopeChoices.WinUI3)}))combo.set(key,value);
            combo.AddItem('First');combo.AddItem('Second');
        }''')
        self.idle()
        self.control('TemporaryChoices').locator('.vb-combo-arrow').click()
        temporary = self.page.get_by_role('listbox', name='TemporaryChoices items', exact=True)
        expect(temporary).to_be_visible()
        expect(temporary).to_have_attribute('data-winui-effective-theme', 'Light')
        self.page.evaluate('vb6Application.forms[0].Controls.Remove("TemporaryChoices")')
        expect(temporary).to_have_count(0)
        expect(self.control('TemporaryChoices')).to_have_count(0)
        self.theme('fluent-dark')
        expect(self.control('DarkText')).to_have_attribute('data-winui-effective-theme', 'Dark')
        self.done()

    def test_moving_an_unrequested_container_repaints_existing_descendants(self):
        self.set_control('MovingScope', {'Left': 0, 'Top': 0})
        for parent, theme, brush in (('DarkScope', 'Dark', DARK_BRUSH),
                                      ('LightScope', 'Light', LIGHT_BRUSH),
                                      ('Layout', 'Light', LIGHT_BRUSH)):
            self.page.evaluate('name=>winuiControls.MovingScope.set("Container",winuiControls[name])', parent)
            self.idle()
            expect(self.control('MovingScope')).to_have_attribute('data-winui-effective-theme', theme)
            expect(self.control('PaintSample')).to_have_attribute('data-winui-effective-theme', theme)
            self.expect_color(self.field('PaintSample'), 'background-color', brush)
            self.assert_identity()
        self.theme('fluent-dark')
        self.expect_color(self.field('PaintSample'), 'background-color', DARK_BRUSH)
        self.done()

    def test_switch_toggle_hyperlink_buttons_and_range_run_compiled_vb_handlers(self):
        switch = self.page.get_by_role('switch', name='Notifications', exact=True)
        expect(switch).to_be_checked()
        expect(self.control('Notifications').locator('.vb-winui-switch-header')).to_have_text('Notifications')
        self.assertIn('Enabled', self.control('Notifications').inner_text())
        self.expect_color(self.control('Notifications'), 'color', '#000000e4')
        switch.press('Space')
        expect(switch).not_to_be_checked()
        expect(switch).to_have_attribute('aria-checked', 'false')
        expect(self.control('ToggleStatus')).to_have_text('1:0')
        self.assertIn('Disabled', self.control('Notifications').inner_text())
        switch.click()
        expect(switch).to_be_checked()
        expect(self.control('ToggleStatus')).to_have_text('2:1')
        self.set_control('Notifications', {'Enabled': 0})
        expect(switch).to_be_disabled()
        self.expect_color(self.control('Notifications'), 'color', '#0000005c')
        switch.evaluate('e=>e.click()')
        self.idle()
        expect(self.control('ToggleStatus')).to_have_text('2:1')
        self.set_control('Notifications', {'Enabled': -1})
        self.expect_color(self.control('Notifications'), 'color', '#000000e4')

        toggle = self.field('Pin')
        expect(toggle).to_have_attribute('role', 'button')
        expect(toggle).to_have_attribute('aria-pressed', 'false')
        toggle.press('Space')
        expect(toggle).to_have_attribute('aria-pressed', 'true')
        expect(self.control('PinStatus')).to_have_text('1:1')
        toggle.click()
        expect(toggle).to_have_attribute('aria-pressed', 'false')
        expect(self.control('PinStatus')).to_have_text('2:0')
        self.field('LiveText').fill('Saved draft')
        for name, caption in (('DefaultButton', 'default:Saved draft'),
                              ('AccentButton', 'accent:Saved draft'),
                              ('HelpLink', 'help opened locally')):
            self.control(name).click()
            expect(self.control('ActionStatus')).to_have_text(caption)
        slider = self.field('Gain')
        slider.focus()
        slider.press('ArrowRight')
        expect(slider).to_have_value('45')
        expect(self.control('RangeStatus')).to_have_text('45')
        slider.press('End')
        expect(slider).to_have_value('100')
        expect(self.control('RangeStatus')).to_have_text('100')
        self.assert_identity()
        self.done()

    def test_partial_toggle_state_brushes_keep_checked_paint_during_pointer_transitions(self):
        self.set_control('Pin', {'WinUI3': {
            'version': 1, 'sourceType': 'ToggleButton',
            'properties': {'Background': '#FF123456'},
            'states': {'Checked': {'Background': '#FFAA3300'},
                       'PointerOver': {'Background': '#FF00AA33'}}}})
        self.set_control('Pin', {'Value': 1})
        self.page.mouse.move(1400, 1000)
        toggle = self.control('Pin')
        expect(toggle).to_have_css('background-color', 'rgb(170, 51, 0)')
        toggle.hover()
        expect(toggle).to_have_css('background-color', 'rgb(170, 51, 0)')
        self.page.mouse.down()
        try:
            expect(toggle).to_have_css('background-color', 'rgb(170, 51, 0)')
        finally:
            self.page.mouse.up()
        expect(self.field('Pin')).to_have_attribute('aria-pressed', 'false')
        expect(toggle).to_have_css('background-color', 'rgb(0, 170, 51)')
        self.page.mouse.move(1400, 1000)
        expect(toggle).to_have_css('background-color', 'rgb(18, 52, 86)')
        self.done()

    def test_source_metrics_progress_gradient_and_scoped_pointer_states(self):
        self.page.mouse.move(1400, 1000)
        # DIPs from the fixture remain outer VB geometry, independent of paint.
        for name, width, height in (
                ('LiveText', 330, 32), ('DefaultButton', 130, 32),
                ('Notifications', 300, 68), ('Progress', 320, 20),
                ('Gain', 320, 32), ('DarkText', 230, 32)):
            bounds = self.control(name).bounding_box()
            self.assertAlmostEqual(bounds['width'], width, delta=0.1, msg=name)
            self.assertAlmostEqual(bounds['height'], height, delta=0.1, msg=name)
        for name in ('Layout', 'ShadowScope', 'DarkScope', 'LightScope', 'StateScope'):
            expect(self.control(name)).to_have_css('border-width', '0px')
            expect(self.control(name)).to_have_css('box-shadow', 'none')
        offset = self.control('ShadowText').evaluate('''e=>{
            const child=e.getBoundingClientRect(),parent=e.parentElement.getBoundingClientRect();
            return [child.x-parent.x,child.y-parent.y];
        }''')
        self.assertEqual(offset, [12, 34], 'Canvas geometry excludes the legacy PictureBox bevel')
        expect(self.field('LiveText')).to_have_css('font-size', '16px')
        self.assertIn('Courier New', self.field('LiveText').evaluate('e=>getComputedStyle(e).fontFamily'))
        switch = self.field('Notifications')
        self.assertEqual(switch.evaluate('e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]'), [40, 20])
        self.assertEqual(switch.evaluate('e=>{const s=getComputedStyle(e,"::before");return [s.width,s.height];}'), ['12px', '12px'])
        progress = self.control('Progress')
        expect(progress).to_have_attribute('role', 'progressbar')
        expect(progress).to_have_attribute('aria-valuenow', '42')
        track, fill = progress.locator('.vb-progress'), progress.locator('.vb-progress-fill')
        self.assertEqual(track.evaluate('e=>getComputedStyle(e,"::before").height'), '1px')
        self.assertAlmostEqual(fill.bounding_box()['height'], 3, delta=0.1)
        self.assertAlmostEqual(fill.bounding_box()['width'] / track.bounding_box()['width'], 0.42, delta=0.01)
        waiting = self.control('Waiting')
        self.assertIsNone(waiting.get_attribute('aria-valuenow'))
        expect(waiting.locator('.vb-progress-fill')).to_have_css('animation-name', 'none')
        self.assertGreater(waiting.locator('.vb-progress-fill').bounding_box()['width'], 0)

        gradient = Image.open(io.BytesIO(self.control('GradientCard').screenshot())).convert('RGB')
        top = gradient.getpixel((gradient.width // 2, 12))
        bottom = gradient.getpixel((gradient.width // 2, gradient.height - 12))
        self.assertGreater(bottom[0] - top[0], 35)
        self.assertGreater(bottom[1] - top[1], 70)
        self.assertGreater(bottom[2] - top[2], 60)
        state = self.control('StateButton')
        ordinary = self.control('DefaultButton')
        # Common_themeresources.xaml's absolute 3-DIP gradient has a 0.33
        # stop (0.99 DIP), reflected around the full control height in Light.
        for name, gradient_css in (
                ('DefaultButton', 'linear-gradient(to top, #00000029 0.99px, #0000000f 3px)'),
                ('AccentButton', 'linear-gradient(to top, #00000066 0.99px, #ffffff14 3px)')):
            border = self.control(name).locator('.vb-winui-border')
            expected = border.evaluate('''(e,value)=>{
                const probe=document.createElement('i');probe.style.backgroundImage=value;
                document.body.append(probe);const actual=getComputedStyle(probe).backgroundImage;
                probe.remove();return actual;
            }''', gradient_css)
            expect(border).to_have_css('background-image', expected)
        normal = ordinary.evaluate('e=>getComputedStyle(e).backgroundColor')
        self.assertNotEqual(normal, 'rgba(0, 0, 0, 0)')
        expect(state).to_have_css('background-color', normal)
        state.hover()
        expect(state).to_have_css('background-color', 'rgb(190, 34, 102)')
        expect(ordinary).to_have_css('background-color', normal)
        self.page.mouse.down()
        try:
            expect(state).to_have_css('background-color', 'rgb(102, 51, 153)')
        finally:
            self.page.mouse.up()
        self.set_control('StateButton', {'Enabled': 0})
        expect(state).to_have_css('background-color', 'rgb(120, 120, 120)')
        self.page.mouse.move(1400, 1000)
        for name, source_type in (('Gain', 'Slider'), ('Progress', 'ProgressBar')):
            self.set_control(name, {'WinUI3': {
                'version': 1, 'sourceType': source_type,
                'properties': {'Background': '#FF123456', 'Foreground': '#FFCC3300'}}})
        # Native Slider/ProgressBar brushes target their track and value parts.
        # A correctly colored root rectangle or text foreground would not
        # produce these independent visible track/value pixels.
        slider_pixels = Image.open(io.BytesIO(self.control('Gain').screenshot())).convert('RGB')
        for position, expected in (((60, 16), (204, 51, 0)), ((270, 16), (18, 52, 86)),
                                   ((300, 2), (243, 243, 243))):
            for actual, channel in zip(slider_pixels.getpixel(position), expected):
                self.assertAlmostEqual(actual, channel, delta=2)
        track = self.control('Progress').locator('.vb-progress')
        self.assertEqual(track.evaluate('e=>getComputedStyle(e,"::before").backgroundColor'), 'rgb(18, 52, 86)')
        expect(self.control('Progress').locator('.vb-progress-fill')).to_have_css('background-color', 'rgb(204, 51, 0)')
        progress_pixels = Image.open(io.BytesIO(self.control('Progress').screenshot())).convert('RGB')
        for position, expected in (((50, 10), (204, 51, 0)), ((280, 2), (243, 243, 243))):
            for actual, channel in zip(progress_pixels.getpixel(position), expected):
                self.assertAlmostEqual(actual, channel, delta=2)
        self.theme('fluent-dark')
        self.page.screenshot(path=str(REPORT / 'dark-imported-gallery.png'))
        self.done()

    def test_forced_colors_selects_high_contrast_resource_branch_and_restores_live_palette(self):
        text = self.field('LiveText')
        text.fill('Accessible draft')
        text.evaluate('e=>{e.focus();e.setSelectionRange(1,6);} ')
        self.page.emulate_media(forced_colors='active')
        if not self.page.evaluate('matchMedia("(forced-colors: active)").matches'):
            self.skipTest('This browser cannot emulate forced-colors; application HighContrast branch is tested separately.')
        for name in ('PaintSample', 'DarkText', 'LightText'):
            expect(self.control(name)).to_have_attribute('data-winui-effective-theme', 'HighContrast')
            # Forced-color adjustment may replace computed paint. The retained
            # normal brush is the actual CSS variable consumed by the input.
            self.assertEqual(self.control(name).evaluate('e=>e.style.getPropertyValue("--winui3-Normal-Background")'), CONTRAST_BRUSH)
        expect(text).to_be_focused()
        self.assertEqual(text.evaluate('e=>[e.selectionStart,e.selectionEnd]'), [1, 6])
        self.page.emulate_media(forced_colors='none')
        self.expect_color(self.field('PaintSample'), 'background-color', LIGHT_BRUSH)
        self.expect_color(self.field('DarkText'), 'background-color', DARK_BRUSH)
        self.assert_identity()
        self.done()

    def test_file_export_and_disposal_release_all_owned_theme_listeners(self):
        self.load_runtime(file_origin=True)
        self.assertEqual(urlparse(self.page.url).scheme, 'file')
        self.field('LiveText').fill('Offline file')
        self.control('AccentButton').click()
        expect(self.control('ActionStatus')).to_have_text('accent:Offline file')
        before = self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)')
        self.assertGreater(before['controls'], 20)
        self.assertEqual(before['themeListeners'], 1)
        self.page.evaluate('''() => {
            for(let i=0;i<30;i++)vb6Application.setTheme(i%2?'fluent':'fluent-dark',{reduceMotion:true});
        }''')
        self.idle()
        self.assertEqual(self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)'), before)
        self.page.evaluate('''() => {
            const api=VB6Runtime.RuntimeAPI,form=vb6Application.forms[0],model=structuredClone(winuiControls.DefaultButton.model);
            model.id='temporary-winui-button';model.name='TemporaryButton';model.properties.Name=model.name;
            window.temporaryWinuiControl=new api.BrowserControl(model,{form,design:true,backend:'canvas2d'});
            form.content.append(temporaryWinuiControl.node);
        }''')
        during = self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)')
        self.assertEqual(during, {'controls': before['controls'] + 1, 'themeListeners': 1})
        self.page.evaluate('temporaryWinuiControl.dispose();temporaryWinuiControl.dispose()')
        self.assertEqual(self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)'), before)
        self.page.evaluate('vb6Application.dispose();vb6Application.dispose()')
        self.assertEqual(self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)'), {'controls': 0, 'themeListeners': 0})
        self.page.emulate_media(color_scheme='dark')
        self.assertEqual(self.page.evaluate('VB6Runtime.RuntimeAPI.winui3PresentationDiagnostics(document)'), {'controls': 0, 'themeListeners': 0})
        self.done()

    def test_ide_file_import_property_edit_undo_reload_and_runtime_keep_authored_xaml(self):
        ide = self.context.new_page()
        ide.goto(self.base + 'dist/index.html')
        ide.wait_for_function('globalThis.vb6Studio?.xaml')
        ide.evaluate('p=>vb6Studio.loadProject(p)', self.project)
        ide.evaluate('vb6Studio.xaml.open() && true')
        source = self.source.replace('WinUI 3 imported XAML', 'Imported through the IDE')
        with ide.expect_file_chooser() as chooser:
            ide.locator('[data-xaml-action="import"]').click()
        chooser.value.set_files({'name': 'Form1.xaml', 'mimeType': 'application/xml', 'buffer': source.encode()})
        editor = ide.locator('.xaml-input')
        expect(editor).to_have_value(source)
        expect(ide.locator('.xaml-problems button')).to_have_count(0)
        ide.evaluate('''() => {
            const button=vb6Studio.activeModule.form.controls.find(c=>c.name==='AccentButton');
            vb6Studio.designer.select([button.id]);
        }''')
        caption = ide.locator('input[data-property="Caption"]')
        caption.fill('Inspector accent')
        caption.press('Enter')
        edited = editor.input_value()
        self.assertIn('Content="Inspector accent"', edited)
        self.assertIn('Style="{StaticResource AccentButtonStyle}"', edited)
        self.assertIn('<ResourceDictionary.ThemeDictionaries>', edited)
        self.assertIn('<LinearGradientBrush x:Key="PreviewGradient"', edited)
        self.assertIn('Preserve the resources, vocabulary, comments and handlers', edited)
        self.assertIn('Toggled="Notifications_Click"', edited)
        self.assertNotIn('<vb:Form', edited)
        ide.evaluate('vb6Studio.command("undo")')
        expect(editor).to_have_value(source)
        ide.evaluate('vb6Studio.command("redo")')
        expect(editor).to_have_value(edited)
        ide.evaluate('''() => {
            const heading=vb6Studio.activeModule.form.controls.find(c=>c.name==='Heading');
            vb6Studio.designer.select([heading.id]);
        }''')
        heading = ide.locator('.designer-scroll [data-control="Heading"]')
        expect(heading).to_have_css('font-weight', '500')
        if ide.locator('select[data-property="FontBold"]').count() == 0:
            ide.get_by_role('button', name='Expand Font', exact=True).click()
        font_bold = ide.locator('select[data-property="FontBold"]')
        expect(font_bold).to_have_value('0')
        # Choosing the same VB Boolean takes ownership of a native medium
        # weight that also lowered to False. The source must retain that edit.
        font_bold.select_option('0')
        expect(heading).to_have_css('font-weight', '400')
        font_edited = editor.input_value()
        self.assertNotEqual(font_edited, edited)
        ide.evaluate('vb6Studio.command("undo")')
        expect(editor).to_have_value(edited)
        expect(heading).to_have_css('font-weight', '500')
        ide.evaluate('vb6Studio.command("redo")')
        expect(editor).to_have_value(font_edited)
        expect(heading).to_have_css('font-weight', '400')
        edited = font_edited
        saved = ide.evaluate('JSON.stringify(vb6Studio.project)')
        ide.evaluate('value=>vb6Studio.loadProject(JSON.parse(value))', saved)
        ide.evaluate('vb6Studio.xaml.open() && true')
        expect(ide.locator('.xaml-input')).to_have_value(edited)
        expect(ide.locator('.xaml-problems button')).to_have_count(0)
        ide.evaluate('void vb6Studio.command("run")')
        iframe = ide.locator('iframe[title="Running Visual Basic application"]').element_handle()
        runtime = iframe.content_frame()
        runtime.wait_for_function('globalThis.vb6Application?.forms?.length === 1')
        runtime.locator('[data-control="LiveText"] input').fill('IDE runtime')
        runtime.locator('[data-control="AccentButton"]').click()
        expect(runtime.locator('[data-control="ActionStatus"]')).to_have_text('accent:IDE runtime')
        expect(runtime.locator('[data-control="AccentButton"]')).to_have_text('Inspector accent')
        ide.screenshot(path=str(REPORT / 'ide-xaml-runtime.png'))
        self.done()

    def test_ide_tabs_select_focus_and_designer_isolation_use_their_own_theme(self):
        ide = self.context.new_page()
        ide.goto(self.base + 'dist/index.html')
        ide.wait_for_function('globalThis.vb6Studio?.xaml')
        ide.evaluate('p=>vb6Studio.loadProject(p)', self.project)
        snapshot = '''() => [...document.querySelectorAll('.designer-scroll .vb-control')].map(e=>{
            const s=getComputedStyle(e),r=e.getBoundingClientRect();
            return [e.dataset.control,r.width,r.height,s.font,s.backgroundColor,s.color,s.borderWidth,s.boxShadow];
        })'''
        baseline = None
        for theme, background in (('classic', None), ('fluent', 'rgb(249, 249, 249)'),
                                  ('fluent-dark', 'rgb(40, 40, 40)')):
            ide.evaluate('''theme=>{
                Object.assign(vb6Studio.appearance,{theme,reduceMotion:true,documentTabs:true});
                vb6Studio.applyAppearance();
            }''', theme)
            ide.wait_for_function('''() => {
                const s=vb6Studio.syntaxDiagnostics;
                return !s||(!s.pending&&!s.busy&&!s.timer);
            }''')
            current = ide.evaluate(snapshot)
            self.assertGreater(len(current), 25)
            if baseline is None:
                baseline = current
                continue
            self.assertEqual(current, baseline, 'IDE appearance preserves authored control size, fonts and paint')
            tab = ide.locator('.document-tab.active').first
            expect(tab).to_have_css('background-color', background)
            expect(tab).to_have_css('box-shadow', 'none')
            expect(tab).to_have_css('font-weight', '400')
            expect(ide.locator('.project-tree .tree-row').first).to_have_css('height', '28px')
            ide.evaluate('void vb6Studio.command("options")')
            dialog = ide.get_by_role('dialog', name='Options', exact=True)
            dialog.get_by_role('tab', name='General', exact=True).click()
            choice = dialog.get_by_label('Error Trapping', exact=True)
            # Programmatic focus after a mouse click can retain mouse modality.
            # Enter the select with the keyboard before checking its focus ring.
            choice.focus()
            ide.keyboard.press('Shift+Tab')
            expect(choice).not_to_be_focused()
            ide.keyboard.press('Tab')
            expect(choice).to_be_focused()
            self.assertTrue(choice.evaluate('e=>e.matches(":focus-visible")'))
            self.expect_color(choice, 'background-color', '#ffffff0f' if theme.endswith('-dark') else '#ffffffb3')
            expect(choice).to_have_css('outline-style', 'solid')
            expect(choice).to_have_css('outline-width', '2px')
            self.assertNotIn('0px -2px', choice.evaluate('e=>getComputedStyle(e).boxShadow'))
            dialog.get_by_role('button', name='Cancel', exact=True).click()
        ide.screenshot(path=str(REPORT / 'ide-native-chrome.png'))
        self.done()

    def test_canvas_alpha_gradient_png_and_retained_commands_match_independent_oracles(self):
        # Source-module acceptance complements the bundled export tests. The
        # module owns/disposes its Canvas surfaces and uses literal Canvas
        # commands as its independent pixel oracle, without conversion helpers.
        page = self.context.new_page()
        page.goto(self.base + 'reports/winui3/fixtures/graphics.html')
        result = page.evaluate('''async () => {
            const tests=await import('/tests/winui3-graphics-browser.mjs');
            return tests.runWinUI3GraphicsTests();
        }''')
        self.assertTrue(result['passed'])
        self.assertEqual(len(result['cases']), 5)
        self.assertGreaterEqual(result['assertions'], 18)
        (REPORT / 'canvas-results.json').write_text(json.dumps(result, indent=2))
        self.done()


if __name__ == '__main__':
    unittest.main(verbosity=2)

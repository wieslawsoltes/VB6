"""Ensure diagnostic readback cannot replace or repair a presentation oracle."""
import ast
import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from rendering_pixels import compare_pixels

class ScreenshotTimeout(Exception):
    pass


class PrimitiveCaptureTests(unittest.TestCase):
    def run_case(self, *, blank_presentation=False, wrong_readback=False, screenshot_timeouts=0):
        source = Path(__file__).with_name('browser-rendering-tests.py').read_text()
        functions = [n for n in ast.walk(ast.parse(source))
                     if isinstance(n, ast.FunctionDef) and n.name in {'primitive_parity', 'stable_render_capture'}]
        self.assertEqual(len(functions), 2)
        image = Image.new('RGBA', (256, 128), (255, 0, 0, 255))
        encoded = io.BytesIO(); image.convert('RGB').save(encoded, format='PNG')
        white = io.BytesIO(); Image.new('RGB', image.size, 'white').save(white, format='PNG')
        events = []
        class Page:
            errors = []
            backend = None
            remaining_timeouts = screenshot_timeouts
            def evaluate(page, script, arg=None):
                if arg is not None:
                    page.backend = arg['backend']; events.append(('draw', page.backend, script))
                    return dict(name=page.backend, width=256, height=128, stats={})
                if script == 'painter.name': return page.backend
                if 'painter.render(primitiveScene' in script:
                    events.append(('readback', page.backend))
                    raw = bytes([0, 0, 255, 255]) * (256*128) if wrong_readback else image.tobytes()
                    return base64.b64encode(raw).decode('ascii')
            def screenshot(page, **kwargs):
                events.append(('screenshot', page.backend, kwargs))
                if page.backend == 'webgpu' and page.remaining_timeouts:
                    page.remaining_timeouts -= 1
                    raise ScreenshotTimeout('synthetic screenshot command timeout')
                return white.getvalue() if blank_presentation and page.backend == 'webgpu' else encoded.getvalue()
            def close(page):
                pass
        def check(ok, message):
            if not ok: raise AssertionError(message)
        with tempfile.TemporaryDirectory() as temporary:
            namespace = dict(dpr=1, browser=None, new_page=lambda *a: Page(),
                             METRICS={'backends': {'canvas2d': {'available': True}, 'webgpu': {'available': True}}},
                             REQUIRED=['webgpu'], OUT=Path(temporary), check=check,
                             Image=Image, io=io, base64=base64, pixels=compare_pixels,
                             json=json, PlaywrightTimeoutError=ScreenshotTimeout)
            exec(compile(ast.Module(body=functions, type_ignores=[]), 'primitive_parity', 'exec'), namespace)
            result = namespace['primitive_parity']()
        return events, result

    def test_presentation_precedes_diagnostic_readback(self):
        events, result = self.run_case()
        self.assertEqual([(e[0],e[1]) for e in events], [
            ('draw','canvas2d'), *[('screenshot','canvas2d')]*3,
            ('draw','webgpu'), *[('screenshot','webgpu')]*3, ('readback','webgpu')])
        for event in events:
            if event[0] == 'screenshot':
                self.assertEqual(event[2], {'caret':'initial','clip':{'x':0,'y':0,'width':256,'height':128}})
            if event[0] == 'draw':
                self.assertIn('requestAnimationFrame', event[2])
                self.assertIn('p.render(s)', event[2])
                self.assertNotIn('readback:true', event[2])
        self.assertEqual(result['comparisons']['webgpu']['changedPixels'], 0)

    def test_correct_framebuffer_does_not_rescue_blank_presentation(self):
        with self.assertRaisesRegex(AssertionError, 'pixel mismatch'):
            self.run_case(blank_presentation=True)

    def test_correct_presentation_does_not_rescue_wrong_framebuffer(self):
        with self.assertRaisesRegex(AssertionError, 'diagnostic framebuffer differs'):
            self.run_case(wrong_readback=True)

    def test_one_timeout_requires_three_new_frames_before_readback_without_redraw(self):
        events, result = self.run_case(screenshot_timeouts=1)
        gpu = [e[0] for e in events if e[1] == 'webgpu']
        self.assertEqual(gpu, ['draw'] + ['screenshot']*4 + ['readback'])
        self.assertEqual(result['comparisons']['webgpu']['changedPixels'], 0)

    def test_correct_readback_cannot_rescue_a_recovered_blank_presentation(self):
        with self.assertRaisesRegex(AssertionError, 'pixel mismatch'):
            self.run_case(screenshot_timeouts=1, blank_presentation=True)

    def test_repeated_transport_timeout_still_fails(self):
        with self.assertRaises(ScreenshotTimeout):
            self.run_case(screenshot_timeouts=2)

if __name__ == '__main__':
    unittest.main()

"""Regression tests for the suite's reference-independent screenshot capture.

Extract only the nested helper so importing this test never starts browsers or
executes acceptance cases. The fake page records actual screenshot options.
"""
import ast
import json
from pathlib import Path
import tempfile
import unittest


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)
        source = Path(__file__).with_name('browser-rendering-tests.py').read_text()
        functions = [node for node in ast.walk(ast.parse(source))
                     if isinstance(node, ast.FunctionDef) and node.name == 'stable_render_capture']
        self.assertEqual(len(functions), 1)
        module = ast.Module(body=functions, type_ignores=[])

        def check(ok, message):
            if not ok:
                raise AssertionError(message)

        self.namespace = {
            'OUT': self.output, 'json': json, 'check': check,
            'pixels': lambda a, b: {'changedPixels': int(a != b)},
        }
        exec(compile(module, str(Path(__file__)), 'exec'), self.namespace)
        self.capture = self.namespace['stable_render_capture']

    def page(self, images, backend='html', renderer='vb6Studio.rendering'):
        class Page:
            calls = []
            index = 0

            def evaluate(self, expression):
                if expression == renderer + '.backend':
                    return backend
                return None

            def screenshot(self, **options):
                self.calls.append(options)
                image = images[min(self.index, len(images)-1)]
                self.index += 1
                return image
        return Page()

    def test_three_stable_captures_do_not_toggle_caret_styles(self):
        page = self.page([b'frame'])
        self.assertEqual(self.capture(page, 'stable', 'html'), b'frame')
        self.assertEqual(page.calls, [{'caret': 'initial'}] * 3)
        self.assertEqual((self.output / 'stable-html.png').read_bytes(), b'frame')

    def test_capture_does_not_search_for_an_expected_image(self):
        page = self.page([b'loading', b'wrong-but-stable'])
        self.assertEqual(self.capture(page, 'independent', 'html'), b'wrong-but-stable')
        self.assertEqual(len(page.calls), 4)
        # Comparison with the fixed baseline remains the caller's strict check.
        self.assertNotEqual(b'expected', (self.output / 'independent-html.png').read_bytes())

    def test_alternating_pixels_never_become_a_reference(self):
        page = self.page([b'a', b'b'] * 15)
        with self.assertRaisesRegex(AssertionError, 'never reached stable pixels'):
            self.capture(page, 'unstable', 'html')
        self.assertEqual(len(page.calls), 30)
        self.assertFalse((self.output / 'unstable-html.png').exists())
        report = json.loads((self.output / 'unstable-reference.json').read_text())
        self.assertEqual(len(report['samples']), 30)
        self.assertEqual(report['stableCaptures'], 1)

    def test_standalone_control_fixture_checks_its_actual_backend(self):
        page = self.page([b'control-pixels'], backend='webgl2', renderer='fixtureRenderer')
        self.assertEqual(self.capture(page, 'controls', 'webgl2', 'fixtureRenderer'), b'control-pixels')
        self.assertEqual(page.calls, [{'caret': 'initial'}] * 3)
        fallback = self.page([b'wrong'], renderer='fixtureRenderer')
        with self.assertRaisesRegex(AssertionError, 'unexpected renderer'):
            self.capture(fallback, 'controls-fallback', 'webgl2', 'fixtureRenderer')
        self.assertEqual(fallback.calls, [])

    def test_backend_fallback_cannot_satisfy_capture(self):
        page = self.page([b'frame'], backend='html')
        with self.assertRaisesRegex(AssertionError, 'unexpected renderer'):
            self.capture(page, 'fallback', 'webgpu')
        self.assertEqual(page.calls, [])


if __name__ == '__main__':
    unittest.main()

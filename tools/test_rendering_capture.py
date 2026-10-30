"""Regression tests for the suite's reference-independent screenshot capture.

Extract only the capture helper so importing this test never starts browsers or
executes acceptance cases. The fake page records actual screenshot options.
"""
import ast
import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from test_rendering_primitives import PrimitiveCaptureTests


class ScreenshotTimeout(Exception):
    pass


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
            'PlaywrightTimeoutError': ScreenshotTimeout,
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
                if isinstance(image, Exception):
                    raise image
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

    def test_timeout_preserves_failure_and_requires_three_fresh_captures(self):
        page = self.page([b'old', b'old', ScreenshotTimeout('capture timed out'),
                          b'new', b'new', b'new'])
        self.assertEqual(self.capture(page, 'recovered', 'html'), b'new')
        self.assertEqual(len(page.calls), 6)
        report = json.loads((self.output / 'recovered-reference.json').read_text())
        self.assertTrue(report['accepted'])
        self.assertEqual(report['stableCaptures'], 3)
        self.assertEqual(report['captureErrors'], [{'attempt': 2, 'error': 'capture timed out'}])
        self.assertIsNone(report['samples'][2]['difference'])

    def test_a_second_timeout_fails_even_after_successful_captures(self):
        page = self.page([ScreenshotTimeout('first'), b'a', b'a', ScreenshotTimeout('second')])
        with self.assertRaisesRegex(ScreenshotTimeout, 'second'):
            self.capture(page, 'failed-recovery', 'html')
        self.assertEqual(len(page.calls), 4)
        report = json.loads((self.output / 'failed-recovery-reference.json').read_text())
        self.assertFalse(report['accepted'])
        self.assertEqual(len(report['captureErrors']), 2)
        self.assertEqual(report['stableCaptures'], 0)
        self.assertFalse((self.output / 'failed-recovery-html.png').exists())

    def test_non_timeout_screenshot_errors_are_not_retried(self):
        page = self.page([RuntimeError('target closed'), b'frame'])
        with self.assertRaisesRegex(RuntimeError, 'target closed'):
            self.capture(page, 'closed', 'html')
        self.assertEqual(len(page.calls), 1)
        report = json.loads((self.output / 'closed-reference.json').read_text())
        self.assertFalse(report['accepted'])
        self.assertEqual(report['captureErrors'], [])

    def test_recovery_cannot_accept_backend_fallback(self):
        page = self.page([ScreenshotTimeout('capture'), b'frame'])
        reads = []
        original = page.evaluate
        def evaluate(expression):
            if expression == 'vb6Studio.rendering.backend':
                reads.append(expression)
                if len(reads) > 1:
                    return 'canvas2d'
            return original(expression)
        page.evaluate = evaluate
        with self.assertRaisesRegex(AssertionError, 'unexpected renderer'):
            self.capture(page, 'fallback-after-timeout', 'html')
        self.assertEqual(len(page.calls), 1)
        report = json.loads((self.output / 'fallback-after-timeout-reference.json').read_text())
        self.assertFalse(report['accepted'])
        self.assertEqual(len(report['captureErrors']), 1)

    def test_unstable_frames_after_timeout_still_fail_at_the_original_attempt_limit(self):
        page = self.page([ScreenshotTimeout('capture')] + [b'a', b'b'] * 15)
        with self.assertRaisesRegex(AssertionError, 'never reached stable pixels'):
            self.capture(page, 'unstable-after-timeout', 'html')
        self.assertEqual(len(page.calls), 30)
        report = json.loads((self.output / 'unstable-after-timeout-reference.json').read_text())
        self.assertFalse(report['accepted'])
        self.assertEqual(len(report['samples']), 29)

    def test_readiness_timeout_is_not_misclassified_as_a_screenshot_timeout(self):
        page = self.page([b'frame'])
        original = page.evaluate
        def evaluate(expression):
            if 'document.fonts.ready' in expression:
                raise ScreenshotTimeout('font or frame readiness did not finish')
            return original(expression)
        page.evaluate = evaluate
        with self.assertRaisesRegex(ScreenshotTimeout, 'readiness'):
            self.capture(page, 'unready', 'html')
        self.assertEqual(page.calls, [])
        report = json.loads((self.output / 'unready-reference.json').read_text())
        self.assertFalse(report['accepted'])
        self.assertEqual(report['captureErrors'], [])

    def test_failed_rerun_removes_prior_accepted_image(self):
        (self.output / 'rerun-html.png').write_bytes(b'previous run')
        page = self.page([RuntimeError('target closed')])
        with self.assertRaises(RuntimeError):
            self.capture(page, 'rerun', 'html')
        self.assertFalse((self.output / 'rerun-html.png').exists())


    def test_primitive_clip_and_painter_identity_survive_timeout_recovery(self):
        page = self.page([b'old', ScreenshotTimeout('stalled'), b'new'], backend='webgpu')
        base = page.evaluate
        checks = []
        def evaluate(expression):
            if expression == 'painter.name':
                checks.append(expression); return 'webgpu'
            self.assertNotIn('painter.render', expression)
            return base(expression)
        page.evaluate = evaluate
        clip = {'x': 0, 'y': 0, 'width': 256, 'height': 128}
        image = self.capture(page, 'primitive', 'webgpu', 'painter', backend_property='name', clip=clip)
        self.assertEqual(image, b'new')
        self.assertEqual(page.calls, [{'caret': 'initial', 'clip': clip}]*5)
        self.assertEqual(len(checks), 9)
        report = json.loads((self.output / 'primitive-reference.json').read_text())
        self.assertTrue(report['accepted']); self.assertEqual(report['stableCaptures'], 3)
        self.assertEqual(report['clip'], clip)
        self.assertEqual(len(report['captureErrors']), 1)

    def test_primitive_painter_change_during_capture_is_fatal(self):
        page = self.page([b'frame']); checks = []
        base = page.evaluate
        def evaluate(expression):
            if expression == 'painter.name':
                checks.append(expression); return 'webgpu' if len(checks) == 1 else 'canvas2d'
            return base(expression)
        page.evaluate = evaluate
        with self.assertRaisesRegex(AssertionError, 'unexpected renderer'):
            self.capture(page, 'wrong-painter', 'webgpu', 'painter', backend_property='name')
        self.assertEqual(len(page.calls), 1)
        self.assertFalse((self.output / 'wrong-painter-webgpu.png').exists())

    def test_only_known_backend_identity_properties_are_accepted(self):
        page = self.page([b'frame'])
        with self.assertRaises(ValueError):
            self.capture(page, 'bad-identity', 'webgpu', 'painter', backend_property='device.destroy()')
        self.assertEqual(page.calls, [])


class TranslucentCaptureTests(unittest.TestCase):
    """Exercise the production acceptance caller, including its strict comparison."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)
        source = Path(__file__).with_name('browser-rendering-tests.py').read_text()
        functions = [node for node in ast.walk(ast.parse(source))
                     if isinstance(node, ast.FunctionDef) and node.name in {'stable_render_capture', 'translucent_paint'}]
        self.assertEqual(len(functions), 2)
        self.namespace = {
            'OUT': self.output, 'json': json, 'check': self.assertTrue,
            'PlaywrightTimeoutError': ScreenshotTimeout,
            'pixels': lambda a, b: {'changedPixels': int(a != b)},
            'browser': object(), 'REQUIRED': ['webgpu'],
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(Path(__file__)), 'exec'), self.namespace)

    def run_case(self, images=None, creation_error=None):
        images = {'html': [b'baseline'], 'webgpu': [b'baseline'], **(images or {})}
        events = self.events = []

        class Page:
            def __init__(self):
                self.backend = 'html'
                self.indices = {}
                self.errors = []

            def evaluate(self, expression, argument=None):
                if 'document.body.innerHTML=' in expression:
                    events.append(('fixture',)); self.backend = 'html'
                elif argument is not None:
                    events.append(('switch', argument)); self.backend = argument
                elif expression == 'r.backend':
                    return self.backend
                elif expression == 'r.dispose();undefined':
                    events.append(('dispose',))

            def screenshot(self, **options):
                backend = self.backend
                index = self.indices.get(backend, 0)
                self.indices[backend] = index + 1
                events.append(('capture', backend, options))
                action = images[backend][min(index, len(images[backend])-1)]
                if isinstance(action, Exception):
                    raise action
                return action(self) if callable(action) else action

            def wait_for_timeout(self, milliseconds):
                events.append(('wait', milliseconds))

            def close(self):
                events.append(('close',))

        self.page = Page()

        def new_page(browser, dpr):
            self.assertIs(browser, self.namespace['browser'])
            events.append(('page', dpr))
            if creation_error:
                raise creation_error
            return self.page

        self.namespace['new_page'] = new_page
        return self.namespace['translucent_paint']()

    def report(self, backend):
        return json.loads((self.output / f'translucent-capture-{backend}-reference.json').read_text())

    def captures(self, backend):
        return [event for event in self.events if event[:2] == ('capture', backend)]

    def assert_legacy_absent(self):
        for backend in ('html', 'webgpu'):
            self.assertFalse((self.output / f'translucent-{backend}.png').exists())

    def test_both_captures_keep_one_page_and_fixed_baseline(self):
        self.assertEqual(self.run_case(), {'changedPixels': 0})
        self.assertEqual([event for event in self.events if event[0] in ('page', 'fixture', 'switch')],
                         [('page', 1.5), ('fixture',), ('switch', 'webgpu')])
        for backend in ('html', 'webgpu'):
            self.assertEqual(self.captures(backend), [('capture', backend, {'caret': 'initial'})] * 3)
            self.assertTrue(self.report(backend)['accepted'])
            self.assertEqual((self.output / f'translucent-{backend}.png').read_bytes(), b'baseline')

    def test_each_single_command_timeout_requires_three_fresh_images(self):
        images = [b'old', b'old', ScreenshotTimeout('capture stalled'), b'baseline']
        self.assertEqual(self.run_case({'html': images, 'webgpu': images}), {'changedPixels': 0})
        for backend in ('html', 'webgpu'):
            self.assertEqual(len(self.captures(backend)), 6)
            report = self.report(backend)
            self.assertTrue(report['accepted'])
            self.assertEqual(report['stableCaptures'], 3)
            self.assertEqual(report['captureErrors'], [{'attempt': 2, 'error': 'capture stalled'}])
            self.assertIsNone(report['samples'][2]['difference'])
        self.assertEqual(sum(event[0] == 'switch' for event in self.events), 1)

    def test_repeated_command_timeout_fails_on_either_side(self):
        for backend in ('html', 'webgpu'):
            with self.subTest(backend=backend):
                with self.assertRaisesRegex(ScreenshotTimeout, 'second'):
                    self.run_case({backend: [ScreenshotTimeout('first'), b'baseline', ScreenshotTimeout('second')]})
                self.assertEqual(len(self.captures(backend)), 3)
                report = self.report(backend)
                self.assertFalse(report['accepted'])
                self.assertEqual(len(report['captureErrors']), 2)
                self.assert_legacy_absent()

    def test_backend_change_during_capture_is_fatal(self):
        def fall_back(page):
            page.backend = 'canvas2d'
            return b'baseline'

        with self.assertRaisesRegex(AssertionError, 'unexpected renderer'):
            self.run_case({'webgpu': [fall_back]})
        self.assertEqual(len(self.captures('webgpu')), 1)
        self.assertFalse(self.report('webgpu')['accepted'])
        self.assert_legacy_absent()

    def test_stable_wrong_pixels_fail_against_the_unchanged_baseline(self):
        with self.assertRaisesRegex(AssertionError, 'CSS opacity applied twice'):
            self.run_case({'webgpu': [b'stable wrong pixels']})
        self.assertEqual(len(self.captures('html')), 3)
        self.assertEqual(len(self.captures('webgpu')), 3)
        self.assertEqual((self.output / 'translucent-html.png').read_bytes(), b'baseline')
        self.assertEqual((self.output / 'translucent-webgpu.png').read_bytes(), b'stable wrong pixels')

    def test_failed_rerun_retires_legacy_and_unvisited_capture_evidence(self):
        self.run_case()
        for backend in ('html', 'webgpu'):
            self.assertTrue((self.output / f'translucent-{backend}.png').exists())
        with self.assertRaisesRegex(RuntimeError, 'page closed'):
            self.run_case(creation_error=RuntimeError('page closed'))
        self.assert_legacy_absent()
        self.assertFalse(list(self.output.glob('translucent-capture-*')))


class FailedCanvasDiagnosticTests(unittest.TestCase):
    """A diagnostic repair must never qualify the screenshot that failed."""
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.output = Path(directory.name)
        source = Path(__file__).with_name('figma-presentation-browser-tests.py').read_text()
        original = next(node for node in ast.parse(source).body
                        if isinstance(node, ast.ClassDef) and node.name == 'FigmaPresentation')
        original.bases = [ast.Name(id='TestCase', ctx=ast.Load())]
        original.body = [node for node in original.body if isinstance(node, ast.FunctionDef)
                         and node.name in {'painted_theme', 'capture_failed_canvas_frame'}]
        module = ast.fix_missing_locations(ast.Module(body=[original], type_ignores=[]))
        namespace = {'REPORT': self.output, 'TestCase': unittest.TestCase,
                     'json': json, 'base64': base64, 'io': io, 'Image': Image}
        exec(compile(module, str(Path(__file__)), 'exec'), namespace)
        self.case = namespace['FigmaPresentation']('runTest')
        self.names = ['header', 'layers', 'canvas', 'design']
        self.probes = {name: {'x': index, 'y': 0} for index, name in enumerate(self.names)}
        self.expected = [(255, 255, 255), (255, 255, 255), (245, 245, 245), (255, 255, 255)]
        self.wrong = [(21, 21, 21), (255, 255, 255), (245, 245, 245), (192, 192, 192)]

    def png(self, colors):
        image = Image.new('RGB', (4, 1))
        image.putdata(colors)
        output = io.BytesIO()
        image.save(output, format='PNG')
        return output.getvalue()

    def page(self, *, diagnostic_error=False, backend='canvas2d'):
        owner = self
        events = []
        wrong_png, expected_png = self.png(self.wrong), self.png(self.expected)
        pixels = dict(zip(self.names, self.expected))

        class Frame:
            reads = 0

            def evaluate(self, expression, probes):
                self.reads += 1
                events.append('original-buffer' if self.reads == 1 else 'redraw')
                if self.reads == 1:
                    return {'state': {}, 'beforeRedraw': dict(zip(owner.names, owner.wrong)),
                            'originalBitmap': 'data:image/png;base64,' + base64.b64encode(wrong_png).decode()}
                return {'sameScene': True, 'immediatePixels': pixels, 'independentPainter': pixels}

            def dispose(self):
                events.append('dispose')

        class Page:
            values = iter([self.probes, {'active': backend}, {}, {'active': backend}])

            def evaluate(self, expression, argument=None):
                return next(self.values)

            def evaluate_handle(self, expression):
                return Frame()

            def screenshot(self, *, path, caret, timeout):
                events.append('capture-' + caret)
                if caret == 'initial':
                    # Evidence must already be durable before the first
                    # comparison screenshot or any diagnostic redraw.
                    owner.assertEqual((owner.output / 'failed-canvas-before-redraw.png').read_bytes(), wrong_png)
                    owner.assertTrue((owner.output / 'failed-canvas-diagnostic.json').is_file())
                    if diagnostic_error:
                        raise RuntimeError('diagnostic capture failed')
                png = wrong_png if caret == 'hide' else expected_png
                Path(path).write_bytes(png)
                return png

        self.events = events
        return Page()

    def test_correct_diagnostic_pixels_cannot_replace_failed_original(self):
        self.case.page = self.page()
        with self.assertRaisesRegex(AssertionError, 'Native DOM and retained paint'):
            self.case.painted_theme('light', 'failed')
        self.assertEqual((self.output / 'failed.png').read_bytes(), self.png(self.wrong))
        report = json.loads((self.output / 'failed.json').read_text())
        self.assertEqual(report['actual']['header'], [21, 21, 21])
        diagnostic = json.loads((self.output / 'failed-canvas-diagnostic.json').read_text())
        self.assertEqual(diagnostic['caretInitial']['header'], [255, 255, 255])
        self.assertEqual(self.events, ['capture-hide', 'original-buffer', 'capture-initial',
                                      'redraw', 'capture-initial', 'dispose'])

    def test_diagnostic_error_preserves_original_failure_and_buffer(self):
        self.case.page = self.page(diagnostic_error=True)
        with self.assertRaisesRegex(AssertionError, 'Native DOM and retained paint'):
            self.case.painted_theme('light', 'failed')
        self.assertEqual((self.output / 'failed-canvas-before-redraw.png').read_bytes(), self.png(self.wrong))
        self.assertEqual((self.output / 'failed-canvas-diagnostic-error.txt').read_text(), 'diagnostic capture failed')
        self.assertEqual(self.events, ['capture-hide', 'original-buffer', 'capture-initial', 'dispose'])

    def test_backend_fallback_fails_before_diagnostic_mutations(self):
        self.case.page = self.page(backend='html')
        with self.assertRaisesRegex(AssertionError, 'retain the qualified backend'):
            self.case.painted_theme('light', 'failed')
        self.assertEqual(self.events, ['capture-hide'])


if __name__ == '__main__':
    unittest.main()

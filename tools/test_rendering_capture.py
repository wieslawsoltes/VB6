"""Regression tests for the suite's reference-independent screenshot capture.

Extract only the nested helper so importing this test never starts browsers or
executes acceptance cases. The fake page records actual screenshot options.
"""
import ast
import json
from pathlib import Path
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()

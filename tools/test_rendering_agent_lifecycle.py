"""Test diagnostic/cleanup helpers without importing the browser runner."""
import ast
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


class AgentLifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name)
        path = Path(__file__).with_name('browser-rendering-agent-thread.py')
        tree = ast.parse(path.read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {'record_failure', 'close_case'}]
        self.assertEqual(len(functions), 2)
        self.namespace = {'OUT': self.out, 'traceback': SimpleNamespace(print_exc=lambda: None)}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), 'exec'), self.namespace)

    def page(self, screenshot_error=None, cleanup_error=None):
        owner = self
        class Page:
            def __init__(self): self.calls = []
            def screenshot(self, **options):
                self.calls.append(('screenshot', options))
                if screenshot_error: raise screenshot_error
                Path(options['path']).write_bytes(b'failure image')
            def evaluate(self, expression):
                self.calls.append(('dispose', expression))
                owner.assertIn('window.renderer?.dispose()', expression)
                owner.assertIn('window.fixture?.view?.dispose()', expression)
                if cleanup_error: raise cleanup_error
        return Page()

    def record_failure(self, page, result, error):
        with redirect_stdout(io.StringIO()):
            self.namespace['record_failure'](page, result, error)

    def test_original_failure_survives_secondary_screenshot_timeout(self):
        page = self.page(screenshot_error=TimeoutError('screenshot stalled'))
        result = {'name': 'case', 'passed': True}
        self.record_failure(page, result, ValueError('original invariant'))
        self.assertEqual(result, {'name': 'case', 'passed': False, 'error': 'original invariant',
                                  'failureScreenshotError': 'screenshot stalled'})

    def test_successful_failure_capture_never_turns_failure_into_pass(self):
        page = self.page(); result = {'name': 'case', 'passed': True}
        self.record_failure(page, result, AssertionError('pixel mismatch'))
        self.assertFalse(result['passed'])
        self.assertEqual(result['error'], 'pixel mismatch')
        self.assertEqual((self.out / 'case-failure.png').read_bytes(), b'failure image')
        self.assertEqual(page.calls[0][1]['caret'], 'initial')

    def test_primary_error_is_recorded_before_screenshot(self):
        result = {'name': 'case', 'passed': True}
        class Page:
            def screenshot(inner, **options):
                self.assertFalse(result['passed']); self.assertEqual(result['error'], 'original')
        self.record_failure(Page(), result, RuntimeError('original'))

    def test_disposal_precedes_context_close_without_replacing_success(self):
        page = self.page(); result = {'name': 'case', 'passed': True}; closed = []
        context = SimpleNamespace(close=lambda: closed.append(list(page.calls)))
        self.namespace['close_case'](page, context, result)
        self.assertTrue(result['passed']); self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0][0][0], 'dispose')

    def test_cleanup_failure_is_fatal_and_still_closes_context(self):
        page = self.page(cleanup_error=RuntimeError('dispose failed')); closed = []
        result = {'name': 'case', 'passed': True}
        self.namespace['close_case'](page, SimpleNamespace(close=lambda: closed.append(True)), result)
        self.assertFalse(result['passed']); self.assertEqual(result['cleanupError'], 'dispose failed')
        self.assertEqual(closed, [True])

    def test_cleanup_does_not_erase_a_primary_failure(self):
        page = self.page(cleanup_error=RuntimeError('dispose failed'))
        result = {'name': 'case', 'passed': False, 'error': 'pixel mismatch'}
        self.namespace['close_case'](page, SimpleNamespace(close=lambda: None), result)
        self.assertEqual(result['error'], 'pixel mismatch'); self.assertFalse(result['passed'])



class ScreenshotTimeout(Exception):
    """Stand-in for Playwright's specific screenshot transport exception."""


class AgentCaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name)
        path = Path(__file__).with_name('browser-rendering-agent-thread.py')
        tree = ast.parse(path.read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'capture']
        self.assertEqual(len(functions), 1)
        def check(value, message):
            if not value:
                raise AssertionError(message)
        self.namespace = {'OUT': self.out, 'json': json, 'check': check, 'backend': 'webgpu',
                          'settle': lambda page: page.settle(),
                          'PlaywrightTimeoutError': ScreenshotTimeout}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), 'exec'), self.namespace)
        self.capture = self.namespace['capture']

    def page(self, frames):
        class Page:
            def __init__(self):
                self.calls = []; self.index = 0; self.reads = 0; self.settled = 0
                self.backend = 'webgpu'; self.readiness_error = None
            def settle(self):
                self.settled += 1
                if self.readiness_error: raise self.readiness_error
            def evaluate(self, expression):
                if expression != 'renderer.backend': raise AssertionError(expression)
                self.reads += 1; return self.backend
            def screenshot(self, **options):
                self.calls.append(options)
                frame = frames[min(self.index, len(frames) - 1)]; self.index += 1
                if isinstance(frame, Exception): raise frame
                return frame
        return Page()

    def report(self, label):
        return json.loads((self.out / (label + '-capture.json')).read_text())

    def test_three_fresh_frames_keep_original_caret_and_backend(self):
        page = self.page([b'frame'])
        self.assertEqual(self.capture(page, 'stable'), b'frame')
        self.assertEqual(page.calls, [{'caret': 'initial'}] * 3)
        self.assertEqual(page.reads, 6)  # Guard both sides of the screenshot call.
        self.assertTrue(self.report('stable')['accepted'])
        self.assertEqual(self.report('stable')['stableCaptures'], 3)

    def test_timeout_recovery_discards_pre_timeout_stability(self):
        page = self.page([b'frame', b'frame', ScreenshotTimeout('capture stalled'), b'frame'])
        self.assertEqual(self.capture(page, 'recovered'), b'frame')
        self.assertEqual(len(page.calls), 6)
        report = self.report('recovered')
        self.assertTrue(report['accepted'])
        self.assertEqual(report['captureErrors'], [{'attempt': 2, 'error': 'capture stalled'}])
        self.assertEqual(report['samples'][2]['consecutive'], 1)
        self.assertEqual(report['stableCaptures'], 3)

    def test_a_second_timeout_is_fatal_and_preserves_error_identity(self):
        second = ScreenshotTimeout('second timeout')
        page = self.page([ScreenshotTimeout('first timeout'), b'a', b'a', second])
        with self.assertRaises(ScreenshotTimeout) as raised:
            self.capture(page, 'repeated')
        self.assertIs(raised.exception, second)
        self.assertEqual(len(page.calls), 4)
        self.assertFalse((self.out / 'repeated.png').exists())
        report = self.report('repeated')
        self.assertFalse(report['accepted']); self.assertEqual(len(report['captureErrors']), 2)

    def test_non_timeout_is_never_retried(self):
        page = self.page([RuntimeError('target closed'), b'good'])
        with self.assertRaisesRegex(RuntimeError, 'target closed'):
            self.capture(page, 'closed')
        self.assertEqual(len(page.calls), 1)
        self.assertFalse(self.report('closed')['accepted'])
        self.assertEqual(self.report('closed')['captureErrors'], [])

    def test_readiness_timeout_is_not_a_capture_timeout(self):
        page = self.page([b'frame']); page.readiness_error = ScreenshotTimeout('device queue blocked')
        with self.assertRaisesRegex(ScreenshotTimeout, 'device queue blocked'):
            self.capture(page, 'unready')
        self.assertEqual(page.calls, [])
        self.assertEqual(self.report('unready')['captureErrors'], [])

    def test_backend_fallback_before_capture_is_fatal(self):
        page = self.page([b'frame']); page.backend = 'canvas2d'
        with self.assertRaisesRegex(AssertionError, 'backend fallback'):
            self.capture(page, 'fallback')
        self.assertEqual(page.calls, [])
        self.assertFalse(self.report('fallback')['accepted'])

    def test_fallback_during_capture_cannot_be_accepted(self):
        page = self.page([b'frame']); take = page.screenshot
        def screenshot(**options):
            image = take(**options); page.backend = 'html'; return image
        page.screenshot = screenshot
        with self.assertRaisesRegex(AssertionError, 'backend fallback'):
            self.capture(page, 'mid-fallback')
        self.assertEqual(len(page.calls), 1)
        self.assertFalse((self.out / 'mid-fallback.png').exists())

    def test_recovery_cannot_accept_a_different_backend(self):
        page = self.page([ScreenshotTimeout('stalled'), b'frame']); take = page.screenshot
        def screenshot(**options):
            try: return take(**options)
            finally: page.backend = 'canvas2d'
        page.screenshot = screenshot
        with self.assertRaisesRegex(AssertionError, 'backend fallback'):
            self.capture(page, 'recovery-fallback')
        self.assertEqual(len(page.calls), 1)
        self.assertFalse(self.report('recovery-fallback')['accepted'])
        self.assertEqual(len(self.report('recovery-fallback')['captureErrors']), 1)

    def test_no_stability_after_timeout_fails_with_original_attempt_budget(self):
        page = self.page([ScreenshotTimeout('capture')] + [b'a', b'b'] * 12)
        with self.assertRaisesRegex(AssertionError, 'did not stabilize'):
            self.capture(page, 'unstable')
        self.assertEqual(len(page.calls), 12)
        self.assertFalse((self.out / 'unstable.png').exists())
        self.assertEqual(len(self.report('unstable')['samples']), 11)

    def test_stable_wrong_pixels_are_not_searched_away(self):
        page = self.page([b'loading', b'wrong', b'wrong', b'wrong', b'expected'])
        self.assertEqual(self.capture(page, 'independent'), b'wrong')
        self.assertEqual(len(page.calls), 4)
        self.assertNotEqual(b'expected', (self.out / 'independent.png').read_bytes())

    def test_failed_rerun_cannot_retain_old_passing_evidence(self):
        (self.out / 'rerun.png').write_bytes(b'old success')
        page = self.page([RuntimeError('closed')])
        with self.assertRaises(RuntimeError): self.capture(page, 'rerun')
        self.assertFalse((self.out / 'rerun.png').exists())
        self.assertFalse(self.report('rerun')['accepted'])

    def test_first_timeout_evidence_is_written_before_recovery(self):
        page = self.page([ScreenshotTimeout('stalled'), b'frame']); original = page.settle
        def settle():
            original()
            if page.settled == 2:
                report = self.report('durable')
                self.assertFalse(report['accepted'])
                self.assertEqual(len(report['captureErrors']), 1)
                self.assertEqual(report['stableCaptures'], 0)
        page.settle = settle
        self.assertEqual(self.capture(page, 'durable'), b'frame')

if __name__ == '__main__': unittest.main()

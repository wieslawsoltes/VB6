import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('DOS collections preserve primary failures, progress and cleanup without a live browser', t => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const helper = fileURLToPath(new URL('../tools/dos_collection_checks.py', import.meta.url));
  // Load the production context manager without importing Playwright or executing the browser fixture.
  const result = spawnSync(python, ['-c', String.raw`
import ast
import json
from pathlib import Path
import sys
import tempfile
import unittest

source = ast.parse(Path(sys.argv[1]).read_text())
nodes = [node for node in source.body
         if isinstance(node, ast.Import)
         or isinstance(node, ast.ImportFrom) and node.module == 'contextlib'
         or isinstance(node, ast.FunctionDef) and node.name == '_collection_case']
namespace = {}
exec(compile(ast.Module(body=nodes, type_ignores=[]), sys.argv[1], 'exec'), namespace)
collection_case = namespace['_collection_case']


class Page:
    def __init__(self, report):
        self.report = report
        self.events = {}
        self.calls = []
        self.failures = {}
        self.closed = False
        self.close_event = None
        self.failure_saved_before_capture = False
        self.success_saved_before_close = None

    def on(self, event, callback):
        self.events[event] = callback

    def is_closed(self):
        if 'availability' in self.failures:
            raise self.failures['availability']
        return self.closed

    def invoke(self, operation):
        self.calls.append(operation)
        if operation in self.failures:
            raise self.failures[operation]

    def evaluate(self, expression):
        operation = 'dispose' if expression.startswith('()=>{for(const host') else 'state'
        self.invoke(operation)
        return {'hosts': []}

    def screenshot(self, **options):
        assert options['timeout'] == 5000
        assert options['full_page'] is True
        self.failure_saved_before_capture = (self.report / 'collection-metrics-failure.json').exists()
        self.invoke('screenshot')

    def close(self):
        self.success_saved_before_close = (self.report / 'collection-metrics.json').exists()
        if self.close_event:
            self.events[self.close_event](*(['late page error'] if self.close_event == 'pageerror' else []))
        self.invoke('close')
        self.closed = True


class Browser:
    def __init__(self, page):
        self.page = page

    def new_page(self, **options):
        assert options == {'viewport': {'width': 1840, 'height': 1000}}
        return self.page


class CollectionLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.report = Path(self.temp.name)
        self.page = Page(self.report)

    def tearDown(self):
        self.temp.cleanup()

    def case(self, report=None):
        return collection_case(Browser(self.page), report or self.report)

    def read(self, name):
        return json.loads((self.report / ('collection-metrics' + name + '.json')).read_text())

    def assert_no_success(self):
        self.assertFalse((self.report / 'collection-metrics.json').exists())

    def test_success_waits_for_disposal_and_close(self):
        with self.case() as (page, errors, passed, checkpoint):
            self.assertIs(page, self.page)
            passed.append('functional check')
            checkpoint('functional check: passed')
            self.assertEqual(self.read('-progress')['passed'], ['functional check'])
            self.assert_no_success()
        self.assertEqual(self.page.calls, ['dispose', 'close'])
        self.assertTrue(self.page.closed)
        self.assertFalse(self.page.success_saved_before_close)
        self.assertEqual(self.read(''), {'passed': ['functional check'], 'errors': []})
        progress = self.read('-progress')
        self.assertEqual(progress['checkpoint'], 'complete')
        self.assertTrue(progress['page_closed'])
        self.assertFalse((self.report / 'collection-metrics-failure.json').exists())

    def test_primary_exception_survives_both_cleanup_failures(self):
        primary = ValueError('original collection assertion')
        self.page.failures.update(dispose=RuntimeError('dispose failed'), close=RuntimeError('close failed'))
        with self.assertRaises(ValueError) as caught:
            with self.case() as (_, errors, passed, checkpoint):
                passed.append('earlier assertion')
                errors.append('observed page error')
                checkpoint('grid reveal')
                raise primary
        self.assertIs(caught.exception, primary)
        failure = self.read('-failure')
        self.assertEqual(failure['failure']['checkpoint'], 'grid reveal')
        self.assertEqual(failure['failure']['type'], 'ValueError')
        self.assertIn('ValueError: original collection assertion', failure['failure']['traceback'])
        self.assertEqual(failure['passed'], ['earlier assertion'])
        self.assertEqual(failure['errors'], ['observed page error'])
        self.assertEqual([e['operation'] for e in failure['cleanup_errors']], ['dispose hosts', 'close page'])
        self.assertEqual(self.page.calls[-2:], ['dispose', 'close'])
        self.assert_no_success()

    def test_failed_diagnostics_cannot_replace_primary_or_prevent_cleanup(self):
        for unavailable in (False, True):
            with self.subTest(unavailable=unavailable):
                self.page = Page(self.report)
                primary = AssertionError('first failure')
                self.page.failures.update(screenshot=RuntimeError('screenshot unavailable'), state=RuntimeError('state unavailable'))
                if unavailable:
                    self.page.failures['availability'] = RuntimeError('availability unavailable')
                with self.assertRaises(AssertionError) as caught:
                    with self.case():
                        raise primary
                self.assertIs(caught.exception, primary)
                failure = self.read('-failure')
                operations = [error['operation'] for error in failure['diagnostic_errors']]
                if unavailable:
                    self.assertIn('page availability', operations)
                else:
                    self.assertTrue(self.page.failure_saved_before_capture)
                    self.assertEqual(operations, ['screenshot', 'state'])
                self.assertEqual(self.page.calls[-2:], ['dispose', 'close'])
                self.assertTrue(self.page.closed)
                self.assert_no_success()

    def test_disposal_failure_still_closes_page_and_fails_case(self):
        error = RuntimeError('runtime disposal failed')
        self.page.failures['dispose'] = error
        with self.assertRaises(RuntimeError) as caught:
            with self.case() as (_, _, passed, _):
                passed.append('all assertions passed')
        self.assertIs(caught.exception, error)
        self.assertTrue(self.page.closed)
        self.assertEqual(self.read('-failure')['failure']['checkpoint'], 'dispose hosts')
        self.assertTrue(self.page.failure_saved_before_capture)
        self.assert_no_success()

    def test_close_failure_is_a_failure_after_successful_disposal(self):
        error = RuntimeError('page close failed')
        self.page.failures['close'] = error
        with self.assertRaises(RuntimeError) as caught:
            with self.case():
                pass
        self.assertIs(caught.exception, error)
        self.assertEqual(self.page.calls[:2], ['dispose', 'close'])
        self.assertEqual(self.read('-failure')['failure']['checkpoint'], 'close page')
        self.assert_no_success()

    def test_late_crash_or_page_error_cannot_produce_success_metrics(self):
        for event, exception in [('crash', RuntimeError), ('pageerror', AssertionError)]:
            with self.subTest(event=event):
                self.page = Page(self.report)
                self.page.close_event = event
                with self.assertRaises(exception):
                    with self.case() as (_, _, passed, _):
                        passed.append('all assertions passed')
                failure = self.read('-failure')
                self.assertTrue(failure['page_closed'])
                if event == 'crash':
                    self.assertTrue(failure['crashed'])
                    self.assertEqual(failure['crash_checkpoint'], 'close page')
                else:
                    self.assertEqual(failure['errors'], ['late page error'])
                self.assert_no_success()

    def test_progress_write_failure_cannot_mask_primary(self):
        class UnwritableProgress:
            def write_text(self, _):
                raise OSError('progress file unavailable')

        class Report:
            def __truediv__(_, name):
                return UnwritableProgress() if name == 'collection-metrics-progress.json' else self.report / name

        primary = RuntimeError('browser assertion failed')
        with self.assertRaises(RuntimeError) as caught:
            with self.case(Report()) as (_, _, _, checkpoint):
                checkpoint('selection')
                raise primary
        self.assertIs(caught.exception, primary)
        failure = self.read('-failure')
        self.assertEqual(failure['failure']['checkpoint'], 'selection')
        self.assertTrue(any(error['operation'] == 'collection-metrics-progress.json' for error in failure['diagnostic_errors']))
        self.assertTrue(self.page.closed)
        self.assert_no_success()

    def test_cancellation_preserves_identity_and_attempts_both_cleanup_steps(self):
        cancellation = KeyboardInterrupt('cancelled collection check')
        self.page.failures['dispose'] = RuntimeError('dispose failed after cancellation')
        with self.assertRaises(KeyboardInterrupt) as caught:
            with self.case():
                raise cancellation
        self.assertIs(caught.exception, cancellation)
        self.assertEqual(self.page.calls[-2:], ['dispose', 'close'])
        self.assertTrue(self.page.closed)
        self.assertEqual(self.read('-failure')['failure']['type'], 'KeyboardInterrupt')
        self.assert_no_success()

    def test_first_cleanup_error_wins_when_both_cleanup_steps_fail(self):
        first = RuntimeError('first cleanup failure')
        second = ValueError('second cleanup failure')
        self.page.failures.update(dispose=first, close=second)
        with self.assertRaises(RuntimeError) as caught:
            with self.case():
                pass
        self.assertIs(caught.exception, first)
        failure = self.read('-failure')
        self.assertEqual(failure['failure']['message'], 'first cleanup failure')
        self.assertEqual([error['message'] for error in failure['cleanup_errors']], ['first cleanup failure', 'second cleanup failure'])
        self.assertEqual(self.page.calls[-1], 'close')
        self.assert_no_success()


unittest.main(argv=[sys.argv[0]], verbosity=2)
`, helper], {encoding: 'utf8', timeout: 30000});
  if (result.error?.code === 'ENOENT') { t.skip('Python is not installed'); return; }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
  assert.match(result.stderr, /\nOK\s*$/);
});

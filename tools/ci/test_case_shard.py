#!/usr/bin/env python3
"""Case coverage, isolation, failure and cancellation admission regressions."""
import ast
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch
import case_shard
import run

SCRIPT = 'native-project-browser-tests.py'
TOKEN = '1' * 32
SOURCE = '''import unittest
from pathlib import Path
REPORT = Path(__file__).resolve().parents[1] / 'reports' / 'fixture'
class Fixture(unittest.TestCase):
    def test_01(self): pass
    def test_02(self): pass
    def test_03(self): pass
    def test_04(self): pass
'''


class CaseShardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'tools/ci').mkdir(parents=True)
        (self.root / 'reports').mkdir()
        self.source = self.root / 'tools' / SCRIPT
        self.source.write_text(SOURCE)
        shutil.copy(case_shard.__file__, self.root / 'tools/ci/case_shard.py')
        self.env = {**os.environ, 'VB6_BROWSER': 'webkit', 'VB6_TEST_TRANSPORT': 'file', 'PYTHONUNBUFFERED': '1'}
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))
        self.enterContext(contextlib.redirect_stderr(self.output))
        self.enterContext(patch.dict(os.environ, self.env))
        old_path = sys.path[:]
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), old_path))
        self.enterContext(patch.dict(sys.modules))

    def worker(self, index, content=None):
        if content is not None:
            self.source.write_text(content)
        return case_shard.run_worker(self.root, SCRIPT, index, 2, self.root / f'evidence-{index}.json', TOKEN)

    def admit(self, records):
        return case_shard.validate_evidence(records, SCRIPT, 2, TOKEN,
                    hashlib.sha256(self.source.read_bytes()).hexdigest(), 'webkit', 'file')

    def task(self):
        return {'script': SCRIPT, 'transport': 'file', 'caseShards': 2,
                'argv': [sys.executable, str(self.source)]}

    def execute(self, timeout=3, cancelled=None, execute_fn=run.execute):
        return run.execute_case_shards(self.task(), self.root, self.env,
                    self.root / 'reports/suite.log', timeout,
                    cancelled if cancelled is not None else threading.Event(), execute_fn)

    def test_partitions_cover_every_inventory_size_exactly_once(self):
        for size in range(2, 200):
            inventory = [f'case_{i:04d}' for i in range(size)]
            parts = [case_shard.partition(inventory, index, 2) for index in (1, 2)]
            self.assertEqual(parts[0] + parts[1], inventory)
            self.assertFalse(set(parts[0]) & set(parts[1]))
            self.assertLessEqual(abs(len(parts[0]) - len(parts[1])), 1)

    def test_invalid_worker_count_index_and_empty_partition_rejected(self):
        for index, count in ((0, 2), (3, 2), (1, 3), (1, 0), (True, 2), (1, True), ('1', 2)):
            with self.subTest(index=index, count=count), self.assertRaises(ValueError):
                case_shard.partition(['a', 'b'], index, count)
        for items in ([], ['a']):
            with self.assertRaises(ValueError):
                case_shard.partition(items, 1, 2)

    def test_original_load_tests_is_authoritative_and_nested_suites_flatten(self):
        self.source.write_text(SOURCE + '''
def load_tests(loader, standard, pattern):
    return unittest.TestSuite([unittest.TestSuite([Fixture('test_04')]), Fixture('test_02')])
''')
        records = [self.worker(i) for i in (1, 2)]
        self.assertEqual([name.rsplit('.', 1)[1] for name in records[0]['universe']], ['test_02', 'test_04'])
        self.assertEqual(self.admit(records), {'discovered': 2, 'completed': 2, 'skipped': 0})

    def test_duplicate_inventory_rejected(self):
        self.source.write_text(SOURCE + '''
def load_tests(loader, standard, pattern):
    return unittest.TestSuite([Fixture('test_01'), Fixture('test_01')])
''')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.worker(1)
        self.assertFalse(json.loads((self.root / 'evidence-1.json').read_text())['passed'])

    def test_load_tests_error_is_not_a_smaller_passing_inventory(self):
        self.source.write_text(SOURCE + '\ndef load_tests(*args): raise RuntimeError("discovery failed")\n')
        with self.assertRaisesRegex(ValueError, 'discovery failed'):
            self.worker(1)

    def test_fresh_processes_and_disjoint_artifact_directories(self):
        self.source.write_text(SOURCE.replace('def test_01(self): pass', '''def test_01(self):
        REPORT.mkdir(parents=True, exist_ok=True)
        (REPORT / 'capture.txt').write_text(str(__import__('os').getpid()))''').replace('def test_03(self): pass', '''def test_03(self):
        REPORT.mkdir(parents=True, exist_ok=True)
        (REPORT / 'capture.txt').write_text(str(__import__('os').getpid()))'''))
        result = self.execute()
        self.assertEqual(result['status'], 'passed', result)
        self.assertEqual(result['caseCoverage']['completed'], 4)
        paths = list((self.root / 'reports/fixture').glob('case-shard-*/capture.txt'))
        self.assertEqual(len(paths), 2)
        self.assertEqual(len({path.read_text() for path in paths}), 2)
        self.assertEqual(len(list((self.root / 'reports').glob('*-case-*-of-2.log'))), 2)
        self.assertEqual(len(list((self.root / 'reports').glob('*-case-*-of-2.json'))), 2)

    def test_report_isolation_does_not_change_source_root_or_url(self):
        module = case_shard.load_module(self.root, SCRIPT)
        original_file = module.__file__
        original = module.REPORT
        case_shard.isolate_reports(module, self.root, SCRIPT, 1, 2)
        self.assertEqual(module.REPORT, original / 'case-shard-1-of-2')
        self.assertEqual(module.__file__, original_file)

    def test_figma_report_binding_is_isolated_before_fixtures_start(self):
        report = self.root / 'reports/figma'
        module = types.SimpleNamespace(base=types.SimpleNamespace(REPORT=report))
        case_shard.isolate_reports(module, self.root, 'figma-services-browser-tests.py', 2, 2)
        self.assertEqual(module.base.REPORT, report / 'case-shard-2-of-2')

    def test_outside_report_directory_and_undeclared_suites_rejected(self):
        module = types.SimpleNamespace(REPORT=self.root / 'outside')
        with self.assertRaisesRegex(ValueError, 'reports directory'):
            case_shard.isolate_reports(module, self.root, SCRIPT, 1, 2)
        with self.assertRaisesRegex(ValueError, 'declared'):
            case_shard.load_module(self.root, '../outside.py')

    def test_success_records_all_started_and_finished_cases(self):
        records = [self.worker(i) for i in (1, 2)]
        self.assertEqual(self.admit(records), {'discovered': 4, 'completed': 4, 'skipped': 0})
        for record in records:
            self.assertEqual(record['selected'], record['started'])
            self.assertEqual(record['selected'], record['finished'])
            self.assertEqual(set(record['caseSeconds']), set(record['selected']))

    def test_missing_duplicate_truncated_or_reordered_completion_rejected(self):
        records = [self.worker(i) for i in (1, 2)]
        for field in ('selected', 'started', 'finished'):
            for transform in (lambda x: x[:1], lambda x: x + x[:1], lambda x: x[::-1]):
                with self.subTest(field=field):
                    modified = copy.deepcopy(records)
                    modified[0][field] = transform(modified[0][field])
                    with self.assertRaises(ValueError):
                        self.admit(modified)
        with self.assertRaises(ValueError): self.admit(records[:1])
        with self.assertRaises(ValueError): self.admit(records[::-1])

    def test_stale_source_wrong_browser_origin_and_boolean_counts_rejected(self):
        records = [self.worker(i) for i in (1, 2)]
        mutations = {'executionId': '2' * 32, 'sourceSha256': '0' * 64, 'script': 'other.py',
                     'browser': 'chromium', 'transport': 'http', 'index': True, 'count': 3,
                     'version': True, 'testsRun': True, 'passed': 1}
        for key, value in mutations.items():
            with self.subTest(key=key):
                changed = copy.deepcopy(records); changed[0][key] = value
                with self.assertRaises(ValueError): self.admit(changed)
        self.source.write_text(SOURCE + '# changed source\n')
        with self.assertRaises(ValueError): self.admit(records)

    def test_inconsistent_unsorted_or_duplicate_inventories_rejected(self):
        records = [self.worker(i) for i in (1, 2)]
        for names in ([], [''], [0], records[0]['universe'][::-1], records[0]['universe'][:2],
                      records[0]['universe'] + records[0]['universe'][:1]):
            changed = copy.deepcopy(records); changed[0]['universe'] = names
            with self.assertRaises(ValueError): self.admit(changed)

    def test_native_capability_skips_and_expected_failures_are_retained(self):
        self.source.write_text(SOURCE.replace('def test_01(self): pass', '''@unittest.skip('original capability')
    def test_01(self): pass''').replace('def test_03(self): pass', '''@unittest.expectedFailure
    def test_03(self): self.fail('original known failure')'''))
        records = [self.worker(i) for i in (1, 2)]
        self.assertEqual(self.admit(records), {'discovered': 4, 'completed': 4, 'skipped': 1})
        self.assertEqual(records[0]['skipped'][0][1], 'original capability')
        self.assertEqual(len(records[1]['expectedFailures']), 1)

    def test_assertion_setup_subtest_cleanup_and_unexpected_success_fail(self):
        variants = [SOURCE.replace('def test_01(self): pass', "def test_01(self): self.fail('assertion')"),
                    SOURCE + "\nFixture.setUp = lambda self: (_ for _ in ()).throw(RuntimeError('setup'))\n",
                    SOURCE.replace('def test_01(self): pass', '''def test_01(self):
        with self.subTest(field='x'): self.fail('subtest')'''),
                    SOURCE + "\nFixture.tearDownClass = classmethod(lambda cls: (_ for _ in ()).throw(RuntimeError('cleanup')))\n",
                    SOURCE.replace('def test_01(self): pass', '''@unittest.expectedFailure
    def test_01(self): pass''')]
        for source in variants:
            with self.subTest(source=source):
                records = [self.worker(i, source) for i in (1, 2)]
                with self.assertRaises(ValueError): self.admit(records)

    def test_class_setup_skips_do_not_claim_unexecuted_cases_passed(self):
        self.source.write_text(SOURCE + "\nFixture.setUpClass = classmethod(lambda cls: (_ for _ in ()).throw(unittest.SkipTest('no browser')))\n")
        records = [self.worker(i) for i in (1, 2)]
        with self.assertRaises(ValueError): self.admit(records)
        self.assertFalse(any(record['passed'] for record in records))

    def test_failure_record_write_does_not_replace_the_primary_error(self):
        primary = RuntimeError('original discovery failure')
        writes = []
        def write(path, value):
            writes.append(value['passed'])
            if len(writes) > 1: raise OSError('report failure')
        with patch.object(case_shard, 'load_module', side_effect=primary), patch.object(case_shard, 'write_evidence', side_effect=write):
            with self.assertRaises(RuntimeError) as caught: self.worker(1)
        self.assertIs(caught.exception, primary)
        self.assertEqual(writes, [False, False])

    def test_failed_worker_does_not_cancel_its_independent_sibling(self):
        self.source.write_text(SOURCE.replace('def test_01(self): pass', "def test_01(self): self.fail('primary assertion')"))
        result = self.execute()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual([record['status'] for record in result['shards']], ['failed', 'passed'])
        self.assertIn('primary assertion', (self.root / 'reports' / result['shards'][0]['log']).read_text())

    def test_zero_exit_without_current_coverage_evidence_fails_closed(self):
        self.assertEqual(self.execute()['status'], 'passed')
        def no_evidence(*args): return {'status': 'passed', 'exitCode': 0, 'seconds': 0}
        result = self.execute(execute_fn=no_evidence)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('admission failed', result['error'])
        self.assertIn('identity', result['error'])

    def test_parallel_deadlines_terminate_both_workers(self):
        self.source.write_text(SOURCE.replace('pass', "__import__('time').sleep(30)"))
        started = time.monotonic()
        result = self.execute(timeout=.4)
        self.assertEqual(result['status'], 'timed_out')
        self.assertEqual([record['status'] for record in result['shards']], ['timed_out', 'timed_out'])
        self.assertLess(time.monotonic() - started, 6)

    def test_cancellation_reaches_both_workers_and_prevents_success(self):
        self.source.write_text(SOURCE.replace('pass', "__import__('time').sleep(30)"))
        cancelled = threading.Event()
        timer = threading.Timer(.25, cancelled.set)
        timer.start()
        try: result = self.execute(cancelled=cancelled)
        finally: timer.cancel(); timer.join()
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual([record['status'] for record in result['shards']], ['cancelled', 'cancelled'])

    def test_preexisting_cancellation_launches_no_case_workers(self):
        cancelled = threading.Event(); cancelled.set()
        with patch.object(run, 'execute') as executor:
            result = self.execute(cancelled=cancelled, execute_fn=executor)
        executor.assert_not_called()
        self.assertEqual(result['status'], 'cancelled')

    def test_worker_scope_preserves_every_other_suite_and_memory_mode(self):
        for engine in run.ENGINES:
            for origin in ('http', 'file', 'memory'):
                for group in ('project-authoring', 'figma-services', 'advanced-editor-integration'):
                    tasks = run.plan(group, engine, origin)
                    expected = {SCRIPT} if engine == 'webkit' and origin != 'memory' and group == 'project-authoring' else set()
                    if engine == 'webkit' and origin == 'file':
                        if group == 'figma-services':
                            expected = {'figma-services-browser-tests.py'}
                        elif group == 'advanced-editor-integration':
                            expected = {'browser-input-modes-tests.py'}
                    self.assertEqual({t['script'] for t in tasks if t.get('caseShards')}, expected)
                    for task in tasks:
                        self.assertEqual(task['argv'], [sys.executable, str(run.ROOT / 'tools' / task['script'])])

    def test_driver_does_not_discard_flags_or_admit_undeclared_suites(self):
        for change in ({'caseShards': 3}, {'caseShards': True}, {'script': 'other.py'},
                       {'argv': [sys.executable, str(self.source), '--important-flag']}):
            task = {**self.task(), **change}
            with self.assertRaises(ValueError):
                run.execute_case_shards(task, self.root, self.env, self.root / 'reports/x.log', 1, threading.Event())

    def test_service_persistence_reload_uses_startup_budget_and_restored_state(self):
        calls = []
        class Page:
            def get_by_role(self, *args, **kwargs): return self
            def get_by_label(self, *args, **kwargs): return self
            def click(self): pass
            def reload(self, **kwargs): calls.append(('reload', kwargs))
            def wait_for_function(self, predicate, **kwargs): calls.append(('ready', predicate, kwargs))
            def evaluate(self, expression):
                if 'groups.values()' in expression: return 1
                if expression.endswith('.enabled') or expression.endswith('.busy'): return False
        sync_api = types.ModuleType('playwright.sync_api')
        sync_api.sync_playwright = lambda: self.fail('No browser needed for reload contract')
        sync_api.expect = lambda node: types.SimpleNamespace(to_be_visible=lambda: None)
        with patch.dict(sys.modules, {'playwright': types.ModuleType('playwright'), 'playwright.sync_api': sync_api}):
            module = case_shard.load_module(run.ROOT, 'figma-services-browser-tests.py')
            case = module.ServicesAssets('test_service_dock_profiles_reload_without_authority_or_eager_connection')
            case.page = Page(); case.enable = lambda: None
            case.test_service_dock_profiles_reload_without_authority_or_eager_connection()
            self.assertTrue(case.passed)
            self.assertEqual(calls, [('reload', {'wait_until': 'commit', 'timeout': 60000}),
                ('ready', 'globalThis.vb6Studio?.figmaMode?.enabled', {'polling': 100, 'timeout': 60000})])

    def test_input_mode_partitions_retain_core_and_optional_monaco_inventories(self):
        script = 'browser-input-modes-tests.py'
        tree = ast.parse((run.ROOT / 'tools' / script).read_text())
        classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
        def methods(name):
            return [name + '.' + node.name for node in classes[name].body
                    if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')]
        core = methods('InputModeAcceptance')
        advanced = methods('AdvancedInputModeAcceptance')
        self.assertEqual((len(core), len(advanced)), (20, 5))
        sync_api = types.ModuleType('playwright.sync_api')
        sync_api.sync_playwright = lambda *args, **kwargs: self.fail('Discovery must not start a browser')
        with patch.dict(sys.modules, {'playwright': types.ModuleType('playwright'), 'playwright.sync_api': sync_api}):
            for enabled in ('0', '1'):
                with self.subTest(advanced=enabled), patch.dict(os.environ, {'VB6_TEST_ADVANCED': enabled}):
                    module = case_shard.load_module(run.ROOT, script)
                    ids = [case.id() for case in case_shard.discover(module)]
                    expected = sorted(core + (advanced if enabled == '1' else []))
                    self.assertEqual([name.split('.', 1)[1] for name in ids], expected)
                    halves = [case_shard.partition(ids, index, 2) for index in (1, 2)]
                    self.assertEqual(halves[0] + halves[1], ids)
                    self.assertEqual([len(half) for half in halves], [12, 13] if enabled == '1' else [10, 10])
                    report = module.REPORT
                    case_shard.isolate_reports(module, run.ROOT, script, 1, 2)
                    self.assertEqual(module.REPORT, report / 'case-shard-1-of-2')

    def test_actual_native_and_figma_inventories_match_independent_source_scan(self):
        # Discovery is dependency-free: browser APIs are never called. This
        # exercises the original dynamic registration and Figma load_tests.
        sync_api = types.ModuleType('playwright.sync_api')
        sync_api.sync_playwright = sync_api.expect = lambda *args, **kwargs: self.fail('Discovery must not start a browser')
        with patch.dict(sys.modules, {'playwright': types.ModuleType('playwright'), 'playwright.sync_api': sync_api}):
            for script, cls_name, prefix in ((SCRIPT, 'NativeProjects', 'case_'),
                    ('figma-services-browser-tests.py', 'ServicesAssets', 'test_')):
                tree = ast.parse((run.ROOT / 'tools' / script).read_text())
                cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == cls_name)
                names = [node.name for node in cls.body if isinstance(node, ast.FunctionDef) and node.name.startswith(prefix)]
                if prefix == 'case_': names = ['test_' + name[5:] + '_' + origin for name in names for origin in ('http', 'file')]
                module = case_shard.load_module(run.ROOT, script)
                ids = [test.id() for test in case_shard.discover(module)]
                self.assertEqual([name.rsplit('.', 1)[-1] for name in ids], sorted(names))
                self.assertEqual(len(ids), 60 if script == SCRIPT else 21)
                halves = [case_shard.partition(ids, index, 2) for index in (1, 2)]
                self.assertEqual(halves[0] + halves[1], ids)
                if script == SCRIPT:
                    for half in halves:
                        self.assertEqual(sum(name.endswith('_http') for name in half), 15)
                        self.assertEqual(sum(name.endswith('_file') for name in half), 15)


if __name__ == '__main__':
    unittest.main(verbosity=2)

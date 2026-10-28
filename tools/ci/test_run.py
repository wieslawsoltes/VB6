#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
import run
from browser_partition import own_case_names, project_test_names, select_case_names, validate_browser_shard

class RunnerTests(unittest.TestCase):
    def task(self, code):
        return {'script':'fixture.py','transport':'http','argv':[sys.executable,'-u','-c',code]}
    def test_all_plans_are_finite_and_both_advanced_origins_are_owned(self):
        for group in json.loads((run.ROOT/'tools/ci/suites.json').read_text()):
            for engine in run.ENGINES:
                tasks=run.plan(group,engine,'http');self.assertTrue(0<len(tasks)<=16)
                if group in ('advanced-editor','code-gpu'):
                    self.assertEqual({t['transport'] for t in tasks},{'http','file'})
    def test_figma_partitions_are_disjoint_and_combined_alias_preserves_every_suite(self):
        for engine in run.ENGINES:
            for origin in ('http', 'file'):
                first=run.plan('figma-authoring',engine,origin)
                second=run.plan('figma-services',engine,origin)
                self.assertFalse({t['script'] for t in first}&{t['script'] for t in second})
                self.assertEqual(first+second,run.plan('figma',engine,origin))
                self.assertEqual(len(first),5)
                self.assertEqual(len(second),3)
    def test_invalid_arguments_fail_closed(self):
        for args in [('unknown','chromium','http'),('../figma','chromium','http'),('figma','chrome','http'),('figma','webkit','https://remote')]:
            with self.assertRaises(ValueError):run.plan(*args)
    def test_only_approved_webkit_cells_accept_browser_shards(self):
        approved = [('project-authoring', 'webkit', 'http'), ('figma-authoring', 'webkit', 'file'),
                    ('figma-services', 'webkit', 'file'), ('advanced-editor', 'webkit', 'http'),
                    ('advanced-editor', 'webkit', 'file')]
        for cell in approved:
            for shard in ('1', '2', '3'):
                self.assertEqual(validate_browser_shard(shard, *cell), shard)
        for shard in ('0', '4', '01', '1/3', '-1', ' 1', '1.0', 1, True):
            with self.assertRaises(ValueError):run.plan('project-authoring', 'webkit', 'http', browser_shard=shard)
        for cell in [('project-authoring', 'chromium', 'http'), ('project-authoring', 'webkit', 'file'),
                     ('project-authoring', 'webkit', 'memory'), ('figma-authoring', 'webkit', 'http'),
                     ('figma-services', 'firefox', 'file'), ('advanced-editor', 'chromium', 'http'),
                     ('integration-authoring', 'webkit', 'http'), ('figma', 'webkit', 'file')]:
            with self.assertRaises(ValueError):run.plan(*cell, browser_shard='1')
    def test_native_project_shards_preserve_every_case_on_both_origins_once(self):
        cases = own_case_names(run.ROOT / 'tools/native-project-browser-tests.py', 'case_')
        complete = project_test_names(cases)
        parts = [project_test_names(cases, shard=shard) for shard in ('1', '2', '3')]
        self.assertEqual(len(cases), 30)
        self.assertEqual([len(part) for part in parts], [20, 20, 20])
        self.assertEqual(sorted(name for part in parts for name in part), complete)
        self.assertEqual(len(set(name for part in parts for name in part)), len(complete))
        for part in parts:
            self.assertEqual({name[:-5] for name in part if name.endswith('_http')},
                             {name[:-5] for name in part if name.endswith('_file')})
        self.assertEqual(len(project_test_names(cases, 'memory')), 30)
        self.assertTrue(all(name.endswith('_memory') for name in project_test_names(cases, 'memory')))
        for names in ([], ['case_a', 'case_a'], ['invalid']):
            with self.assertRaises(ValueError):project_test_names(names)
        for origin in ('file', 'memory'):
            with self.assertRaises(ValueError):project_test_names(cases, origin, '1')
        with self.assertRaises(ValueError):select_case_names(['test_only'], '2')
        self.assertEqual(select_case_names(['test_only'], '2', allow_empty=True), [])
    def test_native_project_workspace_review_has_exactly_one_shard_owner(self):
        parts = [run.plan('project-authoring', 'webkit', 'http', browser_shard=shard) for shard in ('1', '2', '3')]
        self.assertEqual([[task['script'] for task in part] for part in parts],
                         [['native-project-browser-tests.py', 'project-workspace-review-browser-tests.py'],
                          ['native-project-browser-tests.py'], ['native-project-browser-tests.py']])
        self.assertNotIn('browserShard', parts[0][1])
        for shard, part in zip(('1', '2', '3'), parts):
            self.assertEqual(part[0]['browserShard'], shard)
            self.assertEqual(len(part[0]['ownedCases']), 10)
        for engine in ('chromium', 'firefox'):
            tasks = run.plan('project-authoring', engine, 'http')
            self.assertEqual(len(tasks), 2)
            self.assertTrue(all('browserShard' not in task for task in tasks))
    def test_figma_and_advanced_plans_have_exact_disjoint_case_ownership(self):
        for group, origin in [('figma-authoring', 'file'), ('figma-services', 'file'), ('advanced-editor', 'http')]:
            whole = run.plan(group, 'webkit', origin)
            expected = sorted((task['script'], task['transport'], name)
                              for task in whole for name in own_case_names(run.ROOT / 'tools' / task['script']))
            parts = [run.plan(group, 'webkit', origin, browser_shard=shard) for shard in ('1', '2', '3')]
            actual = [(task['script'], task['transport'], name)
                      for part in parts for task in part for name in task['ownedCases']]
            self.assertEqual(sorted(actual), expected)
            self.assertEqual(len(actual), len(set(actual)))
            self.assertTrue(all(task['ownedCases'] for part in parts for task in part))
            self.assertEqual([sum(len(task['ownedCases']) for task in part) for part in parts],
                             {'figma-authoring': [16, 14, 13], 'figma-services': [11, 11, 10],
                              'advanced-editor': [28, 22, 22]}[group])
        retained = 'figma-retained-webgl-browser-tests.py'
        self.assertIn(retained, [task['script'] for task in run.plan('figma-authoring', 'webkit', 'file', browser_shard='1')])
        for shard in ('2', '3'):
            self.assertNotIn(retained, [task['script'] for task in run.plan('figma-authoring', 'webkit', 'file', browser_shard=shard)])
            self.assertNotIn('figma-advanced-editor-browser-tests.py',
                             [task['script'] for task in run.plan('advanced-editor', 'webkit', 'http', browser_shard=shard)])
    def test_child_shard_environment_is_owned_by_the_validated_plan(self):
        observed = []
        def inspect(task, root, env, log, timeout, cancelled):
            observed.append((task['script'], env['VB6_BROWSER_SHARD']))
            return {'status': 'passed', 'exitCode': 0, 'error': None, 'seconds': 0}
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()), patch.dict(os.environ, {'VB6_BROWSER_SHARD': 'invalid inherited value'}):
            tasks = run.plan('project-authoring', 'webkit', 'http', browser_shard='1')
            result = run.run_batch(tasks, Path(d), 'webkit', Path(d) / 'report', execute_fn=inspect)
            self.assertTrue(result['passed'])
        self.assertEqual(observed, [('native-project-browser-tests.py', '1'), ('project-workspace-review-browser-tests.py', '')])
    def test_firefox_only_wraps_the_explicit_webgl_case(self):
        for engine in run.ENGINES:
            for t in run.plan('figma',engine,'file'):
                self.assertEqual(t['argv'][0]=='xvfb-run',engine=='firefox' and t['script']=='figma-retained-webgl-browser-tests.py')
    def test_all_designer_engines_pass_explicit_command_line_flags(self):
        for engine in run.ENGINES:
            t=next(t for t in run.plan('authoring-exports',engine,'http') if t['script']=='browser-designer-tests.py')
            self.assertEqual(t['argv'][-4:],['--browser',engine,'--origin','http'])
    def test_runtime_intrinsics_have_one_ci_owner_and_real_http_transport(self):
        groups=json.loads((run.ROOT/'tools/ci/suites.json').read_text())
        owners=[group for group,scripts in groups.items() if 'browser-compiler-runtime.py' in scripts]
        self.assertEqual(owners,['core-runtime'])
        for origin in ('http','memory'):
            task=next(t for t in run.plan('core-runtime','chromium',origin) if t['script']=='browser-compiler-runtime.py')
            self.assertEqual('--http' in task['argv'],origin=='http')
            self.assertEqual(task['transport'],origin)
        with self.assertRaisesRegex(ValueError,'HTTP or memory'):
            run.plan('core-runtime','chromium','file')
    def test_data_recordsets_use_every_selected_engine(self):
        for engine in run.ENGINES:
            task=next(t for t in run.plan('integration-controls',engine,'http') if t['script']=='browser-data-recordsets.py')
            self.assertEqual(task['argv'][-2:],['--browser',engine])
        scripts={t['script'] for t in run.plan('core-runtime','chromium','http')}
        self.assertTrue({'browser-data-sources.py','browser-data-layout.py'} <= scripts)
    def test_paths_duplicates_and_empty_groups_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'tools/ci').mkdir(parents=True)
            for scripts in [[],['missing.py'],['../../a.py'],['/tmp/a.py'],['a.py','a.py'],{},'a.py']:
                (root/'tools/ci/suites.json').write_text(json.dumps({'group':scripts}))
                with self.assertRaises(ValueError):run.plan('group','chromium','http',root)
    def test_failure_preserves_output_and_runs_independent_successor(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            result=run.run_batch([self.task("print('primary failure');raise SystemExit(7)"),self.task("print('ok')")],root,'chromium',root/'report')
            self.assertFalse(result['passed']);self.assertEqual([r['status'] for r in result['cases']],['failed','passed'])
            self.assertEqual(result['cases'][0]['exitCode'],7)
            self.assertIn('primary failure',(root/'report'/result['cases'][0]['log']).read_text())
            self.assertEqual(json.loads((root/'report/timings.json').read_text()),result)
    def test_timeout_and_cancellation_never_pass(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            result=run.run_batch([self.task('import time;time.sleep(30)'),self.task('print("ok")')],root,'webkit',root/'timeout',timeout=2)
            self.assertFalse(result['passed']);self.assertEqual([r['status'] for r in result['cases']],['timed_out','passed'])
            event=threading.Event();timer=threading.Timer(.2,event.set);timer.start()
            try:result=run.run_batch([self.task('import time;time.sleep(30)'),self.task('print("never")')],root,'firefox',root/'cancel',cancelled=event)
            finally:timer.cancel();timer.join()
            self.assertFalse(result['passed']);self.assertEqual([r['status'] for r in result['cases']],['cancelled','cancelled']);self.assertNotIn('log',result['cases'][1])
    def test_startup_failure_and_interruption_retain_failure_evidence(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);t={'script':'fixture.py','transport':'http','argv':[str(root/'missing')]}
            result=run.run_batch([t],root,'chromium',root/'report');self.assertFalse(result['passed']);self.assertTrue(result['cases'][0]['error'])
            def interrupt(*args):raise KeyboardInterrupt()
            with self.assertRaises(KeyboardInterrupt):run.run_batch([t],root,'chromium',root/'interrupt',execute_fn=interrupt)
            result=json.loads((root/'interrupt/timings.json').read_text());self.assertFalse(result['passed']);self.assertEqual(result['cases'][0]['status'],'running')
    def test_success_requires_all_cases_and_empty_batch_is_invalid(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);self.assertTrue(run.run_batch([self.task('print("ok")')],root,'chromium',root/'r')['passed'])
            with self.assertRaises(ValueError):run.run_batch([],root,'chromium',root/'empty')


class NativeProjectFixtureTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, **environment):
        playwright = types.ModuleType('playwright')
        sync_api = types.ModuleType('playwright.sync_api')
        def unexpected_browser():
            raise AssertionError('Inventory and fixture fault injection must not launch a browser')
        sync_api.sync_playwright = unexpected_browser
        with patch.dict(sys.modules, {'playwright': playwright, 'playwright.sync_api': sync_api}), \
             patch.object(sys, 'path', [str(run.ROOT / 'tools'), *sys.path]), \
             patch.dict(os.environ, {'VB6_BROWSER': 'webkit', 'VB6_TEST_TRANSPORT': 'http',
                                     'VB6_BROWSER_SHARD': '', **environment}):
            spec = importlib.util.spec_from_file_location('native_project_partition_regression', run.ROOT / 'tools/native-project-browser-tests.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            yield module

    def test_real_loader_partitions_the_full_inventory_and_preserves_unsharded_origins(self):
        with self.fixture() as module:
            complete = [test._testMethodName for test in module.load_tests(unittest.TestLoader(), None, None)]
            self.assertEqual(len(complete), 60)
            selected = []
            for shard in ('1', '2', '3'):
                with patch.dict(os.environ, {'VB6_BROWSER_SHARD': shard}):
                    names = [test._testMethodName for test in module.load_tests(unittest.TestLoader(), None, None)]
                self.assertEqual(len(names), 20)
                selected.extend(names)
            self.assertEqual(sorted(selected), complete)
            self.assertEqual(len(selected), len(set(selected)))
            for engine in ('chromium', 'firefox'):
                with patch.dict(os.environ, {'VB6_BROWSER': engine}):
                    self.assertEqual([test._testMethodName for test in module.load_tests(unittest.TestLoader(), None, None)], complete)
            for env in ({'VB6_BROWSER_SHARD': '4'}, {'VB6_BROWSER_SHARD': '1', 'VB6_BROWSER': 'chromium'},
                        {'VB6_BROWSER_SHARD': '1', 'VB6_TEST_TRANSPORT': 'memory'}):
                with patch.dict(os.environ, env), self.assertRaises(ValueError):
                    module.load_tests(unittest.TestLoader(), None, None)
        with self.fixture(VB6_TEST_TRANSPORT='memory') as module:
            names = [test._testMethodName for test in module.load_tests(unittest.TestLoader(), None, None)]
            self.assertEqual(len(names), 30)
            self.assertTrue(all(name.endswith('_memory') for name in names))

    def test_real_fixture_retains_phase_timings_and_cleanup_after_startup_failure(self):
        for failure, close_failure in [(None, False), ('navigation', False), ('readiness', False),
                                       ('navigation', True), ('readiness', True), (None, True)]:
            with self.subTest(failure=failure, close_failure=close_failure), self.fixture(VB6_BROWSER_SHARD='1') as module, \
                 tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
                calls = []
                original = RuntimeError('original ' + str(failure))
                class Page:
                    def on(self, event, listener):
                        calls.append(('page-event', event))
                    def goto(self, address, **options):
                        calls.append(('goto', address, options))
                        if failure == 'navigation':
                            raise original
                    def wait_for_function(self, expression, **options):
                        calls.append(('readiness', expression, options))
                        if failure == 'readiness':
                            raise original
                class Context:
                    def set_default_timeout(self, timeout):
                        calls.append(('action-timeout', timeout))
                    def new_page(self):
                        return Page()
                    def close(self):
                        calls.append(('close',))
                        if close_failure:
                            raise RuntimeError('cleanup failure')
                class Browser:
                    def new_context(self, **options):
                        calls.append(('context', options))
                        return Context()
                class Probe(module.NativeProjects):
                    engine = 'webkit'
                    browser = Browser()
                    def test_probe_file(self):
                        calls.append(('body',))
                module.REPORT = Path(directory)
                result = unittest.TestResult()
                Probe('test_probe_file').run(result)
                self.assertEqual(len(result.errors), bool(failure) + close_failure)
                self.assertEqual(sum(call[0] == 'close' for call in calls), 1)
                self.assertIn(('action-timeout', 6000), calls)
                navigation = next(call for call in calls if call[0] == 'goto')
                self.assertTrue(navigation[1].startswith('file:'))
                self.assertEqual(navigation[2], {'wait_until': 'commit'})
                if failure != 'navigation':
                    readiness = next(call for call in calls if call[0] == 'readiness')
                    self.assertEqual(readiness[2], {'polling': 100, 'timeout': 60000})
                records = list(Path(directory).rglob('*.timings.json'))
                self.assertEqual(len(records), 1)
                record = json.loads(records[0].read_text())
                self.assertEqual((record['browser'], record['origin'], record['shard']), ('webkit', 'file', '1'))
                self.assertEqual(record['phases']['cleanup']['completed'], not close_failure)
                if failure:
                    self.assertFalse(record['phases'][failure]['completed'])
                    self.assertTrue(any('original ' + failure in error for _case, error in result.errors))
                    self.assertNotIn(('body',), calls)
                else:
                    self.assertIn(('body',), calls)


if __name__=='__main__':unittest.main(verbosity=2)

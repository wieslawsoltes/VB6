#!/usr/bin/env python3
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import run

class RunnerTests(unittest.TestCase):
    def task(self, code):
        return {'script':'fixture.py','transport':'http','argv':[sys.executable,'-u','-c',code]}
    def test_all_plans_are_finite_and_both_advanced_origins_are_owned(self):
        groups=json.loads((run.ROOT/'tools/ci/suites.json').read_text())
        for group in [*groups,'advanced-editor']:
            for engine in run.ENGINES:
                tasks=run.plan(group,engine,'http');self.assertTrue(0<len(tasks)<=16)
                if group in ('advanced-editor','code-gpu'):
                    self.assertEqual({t['transport'] for t in tasks},{'http','file'})
    def test_advanced_partitions_are_disjoint_and_alias_preserves_both_origins(self):
        expected=['browser-advanced-editor-tests.py','browser-input-modes-tests.py',
                  'browser-tui-advanced-tests.py','figma-advanced-editor-browser-tests.py']
        for engine in run.ENGINES:
            for origin in ('http','file','memory'):
                parts=[run.plan(group,engine,origin) for group in
                       ('advanced-editor-core','advanced-editor-integration')]
                combined=[task for part in parts for task in part]
                self.assertEqual([len(part) for part in parts],[1,3])
                self.assertEqual([task['script'] for task in combined],expected)
                self.assertEqual(len({task['script'] for task in combined}),4)
                self.assertEqual({task['transport'] for task in combined},{origin})
                for task in combined:
                    self.assertEqual(task['argv'],[sys.executable,str(run.ROOT/'tools'/task['script'])])
            both=[task for origin in ('http','file') for group in
                  ('advanced-editor-core','advanced-editor-integration')
                  for task in run.plan(group,engine,origin)]
            for requested_origin in ('http','file','memory'):
                self.assertEqual(run.plan('advanced-editor',engine,requested_origin),both)
    def test_figma_partitions_are_disjoint_and_combined_alias_preserves_every_suite(self):
        expected=['figma-browser-tests.py','figma-presentation-browser-tests.py',
                  'figma-retained-webgl-browser-tests.py','figma-navigation-browser-tests.py',
                  'figma-editor-browser-tests.py','figma-property-keyboard-browser-tests.py',
                  'figma-services-browser-tests.py','figma-service-state-browser-tests.py']
        for engine in run.ENGINES:
            for origin in ('http', 'file', 'memory'):
                parts=[run.plan(group,engine,origin) for group in
                       ('figma-workspace','figma-authoring','figma-services')]
                combined=[task for part in parts for task in part]
                self.assertEqual([len(part) for part in parts],[1,4,3])
                self.assertEqual([task['script'] for task in combined],expected)
                self.assertEqual(len({task['script'] for task in combined}),8)
                self.assertEqual({task['transport'] for task in combined},{origin})
                self.assertEqual(combined,run.plan('figma',engine,origin))
    def test_process_deadlines_are_scoped_to_measured_standalone_suites(self):
        expected={
            ('webkit','http','browser-application-theme-tests.py'):900,
            ('webkit','file','browser-application-theme-tests.py'):900,
            ('webkit','file','figma-browser-tests.py'):900,
            ('webkit','file','figma-editor-browser-tests.py'):900,
            ('webkit','file','figma-services-browser-tests.py'):900,
            ('webkit','http','native-project-browser-tests.py'):1200,
            ('webkit','file','native-project-browser-tests.py'):1200,
            ('webkit','file','browser-advanced-editor-tests.py'):1200,
            ('webkit','file','browser-input-modes-tests.py'):900,
        }
        scripts=sorted({script for group in json.loads((run.ROOT/'tools/ci/suites.json').read_text()).values() for script in group})
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            for engine in run.ENGINES:
                for origin in ('http','file','memory'):
                    tasks=[{**self.task(''), 'script':script, 'transport':origin} for script in scripts]
                    observed=[]
                    def execute(task,root,env,log,timeout,cancelled):
                        observed.append(timeout)
                        return {'status':'passed','exitCode':0,'seconds':0}
                    result=run.run_batch(tasks,root,engine,root/(engine+'-'+origin),execute_fn=execute)
                    deadlines=[expected.get((engine,origin,script),480) for script in scripts]
                    self.assertTrue(result['passed'])
                    self.assertEqual(observed,deadlines,(engine,origin))
                    self.assertEqual([r['timeoutSeconds'] for r in result['cases']],deadlines)

    def test_explicit_short_deadline_is_preserved_for_standalone_suites(self):
        tasks=[{**self.task(''), 'script':script, 'transport':origin} for origin,script in [
            ('file','figma-browser-tests.py'),('file','figma-editor-browser-tests.py'),
            ('file','figma-services-browser-tests.py'),
            ('http','native-project-browser-tests.py'),('file','native-project-browser-tests.py'),
            ('file','browser-advanced-editor-tests.py'),
            ('http','browser-application-theme-tests.py'),('file','browser-application-theme-tests.py')]]
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d);observed=[]
            def execute(task,root,env,log,timeout,cancelled):
                observed.append(timeout)
                return {'status':'passed','exitCode':0,'seconds':0}
            result=run.run_batch(tasks,root,'webkit',root/'report',timeout=2,execute_fn=execute)
            self.assertTrue(result['passed']);self.assertEqual(observed,[2]*len(tasks))

    def test_invalid_arguments_fail_closed(self):
        for args in [('unknown','chromium','http'),('../figma','chromium','http'),('figma','chrome','http'),('figma','webkit','https://remote')]:
            with self.assertRaises(ValueError):run.plan(*args)
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
    def test_native_project_deadline_is_scoped_and_explicit_limits_win(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            scripts=['native-project-browser-tests.py','project-workspace-review-browser-tests.py','fixture.py']
            tasks=[{**self.task(''), 'script':script} for script in scripts]
            deadlines=[]
            def record_deadline(task,root,env,log,timeout,cancelled):
                deadlines.append((env['VB6_BROWSER'],task['script'],timeout))
                return {'status':'passed','exitCode':0,'seconds':0}
            for engine in run.ENGINES:
                result=run.run_batch(tasks,root,engine,root/engine,execute_fn=record_deadline)
                expected=[1200 if engine=='webkit' else 480,480,480]
                self.assertTrue(result['passed'])
                self.assertEqual([item['script'] for item in result['cases']],scripts)
                self.assertEqual([item['timeoutSeconds'] for item in result['cases']],expected)
                self.assertEqual(deadlines[-3:],[(engine,script,limit) for script,limit in zip(scripts,expected)])
            for limit in (2,480):
                result=run.run_batch(tasks,root,'webkit',root/str(limit),timeout=limit,execute_fn=record_deadline)
                self.assertEqual([item['timeoutSeconds'] for item in result['cases']],[limit]*3)
                self.assertEqual(deadlines[-3:],[('webkit',script,limit) for script in scripts])
    def test_figma_workspace_deadline_is_scoped_to_webkit_file_and_explicit_limits_win(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            scripts=['native-project-browser-tests.py','figma-browser-tests.py',
                     'figma-editor-browser-tests.py','fixture.py']
            deadlines=[]
            def record_deadline(task,root,env,log,timeout,cancelled):
                deadlines.append((env['VB6_BROWSER'],env['VB6_TEST_TRANSPORT'],task['script'],timeout))
                return {'status':'passed','exitCode':0,'seconds':0}
            for engine in run.ENGINES:
                for origin in ('http','file','memory'):
                    tasks=[{**self.task(''),'script':script,'transport':origin} for script in scripts]
                    result=run.run_batch(tasks,root,engine,root/engine/origin,execute_fn=record_deadline)
                    expected=[1200 if engine=='webkit' and origin!='memory' else 480,
                              900 if engine=='webkit' and origin=='file' else 480,
                              900 if engine=='webkit' and origin=='file' else 480,480]
                    self.assertTrue(result['passed'])
                    self.assertEqual([item['timeoutSeconds'] for item in result['cases']],expected)
                    self.assertEqual(deadlines[-4:],[(engine,origin,script,limit) for script,limit in zip(scripts,expected)])
            for limit in (2,480):
                tasks=[{**self.task(''),'script':script,'transport':'file'} for script in scripts]
                result=run.run_batch(tasks,root,'webkit',root/str(limit),timeout=limit,execute_fn=record_deadline)
                self.assertEqual([item['timeoutSeconds'] for item in result['cases']],[limit]*4)
                self.assertEqual(deadlines[-4:],[('webkit','file',script,limit) for script in scripts])
    def test_advanced_deadlines_only_extend_webkit_file_monaco_and_vim(self):
        with tempfile.TemporaryDirectory() as d,contextlib.redirect_stdout(io.StringIO()):
            root=Path(d)
            scripts=['browser-advanced-editor-tests.py','browser-input-modes-tests.py',
                     'browser-tui-advanced-tests.py','figma-advanced-editor-browser-tests.py']
            deadlines=[]
            def record_deadline(task,root,env,log,timeout,cancelled):
                deadlines.append((env['VB6_BROWSER'],env['VB6_TEST_TRANSPORT'],task['script'],timeout))
                return {'status':'passed','exitCode':0,'seconds':0}
            for engine in run.ENGINES:
                for origin in ('http','file','memory'):
                    tasks=[{**self.task(''),'script':script,'transport':origin} for script in scripts]
                    result=run.run_batch(tasks,root,engine,root/engine/origin,execute_fn=record_deadline)
                    limit=900 if engine=='webkit' and origin=='file' else 480
                    expected=[1200 if engine=='webkit' and origin=='file' else 480,limit,480,480]
                    self.assertTrue(result['passed'])
                    self.assertEqual([item['timeoutSeconds'] for item in result['cases']],expected)
                    self.assertEqual(deadlines[-4:],[(engine,origin,script,bound) for script,bound in zip(scripts,expected)])
            for limit in (2,480):
                tasks=[{**self.task(''),'script':script,'transport':'file'} for script in scripts]
                result=run.run_batch(tasks,root,'webkit',root/str(limit),timeout=limit,execute_fn=record_deadline)
                self.assertEqual([item['timeoutSeconds'] for item in result['cases']],[limit]*4)
                self.assertEqual(deadlines[-4:],[('webkit','file',script,limit) for script in scripts])
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
if __name__=='__main__':unittest.main(verbosity=2)

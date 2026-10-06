#!/usr/bin/env python3
"""Regression tests use isolated synthetic evidence, never production reports."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), TOOLS / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ReportRetention(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'package.json').write_text(json.dumps({'version': '0.6.0'}))
        self.validator = load('validate-release.py')
        self.calls = []

    def runner(self, args, **options):
        self.calls.append(args)
        if args[-1] == 'test':
            options['stdout'].write('# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        for _, script, report in self.validator.SUITES:
            if f'tools/{script}' in args:
                p = self.root / 'reports' / report
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps({'passed': 1, 'failed': 0}))
        return subprocess.CompletedProcess(args, 0)

    def test_complete_run_generates_summary_and_logs(self):
        result = self.validator.validate(self.root, True, self.runner)
        self.assertTrue(result['passed'])
        self.assertEqual(len(result['steps']), 9)
        self.assertFalse(result['nativeVB6Certification'])
        self.assertEqual(sum('--check-goldens' in args for args in self.calls), 1)
        for step in result['steps'].values():
            self.assertTrue((self.root / step['log']).is_file())

    def test_failure_replaces_old_passing_summary(self):
        path = self.root / 'reports/release-validation.json'
        path.parent.mkdir()
        path.write_text('{"passed": true}')
        def fail(args, **options):
            self.assertFalse(json.loads(path.read_text())['passed'])
            return subprocess.CompletedProcess(args, 2)
        result = self.validator.validate(self.root, runner=fail)
        self.assertFalse(result['passed'])
        self.assertFalse(json.loads(path.read_text())['passed'])
        self.assertEqual(result['steps']['build']['exitCode'], 2)

    def test_interruption_records_failure(self):
        def interrupt(*args, **options):
            raise KeyboardInterrupt()
        result = self.validator.validate(self.root, runner=interrupt)
        self.assertFalse(result['passed'])
        self.assertIn('KeyboardInterrupt', result['error'])
        self.assertFalse(json.loads((self.root / 'reports/release-validation.json').read_text())['passed'])

    def test_success_exit_without_node_summary_is_rejected(self):
        result = self.validator.validate(self.root, runner=lambda args, **kwargs: subprocess.CompletedProcess(args, 0))
        self.assertFalse(result['passed'])
        self.assertIn('Incomplete Node report', result['error'])

    def test_missing_browser_output_does_not_reuse_old_json(self):
        stale = self.root / 'reports/browser-tests.json'
        stale.parent.mkdir()
        stale.write_text('{"passed": 100, "failed": 0}')
        def no_browser_report(args, **options):
            if 'tools/browser-tests.py' in args:
                self.assertFalse(stale.exists())
                return subprocess.CompletedProcess(args, 0)
            return self.runner(args, **options)
        result = self.validator.validate(self.root, runner=no_browser_report)
        self.assertFalse(result['passed'])
        self.assertIn('FileNotFoundError', result['error'])

    def test_failed_or_empty_browser_results_are_rejected(self):
        for evidence in ({'passed': 1, 'failed': 1}, {'passed': 0, 'failed': 0},
                         {'passed': True, 'failed': False}):
            with self.subTest(evidence=evidence):
                def bad_result(args, **options):
                    result = self.runner(args, **options)
                    if 'tools/browser-tests.py' in args:
                        (self.root / 'reports/browser-tests.json').write_text(json.dumps(evidence))
                    return result
                self.assertFalse(self.validator.validate(self.root, runner=bad_result)['passed'])

    def test_missing_package_evidence_has_actionable_error(self):
        module = load('package-release.py')
        module.ROOT = self.root
        (self.root / 'dist').mkdir()
        (self.root / 'dist/VB6-Studio-Web.html').write_text('Synthetic build fixture')
        for evidence, expected in ((None, 'validate-release.py'),
                                   ({'version': '0.6.0', 'passed': True}, 'missing:')):
            with self.subTest(evidence=evidence):
                if evidence:
                    path = self.root / 'reports/release-validation.json'
                    path.parent.mkdir(exist_ok=True)
                    path.write_text(json.dumps(evidence))
                with patch.object(sys, 'argv', ['package-release.py', '--out', str(self.root / 'out')]):
                    with self.assertRaisesRegex(SystemExit, expected):
                        module.main()
                self.assertEqual(list((self.root / 'out').glob('*.zip')), [])

if __name__ == '__main__':
    unittest.main()

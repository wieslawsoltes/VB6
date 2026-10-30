#!/usr/bin/env python3
"""Run an isolated, audited partition of an existing unittest browser suite.

The original loader (including load_tests) defines the inventory. Contiguous
partitions keep native-project HTTP/file pairs balanced. Each worker owns its
browser, contexts and report directory; neither test bodies nor skips change.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
import unittest

ROOT = Path(__file__).resolve().parents[2]
# Explicit report bindings: these suites already expose their configuration
# globals. Never rewrite ROOT, the URL, the fixture, or any test method.
REPORT_BINDINGS = {
    'native-project-browser-tests.py': ('REPORT',),
    'figma-services-browser-tests.py': ('base', 'REPORT'),
    'browser-input-modes-tests.py': ('REPORT',),
}


def write_evidence(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def partition(items, index, count):
    if type(index) is not int or type(count) is not int or not 1 <= index <= count <= 2:
        raise ValueError('Case shards require an index in 1..count and at most two workers')
    if len(items) < count:
        raise ValueError('Empty case partitions cannot qualify a suite')
    return items[len(items) * (index - 1) // count:len(items) * index // count]


def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        elif isinstance(item, unittest.TestCase):
            yield item
        else:
            raise ValueError('Unsupported unittest suite member')


def discover(module):
    # A fresh loader prevents errors or name patterns leaking from prior imports.
    loader = unittest.TestLoader()
    cases = sorted(flatten(loader.loadTestsFromModule(module)), key=lambda case: case.id())
    if loader.errors:
        raise ValueError('Browser case discovery failed: ' + '\n'.join(loader.errors))
    ids = [case.id() for case in cases]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Empty or duplicate browser case inventory')
    return cases


def load_module(root, script):
    if script not in REPORT_BINDINGS:
        raise ValueError('Suite has not declared an isolated case-shard report binding')
    path = Path(root) / 'tools' / script
    if not path.is_file() or path.is_symlink():
        raise ValueError('Case-sharded suite must be a regular source file')
    # Match direct `python tools/suite.py` imports without executing its main.
    tools = str(Path(root) / 'tools')
    if tools not in sys.path:
        sys.path.insert(0, tools)
    spec = importlib.util.spec_from_file_location('vb6_case_suite', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def isolate_reports(module, root, script, index, count):
    owner = module
    binding = REPORT_BINDINGS[script]
    for name in binding[:-1]:
        owner = getattr(owner, name)
    original = getattr(owner, binding[-1])
    if not isinstance(original, Path) or not original.resolve().is_relative_to((Path(root) / 'reports').resolve()):
        raise ValueError('Case reports must remain under the repository reports directory')
    setattr(owner, binding[-1], original / f'case-shard-{index}-of-{count}')


class EvidenceResult(unittest.TextTestResult):
    def __init__(self, stream, descriptions, verbosity, evidence, path):
        super().__init__(stream, descriptions, verbosity)
        self.evidence, self.path = evidence, path
        self.starts = {}

    def startTest(self, test):
        super().startTest(test)
        self.starts[test.id()] = time.monotonic()
        self.evidence['started'].append(test.id())
        write_evidence(self.path, self.evidence)

    def stopTest(self, test):
        self.evidence['finished'].append(test.id())
        self.evidence['caseSeconds'][test.id()] = round(time.monotonic() - self.starts[test.id()], 6)
        write_evidence(self.path, self.evidence)
        super().stopTest(test)


def run_worker(root, script, index, count, path, execution_id):
    if not re.fullmatch(r'[0-9a-f]{32}', execution_id):
        raise ValueError('Invalid case-shard execution identity')
    evidence = {'version': 1, 'executionId': execution_id, 'script': script,
                'sourceSha256': None, 'revision': os.environ.get('GITHUB_SHA'),
                'browser': os.environ.get('VB6_BROWSER'), 'transport': os.environ.get('VB6_TEST_TRANSPORT'),
                'index': index, 'count': count, 'universe': [], 'selected': [],
                'started': [], 'finished': [], 'caseSeconds': {}, 'testsRun': 0,
                'failures': [], 'errors': [], 'skipped': [], 'expectedFailures': [],
                'unexpectedSuccesses': [], 'passed': False}
    write_evidence(path, evidence)
    try:
        module = load_module(root, script)
        evidence['sourceSha256'] = hashlib.sha256((Path(root) / 'tools' / script).read_bytes()).hexdigest()
        cases = discover(module)
        selected = partition(cases, index, count)
        evidence['universe'] = [case.id() for case in cases]
        evidence['selected'] = [case.id() for case in selected]
        isolate_reports(module, root, script, index, count)
        write_evidence(path, evidence)
        print(f"Case partition {index}/{count}: {len(selected)} of {len(cases)} discovered tests", flush=True)
        factory = lambda stream, descriptions, verbosity: EvidenceResult(stream, descriptions, verbosity, evidence, path)
        result = unittest.TextTestRunner(verbosity=2, resultclass=factory).run(unittest.TestSuite(selected))
        evidence.update(testsRun=result.testsRun,
                        failures=[(test.id(), message) for test, message in result.failures],
                        errors=[(test.id(), message) for test, message in result.errors],
                        skipped=[(test.id(), reason) for test, reason in result.skipped],
                        expectedFailures=[(test.id(), message) for test, message in result.expectedFailures],
                        unexpectedSuccesses=[test.id() for test in result.unexpectedSuccesses])
        evidence['passed'] = (result.wasSuccessful() and result.testsRun == len(selected)
                              and evidence['started'] == evidence['selected'] == evidence['finished'])
    except BaseException as error:
        # Interrupted/failed discovery, setup or report writes never leave a
        # successful completion record. Keep the original traceback in the log.
        evidence['passed'] = False
        evidence['workerError'] = f'{type(error).__name__}: {error}'
        try:
            write_evidence(path, evidence)
        except Exception as report_error:
            print(f'Could not retain worker failure evidence: {report_error}', file=sys.stderr, flush=True)
        raise
    write_evidence(path, evidence)
    return evidence


def validate_evidence(records, script, count, execution_id, source_sha256, engine, transport):
    if len(records) != count or count != 2:
        raise ValueError('Every case worker must provide completion evidence')
    universe = None
    covered = []
    for index, record in enumerate(records, 1):
        expected = {'version': 1, 'executionId': execution_id, 'script': script,
                    'sourceSha256': source_sha256, 'browser': engine, 'transport': transport,
                    'index': index, 'count': count}
        if any(type(record.get(key)) is not type(value) or record.get(key) != value for key, value in expected.items()):
            raise ValueError('Case worker identity/source/origin does not match this execution')
        names = record.get('universe')
        if not isinstance(names, list) or not names or any(not isinstance(name, str) or not name for name in names):
            raise ValueError('Missing case inventory')
        if names != sorted(set(names)) or (universe is not None and names != universe):
            raise ValueError('Workers disagree on the complete, unique case inventory')
        universe = names
        selected = partition(names, index, count)
        if any(record.get(key) != selected for key in ('selected', 'started', 'finished')):
            raise ValueError('Every assigned case must start and finish exactly once')
        if record.get('passed') is not True or type(record.get('testsRun')) is not int or record['testsRun'] != len(selected):
            raise ValueError('Case worker did not complete successfully')
        if any(record.get(key) != [] for key in ('errors', 'failures', 'unexpectedSuccesses')) or 'workerError' in record:
            raise ValueError('Case worker reported a failure')
        covered.extend(selected)
    if covered != universe:
        raise ValueError('Case partitions do not cover the original suite exactly once')
    return {'discovered': len(universe), 'completed': len(covered),
            'skipped': sum(len(record['skipped']) for record in records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', required=True, choices=tuple(REPORT_BINDINGS))
    parser.add_argument('--index', required=True, type=int)
    parser.add_argument('--count', required=True, type=int, choices=(2,))
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--execution-id', required=True)
    args = parser.parse_args()
    try:
        record = run_worker(ROOT, args.script, args.index, args.count, args.evidence, args.execution_id)
    except Exception:
        traceback.print_exc()
        return 1
    return 0 if record['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

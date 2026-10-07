#!/usr/bin/env python3
"""Shared strict CI gate. Update the case count when adding an acceptance case.

A required backend must draw; a successful fallback or a skipped comparison is
not a GPU pass. This validates report completeness, not hardware performance.
"""
import argparse
import json
from pathlib import Path

EXPECTED_CASES = 40

def verify(report, backend):
    expected = {'passed': EXPECTED_CASES, 'failed': 0, 'skipped': 0}
    if report.get('summary') != expected:
        raise ValueError(f'Incomplete rendering acceptance: {report.get("summary")} != {expected}')
    cases = report.get('results', [])
    if len(cases) != EXPECTED_CASES or len({case['name'] for case in cases}) != EXPECTED_CASES:
        raise ValueError('Missing or duplicate rendering cases')
    for case in cases:
        if case.get('passed') is not True or (isinstance(case.get('details'), dict) and case['details'].get('skipped')):
            raise ValueError(f'Unexecuted rendering case: {case["name"]}')
    metrics = report.get('metrics', {})
    if backend not in metrics.get('requiredBackends', []):
        raise ValueError(f'{backend} was not required by the test runner')
    if metrics.get('backends', {}).get(backend, {}).get('available') is not True:
        raise ValueError(f'{backend} never initialized')
    visual = [v for v in report.get('visual', []) if v.get('backend') == backend]
    if len(visual) != 4 or {v.get('dpr') for v in visual} != {1, 1.25, 1.5, 2}:
        raise ValueError('Incomplete required-backend IDE pixel comparisons')
    if any(v.get('changedPixels') != 0 for v in report.get('visual', [])):
        raise ValueError('IDE pixels differ from the HTML reference')
    return expected

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--backend', required=True, choices=['webgpu', 'webgl2'])
    args = parser.parse_args()
    try:
        summary = verify(json.loads(args.report.read_text()), args.backend)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'{error}\n')
    print(f'{args.backend}: {summary}')

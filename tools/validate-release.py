#!/usr/bin/env python3
"""Generate release evidence from real tests instead of checked-in snapshots."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SUITES = (
    ('general', 'browser-tests.py', 'browser-tests.json'),
    ('compatibility', 'browser-parity-tests.py', 'browser-parity-tests.json'),
    ('visual', 'browser-visual-tests.py', 'browser-visual-tests.json'),
    ('features', 'browser-features-04.py', 'browser-features-04.json'),
    ('recovery', 'recovery-browser-tests.py', 'recovery/recovery-browser.json'),
    ('finalization', 'browser-finalization-05.py', 'finalization-05/browser-finalization-05.json'),
    ('boundaries', 'browser-boundaries-06.py', 'boundaries-06/browser-boundaries-06.json'),
)

def validate(root: Path, check_goldens: bool = False, runner=subprocess.run) -> dict:
    reports = root / 'reports'
    logs = reports / 'release'
    logs.mkdir(parents=True, exist_ok=True)
    summary_path = reports / 'release-validation.json'
    summary = {'version': json.loads((root / 'package.json').read_text())['version'],
               'passed': False, 'steps': {}, 'nativeVB6Certification': False}
    def save():
        # Persist a non-passing state before starting, including on interruption.
        temporary = summary_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(summary, indent=2) + '\n')
        temporary.replace(summary_path)
    save()
    npm = shutil.which('npm') or 'npm'
    commands = [('build', [npm, 'run', 'build'], None),
                ('node', [npm, 'test'], None)]
    commands += [(name, [sys.executable, f'tools/{script}'] +
                  (['--check-goldens'] if check_goldens and name == 'visual' else []), report)
                 for name, script, report in SUITES]
    try:
        for name, command, report in commands:
            if report:
                (reports / report).unlink(missing_ok=True)
            log = logs / f'{name}.log'
            started = time.monotonic()
            with log.open('w') as output:
                result = runner(command, cwd=root, stdout=output,
                                stderr=subprocess.STDOUT, timeout=900, check=False)
            step = {'exitCode': result.returncode, 'log': log.relative_to(root).as_posix(),
                    'seconds': round(time.monotonic() - started, 3)}
            summary['steps'][name] = step
            if result.returncode:
                raise RuntimeError(f'{name} failed; see {step["log"]}')
            if name == 'node':
                text = log.read_text()
                counts = {}
                for key in ('pass', 'fail', 'cancelled', 'skipped', 'todo'):
                    match = re.search(rf'^# {key} (\d+)$', text, re.M)
                    if not match:
                        raise RuntimeError(f'Incomplete Node report: missing {key}')
                    counts[key] = int(match[1])
                if counts['pass'] <= 0 or any(counts[key] for key in counts if key != 'pass'):
                    raise RuntimeError('Node validation must complete without failures, skips or cancellations')
                step.update(passed=counts['pass'], failed=0)
            elif report:
                evidence = json.loads((reports / report).read_text())
                passed, failed = evidence.get('passed'), evidence.get('failed')
                if type(passed) is not int or passed <= 0 or type(failed) is not int or failed != 0:
                    raise RuntimeError(f'{name} must record positive passed and zero failed counts')
                step.update(passed=passed, failed=failed)
            save()
        summary['passed'] = True
    except (Exception, KeyboardInterrupt) as error:
        summary['error'] = f'{type(error).__name__}: {error}'
    finally:
        save()
    return summary

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-goldens', action='store_true')
    args = parser.parse_args()
    result = validate(ROOT, args.check_goldens)
    print(json.dumps(result, indent=2))
    return 0 if result['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())

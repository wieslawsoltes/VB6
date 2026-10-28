#!/usr/bin/env python3
"""Run an allowlisted suite group, retaining every exit, log and elapsed time.

Independent suites continue after failure. Cancellation stops the child process
 group and launches no successor. No retries, skipped assertions or shell input.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
ENGINES = ('chromium', 'firefox', 'webkit')
# The combined name remains a local convenience; CI schedules each owner once.
FIGMA_GROUPS = ('figma-authoring', 'figma-services')
DEFAULT_PROCESS_TIMEOUT = 480
# WebKit's large standalone document needs a fresh parse for each isolated
# case. These complete suites exceed eight minutes while individual actions
# keep their existing short deadlines. The native-project script owns both
# HTTP and file cases when either real transport is selected.
PROCESS_TIMEOUTS = {
    ('webkit', 'file', 'figma-browser-tests.py'): 900,
    ('webkit', 'file', 'figma-services-browser-tests.py'): 900,
    ('webkit', 'http', 'native-project-browser-tests.py'): 1200,
    ('webkit', 'file', 'native-project-browser-tests.py'): 1200,
    ('webkit', 'file', 'browser-advanced-editor-tests.py'): 1200,
}


def plan(group, engine, transport, root=ROOT):
    if engine not in ENGINES or transport not in ('http', 'file', 'memory'):
        raise ValueError('Unknown engine or transport')
    suites = json.loads((root / 'tools/ci/suites.json').read_text())
    if not isinstance(group, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', group):
        raise ValueError('Unknown validation group')
    groups = FIGMA_GROUPS if group == 'figma' else (group,)
    if any(name not in suites for name in groups):
        raise ValueError('Unknown validation group')
    if any(not isinstance(suites[name], list) for name in groups):
        raise ValueError('A validation group must be a list of scripts')
    scripts = [script for name in groups for script in suites[name]]
    if not scripts or len(scripts) != len(set(scripts)):
        raise ValueError('Empty or duplicate suite list')
    origins = ('http', 'file') if group in ('advanced-editor', 'code-gpu') else (transport,)
    result = []
    for origin in origins:
        for script in scripts:
            if not isinstance(script, str) or not re.fullmatch(r'[a-z][a-z0-9_-]*\.py', script):
                raise ValueError('Only fixed tool basenames are allowed')
            path = root / 'tools' / script
            if not path.is_file() or path.is_symlink():
                raise ValueError('Missing suite: ' + script)
            argv = [sys.executable, str(path)]
            if script == 'browser-compiler-runtime.py':
                if origin == 'http':
                    argv += ['--http']
                elif origin != 'memory':
                    raise ValueError('Compiler/runtime validation supports HTTP or memory transport')
            if script == 'browser-data-recordsets.py':
                argv += ['--browser', engine]
            if script == 'browser-designer-tests.py':
                argv += ['--browser', engine, '--origin', origin]
            if engine == 'firefox' and script == 'figma-retained-webgl-browser-tests.py':
                argv = ['xvfb-run', '-a', '-s', '-screen 0 1920x1200x24', *argv]
            result.append({'script': script, 'transport': origin, 'argv': argv})
    return result


def write_report(path, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, indent=2) + '\n')
    temporary.replace(path)


def terminate(process):
    # POSIX process groups include the browser and fixture-server descendants.
    if os.name == 'posix':
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    elif process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    if os.name == 'posix':
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif process.poll() is None:
        process.kill()
    process.wait()


def execute(task, root, env, log, timeout, cancelled):
    if not 0 < timeout <= 1800:
        raise ValueError('Invalid process deadline')
    start = time.monotonic()
    status, code, error = 'failed', None, None
    with log.open('wb') as output:
        try:
            process = subprocess.Popen(task['argv'], cwd=root, env=env, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=os.name == 'posix')
        except OSError as failure:
            error = str(failure)
        else:
            try:
                # A regular file avoids PIPE backpressure and is already durable
                # when a runner is terminated. There is no orphan reader thread.
                with log.open('rb') as reader:
                    while True:
                        chunk = reader.read(65536)
                        if chunk:
                            print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
                        code = process.poll()
                        if code is not None:
                            status = 'passed' if code == 0 else 'failed'
                            break
                        if cancelled.is_set() or time.monotonic() - start >= timeout:
                            status = 'cancelled' if cancelled.is_set() else 'timed_out'
                            terminate(process)
                            code = process.returncode
                            break
                        time.sleep(.05)
                    for chunk in iter(lambda: reader.read(65536), b''):
                        print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
            finally:
                terminate(process)
    return {'status': status, 'exitCode': code, 'error': error,
            'seconds': round(time.monotonic() - start, 3)}


def run_batch(tasks, root, engine, report, timeout=None, cancelled=None, execute_fn=execute):
    if not tasks:
        raise ValueError('An empty batch cannot pass')
    cancelled = cancelled if cancelled is not None else threading.Event()
    records = [{**task, 'status': 'queued'} for task in tasks]
    result = {'revision': os.environ.get('GITHUB_SHA'), 'browser': engine,
              'passed': False, 'cases': records}
    path = report / 'timings.json'
    write_report(path, result)
    for index, (task, record) in enumerate(zip(tasks, records)):
        if cancelled.is_set():
            record['status'] = 'cancelled'
            write_report(path, result)
            continue
        log = report / f"{index + 1:02d}-{task['script']}-{task['transport']}.log"
        deadline = timeout if timeout is not None else PROCESS_TIMEOUTS.get(
            (engine, task['transport'], task['script']), DEFAULT_PROCESS_TIMEOUT)
        record.update(status='running', log=log.name, timeoutSeconds=deadline)
        write_report(path, result)
        print(f"::group::{task['script']} [{engine}/{task['transport']}]", flush=True)
        env = {**os.environ, 'VB6_BROWSER': engine, 'VB6_TEST_TRANSPORT': task['transport'],
               'PYTHONUNBUFFERED': '1'}
        try:
            record.update(execute_fn(task, root, env, log, deadline, cancelled))
        except Exception as failure:
            record.update(status='failed', error=str(failure))
        finally:
            write_report(path, result)
            print(f"::endgroup::\n{record['status'].upper()} {task['script']}", flush=True)
    result['passed'] = not cancelled.is_set() and all(r['status'] == 'passed' for r in records)
    write_report(path, result)
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as output:
            output.write('\n| Suite | Origin | Result | Seconds |\n|---|---|---|---:|\n')
            for record in records:
                output.write(f"| {record['script']} | {record['transport']} | {record['status']} | {record.get('seconds', '—')} |\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('group')
    args = parser.parse_args()
    engine = os.environ.get('VB6_BROWSER', 'chromium')
    transport = os.environ.get('VB6_TEST_TRANSPORT', 'http')
    tasks = plan(args.group, engine, transport)
    cancelled = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda _signum, _frame: cancelled.set())
    result = run_batch(tasks, ROOT, engine, ROOT / 'reports/ci' / f'{args.group}-{engine}-{transport}', cancelled=cancelled)
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Run an allowlisted suite group, retaining every exit, log and elapsed time.

Independent suites continue after failure. Cancellation stops the child process
 group and launches no successor. No retries, skipped assertions or shell input.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
import case_shard

ROOT = Path(__file__).resolve().parents[2]
ENGINES = ('chromium', 'firefox', 'webkit')
# Keep the process bounds already qualified on current main. Splitting the
# measured slow suites into isolated workers does not relax action deadlines.
# Memory transport and all other engines retain the ordinary eight-minute bound.
SCRIPT_TIMEOUTS = {
    # Validate #1493 passed 46/53 appearance cases before the 480s batch
    # deadline. Keep all cases and their 10s interaction limits; allow the
    # complete mixed HTTP/file matrix inside its existing 25-minute job.
    ('webkit', 'browser-application-theme-tests.py', 'http'): 900,
    ('webkit', 'browser-application-theme-tests.py', 'file'): 900,
    ('webkit', 'native-project-browser-tests.py', 'http'): 1200,
    ('webkit', 'native-project-browser-tests.py', 'file'): 1200,
    ('webkit', 'figma-browser-tests.py', 'file'): 900,
    ('webkit', 'figma-editor-browser-tests.py', 'file'): 900,
    ('webkit', 'figma-services-browser-tests.py', 'file'): 900,
    ('webkit', 'browser-advanced-editor-tests.py', 'file'): 1200,
    ('webkit', 'browser-input-modes-tests.py', 'file'): 900,
}
# The combined name remains a local convenience; CI schedules each owner once.
FIGMA_GROUPS = ('figma-workspace', 'figma-authoring', 'figma-services')
ADVANCED_EDITOR_GROUPS = ('advanced-editor-core', 'advanced-editor-integration')


def plan(group, engine, transport, root=ROOT):
    if engine not in ENGINES or transport not in ('http', 'file', 'memory'):
        raise ValueError('Unknown engine or transport')
    suites = json.loads((root / 'tools/ci/suites.json').read_text())
    if not isinstance(group, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', group):
        raise ValueError('Unknown validation group')
    groups = (FIGMA_GROUPS if group == 'figma' else
              ADVANCED_EDITOR_GROUPS if group == 'advanced-editor' else (group,))
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
            task = {'script': script, 'transport': origin, 'argv': argv}
            # Preserve the existing script/job budgets and all original test
            # methods. Only these measured cumulative WebKit workloads need
            # two isolated processes; every other invocation stays unchanged.
            if engine == 'webkit' and origin != 'memory' and (
                    script == 'native-project-browser-tests.py' or
                    (script in ('figma-services-browser-tests.py', 'browser-input-modes-tests.py') and origin == 'file')):
                task['caseShards'] = 2
            result.append(task)
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


def execute_case_shards(task, root, env, log, timeout, cancelled, execute_fn=execute):
    """Bounded parallelism within one owned suite, with complete-case admission."""
    count = task.get('caseShards')
    if type(count) is not int or count != 2 or task['script'] not in case_shard.REPORT_BINDINGS:
        raise ValueError('Only declared browser suites may use two case workers')
    if task['argv'] != [sys.executable, str(root / 'tools' / task['script'])]:
        raise ValueError('Case workers cannot discard original command-line arguments')
    execution_id = uuid.uuid4().hex
    start = time.monotonic()
    source_sha = hashlib.sha256((root / 'tools' / task['script']).read_bytes()).hexdigest()
    records = []
    pool = ThreadPoolExecutor(max_workers=count, thread_name_prefix='vb6-browser-cases')

    def worker(index):
        evidence = log.with_name(f'{log.stem}-case-{index}-of-{count}.json')
        child_log = evidence.with_suffix('.log')
        child = {**task, 'argv': [sys.executable, str(root / 'tools/ci/case_shard.py'),
                 '--script', task['script'], '--index', str(index), '--count', str(count),
                 '--evidence', str(evidence), '--execution-id', execution_id]}
        record = {'index': index, 'count': count, 'log': child_log.name,
                  'evidence': evidence.name, 'timeoutSeconds': timeout}
        if cancelled.is_set():
            return {**record, 'status': 'cancelled', 'exitCode': None, 'seconds': 0}
        try:
            return {**record, **execute_fn(child, root, env, child_log, timeout, cancelled)}
        except Exception as error:
            return {**record, 'status': 'failed', 'exitCode': None, 'error': str(error)}

    try:
        futures = [pool.submit(worker, index) for index in range(1, count + 1)]
        records = [future.result() for future in futures]
    except BaseException:
        cancelled.set()
        raise
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    result = {'status': 'failed', 'exitCode': 1, 'error': None,
              'seconds': round(time.monotonic() - start, 3), 'shards': records}
    if cancelled.is_set() or any(record['status'] == 'cancelled' for record in records):
        result['status'] = 'cancelled'
    elif any(record['status'] == 'timed_out' for record in records):
        result['status'] = 'timed_out'
    elif all(record['status'] == 'passed' and record.get('exitCode') == 0 for record in records):
        try:
            evidence = [json.loads((log.parent / record['evidence']).read_text()) for record in records]
            result['caseCoverage'] = case_shard.validate_evidence(
                evidence, task['script'], count, execution_id, source_sha,
                env['VB6_BROWSER'], env['VB6_TEST_TRANSPORT'])
            result.update(status='passed', exitCode=0)
        except Exception as error:
            result['error'] = 'Case coverage admission failed: ' + str(error)
    log.write_text(json.dumps(result, indent=2) + '\n')
    if result['error']:
        print(result['error'], flush=True)
    return result


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
        default_deadline = SCRIPT_TIMEOUTS.get((engine, task['script'], task['transport']),
                           SCRIPT_TIMEOUTS.get((engine, task['script'], None), 480))
        deadline = timeout if timeout is not None else default_deadline
        record.update(status='running', log=log.name, timeoutSeconds=deadline)
        write_report(path, result)
        print(f"::group::{task['script']} [{engine}/{task['transport']}]", flush=True)
        env = {**os.environ, 'VB6_BROWSER': engine, 'VB6_TEST_TRANSPORT': task['transport'],
               'PYTHONUNBUFFERED': '1'}
        try:
            if task.get('caseShards'):
                record.update(execute_case_shards(task, root, env, log, deadline, cancelled, execute_fn))
            else:
                record.update(execute_fn(task, root, env, log,deadline,cancelled))
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

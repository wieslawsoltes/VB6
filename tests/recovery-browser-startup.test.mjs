import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

// Exercise the actual boot-to-case ownership transfer without importing the
// acceptance script's Playwright runner. A pending load event remains pending;
// only the independent DOM/API startup boundary can admit a feature action.
const result = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import ast, io, json, tempfile, time, traceback
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

tree = ast.parse(Path('tools/recovery-browser-tests.py').read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('check', 'boot', 'case')]
code = compile(ast.Module(body=functions, type_ignores=[]), 'tools/recovery-browser-tests.py', 'exec')

def scenario(failure=None, cleanup_failure=False, through_case=True):
    calls = []
    original = RuntimeError('original ' + (failure or 'pending load') + ' failure')
    class Page:
        def set_default_timeout(self, timeout): calls.append(['action-timeout', timeout])
        def on(self, event, listener):
            calls.append(['listener', event]); self.error_listener = listener
        def set_content(self, html, **options):
            calls.append(['content', html, options])
            if failure == 'content' or options.get('wait_until', 'load') == 'load': raise original
        def wait_for_function(self, expression, **options):
            calls.append(['ready', expression, options])
            if failure == 'readiness': raise original
            if failure == 'page-error': self.error_listener(RuntimeError('observed page error'))
        def screenshot(self, **options): calls.append(['failure-screenshot'])
        def close(self):
            calls.append(['close'])
            if cleanup_failure: raise RuntimeError('secondary cleanup failure')
    class Browser:
        def new_page(self, **options):
            calls.append(['new-page', options]); self.page = Page(); return self.page
    with tempfile.TemporaryDirectory() as directory:
        namespace = {'HTML': '<!doctype html><title>the same inline bytes</title>', 'REPORT': Path(directory),
                     'time': time, 'traceback': traceback, 'results': []}
        exec(code, namespace)
        browser = Browser()
        outcome = {}
        def feature(page):
            calls.append(['feature', page is browser.page])
            if failure == 'feature': raise original
            return {'verified': True}
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            try:
                if through_case:
                    namespace['case'](browser, 'recovery probe', feature)
                else:
                    page = namespace['boot'](browser)
                    outcome['returned_owned_page'] = page is browser.page
            except Exception as error:
                outcome.update(error=str(error), original_error=error is original)
        return {'failure': failure, 'cleanup_failure': cleanup_failure, 'through_case': through_case,
                'calls': calls, 'results': namespace['results'], 'page_errors': browser.page._errors, **outcome}

scenarios = [scenario(), scenario(through_case=False), scenario('page-error'), scenario('feature')]
scenarios += [scenario(failure, cleanup, through_case) for failure in ('content', 'readiness')
              for cleanup in (False, True) for through_case in (False, True)]
print(json.dumps(scenarios))
`], {cwd: root, encoding: 'utf8', timeout: 10000});

test('the recovery boot and case ownership paths can be exercised without a browser', () => {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
});
const scenarios = result.status === 0 ? JSON.parse(result.stdout) : [];
const calls = (scenario, name) => scenario.calls.filter(call => call[0] === name);

test('pending load does not block the connected recovery API or extend interactions', () => {
    const scenario = scenarios.find(item => !item.failure && item.through_case);
    assert.equal(scenario.error, undefined);
    assert.deepEqual(calls(scenario, 'action-timeout'), [['action-timeout', 4500]]);
    assert.deepEqual(calls(scenario, 'content'), [['content', '<!doctype html><title>the same inline bytes</title>',
        {wait_until: 'domcontentloaded', timeout: 60000}]]);
    assert.deepEqual(calls(scenario, 'ready')[0][2], {timeout: 60000});
    const predicate = calls(scenario, 'ready')[0][1];
    for (const state of [{}, {vb6Studio: {ideTools: {}}}, {vb6Studio: {root: {isConnected: false}, ideTools: {}}},
        {vb6Studio: {root: {isConnected: true}}}]) assert.equal(Boolean(vm.runInNewContext(predicate, state)), false);
    assert.equal(Boolean(vm.runInNewContext(predicate, {vb6Studio: {root: {isConnected: true}, ideTools: {}}})), true);
    assert.deepEqual(calls(scenario, 'feature'), [['feature', true]]);
    assert.equal(calls(scenario, 'close').length, 1, 'the successful case retains cleanup ownership');
    assert.equal(scenario.results[0].passed, true);
});

test('successful boot transfers its live page without closing it', () => {
    const scenario = scenarios.find(item => !item.failure && !item.through_case);
    assert.equal(scenario.returned_owned_page, true);
    assert.equal(calls(scenario, 'close').length, 0);
});

for (const scenario of scenarios.filter(item => ['content', 'readiness'].includes(item.failure))) {
    test(`recovery ${scenario.failure} failure retains its initiating error through ${scenario.through_case ? 'case' : 'boot'}${scenario.cleanup_failure ? ' when cleanup fails' : ''}`, () => {
        assert.equal(calls(scenario, 'new-page').length, 1);
        assert.equal(calls(scenario, 'content').length, 1, 'startup must not retry or replace the inline transport');
        assert.equal(calls(scenario, 'ready').length, scenario.failure === 'content' ? 0 : 1);
        assert.equal(calls(scenario, 'feature').length, 0);
        assert.equal(calls(scenario, 'close').length, 1, 'failed startup page must not leak or be closed twice');
        if (scenario.through_case) {
            assert.equal(scenario.error, undefined);
            assert.equal(scenario.results.length, 1);
            assert.equal(scenario.results[0].passed, false);
            assert.equal(scenario.results[0].error, `original ${scenario.failure} failure`);
        } else {
            assert.equal(scenario.original_error, true);
            assert.equal(scenario.error, `original ${scenario.failure} failure`);
        }
    });
}

test('page errors remain observable and fail recovery acceptance', () => {
    const scenario = scenarios.find(item => item.failure === 'page-error');
    assert.deepEqual(scenario.page_errors, ['observed page error']);
    assert.equal(scenario.results[0].passed, false);
    assert.match(scenario.results[0].error, /observed page error/);
    assert.equal(calls(scenario, 'close').length, 1);
});

test('feature assertion failures still record failure and close the returned page', () => {
    const scenario = scenarios.find(item => item.failure === 'feature');
    assert.equal(scenario.results[0].passed, false);
    assert.equal(scenario.results[0].error, 'original feature failure');
    assert.equal(calls(scenario, 'failure-screenshot').length, 1);
    assert.equal(calls(scenario, 'close').length, 1);
});

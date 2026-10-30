import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

// Execute the real fixture loader without importing Playwright or starting the
// script's server. Fault injection covers startup lifetime and error ownership.
const result = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import ast
import json
from pathlib import Path
from types import SimpleNamespace

source = ast.parse(Path('tools/browser-pascal-tests.py').read_text())
loader = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'studio')
code = compile(ast.Module(body=[loader], type_ignores=[]), 'tools/browser-pascal-tests.py', 'exec')

def run(origin, advanced=False, failure=None, cleanup_failure=False):
    calls = []
    errors, requests = [], []
    original = RuntimeError(failure or 'stalled load event')
    class Page:
        def on(self, event, listener):
            calls.append(['page-on', event])
            self.error_listener = listener
        def goto(self, address, **options):
            calls.append(['goto', address, options])
            if failure == 'navigation' or options.get('wait_until', 'load') == 'load':
                raise original
        def wait_for_function(self, expression, **options):
            calls.append(['ready', expression, options])
            if failure == 'readiness':
                raise original
        def evaluate(self, expression):
            calls.append(['evaluate', expression])
            if failure == 'rendering':
                raise original
    class Context:
        def set_default_timeout(self, timeout):
            calls.append(['action-timeout', timeout])
        def on(self, event, listener):
            calls.append(['context-on', event])
            if event == 'page':
                self.page_listener = listener
            else:
                self.request_listener = listener
        def new_page(self):
            self.page = Page()
            self.page_listener(self.page)
            self.request_listener(SimpleNamespace(url=address))
            if failure == 'page-error':
                self.page.error_listener(RuntimeError('observed page error'))
            return self.page
        def close(self):
            calls.append(['close-context'])
            if cleanup_failure:
                raise RuntimeError('cleanup failed')
    class Browser:
        def new_context(self, **options):
            calls.append(['new-context', options])
            self.context = Context()
            return self.context
    artifact = 'VB6-Studio-Web-Advanced.html' if advanced else 'VB6-Studio-Web.html'
    address = ('http://127.0.0.1:49152/dist/' if origin == 'http' else 'file:///checkout/dist/') + artifact
    namespace = {'ARTIFACT': artifact, 'url': lambda path: address}
    exec(code, namespace)
    browser = Browser()
    outcome = {}
    try:
        page = namespace['studio'](browser, errors, requests)
        outcome.update(returned_owned_page=page is browser.context.page)
    except Exception as error:
        outcome.update(error=str(error), original_error=error is original)
    return dict(origin=origin, advanced=advanced, failure=failure, cleanup_failure=cleanup_failure,
                calls=calls, errors=errors, requests=requests, **outcome)

print(json.dumps([run(origin, advanced) for origin in ('http', 'file') for advanced in (False, True)] +
                 [run('http', failure=failure, cleanup_failure=cleanup_failure)
                  for failure in ('navigation', 'readiness', 'rendering') for cleanup_failure in (False, True)] +
                 [run('file', failure='page-error')]))
`], {cwd: root, encoding: 'utf8', timeout: 10000});

test('Pascal browser startup fixtures can be exercised without a browser', () => {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
});

const scenarios = result.status === 0 ? JSON.parse(result.stdout) : [];
const calls = (scenario, name) => scenario.calls.filter(call => call[0] === name);

for (const scenario of scenarios.filter(item => !item.failure)) {
    test(`Pascal ${scenario.advanced ? 'Advanced' : 'classic'} ${scenario.origin} startup waits for mounted APIs when load stalls`, () => {
        assert.equal(scenario.returned_owned_page, true);
        assert.deepEqual(calls(scenario, 'action-timeout'), [['action-timeout', 20000]]);
        const navigation = calls(scenario, 'goto');
        assert.equal(navigation.length, 1);
        assert.equal(new URL(navigation[0][1]).protocol, scenario.origin === 'http' ? 'http:' : 'file:');
        assert.equal(navigation[0][1].endsWith(scenario.advanced ? 'VB6-Studio-Web-Advanced.html' : 'VB6-Studio-Web.html'), true);
        assert.deepEqual(navigation[0][2], {wait_until: 'commit', timeout: 60000});
        const readiness = calls(scenario, 'ready');
        assert.equal(readiness.length, 1);
        assert.deepEqual(readiness[0][2], {timeout: 60000});
        for (const state of [
            {},
            {vb6Studio: {mcp: {}}, VB6StudioAPI: {}},
            {vb6Studio: {root: {isConnected: false}, mcp: {}}, VB6StudioAPI: {}},
            {vb6Studio: {root: {isConnected: true}}, VB6StudioAPI: {}},
            {vb6Studio: {root: {isConnected: true}, mcp: {}}},
        ]) assert.equal(Boolean(vm.runInNewContext(readiness[0][1], state)), false);
        assert.equal(Boolean(vm.runInNewContext(readiness[0][1], {
            vb6Studio: {root: {isConnected: true}, mcp: {}}, VB6StudioAPI: {},
        })), true);
        assert.equal(calls(scenario, 'evaluate').length, 1);
        assert.equal(calls(scenario, 'close-context').length, 0);
        assert.deepEqual(scenario.requests, [navigation[0][1]]);
    });
}

for (const scenario of scenarios.filter(item => ['navigation', 'readiness', 'rendering'].includes(item.failure))) {
    test(`Pascal ${scenario.failure} startup failure closes its context${scenario.cleanup_failure ? ' and preserves the original error when cleanup fails' : ''}`, () => {
        assert.equal(scenario.error, scenario.failure);
        assert.equal(scenario.original_error, true);
        assert.equal(calls(scenario, 'close-context').length, 1);
        assert.equal(calls(scenario, 'goto').length, 1, 'must not retry or change origin');
        assert.equal(calls(scenario, 'ready').length, scenario.failure === 'navigation' ? 0 : 1);
        assert.equal(calls(scenario, 'evaluate').length, scenario.failure === 'rendering' ? 1 : 0);
    });
}

test('Pascal startup keeps page errors observable by the acceptance gate', () => {
    const scenario = scenarios.find(item => item.failure === 'page-error');
    assert.ok(scenario);
    assert.equal(scenario.returned_owned_page, true);
    assert.deepEqual(scenario.errors, ['observed page error']);
});

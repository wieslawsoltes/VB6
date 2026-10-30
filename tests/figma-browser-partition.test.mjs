import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

// Execute the real discovery adapters and fixture lifecycle without importing
// Playwright. The owning methods come from each current source file, so added
// cases must remain covered and inherited acceptance suites cannot duplicate.
const result = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import ast, json, os, sys, tempfile, unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path('tools').resolve()))
from ci.browser_partition import configured_shard, own_case_names, select_case_names

suites = json.loads(Path('tools/ci/suites.json').read_text())
discovery = []
class Inherited(unittest.TestCase):
    def test_inherited_other_suite(self): pass

def selected(namespace, engine, origin, shard='', gpu=''):
    namespace['REQUIRED_GPU'] = gpu
    with patch.dict(os.environ, {'VB6_BROWSER': engine, 'VB6_TEST_TRANSPORT': origin, 'VB6_BROWSER_SHARD': shard}):
        try:
            suite = namespace['load_tests'](unittest.TestLoader(), None, None)
            return {'names': [case._testMethodName for case in suite]}
        except ValueError as error:
            return {'error': str(error)}

for group in ('figma-workspace', 'figma-authoring', 'figma-services'):
    for script in suites[group]:
        path = Path('tools') / script
        tree = ast.parse(path.read_text())
        names = own_case_names(path)
        owner = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                     and any(isinstance(method, ast.FunctionDef) and method.name.startswith('test_') for method in node.body))
        case_type = type(owner.name, (Inherited,), {name: lambda self: None for name in names})
        adapter = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'load_tests')
        namespace = {owner.name: case_type, 'unittest': unittest, 'configured_shard': configured_shard,
                     'select_case_names': select_case_names}
        exec(compile(ast.Module(body=[adapter], type_ignores=[]), str(path), 'exec'), namespace)
        record = {'group': group, 'script': script, 'inventory': names,
                  'whole': [selected(namespace, engine, origin) for engine in ('chromium', 'firefox', 'webkit') for origin in ('http', 'file')],
                  'shards': [selected(namespace, 'webkit', 'file', str(index)) for index in range(1, 4)],
                  'invalid': [selected(namespace, engine, origin, '1') for engine, origin in [('chromium', 'file'), ('firefox', 'file'), ('webkit', 'http')]]}
        if script == 'figma-editor-browser-tests.py':
            record['gpu'] = selected(namespace, 'chromium', 'file', gpu='webgl2')
        discovery.append(record)

source = ast.parse(Path('tools/figma-browser-tests.py').read_text())
original = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'FigmaWorkspace')
methods = [node for node in original.body if isinstance(node, ast.FunctionDef)
           and node.name in ('setUp', 'load', 'phase', 'tearDown', 'close_context')]
fixture = ast.ClassDef(name='Fixture', bases=[ast.Attribute(value=ast.Name(id='unittest',ctx=ast.Load()), attr='TestCase',ctx=ast.Load())],
                       keywords=[], body=methods, decorator_list=[])
fixture_code = compile(ast.fix_missing_locations(ast.Module(body=[fixture], type_ignores=[])), 'figma-fixture', 'exec')

def lifecycle(failure=None):
    calls, clock = [], [0.0]
    def now():
        clock[0] += .01
        return clock[0]
    class Page:
        def on(self, event, listener): self.error_listener = listener
        def goto(self, url, **options):
            calls.append(['navigation', url, options]); clock[0] += 1
        def wait_for_function(self, expression, **options):
            calls.append(['readiness', options]); clock[0] += 5
            if failure == 'readiness': raise RuntimeError('original readiness failure')
        def evaluate(self, expression, argument): clock[0] += .2
    class Context:
        def set_default_timeout(self, timeout): calls.append(['action-timeout', timeout])
        def new_page(self): self.page = Page(); return self.page
        def close(self):
            calls.append(['close']); clock[0] += .8
            if failure == 'cleanup': raise RuntimeError('original cleanup failure')
            if failure == 'page-error': self.page.error_listener(RuntimeError('late page error'))
    class Browser:
        def new_context(self, **options):
            calls.append(['new-context', options]); clock[0] += .3
            return Context()
    with tempfile.TemporaryDirectory() as directory:
        namespace = {'unittest': unittest, 'contextmanager': contextmanager, 'json': json,
                     'time': SimpleNamespace(perf_counter=now), 'ROOT': Path('/checkout'),
                     'REPORT': Path(directory), 'ENGINE': 'webkit', 'TRANSPORT': 'file',
                     'IDE_STARTUP_TIMEOUT_MS': 60000, 'FIXTURE': 'fixture'}
        exec(fixture_code, namespace)
        case_type = namespace['Fixture']
        case_type.results = []; case_type.browser = Browser()
        case_type.test_probe = lambda self: setattr(self, 'passed', True)
        result = unittest.TestResult()
        case_type('test_probe').run(result)
        report = json.loads((Path(directory) / 'results.json').read_text())
        return {'failure': failure, 'calls': calls, 'record': report['results'][0],
                'errors': [error for case, error in result.errors],
                'failures': [error for case, error in result.failures]}

print(json.dumps({'discovery': discovery, 'lifecycle': [lifecycle(failure) for failure in (None, 'readiness', 'cleanup', 'page-error')]}))
`], {cwd: root, encoding: 'utf8', timeout: 10000});

test('real Figma discovery and fixture lifecycle can be exercised without browsers', () => {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
});

const evidence = result.status === 0 ? JSON.parse(result.stdout) : {discovery: [], lifecycle: []};
for (const suite of evidence.discovery) {
    test(`${suite.script} shards own every case once and exclude inherited suites`, () => {
        for (const whole of suite.whole) assert.deepEqual(whole.names, suite.inventory);
        const owned = suite.shards.flatMap(shard => shard.names || []);
        assert.equal(new Set(owned).size, owned.length);
        assert.deepEqual(owned.sort(), suite.inventory);
        suite.shards.forEach((shard, index) => {
            const expected = suite.inventory.filter((_, caseIndex) => caseIndex % 3 === index);
            if (expected.length) assert.deepEqual(shard.names, expected);
            else assert.match(shard.error, /without owned cases/, 'direct empty shard must fail, never report zero-test success');
        });
        for (const invalid of suite.invalid) assert.match(invalid.error, /explicitly partitioned WebKit cells/);
    });
}

for (const [group, count] of [['figma-workspace', 22], ['figma-authoring', 21], ['figma-services', 32]]) {
    test(`${group} retains its complete ${count}-case inventory`, () => {
        const suites = evidence.discovery.filter(suite => suite.group === group);
        assert.equal(suites.reduce((total, suite) => total + suite.inventory.length, 0), count);
        for (let shard = 0; shard < 3; shard++) {
            assert.ok(suites.some(suite => suite.shards[shard].names?.length), 'each local shard must own actual tests');
        }
    });
}

test('the separately qualified code GPU case keeps its existing selection', () => {
    assert.deepEqual(evidence.discovery.find(suite => suite.script === 'figma-editor-browser-tests.py').gpu.names,
        ['test_source_overlay_does_not_cover_highlighted_code']);
});

for (const scenario of evidence.lifecycle) {
    test(`Figma phase evidence includes cleanup and retains ${scenario.failure || 'successful'} outcome`, () => {
        const {calls, record} = scenario;
        assert.equal(calls.filter(call => call[0] === 'new-context').length, 1);
        assert.equal(calls.filter(call => call[0] === 'close').length, 1);
        assert.deepEqual(calls.find(call => call[0] === 'action-timeout'), ['action-timeout', 8000]);
        assert.deepEqual(calls.find(call => call[0] === 'navigation').slice(1),
            ['file:///checkout/dist/VB6-Studio-Web.html', {wait_until: 'commit'}]);
        assert.deepEqual(calls.find(call => call[0] === 'readiness')[1], {polling: 100, timeout: 60000});
        for (const phase of ['context', 'navigation', 'readiness', 'cleanup']) assert.ok(record.phaseMilliseconds[phase] > 0);
        assert.ok(record.milliseconds >= Object.values(record.phaseMilliseconds).reduce((sum, value) => sum + value, 0));
        assert.equal(record.passed, scenario.failure === null);
        if (scenario.failure === 'readiness') {
            assert.match(scenario.errors.join('\n'), /original readiness failure/);
            assert.equal(record.phaseMilliseconds.fixture, undefined);
        } else if (scenario.failure === 'cleanup') assert.match(scenario.errors.join('\n'), /original cleanup failure/);
        else if (scenario.failure === 'page-error') {
            assert.deepEqual(record.pageErrors, ['late page error']);
            assert.match(scenario.failures.join('\n'), /late page error/);
        } else assert.deepEqual([...scenario.errors, ...scenario.failures], []);
    });
}

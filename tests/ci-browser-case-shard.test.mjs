import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';

test('Browser case workers preserve complete coverage, isolation, failures and cancellation', t => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const source = fileURLToPath(new URL('../tools/ci/test_case_shard.py', import.meta.url));
  const result = spawnSync(python, [source], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    env: {...process.env, PYTHONUNBUFFERED: '1'}
  });
  // This named test is discovered by the existing four Node CI shards. CI may
  // not silently skip the Python regressions; local JS-only checkouts may opt out.
  if (result.error?.code === 'ENOENT' && !process.env.CI) {
    t.skip('Python 3.11 or later is required for browser-case runner regressions');
    return;
  }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 27 tests/);
  assert.match(result.stderr, /\nOK\s*$/);
  t.diagnostic('All 27 Python case-worker regressions executed without skips.');
});


test('Figma reload readiness tolerates an absent global and requires restored enabled state', t => {
  const source = readFileSync(new URL('../tools/figma-services-browser-tests.py', import.meta.url), 'utf8');
  const method = source.split('    def test_service_dock_profiles_reload_without_authority_or_eager_connection(self):')[1]
    ?.split('    def ')[0];
  assert.ok(method, 'The real persistence-reload acceptance method must exist.');
  assert.match(method, /self\.reload_workspace\(figma=True\)/);
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const fixture = fileURLToPath(new URL('../tools/figma-browser-tests.py', import.meta.url));
  const result = spawnSync(python, ['-c', String.raw`
import ast,json,sys
from contextlib import nullcontext
from pathlib import Path
source=ast.parse(Path(sys.argv[1]).read_text())
method=next(node for node in ast.walk(source) if isinstance(node,ast.FunctionDef) and node.name=='reload_workspace')
namespace={'IDE_STARTUP_TIMEOUT_MS':60000}
exec(compile(ast.Module(body=[method],type_ignores=[]),sys.argv[1],'exec'),namespace)
predicates=[]
class Page:
    def reload(self,**options):pass
    def wait_for_function(self,predicate,**options):predicates.append(predicate)
class Fixture:
    page=Page()
    phase=lambda self,name:nullcontext()
    reload_workspace=namespace['reload_workspace']
Fixture().reload_workspace(figma=True)
print(json.dumps(predicates))
`, fixture], {encoding: 'utf8', timeout: 10000});
  if (result.error?.code === 'ENOENT' && !process.env.CI) {t.skip('Python is required to execute the shared reload fixture');return;}
  assert.ifError(result.error);assert.equal(result.status, 0, result.stderr);
  const predicates = JSON.parse(result.stdout);
  assert.equal(predicates.length, 1, 'Qualify the exact predicate executed by the browser harness.');
  const predicate = predicates[0];
  const context = createContext({});

  // At navigation commit the inline IDE bundle may not have executed yet.
  // Optional chaining on an undeclared identifier still throws; property
  // lookup on globalThis must stay falsey until the real state is restored.
  assert.equal(runInContext(predicate, context), undefined);
  for (const partial of [null, {}, {figmaMode: null}, {figmaMode: {}}]) {
    context.vb6Studio = partial;
    assert.equal(runInContext(predicate, context), undefined);
  }
  context.vb6Studio = {root: {isConnected: true}, figmaMode: {enabled: false}};
  assert.equal(runInContext(predicate, context), false);
  context.vb6Studio.figmaMode.enabled = true;
  assert.equal(runInContext(predicate, context), true);
  context.vb6Studio.root.isConnected = false;
  assert.equal(runInContext(predicate, context), false);
  delete context.vb6Studio;
  assert.equal(runInContext(predicate, context), undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
  assert.match(result.stderr, /Ran 26 tests/);
  assert.match(result.stderr, /\nOK\s*$/);
  t.diagnostic('All 26 Python case-worker regressions executed without skips.');
});

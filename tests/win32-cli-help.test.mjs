import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native CLI help describes numeric and String support without promising full compatibility', () => {
  const cli = fileURLToPath(new URL('../tools/build-win32.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, '--help'], {encoding:'utf8', timeout:10000});
  assert.match(output, /Single\/Double/);
  assert.match(output, /Strings and typed arrays/);
  assert.match(output, /controls\/GDI/);
  assert.match(output, /Unsupported features produce diagnostics/);
  assert.doesNotMatch(output, /typed integer subset/);
});

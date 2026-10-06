import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fixture = readFileSync(new URL('./fixtures/win32-boundaries-host.html', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../tools/browser-win32-boundaries.py', import.meta.url), 'utf8');

test('independent GDI probe origin is inert and cannot start unrelated IDE workers', () => {
  assert.match(fixture, /^<!doctype html>/i);
  assert.doesNotMatch(fixture, /<(?:script|iframe|object|embed|link)\b|\bon\w+\s*=/i);
  assert.match(fixture, /<body>\s*<\/body>/i);
  assert.match(runner, /PROBE_HOST='\/tests\/fixtures\/win32-boundaries-host\.html'/);
  assert.doesNotMatch(runner, /\/dist\/index\.html/);
  assert.equal((runner.match(/goto\(base\+PROBE_HOST\)/g) || []).length, 4);
});

test('GDI probe isolation retains real exports, worker rendering and unhandled-error checks', () => {
  assert.match(runner, /for mode in \['http','file'\]/);
  assert.match(runner, /new Worker\(url,\{type:'module'\}\)/);
  assert.match(runner, /check\(worker==\{'rendered':1,'visible':True,'memory':0\}/);
  assert.match(runner, /check\(not errors,str\(errors\)\)/);
  assert.match(runner, /page\.on\('pageerror',lambda e:errors\.append\(str\(e\)\)\)/);
  assert.match(runner, /probe\.on\('pageerror',lambda e:errors\.append\(str\(e\)\)\)/);
});

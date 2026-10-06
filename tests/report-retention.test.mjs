import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('reports keep only an explicit porting index exception', () => {
  const rules = read('.gitignore').split(/\r?\n/);
  assert.ok(rules.includes('/reports/*'));
  assert.deepEqual(rules.filter(line => /^!\/?reports\//.test(line)), ['!/reports/README.md']);
  assert.ok(rules.includes('/SOURCE-SHA256SUMS.txt'));
});

test('porting index resolves every maintained contract without duplicate status tables', () => {
  const index = read('reports/README.md');
  const links = [...index.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.ok(links.length >= 10);
  for (const link of links) {
    assert.ok(link.startsWith('../docs/') || link.startsWith('../packages/'), link);
    assert.ok(existsSync(new URL(link, new URL('reports/', root))), link);
  }
  assert.match(index, /not proof of complete native VB6 compatibility/);
});

test('visual golden inputs remain independent of disposable screenshots', () => {
  assert.ok(existsSync(new URL('tests/visual-goldens.json', root)));
  assert.match(read('tools/browser-visual-tests.py'), /visual-goldens\.json/);
  assert.match(read('docs/TESTING.md'), /validate-release\.py/);
});

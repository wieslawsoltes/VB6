import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// Check literal repository tool paths, not arbitrary shell syntax or generated
// fixture strings. Globs/computed paths still need their own integration tests.
function toolReferences(text) {
  const pattern = /(?<![\w/.:\\-])((?:\.{1,2}\/)*tools\/[\w./-]+\.(?:mjs|cjs|js|py|ps1|cs|json))(?=$|[^\w./-])/g;
  return [...new Set([...text.matchAll(pattern)].map(match => match[1]))];
}

function missingTools(text, directory = ROOT) {
  return toolReferences(text).filter(name => {
    try {
      return !fs.statSync(path.resolve(directory, name)).isFile();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return true;
      throw error;
    }
  });
}

function assertToolsExist(text, label, directory = ROOT) {
  assert.deepEqual(missingTools(text, directory), [], `${label}: missing tool references`);
}

test('tool reference checks recognize quoted, relative and compound commands', () => {
  assert.deepEqual(toolReferences(`node tools/build.mjs && python "tools/browser-tests.py"\n./tools/win32-system-oracle.ps1\nnode '../tools/serve.mjs'\nnode tools/build.mjs`), [
    'tools/build.mjs', 'tools/browser-tests.py', './tools/win32-system-oracle.ps1', '../tools/serve.mjs',
  ]);
});

test('literal tool checks do not mistake globs, computed paths or URLs for files', () => {
  assert.deepEqual(toolReferences('tools/browser-*.py tools/${suite}.py https://example.test/tools/build.mjs other/tools/build.mjs tools/build.mjs.map'), []);
});

test('tool reference checks detect a missing target instead of silently dropping it', () => {
  assert.deepEqual(missingTools('node tools/build.mjs && python tools/does-not-exist-for-tooling-test.py'), ['tools/does-not-exist-for-tooling-test.py']);
  assertToolsExist('node ../tools/build.mjs', 'relative package script', path.join(ROOT, 'desktop'));
});

test('every literal tool target in root npm scripts exists', () => {
  const {scripts} = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(Object.keys(scripts).length > 0);
  for (const [name, command] of Object.entries(scripts)) assertToolsExist(command, `npm run ${name}`);
});

test('every literal tool target in retained GitHub workflows exists', () => {
  const directory = path.join(ROOT, '.github/workflows');
  const workflows = fs.readdirSync(directory).filter(name => /\.ya?ml$/.test(name));
  assert.ok(workflows.length > 0);
  for (const name of workflows) assertToolsExist(fs.readFileSync(path.join(directory, name), 'utf8'), name);
});

test('the maintenance guide links to existing files and executable tool targets', () => {
  const directory = path.join(ROOT, 'tools');
  const guide = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');
  assertToolsExist(guide, 'tools/README.md');
  const links = [...guide.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.ok(links.length > 0);
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(link)) continue;
    const file = path.resolve(directory, decodeURIComponent(link.split('#')[0]));
    assert.ok(fs.existsSync(file), `tools/README.md: missing link ${link}`);
  }
});

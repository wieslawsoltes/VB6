import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = resolve(root, 'docs');
const index = resolve(docs, 'README.md');

function markdownFiles(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }).sort();
}

// Check the repository's inline-link convention, not remote URLs or fragments.
// Fenced examples are not navigation links. No Markdown/network dependency is needed.
function localTargets(file) {
  const text = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  return [...text.matchAll(/\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1])
    .filter(target => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target))
    .map(target => ({target, path: resolve(dirname(file), decodeURIComponent(target.split(/[?#]/)[0]))}));
}

const guides = markdownFiles(docs);

test('maintained documentation and root README have existing local link targets', () => {
  const broken = [];
  for (const file of [resolve(root, 'README.md'), ...guides]) {
    for (const {target, path} of localTargets(file)) {
      if (!existsSync(path)) broken.push(`${relative(root, file)} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'Repair local documentation links when moving or deleting files.');
});

test('documentation index covers every maintained guide', () => {
  const indexed = new Set(localTargets(index).map(({path}) => path));
  const missing = guides.filter(path => path !== index && !indexed.has(path)).map(path => relative(docs, path));
  assert.deepEqual(missing, [], 'Link substantial new guides from docs/README.md.');
});

test('testing guide uses defined root npm scripts', () => {
  const {scripts} = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const text = readFileSync(resolve(docs, 'TESTING.md'), 'utf8');
  const commands = new Set([...text.matchAll(/\bnpm run ([a-z\d:_-]+)/gi)].map(match => match[1]));
  assert.ok(commands.size > 0, 'The testing guide should document runnable commands.');
  assert.deepEqual([...commands].filter(command => !Object.hasOwn(scripts, command)), []);
});

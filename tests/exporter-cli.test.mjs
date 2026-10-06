import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {newProject} from '../src/project/model.js';
import {readZip} from '../src/project/zip.js';
import {installApplicationExport} from '../src/ide/application-export.js';
const cli = new URL('../tools/export-application.mjs', import.meta.url);
const run = args => spawnSync(process.execPath, [fileURLToPath(cli), ...args], {encoding: 'utf8'});
const temporary = fn => async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vb6-export-'));
  try { const input = path.join(root, 'source.vb6web'); writeFileSync(input, JSON.stringify(newProject('CLI'))); await fn(root, input); }
  finally { rmSync(root, {recursive: true, force: true}); }
};
test('CLI produces HTML, directories and readable deployment ZIPs without changing input', temporary(async (root, input) => {
  const before = readFileSync(input);
  for (const format of ['html', 'directory', 'zip']) {
    const output = path.join(root, format), result = run([input, '--format', format, '--out', output]);
    assert.equal(result.status, 0, result.stderr);
    if (format === 'html') assert.match(readFileSync(output, 'utf8'), /id="vb6-options"/);
    else if (format === 'directory') assert.deepEqual(readdirSync(output).sort(), ['app.css','bootstrap.js','index.html','manifest.json','runtime.js']);
    else { const entries = await readZip(readFileSync(output)); assert.ok(entries.has('index.html')); assert.ok(entries.has('manifest.json')); }
    const again = run([input, '--out', output, '--format', format]);
    assert.equal(again.status, 1); assert.match(again.stderr, /already exists/);
  }
  assert.deepEqual(readFileSync(input), before);
}));
test('CLI never overwrites the input or a symlink target', temporary((root, input) => {
  const before = readFileSync(input);
  assert.equal(run([input, '--out', input]).status, 1);
  if (process.platform !== 'win32') {
    const link = path.join(root, 'link.html'); symlinkSync(input, link);
    assert.equal(run([input, '--out', link]).status, 1);
  }
  assert.deepEqual(readFileSync(input), before);
}));
test('CLI supports check, document metadata and JSON runtime options', temporary((root, input) => {
  const options = path.join(root, 'options.json'), document = path.join(root, 'document.json'), output = path.join(root, 'app.html');
  writeFileSync(options, '{"persist":false}'); writeFileSync(document, '{"language":"pl-PL","title":"Portable"}');
  const args = [input, '--options', options, '--document', document];
  assert.equal(JSON.parse(run([...args, '--check']).stdout).valid, true);
  assert.equal(run([...args, '--out', output]).status, 0);
  const html = readFileSync(output, 'utf8'); assert.match(html, /lang="pl-PL"/); assert.match(html, /"persist":false/);
  writeFileSync(options, '{"headers":{"Authorization":"private"}}');
  const result = run([...args, '--check']); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'EXPORT_PRIVATE_CONFIGURATION');
}));
test('CLI rejects invalid arguments and input before writing output', temporary((root, input) => {
  for (const args of [[], [input], [input, '--wat'], [input, '--out'], [input, '--format', 'exe', '--check'], [input, '--check', '--check']]) assert.equal(run(args).status, 1);
  writeFileSync(input, 'invalid-json'); const output = path.join(root, 'invalid.html');
  assert.equal(run([input, '--out', output]).status, 1); assert.ok(!readdirSync(root).includes('invalid.html'));
  assert.equal(run(['--help']).status, 0);
}));
test('IDE export extension preserves existing commands and rejects running exports', async () => {
  const calls = [], api = {}, ide = {project: newProject(), runState: 'running', menu: () => [{id: 'exportHTML'}], command: (...args) => calls.push(args), status: message => calls.push(message)};
  installApplicationExport(ide, api); installApplicationExport(ide, api);
  assert.equal(ide.menu('File').filter(i => i.id === 'exportDeployment').length, 1);
  assert.equal(ide.menu('File')[1].enabled, false); assert.equal(typeof api.exportApplicationFiles, 'function');
  await ide.command('exportDeployment'); assert.match(calls.pop(), /Stop execution/);
  await ide.command('other', 1); assert.deepEqual(calls.pop(), ['other', 1]);
  ide.runState = 'design'; ide.project.modules = []; await ide.command('exportDeployment');
  assert.equal(ide.lastApplicationExport.diagnostics[0].code, 'EXPORT_INVALID_MODEL');
});

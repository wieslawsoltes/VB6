import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sourceFiles, importFiles} from '../src/project/formats.js';
import {compileWin32} from '../src/native/compiler.js';

test('unchanged Calculator VBP/FRM round-trip preserves floating and indexed native export', async () => {
  const project = JSON.parse(await fs.readFile(new URL('../examples/calculator.vb6web', import.meta.url), 'utf8'));
  // The authored Unicode minus glyph is not representable in Windows-1252.
  // Explicit UTF-8 is a supported importer mode, not a claim about the classic VB6 IDE.
  const files = sourceFiles(project, {encoding: 'utf-8'});
  assert.ok(Object.keys(files).some(name => name.endsWith('.vbp')));
  assert.ok(Object.keys(files).some(name => name.endsWith('.frm')));
  const imported = await importFiles(Object.entries(files), {encoding: 'utf-8'});
  assert.deepEqual(imported.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  assert.match(imported.project.modules.find(module => module.name === 'frmCalculator').code, /firstNumber\s+As\s+Double/i);
  const options = {arch: 'x86', graphics: 'gdi'};
  assert.deepEqual(compileWin32(imported.project, options).bytes, compileWin32(project, options).bytes);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {renderOcxLab, buildOcxLab} from '../tools/build-ocx-lab.mjs';

const source = fs.readFileSync(new URL('../examples/ocx-source/Gauge.ctl', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const template = '<!--RUNTIME-->\n<script>const project=/*PROJECT*/null;const source=/*CTL_SOURCE*/\'\';</script>\n';
const runtime = 'globalThis.runtime = true;';
const expected = renderOcxLab({source, template, runtime});

for (const ending of ['\r\n', '\r']) test(`native checkout ${JSON.stringify(ending)} produces identical lab bytes`, () => {
  const input = {source: source.replace(/\n/g, ending), template: template.replace(/\n/g, ending), runtime};
  const before = {...input};
  assert.equal(renderOcxLab(input), expected);
  assert.deepEqual(input, before, 'Authoring inputs are never mutated');
});
test('mixed source and template endings produce identical lab bytes', () => {
  let i = 0;
  assert.equal(renderOcxLab({source: source.replace(/\n/g, () => ++i % 2 ? '\n' : '\r\n'), template: template.replace(/\n/g, '\r\n'), runtime}), expected);
});
test('embedded source and runtime cannot terminate their script elements', () => {
  const html = renderOcxLab({source: source + "\n' </script> \u2028\u2029 $&\n", runtime: 'const x="</ScRiPt>";', template});
  assert.equal((html.match(/<\/script>/gi) || []).length, 2);
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('\\u2028\\u2029'));
  assert.ok(html.includes('$&'), 'Replacement-string metacharacters remain literal source');
});
test('standalone builder preserves on-disk native inputs and reproduces LF output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-ocx-lab-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const input = path.join(root, 'examples/ocx-source');
  fs.mkdirSync(input, {recursive: true});fs.mkdirSync(path.join(root, 'dist'));
  const native = Buffer.from(source.replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(input, 'Gauge.ctl'), native);
  fs.writeFileSync(path.join(input, 'lab.template.html'), template);
  fs.writeFileSync(path.join(root, 'dist/vb6-runtime.js'), runtime);
  buildOcxLab(root);
  assert.deepEqual(fs.readFileSync(path.join(input, 'Gauge.ctl')), native);
  assert.equal(fs.readFileSync(path.join(root, 'dist/OCX-Source-Control-Lab.html'), 'utf8'), expected);
  buildOcxLab(root);
  assert.equal(fs.readFileSync(path.join(root, 'dist/OCX-Source-Control-Lab.html'), 'utf8'), expected);
});

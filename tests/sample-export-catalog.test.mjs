import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAMPLES} from '../src/project/examples.js';
import {compileProject} from '../src/language/compiler.js';
import {exportApplication} from '../src/exporter/exporter.js';
for(const example of EXAMPLES)test('complete self-contained export preserves '+example.id,()=>{
  const p=JSON.parse(readFileSync(new URL('../examples/'+example.id+'.vb6web',import.meta.url),'utf8')),before=structuredClone(p);
  const html=exportApplication(p,{persist:false}),match=/<script id="vb6-project" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match);assert.deepEqual(JSON.parse(match[1]),before);assert.deepEqual(p,before);
  assert.deepEqual(compileProject(JSON.parse(match[1])).diagnostics,[]);
  assert.match(html,/VB6Runtime\.mountApplication/);assert.match(html,/installMessageFormatting/);assert.match(html,/SystemTimeToFileTime/);
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);assert.doesNotMatch(html,/<link\b[^>]*\brel\s*=\s*["']stylesheet/i);
});

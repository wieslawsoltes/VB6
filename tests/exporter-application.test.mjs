import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {newProject} from '../src/project/model.js';
import {EXAMPLES} from '../src/project/examples.js';
import {THEMES} from '../src/theme/theme.js';
import {exportApplication, exportApplicationFiles, inspectApplicationExport, createApplicationExporter, RUNTIME_VERSION} from '../src/exporter/exporter.js';
import {APPLICATION_BOOTSTRAP} from '../src/exporter/bootstrap.js';
import {APPLICATION_SHELL_CSS} from '../src/exporter/document.js';

const embedded = (html, id) => JSON.parse(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`).exec(html)[1]);
for (const example of EXAMPLES) test('split deployment preserves complete ' + example.id, () => {
  const p = JSON.parse(readFileSync(new URL('../examples/' + example.id + '.vb6web', import.meta.url), 'utf8'));
  const before = structuredClone(p), options = {persist: false}, bundle = exportApplicationFiles(p, options);
  assert.equal(bundle.entry, 'index.html'); assert.equal(bundle.manifest.runtimeVersion, RUNTIME_VERSION);
  assert.deepEqual(embedded(bundle.files['index.html'], 'vb6-project'), before);
  assert.deepEqual(embedded(bundle.files['index.html'], 'vb6-options'), options);
  assert.deepEqual(p, before); assert.deepEqual(options, {persist: false});
  assert.deepEqual(bundle, exportApplicationFiles(p, options));
  assert.equal(bundle.files['bootstrap.js'], APPLICATION_BOOTSTRAP);
  assert.ok(bundle.files['app.css'].startsWith(APPLICATION_SHELL_CSS));
  const html = bundle.files['index.html'];
  assert.match(html, /<script defer src="\.\/runtime.js"><\/script>/);
  assert.match(html, /<script defer src="\.\/bootstrap.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<\/script)|<style>|fetch\(/);
  assert.match(bundle.files['runtime.js'], /installMessageFormatting/);
  assert.doesNotMatch(bundle.files['runtime.js'], /class VB6Studio/);
  for (const entry of bundle.manifest.files) assert.equal(Buffer.byteLength(bundle.files[entry.path]), entry.bytes);
  assert.deepEqual(JSON.parse(bundle.files['manifest.json']), bundle.manifest);
});
test('standalone and split documents safely preserve metadata and application themes', () => {
  const p = newProject('Name <&>'); p.description = '\"/><script>alert(1)</script>';
  const document = {title: '</title>\"<script>bad()</script>', language: 'pl-PL', direction: 'rtl'};
  for (const theme of Object.keys(THEMES)) {
    const html = exportApplication(p, {theme}, document);
    assert.match(html, /lang="pl-PL"/); assert.ok(html.includes(`data-vb-theme="${theme}" dir="rtl"`));
    assert.match(html, /&lt;\/title&gt;/); assert.doesNotMatch(html, /<script>bad|<script>alert/);
    assert.deepEqual(embedded(html, 'vb6-project'), p); assert.equal(embedded(html, 'vb6-options').persist, true);
  }
});
test('trusted deployment adapters run between runtime and bootstrap in both formats', () => {
  const document = {scripts: {'adapter.js': 'globalThis.vb6ConfigureApplication = async () => ({dataFetch: globalThis.fetch});'}};
  const files = exportApplicationFiles(newProject(), {}, document).files;
  assert.equal(files['adapter.js'], document.scripts['adapter.js']);
  assert.ok(files['index.html'].indexOf('./runtime.js') < files['index.html'].indexOf('./adapter.js'));
  assert.ok(files['index.html'].indexOf('./adapter.js') < files['index.html'].indexOf('./bootstrap.js'));
  assert.match(exportApplication(newProject(), {}, document), /globalThis\.vb6ConfigureApplication = async/);
  assert.throws(() => exportApplication(newProject(), {dataFetch() {}}), error => error.code === 'EXPORT_NON_PORTABLE_VALUE');
});
test('document settings reject traversal, reserved names, case aliases and ambiguous values', () => {
  for (const name of ['../evil.js', 'sub/evil.js', 'evil.js?x', 'runtime.js', 'RUNTIME.js', 'CON.js', 'nul.js', 'evil\\x.js']) {
    assert.throws(() => exportApplicationFiles(newProject(), {}, {scripts: {[name]: ''}}), error => error.code === 'EXPORT_INVALID_PATH');
  }
  assert.throws(() => exportApplicationFiles(newProject(), {}, {scripts: {'a.js': '', 'A.js': ''}}), /unique portable/);
  for (const document of [null, [], {scripts: null}, {scripts: []}, {language: '\" onload=bad()'}, {direction: 'up'}, {title: 1}, {unknown: true}]) {
    assert.throws(() => exportApplication(newProject(), {}, document), error => error.code === 'EXPORT_INVALID_DOCUMENT');
  }
});
test('inline safety never rewrites JavaScript, regexes or CSS string semantics', () => {
  for (const marker of ['</ScRiPt>', '<!--']) {
    const source = `globalThis.VB6Runtime={mountApplication:async()=>({})};globalThis.text=${JSON.stringify(marker)};`;
    const exporter = createApplicationExporter({runtimeSource: source, runtimeCSS: ''});
    assert.throws(() => exporter.html(newProject()), error => error.code === 'EXPORT_UNSAFE_INLINE_SCRIPT');
    assert.equal(exporter.files(newProject()).files['runtime.js'], source);
  }
  const exporter = createApplicationExporter({runtimeSource: '// runtime', runtimeCSS: 'p:before{content:"</STYLE>"}'});
  assert.throws(() => exporter.html(newProject()), error => error.code === 'EXPORT_UNSAFE_INLINE_STYLE');
  assert.ok(exporter.files(newProject()).files['app.css'].includes('</STYLE>'));
});
test('factory takes matching compiler/payloads without importing generated runtime state', () => {
  let calls = 0;
  const exporter = createApplicationExporter({version: 'custom', runtimeSource: '/* custom */', runtimeCSS: '/* css */', compile: project => { calls++; assert.equal(project.name, 'Custom'); return {valid: true, diagnostics: []}; }});
  assert.equal(exporter.inspect(newProject('Custom')).runtimeVersion, 'custom');
  assert.match(exporter.html(newProject('Custom')), /custom/); assert.equal(calls, 2);
  assert.throws(() => createApplicationExporter({runtimeSource: '', runtimeCSS: ''}), /Expected runtime/);
});
test('inspect reports errors without throwing and inventories external runtime dependencies', () => {
  assert.equal(inspectApplicationExport(null).valid, false);
  const p = newProject(); p.modules[0].code = 'Sub Bad()\nIf True Then\nEnd Sub';
  const report = inspectApplicationExport(p); assert.equal(report.valid, false); assert.equal(report.diagnostics[0].source, 'Form1');
  assert.equal(inspectApplicationExport(newProject(), {instructionLimit: -1}).valid, false);
  assert.equal(inspectApplicationExport(newProject(), {persist: 'false'}).valid, false);
});

function environment(runtime) {
  const nodes = {'vb6-project': {textContent: JSON.stringify(newProject())}, 'vb6-options': {textContent: '{"persist":false}'}, app: {}, 'vb6-startup': {hidden: false, setAttribute(name, value) { this[name] = value; }}};
  const events = [], listeners = new Map();
  const context = vm.createContext({document: {getElementById: id => nodes[id]}, VB6Runtime: runtime,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: e => {events.push(e); for (const fn of listeners.get(e.type) || []) fn(e);},
    addEventListener: (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); }
  });
  vm.runInContext('globalThis.parent = globalThis;', context);
  const start = () => vm.runInContext(APPLICATION_BOOTSTRAP, context);
  return {context, nodes, events, listeners, start};
}
test('bootstrap mounts exactly once, exposes host and promise and preserves callbacks', async () => {
  let calls = 0, messages = 0, passed;
  const host = {vm: {state: 'running'}};
  const env = environment({mountApplication: async (project, container, options) => { calls++; passed = options; options.onMessage({type: 'ready'}); return host; }});
  env.context.vb6ConfigureApplication = async ({project, runtime}) => {assert.ok(project.modules.length); assert.ok(runtime); return {dataFetch: () => 'data', onMessage: () => {messages++;}};};
  const first = env.start(), second = env.start(); assert.equal(first, second);
  assert.equal(await first, host); assert.equal(env.context.vb6Application, host); assert.equal(calls, 1); assert.equal(messages, 1);
  assert.equal(passed.dataFetch(), 'data'); assert.equal(passed.persist, false);
  assert.equal(env.context.vb6ApplicationStatus.phase, 'ready'); assert.equal(env.nodes['vb6-startup'].hidden, true);
  assert.deepEqual(env.events.map(e => e.type), ['vb6:message', 'vb6:ready']);
});
for (const mode of ['missing', 'rejection', 'sync', 'vm-error', 'bad-hook', 'bad-options', 'parse']) test('bootstrap shows and rejects ' + mode + ' without a false ready signal', async () => {
  const runtime = {mountApplication: async () => {throw new Error('<script>failure</script>');}};
  if (mode === 'missing') delete runtime.mountApplication;
  if (mode === 'sync') runtime.mountApplication = () => {throw new Error('sync failure');};
  if (mode === 'vm-error') runtime.mountApplication = async (p, c, o) => {o.onMessage({type: 'error', error: {message: 'VB failed', number: 5, source: 'Form1', line: 3}}); return {vm: {state: 'error'}};};
  const env = environment(runtime);
  if (mode === 'bad-hook') env.context.vb6ConfigureApplication = 'bad';
  if (mode === 'bad-options') env.context.vb6ConfigureApplication = () => [];
  if (mode === 'parse') env.nodes['vb6-project'].textContent = '{';
  await assert.rejects(env.start());
  assert.equal(env.context.vb6ApplicationStatus.phase, 'error'); assert.equal(env.nodes['vb6-startup'].role, 'alert');
  assert.ok(env.nodes['vb6-startup'].textContent.startsWith('Application could not start.'));
  assert.equal(env.nodes['vb6-startup'].innerHTML, undefined); assert.ok(!env.events.some(e => e.type === 'vb6:ready'));
  assert.equal(env.events.filter(e => e.type === 'vb6:error').length, 1);
  if (mode === 'vm-error') {assert.equal(env.context.vb6Application.vm.state, 'error'); assert.equal(env.context.vb6ApplicationStatus.error.line, 3);}
});
test('bootstrap persists on pagehide and does not dispose BFCache entries', async () => {
  let saved = 0, disposed = 0;
  const host = {vm: {state: 'running'}, persist() {saved++;}, dispose() {disposed++; this.disposed = true;}};
  const env = environment({mountApplication: async () => host}); await env.start();
  for (const persisted of [true, false, false]) env.context.dispatchEvent({type: 'pagehide', persisted});
  assert.equal(saved, 2); assert.equal(disposed, 1);
});

test('standalone IDE payload cannot enter legacy double-escaped script parsing', () => {
  const source = readFileSync(new URL('../dist/studio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<!--/);
});

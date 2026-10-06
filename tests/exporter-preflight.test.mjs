import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotExportValue, jsonForHTML} from '../src/exporter/serialization.js';
import {prepareApplicationExport, applicationInventory} from '../src/exporter/preflight.js';
import {ApplicationExportError} from '../src/exporter/diagnostics.js';
import {compileProject} from '../src/language/compiler.js';
import {newProject, createControl} from '../src/project/model.js';

const prepare = (project, options = {}) => prepareApplicationExport(project, options, compileProject);
const code = expected => error => error instanceof ApplicationExportError && error.code === expected;

test('export snapshot preserves JSON, aliases, null prototypes and prototype-named data', () => {
  const shared = {name: 'value'}, source = JSON.parse('{"__proto__":{"polluted":true},"constructor":1}');
  Object.assign(source, {shared, also: shared, optional: undefined, sparse: [1, , undefined], nullPrototype: Object.assign(Object.create(null), {a: 2})});
  const copy = snapshotExportValue(source);
  assert.deepEqual(copy, JSON.parse(JSON.stringify(source)));
  assert.notEqual(copy.shared, shared); assert.notEqual(copy.shared, copy.also);
  assert.equal({}.polluted, undefined);
});
for (const [name, value] of [['function', () => {}], ['bigint', 1n], ['nan', NaN], ['infinity', Infinity], ['map', new Map()], ['set', new Set()], ['date', new Date()], ['bytes', new Uint8Array(2)], ['symbol', Symbol()]]) {
  test('export diagnoses rather than silently converting ' + name, () => assert.throws(() => snapshotExportValue({value}), code('EXPORT_NON_PORTABLE_VALUE')));
}
test('snapshot rejects cycles but does not execute getters or toJSON', () => {
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => snapshotExportValue(cycle), code('EXPORT_CIRCULAR_DATA'));
  let called = false;
  const getter = {get name() { called = true; return 'secret'; }};
  assert.throws(() => snapshotExportValue(getter), code('EXPORT_NON_PORTABLE_VALUE'));
  assert.throws(() => snapshotExportValue({toJSON() { called = true; return {}; }}), code('EXPORT_NON_PORTABLE_VALUE'));
  assert.equal(called, false);
});
test('snapshot bounds recursive and sparse data and rejects discarded array properties', () => {
  let deep = {}; for (let i = 0; i < 130; i++) deep = {deep};
  assert.throws(() => snapshotExportValue(deep), code('EXPORT_DATA_LIMIT'));
  assert.throws(() => snapshotExportValue(new Array(1000001)), code('EXPORT_DATA_LIMIT'));
  const array = []; array.named = 1;
  assert.throws(() => snapshotExportValue(array), code('EXPORT_NON_PORTABLE_VALUE'));
  assert.throws(() => snapshotExportValue({[Symbol()]: 1}), code('EXPORT_NON_PORTABLE_VALUE'));
});
test('JSON raw-text escaping round trips closing tags and double-escaped parser states', () => {
  const value = '</ScRiPt><!--<script></script>&>\u2028\u2029';
  const text = jsonForHTML({value});
  assert.doesNotMatch(text, /[<>&\u2028\u2029]/); assert.equal(JSON.parse(text).value, value);
  assert.throws(() => jsonForHTML(undefined), code('EXPORT_NON_PORTABLE_VALUE'));
});
test('preflight preserves every source field without normalization or mutation', () => {
  const p = newProject('Authored <name>'); p.modules[0].form.controls.push(createControl('TextBox', 'Text1'));
  p.resources = {entries: [{type: 10, name: 7, data: 'AP+A', language: 1033}]};
  p.vfs.files['/binary.dat'] = {encoding: 'base64', data: 'AP+A'};
  p.assets.picture = 'data:image/png;base64,AAAA'; p.settings.customRenderer = 'keep'; p.customMetadata = {value: 3};
  const before = structuredClone(p), result = prepare(p, {persist: false, bridgeToken: 'preview-only', breakpoints: [{module: 'Form1', line: 3}]});
  assert.deepEqual(p, before); assert.deepEqual(result.project, before); assert.notEqual(result.project, p);
  assert.equal(result.options.persist, false); assert.equal(result.options.bridgeToken, 'preview-only');
  assert.deepEqual(applicationInventory(p), {modules: 1, forms: 1, controls: 1, menus: 0, assets: 1, resources: 1, virtualFiles: 1, references: 0});
});
test('compiler errors retain locations and stable exporter codes', () => {
  const p = newProject(); p.modules[0].code = 'Sub Test()\nIf True Then\nEnd Sub';
  assert.throws(() => prepare(p), error => error.diagnostics[0].source === 'Form1' && error.diagnostics[0].line > 0 && /Unclosed/.test(error.message));
});
for (const field of ['form', 'control', 'menu', 'options', 'data']) test('private configuration is blocked in ' + field, () => {
  const p = newProject(), options = {}, secret = {Authorization: 'not-for-export'};
  if (field === 'form') p.modules[0].form.properties.Auth = secret;
  if (field === 'control') { const c = createControl('TextBox'); c.properties.Auth = secret; p.modules[0].form.controls.push(c); }
  if (field === 'menu') p.modules[0].form.menus.push({name: 'mnu', type: 'Menu', properties: secret});
  if (field === 'options') options.win32 = {headers: secret};
  if (field === 'data') p.dataSources = {version: 1, connections: [{name: 'Remote', provider: 'rest', url: 'https://example.invalid', headers: secret}], commands: []};
  assert.throws(() => prepare(p, options), error => error.code === 'EXPORT_PRIVATE_CONFIGURATION' && error.number === 70 && !error.message.includes('not-for-export'));
});
test('preflight distinguishes external services from non-portable session assets', () => {
  const p = newProject(); p.assets.remote = 'https://example.invalid/picture.png';
  p.dataSources = {version: 1, connections: [{name: 'Remote', provider: 'rest', url: 'https://example.invalid/api', credentialRef: 'session'}], commands: []};
  p.modules[0].code = 'Private Declare Function GetTickCount Lib "kernel32" () As Long';
  const report = prepare(p); assert.equal(report.dependencies.length, 3); assert.equal(report.diagnostics.length, 2);
  assert.ok(report.diagnostics.every(d => d.severity === 'warning'));
  p.assets.remote = 'blob:https://example.invalid/session';
  assert.throws(() => prepare(p), code('EXPORT_TRANSIENT_ASSET'));
});
test('invalid model and options fail before compilation', () => {
  let compiled = false;
  for (const [p, options] of [[null, {}], [{name: 'bad', modules: []}, {}], [newProject(), null]]) {
    assert.throws(() => prepareApplicationExport(p, options, () => { compiled = true; }), code('EXPORT_INVALID_MODEL'));
  }
  assert.equal(compiled, false);
});

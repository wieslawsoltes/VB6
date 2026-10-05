import test from 'node:test';
import assert from 'node:assert/strict';
import {importFiles, sourceFiles, workspaceProjects} from '../src/project/formats.js';
import {newProject} from '../src/project/model.js';
import {bytesOf, decodeNativeText} from '../src/project/native-text.js';

const bytes = s => new TextEncoder().encode(s);
const text = value => decodeNativeText(bytesOf(value)).text;
const load = async entries => (await importFiles(new Map(entries))).project;
async function edited(source, edit = s => s + "\n' edit\n") {
  const p = await load([['M.bas', bytes(source)]]);
  p.modules[0].code = edit(p.modules[0].code);
  return text(sourceFiles(p)['M.bas']);
}
for (const eol of ['\r\n', '\n', '\r']) test('hidden attributes follow a complete continued declaration: ' + JSON.stringify(eol), async () => {
  const source = ['Attribute VB_Name = "M"', 'Public Function Sum(ByVal a As Long, _',
    '    ByVal b As Long) As Long', 'Attribute Sum.VB_Description = "Sum"', 'Sum = a + b', 'End Function', ''].join(eol);
  const out = await edited(source);
  assert.ok(out.includes('ByVal b As Long) As Long' + eol + 'Attribute Sum.VB_Description'));
  assert.ok(!out.includes('_' + eol + 'Attribute'));
  assert.equal((out.match(/VB_Description/g) || []).length, 1);
});
test('continued procedure name retains its member attributes', async () => {
  const out = await edited('Attribute VB_Name = "M"\r\nPublic Function _\r\n Total() As Long\r\nAttribute Total.VB_HelpID = 7\r\nTotal = 2\r\nEnd Function\r\n');
  assert.ok(out.includes(' Total() As Long\r\nAttribute Total.VB_HelpID = 7'));
});
test('continued property Let attributes remain on Let, not Get', async () => {
  const out = await edited('Attribute VB_Name = "M"\r\nPublic Property Get Value() As Long\r\nEnd Property\r\nPublic Property Let Value( _\r\n ByVal rhs As Long)\r\nAttribute Value.VB_HelpID = 42\r\nEnd Property\r\n');
  assert.ok(out.includes(' ByVal rhs As Long)\r\nAttribute Value.VB_HelpID = 42'));
  assert.equal((out.match(/VB_HelpID/g) || []).length, 1);
});
test('attributes of every variable in a continued comma declaration survive', async () => {
  const declaration = 'Public First(1 To 2, 3 To 4) As Long, _\r\n Second As String';
  const out = await edited('Attribute VB_Name = "M"\r\n' + declaration + '\r\nAttribute First.VB_VarHelpID = 1\r\nAttribute Second.VB_VarDescription = "second"\r\n');
  assert.ok(out.includes(declaration + '\r\nAttribute First.'));
  assert.ok(out.includes('Attribute Second.VB_VarDescription = "second"'));
});
test('continued Event declarations own their hidden attributes', async () => {
  const out = await edited('Attribute VB_Name = "M"\r\nPublic Event Changed( _\r\n ByVal value As Long)\r\nAttribute Changed.VB_Description = "Event"\r\n');
  assert.ok(out.includes(' ByVal value As Long)\r\nAttribute Changed.VB_Description'));
});
test('same-named procedures in conditional branches keep separate metadata', async () => {
  const source = 'Attribute VB_Name = "M"\r\n#If Platform Then\r\nPublic Sub Run()\r\nAttribute Run.VB_Description = "first"\r\nEnd Sub\r\n#Else\r\nPublic Sub Run()\r\nAttribute Run.VB_Description = "second"\r\nEnd Sub\r\n#End If\r\n';
  const out = await edited(source);
  assert.ok(out.includes('Public Sub Run()\r\nAttribute Run.VB_Description = "first"\r\nEnd Sub\r\n#Else\r\nPublic Sub Run()\r\nAttribute Run.VB_Description = "second"'));
});
test('removing an attributed conditional branch fails instead of retargeting metadata', async () => {
  const source = 'Attribute VB_Name = "M"\r\n#If Platform Then\r\nPublic Sub Run()\r\nAttribute Run.VB_Description = "first"\r\nEnd Sub\r\n#Else\r\nPublic Sub Run()\r\nEnd Sub\r\n#End If\r\n';
  await assert.rejects(() => edited(source, () => 'Public Sub Run()\nEnd Sub\n'), /owns hidden attributes/);
});
test('comment underscores do not consume the next declaration', async () => {
  const out = await edited('Attribute VB_Name = "M"\r\nRem comment _\r\nPublic Sub Run()\r\nAttribute Run.VB_Description = "Run"\r\nEnd Sub\r\n');
  assert.ok(out.includes('Public Sub Run()\r\nAttribute Run.VB_Description'));
});
function fresh(code, attributes) {
  const p = newProject('P'); p.modules = [{id: 'module', kind: 'class', name: 'Thing', code, attributes}];
  return text(sourceFiles(p)['Thing.cls']);
}
test('fresh browser-class export emits property metadata once on Get', () => {
  const out = fresh('Public Property Let Value(ByVal rhs As Long)\nEnd Property\nPublic Property Get Value() As Long\nEnd Property', ['Attribute Value.VB_UserMemId = 0']);
  assert.equal((out.match(/VB_UserMemId/g) || []).length, 1);
  assert.ok(out.includes('Public Property Get Value() As Long\r\nAttribute Value.VB_UserMemId'));
});
test('fresh browser module export supports variable metadata and ignores local shadows', () => {
  const out = fresh('Public Field As String\nPublic Sub Run()\nDim Field As Long\nEnd Sub', ['Attribute Field.VB_VarDescription = "Field"']);
  assert.ok(out.includes('Public Field As String\r\nAttribute Field.VB_VarDescription'));
  assert.equal((out.match(/VB_VarDescription/g) || []).length, 1);
});
test('fresh browser module export rejects orphaned hidden metadata', () => {
  assert.throws(() => fresh('Option Explicit', ['Attribute Missing.VB_HelpID = 1']), /cannot place/);
});
test('fresh module export emits attributes after multiline signatures', () => {
  const out = fresh('Public Function Sum(a As Long, _\n b As Long) As Long\nEnd Function', ['Attribute Sum.VB_HelpID = 3']);
  assert.ok(out.includes(' b As Long) As Long\r\nAttribute Sum.VB_HelpID'));
});
test('unchanged native orphan attributes still round-trip as opaque metadata', async () => {
  const input = bytes('Attribute VB_Name = "M"\r\nAttribute Missing.VB_HelpID = 1\r\nOption Explicit\r\n');
  const p = await load([['M.bas', input]]); assert.deepEqual(bytesOf(sourceFiles(p)['M.bas']), input);
  p.modules[0].code += '\nPublic X As Long\n'; assert.throws(() => sourceFiles(p), /identifiable declaration/);
});
const form = 'VERSION 5.00\r\nBegin VB.Form F\r\n Caption = "Form"\r\nEnd\r\nAttribute VB_Name = "F"\r\n';
for (const path of ["O'Brien.frm", "dir/O'Brien.frm", "'Leading.frm"]) test('unquoted apostrophe path loads and rebases: ' + path, async () => {
  const vbp = 'Type=Exe\r\nForm=' + path.replace(/\//g, '\\') + '\r\nName="P"\r\nStartup="F"\r\n';
  const p = await load([['P.vbp', bytes(vbp)], [path, bytes(form)]]);
  assert.equal(p.modules.length, 1); assert.equal(text(sourceFiles(p)['P.vbp']), vbp);
  p.modules[0].sourcePath = 'moved/' + path; const out = sourceFiles(p);
  const q = await load(Object.entries(out)); assert.equal(q.modules.length, 1); assert.equal(q.modules[0].sourcePath, 'moved/' + path);
});
test('literal apostrophes and whitespace-delimited comments coexist in manifests', async () => {
  const vbp = 'Type=Exe\r\nForm=O\'Brien.frm  \'keep\r\nName="P"\r\nStartup="F"\r\n';
  const p = await load([['P.vbp', bytes(vbp)], ["O'Brien.frm", bytes(form)]]); assert.equal(p.modules.length, 1);
  p.modules[0].sourcePath = 'F.frm'; assert.ok(text(sourceFiles(p)['P.vbp']).includes("Form=F.frm  'keep"));
});
test('VBG paths and retained Reference descriptions can contain apostrophes', async () => {
  const p = await load([["O'Brien.vbg", 'VBGROUP 5.0\r\nStartupProject=O\'Brien.vbp\r\n'], ["O'Brien.vbp", 'Type=Exe\r\nName="P"\r\nStartup="Sub Main"\r\nReference=*\\G{T}#1.0#0#O\'Brien.dll#O\'Brien library']]);
  assert.equal(workspaceProjects(p).length, 1); assert.ok(p.references[0].value.endsWith("O'Brien library"));
  p.nativeWorkspace.path = 'moved/Group.vbg'; const q = await load(Object.entries(sourceFiles(p)));
  assert.equal(workspaceProjects(q).length, 1);
});
async function opaque(withManifest = true, withAsset = true) {
  const entries = [['ui/F.frm', bytes(form.replace(' Caption', ' PersistState = "F.frx":0000\r\n Caption'))]];
  if (withManifest) entries.unshift(['P.vbp', 'Type=Exe\r\nForm=ui\\F.frm\r\nName="P"\r\nStartup="F"']);
  if (withAsset) entries.push(['ui/F.frx', Uint8Array.of(255, 0, 128, 9)]);
  return load(entries);
}
for (const manifest of [true, false]) test('moving an opaque FRX binding keeps its original companion: manifest=' + manifest, async () => {
  const p = await opaque(manifest), m = p.modules[0]; m.sourcePath = 'moved/F.frm';
  const out = sourceFiles(p); assert.ok(text(out[m.sourcePath]).includes('PersistState = "..\\ui\\F.frx":0000'));
  assert.deepEqual(bytesOf(out['ui/F.frx']), Uint8Array.of(255, 0, 128, 9));
  const q = await load(Object.entries(out)); assert.equal(q.modules[0].form.properties.PersistState.resource, '..\\ui\\F.frx');
});
test('old snapshots without a recorded source path rebase using VBP membership', async () => {
  const p = await opaque(); delete p.modules[0].nativeSource.path; p.modules[0].sourcePath = 'other/F.frm';
  assert.ok(text(sourceFiles(p)['other/F.frm']).includes('"..\\ui\\F.frx":0000'));
});
test('moving an opaque binding with a missing companion rejects the whole export', async () => {
  const p = await opaque(true, false); assert.doesNotThrow(() => sourceFiles(p)); p.modules[0].sourcePath = 'other/F.frm';
  assert.throws(() => sourceFiles(p), /missing opaque resource/);
});

test('fresh ambiguous conditional member metadata is rejected, not guessed', () => {
  assert.throws(() => fresh('#If Platform Then\nPublic Sub Run()\nEnd Sub\n#Else\nPublic Sub Run()\nEnd Sub\n#End If', ['Attribute Run.VB_HelpID = 1']), /ambiguous hidden attribute/);
});
test('an explicitly edited opaque reference stays relative to the new module path', async () => {
  const p = await opaque(); p.modules[0].sourcePath = 'moved/F.frm';
  p.modules[0].form.properties.PersistState = {resource: 'New.frx', offset: '0000'};
  p.assets['moved/New.frx'] = {encoding: 'base64', data: 'AQID'};
  const files = sourceFiles(p);
  assert.ok(text(files['moved/F.frm']).includes('"New.frx":0000'));
  assert.deepEqual(bytesOf(files['moved/New.frx']), Uint8Array.of(1,2,3));
});

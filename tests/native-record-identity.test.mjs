import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {nativeRecordIdentityCases} from './native-record-identity-fixtures.mjs';

for (const fixture of nativeRecordIdentityCases()) {
  test('native record fixture retains shared VM semantics: ' + fixture.name, async () => {
    const compiled = compileProject(fixture.project);
    assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
    const output = [];
    await new VirtualMachine(compiled, {print: value => output.push(value)}).start();
    assert.deepEqual(output, fixture.expectedOutput);
  });
}

const targets = [
  ['macOS ARM64', input => compileMacOSAOT(input, {optimization: 2})],
  ...['x64', 'arm64'].flatMap(architecture => ['gtk3', 'gtk4'].map(toolkit => [
    'Linux ' + architecture + ' ' + toolkit,
    input => compileLinuxAOT(input, {architecture, toolkit, optimization: 2}),
  ])),
];
for (const [name, compile] of targets) {
  test(name + ' metadata separates nominal record identities from display spelling', () => {
    const fixtures = new Map(nativeRecordIdentityCases().map(fixture => [fixture.name, fixture]));
    const aliases = compile(fixtures.get('qualified-aliases').project);
    assert.equal(aliases.metadata.abi, 5, 'record display metadata requires the extended ABI');
    const records = aliases.metadata.modules.find(module => module.name === 'Records');
    assert.deepEqual(records.records.map(record => [record.name, record.displayName]), [['records.titem', 'TItem']]);
    assert.equal(records.procedures.find(procedure => procedure.name === 'Fill').parameters[0].type, 'records.titem');
    assert.equal(records.procedures.find(procedure => procedure.name === 'Bump').parameters[0].type, 'records.titem');
    const result = records.procedures.find(procedure => procedure.name === 'MakeItems');
    assert.equal(result.returnType, 'records.titem');
    assert.equal(result.returnDisplayType, 'Records.TItem');
    assert.equal(result.returnArray, true);

    const owners = compile(fixtures.get('separate-owners').project).metadata.modules;
    for (const owner of ['Foo', 'Bar']) {
      const module = owners.find(module => module.name === owner);
      assert.deepEqual(module.records.map(record => [record.name, record.displayName]), [[owner.toLowerCase() + '.item', 'Item']]);
      assert.equal(module.procedures.find(procedure => procedure.name === 'ChangeItems').parameters[0].type, owner.toLowerCase() + '.item');
    }

    const nested = compile(fixtures.get('private-nested-fields').project).metadata.modules;
    assert.equal(nested.find(module => module.name === 'Main').records[0].name, 'main.detail');
    assert.deepEqual(nested.find(module => module.name === 'Types').records.map(record => record.name), ['types.detail', 'types.envelope']);
    const collision = compile(fixtures.get('record-class-collision').project).metadata.modules;
    assert.deepEqual(collision.find(module => module.name === 'Main').records.map(record => [record.name, record.displayName]), [['main.item', 'Item']]);
    assert.equal(collision.find(module => module.name === 'Item').kind, 'class');
  });
}

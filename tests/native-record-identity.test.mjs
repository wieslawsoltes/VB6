import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
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

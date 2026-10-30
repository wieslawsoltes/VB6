import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {getPascalRuntimeSource, PASCAL_RUNTIME_HELPERS} from '../src/language/pascal/runtime-library.js';

const project = {
  schema: 1, name: 'PascalRuntimeAOT', startup: 'Sub Main',
  modules: [{id: 'runtime', name: 'PascalRuntime', kind: 'module', code:
    'Option Explicit\n' + getPascalRuntimeSource(PASCAL_RUNTIME_HELPERS.map(helper => helper.id)) + `
Sub Main()
  Dim value As String, values As String
  value = __PascalShortString("Pascal", 3)
  Call __PascalStringSet(value, 1, "p", 3)
  values = __PascalSetRange(0, 255)
  Call __PascalSetExclude(values, 255)
  Debug.Print __PascalOrd(True), __PascalOrd(__PascalChr(255)), __PascalRound(-2.5)
  Debug.Print __PascalIntMul(2147483647, 2147483647, 32), __PascalSetCount(values)
  Debug.Print __PascalFormat(1.25, -1, -1, "real"), value
End Sub`}],
};

test('the complete Pascal helper catalog emits Win32 x86 machine code', () => {
  const before = structuredClone(project);
  const result = compileWin32(project);
  assert.equal(result.bytes[0], 0x4d);
  assert.equal(result.bytes[1], 0x5a);
  const data = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  assert.equal(data.getUint16(data.getUint32(0x3c, true) + 4, true), 0x14c);
  assert.deepEqual(project, before);
});

test('the complete Pascal helper catalog emits macOS ARM64 machine code', () => {
  const before = structuredClone(project);
  const result = compileMacOSAOT(project);
  assert.ok(result.section.length > 0);
  assert.ok(result.metadata.entries.length >= PASCAL_RUNTIME_HELPERS.length + 1);
  assert.ok(result.metadata.entries.every(offset => offset % 16 === 0));
  assert.ok(result.section.fixups.every(fixup => fixup.kind.startsWith('arm64-')));
  assert.deepEqual(project, before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler-core.js';
import {compileProject as compileMixedProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {VBError} from '../src/language/errors.js';
import {getPascalFileHelper, getPascalFileRuntimeHelpers, getPascalFileRuntimeSource, PASCAL_FILE_HELPERS, PASCAL_IEEE_FILE_CODEC} from '../src/language/pascal/file-library.js';

const project = (body, helpers = PASCAL_FILE_HELPERS.map(helper => helper.id)) => ({
  schema: 1, name: 'PascalFiles', startup: 'Sub Main', modules: [{id: 'm', name: 'M', kind: 'module', code:
    'Option Explicit\n' + getPascalFileRuntimeSource(helpers) + '\nSub Main()\nDim f As String, status As Long\n' + body + '\nEnd Sub'}],
});
async function execute(body, helpers, configure) {
  const program = compileProject(project(body, helpers));
  assert.deepEqual(program.diagnostics, []);
  const output = [], vm = new VirtualMachine(program, {print: text => output.push(text)});
  configure?.(vm);
  await vm.start(); assert.equal(vm.err.Number, 0);
  return {output, vm};
}

test('Pascal file helpers are deduplicated and compile without a host adapter', () => {
  assert.equal(getPascalFileHelper('__PascalFileReadChar'), getPascalFileHelper('FILEREADCHAR'));
  const helpers = getPascalFileRuntimeHelpers(['fileReadChar', 'fileEOF', 'fileReadChar']);
  assert.equal(new Set(helpers.map(helper => helper.id)).size, helpers.length);
  for (const [index, helper] of helpers.entries()) for (const dependency of helper.dependencies) {
    assert.ok(helpers.findIndex(candidate => candidate.id === dependency) < index);
  }
  assert.throws(() => getPascalFileHelper('unknown'), /Unknown Turbo Pascal file helper/);
  assert.deepEqual(compileProject(project('')).diagnostics, []);
});

test('Text writes preserve all byte values and emit DOS CRLF exactly', async () => {
  const {vm, output} = await execute(`Dim index As Long, bytes As String
Call __PascalFileAssign(f, "bytes.dat", 0, 1)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
For index = 0 To 255
  bytes = bytes & ChrW(index)
Next index
Call __PascalFileWriteText(f, bytes, True, True, status)
Call __PascalFileClose(f, True, status)
Debug.Print status`);
  assert.deepEqual(output, ['0']);
  assert.deepEqual([...vm.fs.readBytes('/bytes.dat')], [...Array.from({length: 256}, (_, index) => index), 13, 10]);
});

test('Text lookahead does not consume input; capacity, CRLF, LF, CTRL-Z and end-of-file have Pascal semantics', async () => {
  const {output} = await execute(`Dim text As String
Call __PascalFileAssign(f, "text.txt", 0, 1)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteText(f, "abcdef" & vbCrLf & "X" & vbLf & ChrW(26) & "hidden", False, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileOpen(f, 0, 0, 2, True, status)
Debug.Print __PascalFileEOF(f, True, status), __PascalFileEOF(f, True, status)
Debug.Print __PascalFileReadText(f, 3, True, status)
Debug.Print "[" & __PascalFileReadText(f, 255, True, status) & "]", __PascalFileEOLN(f, True, status)
Debug.Print AscW(__PascalFileReadChar(f, True, status))
Debug.Print __PascalFileReadChar(f, True, status), AscW(__PascalFileReadChar(f, True, status))
Debug.Print __PascalFileEOF(f, True, status), __PascalFileEOLN(f, True, status)
Debug.Print AscW(__PascalFileReadChar(f, True, status)), AscW(__PascalFileReadChar(f, True, status))
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['False False', 'abc', '[] True', '13', 'X 13', 'True True', '26 26']);
});

test('numeric input skips whitespace, preserves delimiters and ReadLn consumes the rest of one logical line', async () => {
  const {output} = await execute(`Call __PascalFileAssign(f, "numbers.txt", 0, 1)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteText(f, vbTab & " -42 1.25E+2 rest" & vbCrLf & "last", False, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileOpen(f, 0, 0, 2, True, status)
Debug.Print __PascalFileReadToken(f, True, status), __PascalFileReadToken(f, True, status)
Call __PascalFileReadLn(f, True, status)
Debug.Print __PascalFileReadText(f, 255, True, status), __PascalFileEOF(f, True, status)
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['-42 1.25E+2', 'last True']);
});

test('typed and untyped record positions are zero-based and exact binary layouts survive writes', async () => {
  const {vm, output} = await execute(`Dim bytes As String
Call __PascalFileAssign(f, "integers.dat", 1, 2)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteBytes(f, __PascalFileEncodeInteger(-32768, 2), True, status)
Call __PascalFileWriteBytes(f, __PascalFileEncodeInteger(32767, 2), True, status)
Debug.Print __PascalFilePos(f, True, status), __PascalFileSize(f, True, status)
Call __PascalFileSeek(f, 0, True, status)
bytes = __PascalFileReadBytes(f, 2, True, status)
Debug.Print __PascalFileDecodeInteger(bytes, True), __PascalFilePos(f, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileOpen(f, 0, 0, 0, True, status)
Call __PascalFileSeek(f, 1, True, status)
Debug.Print __PascalFileDecodeInteger(__PascalFileReadBytes(f, 2, True, status), True), __PascalFileEOF(f, True, status)
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['2 2', '-32768 1', '32767 True']);
  assert.deepEqual([...vm.fs.readBytes('/integers.dat')], [0, 128, 255, 127]);
});

test('unchecked errors map to IOResult, inhibit subsequent I/O, and clear only when queried', async () => {
  const {output, vm} = await execute(`Dim missing As String
Call __PascalFileAssign(f, "missing.txt", 0, 1)
Call __PascalFileOpen(f, 0, 0, 2, False, status)
Debug.Print status
Call __PascalFileOpen(f, 1, 0, 2, False, status)
Debug.Print __PascalFileIOResult(status), __PascalFileIOResult(status)
Call __PascalFileOpen(f, 1, 0, 2, False, status)
Call __PascalFileClose(f, False, status)
Call __PascalFileClose(f, False, status)
Debug.Print __PascalFileIOResult(status)
Call __PascalFileOpen(missing, 0, 0, 2, False, status)
Debug.Print __PascalFileIOResult(status)`);
  assert.deepEqual(output, ['2', '2 0', '103', '102']);
  assert.ok(vm.fs.exists('/missing.txt'));
});

test('Append, Rename and Erase preserve the file descriptor after closing', async () => {
  const {output, vm} = await execute(`Call __PascalFileAssign(f, "old.txt", 0, 1)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteText(f, "first", True, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileOpen(f, 2, 0, 2, True, status)
Call __PascalFileWriteText(f, "last", False, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileRename(f, "new.txt", True, status)
Call __PascalFileOpen(f, 0, 0, 2, True, status)
Debug.Print __PascalFileReadText(f, 255, True, status)
Call __PascalFileReadLn(f, True, status)
Debug.Print __PascalFileReadText(f, 255, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileErase(f, True, status)`);
  assert.deepEqual(output, ['first', 'last']); assert.equal(vm.fs.files.size, 0);
});

test('ordinal and Real48 codecs encode Borland disk bytes independently of the VB memory ABI', async () => {
  const {output} = await execute(`Dim bytes As String, index As Long, image As String
bytes = __PascalFileEncodeReal48(-1)
For index = 1 To Len(bytes)
  image = image & Right$("0" & Hex$(AscW(Mid$(bytes, index, 1))), 2)
Next index
Debug.Print image, __PascalFileDecodeReal48(bytes)
Debug.Print __PascalFileDecodeInteger(__PascalFileEncodeInteger(-2147483648#, 4), True)
Debug.Print __PascalFileDecodeInteger(__PascalFileEncodeInteger(65535, 2), False)
Debug.Print __PascalFileDecodeReal48(__PascalFileEncodeReal48(0)), __PascalFileDecodeReal48(__PascalFileEncodeReal48(0.5))`);
  assert.deepEqual(output, ['810000000080 -1', '-2147483648', '65535', '0 0.5']);
});

test('BlockRead counts complete records while returning partial bytes and zero-count operations preserve position', async () => {
  const {output} = await execute(`Dim bytes As String, transferred As Long
Call __PascalFileAssign(f, "blocks.dat", 2, 2)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteBytes(f, "ABCDE", True, status)
Debug.Print __PascalFileRecordSize(f)
Call __PascalFileSeek(f, 0, True, status)
bytes = __PascalFileBlockRead(f, 3, True, transferred, True, status)
Debug.Print bytes, transferred, status
bytes = __PascalFileBlockRead(f, 1, True, transferred, True, status)
Debug.Print Len(bytes), transferred, status
bytes = __PascalFileBlockRead(f, 0, False, transferred, True, status)
Debug.Print Len(bytes), transferred, __PascalFilePos(f, True, status)
Call __PascalFileSeek(f, 0, True, status)
bytes = __PascalFileBlockRead(f, 3, False, transferred, False, status)
Debug.Print Len(bytes), transferred, __PascalFileIOResult(status)
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['2', 'ABCDE 2 0', '0 0 0', '0 0 2', '0 0 100']);
});

for (const allowPartial of [false, true]) test(`BlockWrite bounds its source and reports complete records on disk-full, Result present=${allowPartial}`, async () => {
  const {output, vm} = await execute(`Dim transferred As Long
Call __PascalFileAssign(f, "blocks.dat", 2, 2)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileBlockWrite(f, "ABCDEF", 3, ${allowPartial ? 'True' : 'False'}, transferred, False, status)
Debug.Print transferred, __PascalFileIOResult(status)
Call __PascalFileBlockWrite(f, "x", 2, False, transferred, False, status)
Debug.Print transferred, __PascalFileIOResult(status)
Call __PascalFileClose(f, True, status)`, undefined, vm => {
    const put = vm.fs.put.bind(vm.fs); let calls = 0;
    vm.fs.put = (...args) => {if (++calls === 3) throw new VBError('Disk full', 61); return put(...args);};
  });
  assert.deepEqual(output, [`1 ${allowPartial ? 0 : 101}`, '0 106']);
  assert.deepEqual([...vm.fs.readBytes('/blocks.dat')], [65, 66]);
});

test('Flush validates output state and leaves already-published bytes unchanged', async () => {
  const {output, vm} = await execute(`Call __PascalFileAssign(f, "flush.txt", 0, 1)
Call __PascalFileOpen(f, 1, 0, 2, True, status)
Call __PascalFileWriteText(f, "ready", False, True, status)
Call __PascalFileFlush(f, True, status)
Call __PascalFileClose(f, True, status)
Call __PascalFileOpen(f, 0, 0, 2, True, status)
Call __PascalFileFlush(f, False, status)
Debug.Print __PascalFileIOResult(status)
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['105']); assert.equal(vm.fs.read('/flush.txt'), 'ready');
});

test('finite IEEE codecs agree with an independent DataView oracle at normal and subnormal boundaries', async () => {
  const cases = [
    ...[0, 1, -1, 1.23456789, 2 ** -149, 2 ** -126, (2 - 2 ** -23) * 2 ** 127].map(value => [32, value]),
    ...[0, 1, -1, Math.PI, Number.MIN_VALUE, 2 ** -1022, Number.MAX_VALUE, -Number.MAX_VALUE].map(value => [64, value]),
  ];
  const body = 'Dim bytes As String, image As String, index As Long\n' + cases.map(([bits, value]) => `
bytes = __PascalFileEncodeFloat(${String(value)}#, ${bits})
bytes = __PascalFileEncodeFloat(__PascalFileDecodeFloat(bytes, ${bits}), ${bits})
image = ""
For index = 1 To Len(bytes)
  image = image & Right$("0" & Hex$(AscW(Mid$(bytes, index, 1))), 2)
Next index
Debug.Print image`).join('\n');
  const {output} = await execute(body, ['fileEncodeFloat', 'fileDecodeFloat']);
  const expected = cases.map(([bits, value]) => {
    const data = new DataView(new ArrayBuffer(bits / 8));
    data[bits === 32 ? 'setFloat32' : 'setFloat64'](0, value, true);
    return Buffer.from(data.buffer).toString('hex').toUpperCase();
  });
  assert.deepEqual(output, expected);
  assert.equal(PASCAL_IEEE_FILE_CODEC.preservesNegativeZero, false);
});

test('IEEE file decoding rejects nonfinite records and malformed byte sizes', async () => {
  for (const [expression, number] of [
    ['__PascalFileDecodeFloat(ChrW(0) & ChrW(0) & ChrW(128) & ChrW(127), 32)', 207],
    ['__PascalFileDecodeFloat("abc", 32)', 106],
  ]) {
    const vm = new VirtualMachine(compileProject(project('Debug.Print ' + expression, ['fileDecodeFloat'])), {});
    await assert.rejects(() => vm.start(), error => error.number === number);
  }
});

test('the complete Pascal file library emits Win32 and macOS native code', () => {
  const p = project(''), original = structuredClone(p);
  const win32 = compileWin32(p), macos = compileMacOSAOT(p);
  assert.equal(win32.bytes[0], 0x4d); assert.equal(win32.bytes[1], 0x5a);
  for (const symbol of ['ReadFile', 'WriteFile', 'CreateFileW', 'GetFileAttributesExW', 'MoveFileW', 'DeleteFileW']) {
    assert.ok(win32.report.imports.some(item => item.symbol === symbol), symbol);
  }
  assert.ok(macos.section.length > 0); assert.ok(macos.metadata.entries.length > PASCAL_FILE_HELPERS.length);
  assert.deepEqual(p, original);
});

test('authored Pascal Text and typed record files run in the VM and share both native backends', async () => {
  const p = {schema: 1, name: 'PascalFileFixture', startup: 'Sub Main', modules: [{id: 'main', name: 'FileFixture', kind: 'module', language: 'pascal', code: `program FileFixture;
type TReading = record
  Code: Word;
  Mean: Real;
end;
var TextFile: Text;
    DataFile: file of TReading;
    Original, Restored: TReading;
    Number: Integer;
begin
  Assign(TextFile, 'pascal.txt');
  Rewrite(TextFile);
  WriteLn(TextFile, 42:4);
  Flush(TextFile);
  Close(TextFile);
  Reset(TextFile);
  ReadLn(TextFile, Number);
  Close(TextFile);
  Original.Code := 65535;
  Original.Mean := 1.5;
  Assign(DataFile, 'pascal.dat');
  Rewrite(DataFile);
  Write(DataFile, Original);
  Seek(DataFile, 0);
  Read(DataFile, Restored);
  WriteLn(Number, '/', Restored.Code, '/', Restored.Mean:0:2, '/', FilePos(DataFile), '/', FileSize(DataFile));
  Close(DataFile)
end.`}]};
  const original = structuredClone(p), program = compileMixedProject(p);
  assert.deepEqual(program.diagnostics, []);
  const output = [], vm = new VirtualMachine(program, {print: text => output.push(text)});
  await vm.start(); assert.deepEqual(output, ['42/65535/1.50/1/1']);
  assert.equal(vm.fs.read('/pascal.txt'), '  42\r\n');
  assert.deepEqual([...vm.fs.readBytes('/pascal.dat')], [255, 255, 129, 0, 0, 0, 0, 64]);
  const win32 = compileWin32(p), macos = compileMacOSAOT(p);
  assert.equal(win32.bytes[0], 0x4d); assert.ok(macos.section.length > 0); assert.deepEqual(p, original);
});

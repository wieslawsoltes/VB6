import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler-core.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {getPascalFileHelper, getPascalFileRuntimeHelpers, getPascalFileRuntimeSource, PASCAL_FILE_HELPERS} from '../src/language/pascal/file-library.js';

const project = (body, helpers = PASCAL_FILE_HELPERS.map(helper => helper.id)) => ({
  schema: 1, name: 'PascalFiles', startup: 'Sub Main', modules: [{id: 'm', name: 'M', kind: 'module', code:
    'Option Explicit\n' + getPascalFileRuntimeSource(helpers) + '\nSub Main()\nDim f As String, status As Long\n' + body + '\nEnd Sub'}],
});
async function execute(body, helpers) {
  const program = compileProject(project(body, helpers));
  assert.deepEqual(program.diagnostics, []);
  const output = [], vm = new VirtualMachine(program, {print: text => output.push(text)});
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
Debug.Print __PascalFileReadText(f, 255, True, status), __PascalFileEOLN(f, True, status)
Debug.Print AscW(__PascalFileReadChar(f, True, status))
Debug.Print __PascalFileReadChar(f, True, status), AscW(__PascalFileReadChar(f, True, status))
Debug.Print __PascalFileEOF(f, True, status), __PascalFileEOLN(f, True, status)
Debug.Print AscW(__PascalFileReadChar(f, True, status)), AscW(__PascalFileReadChar(f, True, status))
Call __PascalFileClose(f, True, status)`);
  assert.deepEqual(output, ['False False', 'abc', 'def True', '13', 'X 13', 'True True', '26 26']);
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

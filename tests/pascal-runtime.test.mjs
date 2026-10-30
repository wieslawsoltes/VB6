import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler-core.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {
  getPascalHelper, getPascalRuntimeHelpers, getPascalRuntimeSource,
  PASCAL_RUNTIME_HELPERS, PASCAL_ORDINAL_TYPES, PASCAL_SET_LAYOUT,
} from '../src/language/pascal/runtime-library.js';

function project(body, helpers, declarations = '') {
  return {
    schema: 1, name: 'PascalRuntime', startup: 'Sub Main',
    modules: [{id: 'runtime', name: 'RuntimeTest', kind: 'module', code:
      'Option Explicit\n' + declarations + '\n' + getPascalRuntimeSource(helpers) +
      '\nSub Main()\n' + body + '\nEnd Sub'}],
  };
}

async function execute(body, helpers, declarations = '') {
  const program = compileProject(project(body, helpers, declarations));
  assert.deepEqual(program.diagnostics, []);
  const output = [];
  const vm = new VirtualMachine(program, {print: text => output.push(text)});
  await vm.start();
  assert.equal(vm.err.Number, 0);
  return output;
}

test('Pascal helper requests resolve dependencies once and reject unknown names', () => {
  assert.equal(getPascalHelper('__PascalOrd'), getPascalHelper('ORD'));
  assert.equal(getPascalHelper('shl'), getPascalHelper('shiftLeft'));
  const helpers = getPascalRuntimeHelpers(['setRange', 'setInclude', '__PascalSetRange']);
  assert.equal(new Set(helpers.map(helper => helper.id)).size, helpers.length);
  for (const [index, helper] of helpers.entries()) {
    for (const dependency of helper.dependencies) {
      assert.ok(helpers.findIndex(candidate => candidate.id === dependency) < index);
    }
  }
  assert.throws(() => getPascalRuntimeSource(['notAnIntrinsic']), /Unknown Turbo Pascal/);
  assert.deepEqual([PASCAL_ORDINAL_TYPES.integer.min, PASCAL_ORDINAL_TYPES.integer.max], [-32768, 32767]);
  assert.equal(PASCAL_ORDINAL_TYPES.word.storage, 'Long');
  assert.equal(PASCAL_SET_LAYOUT.bytes * PASCAL_SET_LAYOUT.bitsPerByte, 256);
});

test('the complete Pascal runtime compiles with Option Explicit and no host callbacks', () => {
  const result = compileProject(project('', PASCAL_RUNTIME_HELPERS.map(helper => helper.id)));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.modules.get('runtimetest').procedures.size, PASCAL_RUNTIME_HELPERS.length + 1);
});

test('Pascal char conversion preserves every byte and Boolean ordinals are 0/1', async () => {
  assert.deepEqual(await execute(`Dim i As Long, matches As Long
For i = 0 To 255
  If __PascalOrd(__PascalChr(i)) = i Then matches = matches + 1
Next i
Debug.Print matches, __PascalOrd(False), __PascalOrd(True)
Debug.Print __PascalOrd(__PascalUpCase("a")), __PascalOrd(__PascalUpCase("z")), __PascalOrd(__PascalUpCase(ChrW(255)))`,
  ['ord', 'chr', 'upCase']), ['256 0 1', '65 90 255']);
});

test('ShortString values truncate without padding and indexed ByRef mutation preserves aliases', async () => {
  const declarations = 'Private Type Item\n  Text As String\nEnd Type';
  assert.deepEqual(await execute(`Dim value As String, box As Item, items(0 To 1) As String
value = __PascalShortString("abcdef", 3)
Debug.Print "[" & value & "]", Len(__PascalShortString("a", 3)), __PascalOrd(__PascalStringGet(value, 0))
Call __PascalStringSet(value, 2, "Z", 3)
Debug.Print value
Call __PascalStringSet(value, 0, ChrW(2), 3)
Debug.Print value, Len(value)
box.Text = "ab"
items(1) = "xy"
Call __PascalStringSet(box.Text, 1, "X", 2)
Call __PascalStringSet(items(1), 2, "Z", 2)
Debug.Print box.Text, items(1)
Debug.Print __PascalCopy("abc", 2, 99), Len(__PascalCopy("abc", 9, 1)), __PascalPos("", "abc"), __PascalPos("b", "abc")
Call __PascalInsert("123", value, 2, 4)
Debug.Print value
Call __PascalDelete(value, 2, 2147483647)
Debug.Print value`,
  ['shortString', 'ord', 'stringGet', 'stringSet', 'copy', 'pos', 'insert', 'delete'], declarations),
  ['[abc] 1 3', 'aZc', 'aZ 2', 'Xb xZ', 'bc 0 0 2', 'a123', 'a']);
});

test('Pascal strings diagnose character, length, and capacity violations', async () => {
  const expressions = [
    '__PascalChr(256)', '__PascalOrd("ab")', '__PascalOrd(ChrW(256))',
    '__PascalStringGet("a", 2)', '__PascalShortString("a", 256)',
  ];
  for (const expression of expressions) {
    const program = compileProject(project('Debug.Print ' + expression, ['chr', 'ord', 'stringGet', 'shortString']));
    assert.deepEqual(program.diagnostics, []);
    const vm = new VirtualMachine(program);
    await assert.rejects(() => vm.start(), error => error.number === 201);
    assert.equal(vm.lastError?.number, 201, expression);
  }
});

test('Pascal Round uses halfway away from zero and Trunc/Frac truncate toward zero', async () => {
  const values = [-3.5, -2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5, 3.5];
  const output = await execute(values.map(value => `Debug.Print __PascalRound(${value})`).join('\n') +
    '\nDebug.Print __PascalTrunc(-3.75), __PascalTrunc(3.75), __PascalFrac(-3.75), __PascalFrac(3.75)',
  ['round', 'trunc', 'frac']);
  assert.deepEqual(output, ['-4', '-3', '-2', '-1', '0', '1', '2', '3', '4', '-3 3 -0.75 0.75']);
});

test('Real48 storage quantizes its 40-bit significand and flushes denormals', async () => {
  assert.deepEqual(await execute(`Debug.Print __PascalReal48(1 + 2 ^ (-42)) = 1
Debug.Print __PascalReal48(1 + 2 ^ (-40)) = 1 + 2 ^ (-39)
Debug.Print __PascalReal48(-1 - 2 ^ (-40)) = -1 - 2 ^ (-39)
Debug.Print __PascalReal48(2 ^ (-128)) = 2 ^ (-128), __PascalReal48(2 ^ (-129)) = 0
Debug.Print __PascalReal48(0) = 0, __PascalReal48(2 ^ 126) = 2 ^ 126
Debug.Print __PascalReal48(__PascalReal48(1 / 3)) = __PascalReal48(1 / 3)`, ['real48']),
  ['True', 'True', 'True', 'True True', 'True True', 'True']);
  const vm = new VirtualMachine(compileProject(project('Debug.Print __PascalReal48(2 ^ 127)', ['real48'])));
  await assert.rejects(() => vm.start(), error => error.number === 205);
});

test('Pascal Val accepts signed decimal/hex integers and reports the first invalid position', async () => {
  const values = ['123', '  -2147483648', '$FFFFFFFF', '$ff', '2147483648', '123 ', '12x', '-', '$', ''];
  const body = 'Dim value As Long, code As Long\n' + values.map(value =>
    `value = 777\nCall __PascalValInteger(${JSON.stringify(value)}, value, code)\nDebug.Print value, code`).join('\n');
  assert.deepEqual(await execute(body, ['valInteger']),
    ['123 0', '-2147483648 0', '-1 0', '255 0', '777 10', '777 4', '777 3', '777 2', '777 2', '777 1']);
});

test('Pascal Val validates real syntax without accepting a numeric prefix or trailing blanks', async () => {
  const values = ['1.25e+2', '-0.5', '1e+', '1.5 ', '3junk', '', '1e400'];
  const body = 'Dim value As Double, code As Long\n' + values.map(value =>
    `value = 777\nCall __PascalValReal(${JSON.stringify(value)}, value, code)\nDebug.Print value, code`).join('\n') +
    '\nCall __PascalValReal("1e100", value, code, "double")\nDebug.Print value = 1e100, code';
  assert.deepEqual(await execute(body, ['valReal']),
    ['125 0', '-0.5 0', '777 4', '777 4', '777 2', '777 1', '777 5', 'True 0']);
});

test('Pascal div/mod preserve signed truncated-quotient semantics', async () => {
  const values = [[7, 3], [-7, 3], [7, -3], [-7, -3], [-2147483648, 3], [2147483647, -7]];
  const output = await execute(values.map(([left, right]) =>
    `Debug.Print __PascalDiv(${left}, ${right}), __PascalMod(${left}, ${right})`).join('\n'), ['div', 'mod']);
  assert.deepEqual(output, values.map(([left, right]) => `${Math.trunc(left / right)} ${left % right}`));
  for (const helper of ['Div', 'Mod']) {
    const compiled = compileProject(project(`Debug.Print __Pascal${helper}(1, 0)`, [helper]));
    const vm = new VirtualMachine(compiled);
    await assert.rejects(() => vm.start(), error => error.number === 200);
    assert.equal(vm.lastError?.number, 200);
  }
});

test('Pascal ordinal casts wrap at the declared width and enforce explicit range checks', async () => {
  assert.deepEqual(await execute(`Debug.Print __PascalOrdinal(255, 8, True), __PascalOrdinal(-1, 8, False)
Debug.Print __PascalOrdinal(65535, 16, True), __PascalOrdinal(-1, 16, False)
Debug.Print __PascalOrdinal(2147483648#, 32, True), __PascalOrdinal(4294967295#, 32, True)
Debug.Print __PascalOrdinal(-65537, 16, False)`, ['ordinal']), ['-1 255', '-1 65535', '-2147483648 -1', '65535']);
  const compiled = compileProject(project('Debug.Print __PascalOrdinal(256, 8, False, True)', ['ordinal']));
  const vm = new VirtualMachine(compiled);
  await assert.rejects(() => vm.start(), error => error.number === 201);
  assert.equal(vm.lastError?.number, 201);
});

test('Pascal 32-bit multiplication retains low bits beyond IEEE Double integer precision', async () => {
  const values = [
    [2147483647, 2147483647], [-2147483648, -2147483648], [-2147483648, -1],
    [2147483647, 65537], [-123456789, 987654321], [65535, 65535], [-65537, -65537],
  ];
  let seed = 0x125ad87;
  for (let index = 0; index < 20; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    const left = seed;
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    values.push([left, seed]);
  }
  const output = await execute(values.map(([left, right]) =>
    `Debug.Print __PascalIntMul(${left}, ${right}, 32)`).join('\n'), ['intMul']);
  assert.deepEqual(output, values.map(([left, right]) => String(BigInt.asIntN(32, BigInt(left) * BigInt(right)))));
  assert.deepEqual(await execute(`Debug.Print __PascalIntAdd(2147483647, 1, 32), __PascalIntSub(-2147483648, 1, 32)
Debug.Print __PascalIntMul(32767, 32767, 16)`, ['intAdd', 'intSub', 'intMul']), ['-2147483648 2147483647', '1']);
  const compiled = compileProject(project('Debug.Print __PascalIntMul(32767, 2, 16, True)', ['intMul']));
  const vm = new VirtualMachine(compiled);
  await assert.rejects(() => vm.start(), error => error.number === 215);
  assert.equal(vm.lastError?.number, 215);
});

test('Pascal Word arithmetic preserves unsigned comparisons, wraps and checks the unsigned range', async () => {
  const pairs = [[0, 0], [0, 1], [1, 65535], [32767, 1], [32768, 32768], [65535, 65535], [255, 257]];
  const operations = [
    ['wordAdd', 'WordAdd', (left, right) => left + right],
    ['wordSub', 'WordSub', (left, right) => left - right],
    ['wordMul', 'WordMul', (left, right) => left * right],
  ];
  for (const [helper, suffix, operation] of operations) {
    const output = await execute(pairs.map(([left, right]) => `Debug.Print __Pascal${suffix}(${left}, ${right})`).join('\n'), [helper]);
    assert.deepEqual(output, pairs.map(([left, right]) => String(BigInt.asUintN(16, operation(BigInt(left), BigInt(right))))));
  }
  assert.deepEqual(await execute(`Debug.Print __PascalWordAdd(65535, 0, True) > 0
Debug.Print __PascalWordSub(65535, 32767, True), __PascalWordMul(255, 257, True)`, ['wordAdd', 'wordSub', 'wordMul']), ['True', '32768 65535']);
  for (const [helper, expression] of [['wordAdd', '__PascalWordAdd(65535, 1, True)'], ['wordSub', '__PascalWordSub(0, 1, True)'], ['wordMul', '__PascalWordMul(256, 256, True)']]) {
    const vm = new VirtualMachine(compileProject(project('Debug.Print ' + expression, [helper])));
    await assert.rejects(() => vm.start(), error => error.number === 215);
  }
});

test('Pascal shifts discard outgoing bits and do not use JavaScript modulo-32 counts', async () => {
  assert.deepEqual(await execute(`Debug.Print __PascalShiftLeft(1, 15), __PascalShiftLeft(1, 15, 16, False)
Debug.Print __PascalShiftRight(-1, 1), __PascalShiftRight(-1, 1, 32)
Debug.Print __PascalShiftLeft(1, 31, 32), __PascalShiftLeft(1, 32, 32), __PascalShiftRight(-1, 32, 32)
Debug.Print __PascalShiftLeft(-2147483648, 1, 32), __PascalShiftRight(-2147483648, 31, 32)`,
  ['shiftLeft', 'shiftRight']), ['-32768 32768', '32767 2147483647', '-2147483648 0 0', '0 1']);
});

test('Pascal set algebra handles all 256 values, byte boundaries, and independent assignments', async () => {
  const helpers = ['setRange', 'setCount', 'setInclude', 'setExclude', 'setUnion', 'setIntersect',
    'setDifference', 'setSymmetricDifference', 'setEqual', 'setSubset', 'setContains', 'setWith', 'setWithout'];
  assert.deepEqual(await execute(`Dim a As String, b As String, c As String, i As Long, matches As Long
Debug.Print __PascalSetEqual(a, __PascalSetRange(2, 1)), __PascalSetContains(a, 0)
a = __PascalSetRange(0, 255)
For i = 0 To 255
  If __PascalSetContains(a, i) Then matches = matches + 1
Next i
Debug.Print __PascalSetCount(a), matches, __PascalSetContains(a, -1), __PascalSetContains(a, 256)
a = __PascalSetRange(0, 15)
b = __PascalSetRange(8, 31)
c = a
Call __PascalSetExclude(c, 0)
Call __PascalSetInclude(c, 255)
Debug.Print __PascalSetContains(a, 0), __PascalSetContains(c, 0), __PascalSetContains(c, 255)
Debug.Print __PascalSetCount(__PascalSetUnion(a, b)), __PascalSetCount(__PascalSetIntersect(a, b)), __PascalSetCount(__PascalSetDifference(a, b)), __PascalSetCount(__PascalSetSymmetricDifference(a, b))
Debug.Print __PascalSetSubset(a, __PascalSetUnion(a, b)), __PascalSetSubset(a, b)
Debug.Print __PascalSetEqual(a, __PascalSetWithout(__PascalSetWith(a, 255), 255))
Debug.Print __PascalSetContains(__PascalSetRange(7, 8), 7), __PascalSetContains(__PascalSetRange(7, 8), 8), __PascalSetCount(__PascalSetRange(7, 8))`, helpers),
  ['True False', '256 256 False False', 'True False True', '32 8 8 24', 'True False', 'True', 'True True 2']);
});

test('Pascal formatting applies minimum width, uppercase booleans, and fixed/scientific real conventions', async () => {
  assert.deepEqual(await execute(`Debug.Print "[" & __PascalFormat(True, 6, -1, "boolean") & "]"
Debug.Print "[" & __PascalFormat(False, 1, -1, "boolean") & "]"
Debug.Print "[" & __PascalFormat("abcdef", 2, -1, "string") & "]"
Debug.Print "[" & __PascalFormat(12.375, 8, 2, "real") & "]"
Debug.Print "[" & __PascalFormat(-42, 5, -1, "integer") & "]"
Debug.Print "[" & __PascalFormat(1.25, -1, -1, "real") & "]"
Debug.Print "[" & __PascalFormat(1.25, 8, -1, "real") & "]"
Debug.Print "[" & __PascalFormat(-0.00125, 8, -1, "real") & "]"
Debug.Print "[" & __PascalFormat(9.96, 8, -1, "real") & "]"
Debug.Print "[" & __PascalFormat(0, -1, -1, "real") & "]"
Debug.Print "[" & __PascalFormat(1.25, -1, -1, "real87") & "]"
Debug.Print Len(__PascalFormat(1.5, 0, 20, "real"))`, ['format']),
  ['[  TRUE]', '[FALSE]', '[abcdef]', '[   12.38]', '[  -42]', '[ 1.2500000000E+00]', '[ 1.3E+00]', '[-1.3E-03]', '[ 1.0E+01]', '[ 0.0000000000E+00]', '[ 1.25000000E+0000]', '13']);
});

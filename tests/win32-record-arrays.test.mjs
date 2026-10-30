import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecordArrayMachine, ARRAY_HRESULT} from './support/native-record-array-machine.mjs';

const error = number => exception => exception.number === number;
const redim = (h, slot, size, values, preserve = false, initializer = 0) =>
  h.call('redim', [slot, size, values.length, h.bounds(values), preserve ? 1 : 0, initializer]);

for (const optimization of [0, 1, 2]) test(`record arrays allocate custom POD strides and declaration-order bounds O${optimization}`, t => {
  const h = nativeRecordArrayMachine(t, {optimization});
  for (const size of [3, 7, 16, 257]) {
    const slot = h.slot(), bounds = [[-2, 0], [7, 8], [11, 12]];
    redim(h, slot, size, bounds);
    const address = h.m.read(slot), state = h.descriptor(address);
    assert.equal(state.size, size); assert.equal(state.count, 12); assert.equal(state.flags, 0); assert.equal(state.locks, 0);
    assert.deepEqual(state.bounds, bounds); assert.equal(h.bytes(address).length, size * 12);
    assert.ok(h.bytes(address).every(byte => byte === 0));
    assert.equal(h.call('native:array:lower', [slot, 1]) | 0, -2);
    assert.equal(h.call('native:array:upper', [slot, 3]), 12);
    h.call('native:array:destroy', [slot]); assert.equal(h.m.read(slot), 0);
  }
  assert.equal(h.apiCounts.get('SafeArrayAllocDescriptor'), 4);
  assert.equal(h.apiCounts.get('SafeArrayAllocData'), 4); assert.equal(h.ownedRegions(), 0);
});

test('Preserve grows and shrinks only the final dimension and retains complete POD bytes', t => {
  const h = nativeRecordArrayMachine(t), slot = h.slot();
  redim(h, slot, 7, [[-2, 0], [4, 5]]);
  const address = h.m.read(slot), data = h.descriptor(address).data;
  for (let i = 0; i < 42; i++) h.m.write(data + i, i + 1, 8);
  redim(h, slot, 7, [[-2, 0], [4, 7]], true);
  assert.equal(h.m.read(slot), address); assert.deepEqual(h.descriptor(address).bounds, [[-2, 0], [4, 7]]);
  assert.deepEqual(h.bytes(address), [...Array.from({length: 42}, (_, i) => i + 1), ...Array(42).fill(0)]);
  redim(h, slot, 7, [[-2, 0], [4, 4]], true);
  assert.deepEqual(h.bytes(address), Array.from({length: 21}, (_, i) => i + 1));
  assert.deepEqual(h.descriptor(address).bounds, [[-2, 0], [4, 4]]);
  h.call('native:array:destroy', [slot]); assert.equal(h.ownedRegions(), 0);
});

test('Preserve rejects rank, preceding dimension, lower-bound and element-size changes before allocation', t => {
  const h = nativeRecordArrayMachine(t), slot = h.slot();
  redim(h, slot, 8, [[-2, 0], [4, 5]]);
  const address = h.m.read(slot), original = h.bytes(address), calls = h.apiCounts.get('SafeArrayAllocData');
  for (const [size, bounds, number] of [[8, [[-2, 0]], 9], [8, [[-2, 1], [4, 6]], 9], [8, [[-1, 1], [4, 6]], 9], [8, [[-2, 0], [3, 6]], 9], [12, [[-2, 0], [4, 5]], 13]]) {
    assert.throws(() => redim(h, slot, size, bounds, true), error(number));
    assert.equal(h.m.read(slot), address); assert.deepEqual(h.bytes(address), original);
  }
  assert.equal(h.apiCounts.get('SafeArrayAllocData'), calls);
});

for (const operation of ['SafeArrayAllocDescriptor', 'SafeArrayAllocData', 'SafeArrayRedim', 'SafeArrayDestroy'])
test(`${operation} failure preserves the old record array and releases provisional ownership`, t => {
  const h = nativeRecordArrayMachine(t), slot = h.slot();
  redim(h, slot, 8, [[2, 3]]);
  const address = h.m.read(slot), state = h.descriptor(address), original = Array.from({length: 16}, (_, i) => 255 - i);
  original.forEach((value, i) => h.m.write(state.data + i, value, 8));
  h.fail(operation, operation === 'SafeArrayDestroy' ? ARRAY_HRESULT.locked : ARRAY_HRESULT.outOfMemory,
    args => operation !== 'SafeArrayDestroy' || args[0] === address);
  assert.throws(() => redim(h, slot, 8, [[2, 6]], operation === 'SafeArrayRedim'), error(operation === 'SafeArrayDestroy' ? 10 : 7));
  assert.equal(h.m.read(slot), address); assert.deepEqual(h.bytes(address), original);
  assert.deepEqual(h.descriptor(address).bounds, [[2, 3]]); assert.equal(h.arrays.size, 1); assert.equal(h.ownedRegions(), 2);
  h.call('native:array:destroy', [slot]); assert.equal(h.ownedRegions(), 0);
});

test('locked and fixed record arrays reject replacement before external calls', t => {
  const h = nativeRecordArrayMachine(t), slot = h.slot(); redim(h, slot, 8, [[1, 2]]);
  const address = h.m.read(slot);
  for (const fixed of [false, true]) {
    h.m.write(address + 8, fixed ? 0 : 1); h.m.write(address + 2, fixed ? 0x10 : 0, 16);
    const calls = h.vm.calls.length;
    assert.throws(() => redim(h, slot, 8, [[1, 3]], false), error(10));
    assert.throws(() => redim(h, slot, 8, [[1, 3]], true), error(10));
    assert.equal(h.vm.calls.length, calls + 2, 'only the two native VB error raises occur');
    assert.equal(h.m.read(slot), address);
  }
});

test('record-array size, rank and backing multiplication are checked before external allocation', t => {
  const h = nativeRecordArrayMachine(t, {maxArrayBytes: 63}), slot = h.slot();
  for (const [size, bounds, number] of [[0, [[0, 1]], 5], [524289, [[0, 0]], 7], [8, [[0, 7]], 7], [8, [[0, 65535], [0, 65535]], 7], [8, [[4, 3]], 9]]) {
    assert.throws(() => redim(h, slot, size, bounds), error(number)); assert.equal(h.m.read(slot), 0);
  }
  const bounds = h.bounds([[0, 0]]);
  assert.throws(() => h.call('redim', [slot, 8, 0, bounds, 0, 0]), error(9));
  assert.throws(() => h.call('redim', [slot, 8, 61, bounds, 0, 0]), error(9));
  assert.equal(h.arrays.size, 0); assert.equal(h.apiCounts.get('SafeArrayAllocDescriptor'), undefined);
});

test('real fixed String initializers touch only new records during Preserve and restore spaces after fixed Erase', t => {
  const h = nativeRecordArrayMachine(t), slot = h.slot();
  const layout = h.result.report.records.find(record => record.name === 'm.pod'), size = layout.size;
  const initializer = h.vm.symbol('native:record:m.pod:initialize');
  const label = layout.fields.find(field => field.name === 'Label').offset;
  const nested = layout.fields.find(field => field.name === 'Nested').offset;
  const text = (address, index, offset, length) => Array.from({length}, (_, i) =>
    String.fromCharCode(h.m.read(h.descriptor(address).data + index * size + offset + 2 * i, 16))).join('');
  redim(h, slot, size, [[-1, 0]], false, initializer);
  const address = h.m.read(slot), data = h.descriptor(address).data;
  assert.equal(text(address, 0, label, 3), '   '); assert.equal(text(address, 1, nested, 2), '  ');
  h.m.write(data, 42); h.m.write(data + label, 65, 16); h.m.write(data + nested, 66, 16);
  redim(h, slot, size, [[-1, 2]], true, initializer);
  assert.equal(h.m.read(h.descriptor(address).data), 42); assert.equal(text(address, 0, label, 3), 'A  '); assert.equal(text(address, 0, nested, 2), 'B ');
  assert.equal(text(address, 3, label, 3), '   '); assert.equal(text(address, 3, nested, 2), '  ');
  h.m.write(address + 2, 0x10, 16); h.call('native:array:erase', [slot, 0]); h.call('initialize', [slot, 0, initializer]);
  assert.equal(h.m.read(slot), address); assert.equal(h.m.read(h.descriptor(address).data), 0);
  assert.equal(text(address, 0, label, 3), '   '); assert.equal(text(address, 0, nested, 2), '  ');
  h.call('native:array:destroy', [slot]); assert.equal(h.ownedRegions(), 0);
});

test('whole-record-array copy keeps independent bytes and clears copied fixedness', t => {
  const h = nativeRecordArrayMachine(t), source = h.slot(), destination = h.slot();
  redim(h, source, 7, [[-2, 0], [4, 5]]); redim(h, destination, 7, [[1, 1]]);
  const original = h.m.read(source), previous = h.m.read(destination), data = h.descriptor(original).data;
  for (let i = 0; i < 42; i++) h.m.write(data + i, 255 - i, 8);
  h.m.write(original + 2, 0x10, 16); h.call('native:array:copy', [destination, source]);
  const copied = h.m.read(destination);
  assert.notEqual(copied, original); assert.ok(!h.arrays.has(previous));
  assert.deepEqual(h.descriptor(copied).bounds, [[-2, 0], [4, 5]]); assert.equal(h.descriptor(copied).flags & 0x10, 0);
  assert.deepEqual(h.bytes(copied), h.bytes(original)); h.m.write(data, 99, 8); assert.equal(h.bytes(copied)[0], 255);
  h.call('native:array:copy', [destination, destination]); assert.equal(h.m.read(destination), copied);
  h.call('native:array:destroy', [source]); assert.equal(h.bytes(copied)[0], 255);
  h.call('native:array:destroy', [destination]); assert.equal(h.ownedRegions(), 0);
});

for (const operation of ['SafeArrayCopy', 'SafeArrayDestroy']) test(`record-array copy rolls back ${operation} failure`, t => {
  const h = nativeRecordArrayMachine(t), source = h.slot(), destination = h.slot();
  redim(h, source, 7, [[1, 2]]); redim(h, destination, 7, [[4, 6]]);
  const old = h.m.read(destination), original = h.m.read(source);
  h.m.write(h.descriptor(old).data, 42, 8); h.m.write(h.descriptor(original).data, 99, 8);
  h.fail(operation, operation === 'SafeArrayCopy' ? ARRAY_HRESULT.outOfMemory : ARRAY_HRESULT.locked,
    args => operation !== 'SafeArrayDestroy' || args[0] === old);
  assert.throws(() => h.call('native:array:copy', [destination, source]), error(operation === 'SafeArrayCopy' ? 7 : 10));
  assert.equal(h.m.read(destination), old); assert.equal(h.bytes(old)[0], 42); assert.equal(h.bytes(original)[0], 99);
  assert.equal(h.arrays.size, 2); assert.equal(h.ownedRegions(), 4);
});

for (const optimization of [0, 1, 2]) test(`authored record-array assignment, ByRef calls and fixed String lifecycle execute emitted code O${optimization}`, t => {
  const code = `Private Type POD
  Value As Long
  Label As String * 3
End Type
Public saved As POD
Public erased As POD
Public fresh As POD
Public answer As Long
Private Sub Bump(ByRef item As POD)
  item.Value = item.Value + 1
  item.Label = "Z"
End Sub
Private Sub BumpArray(ByRef items() As POD)
  items(LBound(items)).Value = items(LBound(items)).Value + 2
End Sub
Public Sub Main()
  Dim a() As POD, b() As POD, fixed(1 To 2) As POD
  ReDim a(-2 To -1)
  a(-2).Value = 41
  a(-2).Label = "AB"
  a(-1) = a(-2)
  Bump a(-1)
  b = a
  a(-2).Value = 99
  BumpArray b
  saved = b(-1)
  answer = b(-2).Value
  ReDim Preserve b(-2 To 1)
  fresh = b(1)
  fixed(2).Value = 9
  fixed(2).Label = "XY"
  Erase fixed
  erased = fixed(2)
End Sub`;
  const h = nativeRecordArrayMachine(t, {optimization, code}), before = structuredClone(h.project);
  h.call('proc:M:Main');
  const text = name => [0, 1, 2].map(i => String.fromCharCode(h.m.read(h.global(name) + 4 + 2 * i, 16))).join('');
  assert.equal(h.m.read(h.global('answer')), 43); assert.equal(h.m.read(h.global('saved')), 42); assert.equal(text('saved'), 'Z  ');
  assert.equal(h.m.read(h.global('fresh')), 0); assert.equal(text('fresh'), '   ');
  assert.equal(h.m.read(h.global('erased')), 0); assert.equal(text('erased'), '   ');
  assert.equal(h.arrays.size, 0, 'all local array owners and element pins release on procedure exit');
  assert.equal(h.ownedRegions(), 0); assert.deepEqual(h.project, before);
});

/** Test-only OleAut32 contracts around the emitted IA-32 record-array ABI.
 * No record-array helper is replaced by a JavaScript implementation. External
 * calls operate on the public SAFEARRAY descriptor layout and owned byte data.
 * This is bounded ABI execution, not a Windows execution claim.
 *
 * https://learn.microsoft.com/windows/win32/api/oaidl/ns-oaidl-safearray
 * https://learn.microsoft.com/windows/win32/api/oleauto/nf-oleauto-safearrayallocdescriptor
 * https://learn.microsoft.com/windows/win32/api/oleauto/nf-oleauto-safearrayredim
 */
import assert from 'node:assert/strict';
import {PE32Image} from '../../src/native/pe32.js';
import {compileWin32} from '../../src/native/compiler.js';
import {NativeX86Machine} from './native-x86-machine.mjs';

export const ARRAY_HRESULT = Object.freeze({outOfMemory: 0x8007000e, badIndex: 0x8002000b,
  locked: 0x8002000d, invalid: 0x80070057, unexpected: 0x8000ffff});

const fixture = `Private Type Child
  Text As String * 2
End Type
Private Type POD
  Value As Long
  Label As String * 3
  Nested As Child
End Type
Private values() As POD
Sub Main()
  ReDim values(-2 To 1, 7 To 8)
End Sub`;

export function nativeRecordArrayMachine(t, {code = fixture, optimization = 1, maxArrayBytes = 1048576} = {}) {
  let linked;
  const finish = PE32Image.prototype.finish;
  const mock = t.mock.method(PE32Image.prototype, 'finish', function(...args) {
    return linked = finish.apply(this, args);
  });
  const project = {schema: 1, name: 'RecordArrayABI', startup: 'Sub Main', modules: [
    {id: 'm', name: 'M', kind: 'module', code},
  ]};
  let result;
  try { result = compileWin32(project, {optimization, maxArrayBytes}); }
  finally { mock.mock.restore(); }
  const vm = new NativeX86Machine(linked), m = vm.memory;
  const arrays = new Map(), apiCounts = new Map(), failures = [], allocations = [];
  const alloc = (length, label = 'test-input') => {
    const address = m.alloc(length, label); m.region(address).bytes.fill(0); return address;
  };
  const descriptor = address => {
    assert.ok(arrays.has(address), 'live owned SAFEARRAY descriptor');
    const rank = m.read(address, 16), size = m.read(address + 4);
    const physicalBounds = Array.from({length: rank}, (_, i) => ({
      count: m.read(address + 16 + 8 * i), lower: m.read(address + 20 + 8 * i) | 0,
    }));
    const count = physicalBounds.reduce((n, bound) => n * bound.count, 1);
    // OleAut32 dimension numbers/indices start at the rightmost descriptor
    // dimension. VB declaration-order indices therefore vary fastest first.
    const bounds = [...physicalBounds].reverse().map(({lower, count}) => [lower, lower + count - 1]);
    return {rank, size, count, bounds, physicalBounds, flags: m.read(address + 2, 16),
      locks: m.read(address + 8), data: m.read(address + 12)};
  };
  const allocateDescriptor = rank => {
    assert.ok(rank >= 1 && rank <= 60);
    const address = alloc(16 + 8 * rank, 'SAFEARRAY.descriptor');
    m.write(address, rank, 16); arrays.set(address, {}); return address;
  };
  const allocateData = address => {
    const state = descriptor(address);
    assert.equal(state.flags & (0x20 | 0x80 | 0xf00), 0, 'POD arrays do not advertise COM record or managed-element ownership');
    assert.ok(state.size > 0 && state.count >= 0);
    assert.ok(Number.isSafeInteger(state.count * state.size) && state.count * state.size <= 4 * 1048576,
      'bounded external API test allocation');
    const data = state.count ? alloc(state.count * state.size, 'SAFEARRAY.data') : 0;
    m.write(address + 12, data);
    allocations.push({address, size: state.size, bounds: state.bounds, bytes: state.count * state.size});
    return 0;
  };
  const destroyDescriptor = address => {
    const state = descriptor(address);
    if (state.locks) return ARRAY_HRESULT.locked;
    // DestroyDescriptor never owns destruction of a separately allocated data
    // block. Leaving that block live makes incorrect cleanup observable.
    arrays.delete(address); m.free(address); return 0;
  };
  const destroy = address => {
    if (!address) return 0;
    const state = descriptor(address);
    if (state.locks) return ARRAY_HRESULT.locked;
    if (state.data) m.free(state.data);
    return destroyDescriptor(address);
  };
  const api = (name, argumentCount, body) => vm.hook('oleaut32.dll', name, argumentCount, args => {
    apiCounts.set(name, (apiCounts.get(name) || 0) + 1);
    const index = failures.findIndex(failure => failure.name === name && failure.when(args));
    if (index >= 0) return failures.splice(index, 1)[0].hresult;
    return body(args);
  });
  api('SafeArrayAllocDescriptor', 2, ([rank, out]) => {
    if (!rank || rank > 60) return ARRAY_HRESULT.invalid;
    m.write(out, allocateDescriptor(rank)); return 0;
  });
  api('SafeArrayAllocData', 1, ([address]) => allocateData(address));
  api('SafeArrayDestroyDescriptor', 1, ([address]) => destroyDescriptor(address));
  api('SafeArrayDestroy', 1, ([address]) => destroy(address));
  api('SafeArrayGetDim', 1, ([address]) => descriptor(address).rank);
  api('SafeArrayGetElemsize', 1, ([address]) => descriptor(address).size);
  for (const upper of [false, true]) api(upper ? 'SafeArrayGetUBound' : 'SafeArrayGetLBound', 3, ([address, dimension, out]) => {
    const state = descriptor(address);
    if (dimension < 1 || dimension > state.rank) return ARRAY_HRESULT.badIndex;
    m.write(out, state.bounds[dimension - 1][upper ? 1 : 0]); return 0;
  });
  api('SafeArrayLock', 1, ([address]) => {
    const state = descriptor(address); m.write(address + 8, state.locks + 1); return 0;
  });
  api('SafeArrayUnlock', 1, ([address]) => {
    const state = descriptor(address);
    if (!state.locks) return ARRAY_HRESULT.unexpected;
    m.write(address + 8, state.locks - 1); return 0;
  });
  api('SafeArrayPtrOfIndex', 3, ([address, indices, out]) => {
    const state = descriptor(address);
    assert.ok(state.locks > 0, 'SafeArrayPtrOfIndex requires a caller-owned lock');
    let offset = 0, stride = 1;
    for (let i = 0; i < state.rank; i++) {
      const index = m.read(indices + 4 * i) | 0, [lower, upper] = state.bounds[i];
      if (index < lower || index > upper) return ARRAY_HRESULT.badIndex;
      offset += (index - lower) * stride; stride *= upper - lower + 1;
    }
    m.write(out, state.data + offset * state.size); return 0;
  });
  api('SafeArrayRedim', 2, ([address, bound]) => {
    const state = descriptor(address);
    if (state.locks || state.flags & 0x10) return ARRAY_HRESULT.locked;
    const count = m.read(bound), lower = m.read(bound + 4) | 0;
    const total = state.count / state.physicalBounds[0].count * count, size = total * state.size;
    assert.ok(Number.isSafeInteger(size) && size <= 4 * 1048576, 'bounded external API resize');
    const data = size ? alloc(size, 'SAFEARRAY.data') : 0;
    if (data && state.data) m.region(data).bytes.set(m.region(state.data).bytes.subarray(0, size));
    if (state.data) m.free(state.data);
    m.write(address + 12, data); m.write(address + 16, count); m.write(address + 20, lower);
    return 0;
  });
  api('SafeArrayCopy', 2, ([address, out]) => {
    const state = descriptor(address), copy = allocateDescriptor(state.rank);
    m.region(copy).bytes.set(m.region(address).bytes);
    m.write(copy + 8, 0); m.write(copy + 12, 0); allocateData(copy);
    const copied = descriptor(copy);
    if (state.data) m.region(copied.data).bytes.set(m.region(state.data).bytes);
    m.write(out, copy); return 0;
  });
  const bounds = values => {
    const address = alloc(8 * values.length);
    values.forEach(([lower, upper], i) => {
      m.write(address + 8 * i, upper - lower + 1); m.write(address + 8 * i + 4, lower);
    });
    return address;
  };
  const slot = (value = 0) => { const address = alloc(4); m.write(address, value); return address; };
  const call = (name, args = []) => {
    const esp = vm.get('esp');
    try { return vm.invoke(name.startsWith('native:') || name.startsWith('proc:') ? name : 'native:record-array:' + name, args); }
    finally { vm.set('esp', esp); }
  };
  return {vm, m, result, project, arrays, allocations, apiCounts, descriptor, alloc, bounds, slot, call,
    fail: (name, hresult = ARRAY_HRESULT.outOfMemory, when = () => true) => failures.push({name, hresult, when}),
    bytes: address => { const state = descriptor(address); return state.data ? [...m.region(state.data).bytes] : []; },
    global: name => vm.symbol('global:M:' + name),
    ownedRegions: () => m.regions.filter(region => region.label.startsWith('SAFEARRAY.')).length,
  };
}

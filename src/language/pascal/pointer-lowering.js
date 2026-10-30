const id = name => `[${name}]`;
const key = name => String(name).toLowerCase();

export function pascalPointerStorage(type, owner) {
  const pointer = type.canonical || type, suffix = pointer.name.replace(/[^A-Za-z_0-9]/g, '_'), prefix = pointer.owner === owner ? '' : `${id(pointer.owner.name)}.`;
  return {pointer, heap: `${prefix}${id(`__PascalHeap_${suffix}`)}`, allocate: `${prefix}${id(`__PascalAllocate_${suffix}`)}`, validate: `${prefix}${id(`__PascalDereference_${suffix}`)}`, dispose: `${prefix}${id(`__PascalDispose_${suffix}`)}`, wrapper: pointer.target.kind === 'array' ? '.__PascalValue' : ''};
}

/** Typed heap storage lowers to ordinary arrays and procedures. The same bounds,
 * allocation, and stale-pointer checks therefore run in VM and native builds. */
export function generatePascalPointerHeaps(binder, storageType, declaration) {
  const result = [];
  for (const pointer of binder.pointerTypes) {
    if (pointer.canonical && pointer.canonical !== pointer) continue;
    const suffix = pointer.name.replace(/[^A-Za-z_0-9]/g, '_'), names = pascalPointerStorage(pointer, binder), heap = names.heap, used = id(`__PascalAllocated_${suffix}`), capacity = id(`__PascalCapacity_${suffix}`), empty = id(`__PascalEmpty_${suffix}`), target = pointer.target;
    const wrapperType = id(`__PascalPointerValue_${suffix}`);
    const elementType = target.kind === 'array' ? wrapperType : storageType(target);
    const lines = [];
    if (target.kind === 'array') lines.push(`Private Type ${wrapperType}`, declaration('__PascalValue', target), 'End Type');
    lines.push(`Public ${heap}() As ${elementType}`, `Private ${used}() As Boolean`, `Private ${capacity} As Long`,
      `Public Function ${names.allocate}() As Long`, 'Dim slot As Long',
      `If ${capacity} = 0& Then`, `${capacity} = 16&`, `ReDim ${heap}(1& To ${capacity})`, `ReDim ${used}(1& To ${capacity})`, 'End If',
      `For slot = 1& To ${capacity}`, `If Not ${used}(slot) Then`, `${used}(slot) = True`, `${names.allocate} = slot`, 'Exit Function', 'End If', 'Next slot',
      `If ${capacity} >= 1048576& Then Err.Raise 203, "Turbo Pascal", "Heap allocation limit exceeded"`, `slot = ${capacity} + 1&`, `${capacity} = ${capacity} * 2&`,
      `ReDim Preserve ${heap}(1& To ${capacity})`, `ReDim Preserve ${used}(1& To ${capacity})`, `${used}(slot) = True`, `${names.allocate} = slot`, 'End Function',
      `Public Function ${names.validate}(ByVal pointer As Long) As Long`,
      `If pointer < 1& Or pointer > ${capacity} Then Err.Raise 204, "Turbo Pascal", "Invalid or nil pointer"`,
      `If Not ${used}(pointer) Then Err.Raise 204, "Turbo Pascal", "Pointer refers to disposed storage"`, `${names.validate} = pointer`, 'End Function',
      `Public Sub ${names.dispose}(ByVal pointer As Long)`, `Dim ${empty} As ${elementType}`, `pointer = ${names.validate}(pointer)`,
      `${heap}(pointer) = ${empty}`, `${used}(pointer) = False`, 'End Sub');
    result.push({source: lines.join('\n'), node: pointer.node, identity: key(pointer.identity)});
  }
  return result;
}

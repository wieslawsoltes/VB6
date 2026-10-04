/** Read-only, bounds-checked PE metadata. This never loads or executes the input. */
export function inspectPE(input) {
  const data = Buffer.from(input);
  function range(offset, size) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > data.length) throw new Error('Truncated or invalid PE range');
    return offset;
  }
  const u16 = offset => data.readUInt16LE(range(offset, 2));
  const u32 = offset => data.readUInt32LE(range(offset, 4));
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not an MZ executable');
  const pe = u32(0x3c);
  if (data.toString('ascii', range(pe, 24), pe + 4) !== 'PE\0\0') throw new Error('Not a PE executable');
  const machine = u16(pe + 4), count = u16(pe + 6), optionalSize = u16(pe + 20), characteristics = u16(pe + 22);
  if (count < 1 || count > 96) throw new Error('Invalid PE section count');
  const optional = pe + 24, magic = u16(optional), plus = magic === 0x20b;
  if (magic !== 0x10b && !plus) throw new Error('Unsupported PE optional header');
  const directoryOffset = plus ? 112 : 96;
  if (optionalSize < directoryOffset) throw new Error('Truncated optional header');
  range(optional, optionalSize);
  const directoryCount = u32(optional + (plus ? 108 : 92));
  if (directoryCount > 16 || directoryOffset + directoryCount * 8 > optionalSize) throw new Error('Invalid PE directory table');
  const headersSize = u32(optional + 60), sections = [];
  const table = optional + optionalSize; range(table, count * 40);
  for (let i = 0; i < count; i++) {
    const s = table + i * 40;
    const section = { name: data.toString('ascii', s, s + 8).replace(/\0.*$/, ''), virtualSize: u32(s + 8), rva: u32(s + 12), size: u32(s + 16), offset: u32(s + 20) };
    if (section.size) range(section.offset, section.size);
    sections.push(section);
  }
  function fromRVA(rva, length = 1) {
    if (!rva) throw new Error('Null PE address');
    if (rva < headersSize && rva + length <= headersSize) return range(rva, length);
    const matches = sections.filter(s => rva >= s.rva && rva - s.rva + length <= s.size);
    if (matches.length !== 1) throw new Error('Invalid or ambiguous PE address');
    return range(matches[0].offset + rva - matches[0].rva, length);
  }
  function stringAtRVA(rva) {
    const bytes = [];
    for (let i = 0; i < 512; i++) {
      const byte = data[fromRVA(rva + i)];
      if (byte === 0) return Buffer.from(bytes).toString('ascii');
      if (byte < 32 || byte > 126) throw new Error('Invalid PE import name');
      bytes.push(byte);
    }
    throw new Error('Unterminated PE import name');
  }
  const imports = [];
  if (directoryCount > 1) {
    const address = u32(optional + directoryOffset + 8), size = u32(optional + directoryOffset + 12);
    if (address) {
      if (size < 20) throw new Error('Invalid PE import directory');
      let terminated = false;
      for (let i = 0; i < Math.min(1024, Math.floor(size / 20)); i++) {
        const descriptor = fromRVA(address + i * 20, 20);
        const fields = Array.from({ length: 5 }, (_, k) => u32(descriptor + k * 4));
        if (fields.every(n => n === 0)) { terminated = true; break; }
        const dll = stringAtRVA(fields[3]);
        if (!dll || /[/\\:]/.test(dll)) throw new Error('Invalid import DLL name');
        imports.push(dll);
      }
      if (!terminated) throw new Error('Unterminated PE import directory');
    } else if (size) throw new Error('PE import size without address');
  }
  const arch = ({ 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'arm64' })[machine] || 'unknown';
  const classicRuntimeImport = imports.some(name => name.toLowerCase() === 'msvbvm60.dll');
  return { format: plus ? 'PE32+' : 'PE32', machine, arch, subsystem: u16(optional + 68),
    executable: !!(characteristics & 2), dll: !!(characteristics & 0x2000), imports: [...new Set(imports)], classicRuntimeImport,
    size: data.length, dependencyScan: 'Static imports only; late-bound COM, OCX, LoadLibrary and delay imports require a deployment audit.' };
}
export function verifyClassicExecutable(input) {
  const info = inspectPE(input);
  if (info.format !== 'PE32' || info.arch !== 'x86' || !info.executable || info.dll || !info.classicRuntimeImport) {
    throw new Error('Expected a 32-bit Windows EXE importing MSVBVM60.DLL');
  }
  return info;
}

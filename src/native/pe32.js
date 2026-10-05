/** Deterministic PE32 linker. Browser-safe: no Node, native compiler, or binary template. */
export const PE32_BASE = 0x400000;
const align = (n, a) => Math.ceil(n / a) * a;
export class BinarySection {
  constructor(name, flags) { this.name = name; this.flags = flags; this.bytes = []; this.labels = new Map(); this.fixups = []; }
  get length() { return this.bytes.length; }
  emit(...values) { for (const value of values) this.bytes.push(value & 255); return this; }
  u16(n) { return this.emit(n, n >>> 8); }
  u32(n) { return this.emit(n, n >>> 8, n >>> 16, n >>> 24); }
  zero(n) { if (!Number.isInteger(n) || n < 0 || n > 16 * 1024 * 1024) throw new Error('Invalid section allocation'); for (let i = 0; i < n; i++) this.bytes.push(0); return this; }
  align(n) { return this.zero(align(this.length, n) - this.length); }
  label(name) { if (this.labels.has(name)) throw new Error('Duplicate label: ' + name); this.labels.set(name, this.length); return this; }
  reference(label, kind = 'va', addend = 0) { this.fixups.push({ offset: this.length, label, kind, addend }); return this.u32(0); }
  ascii(text) { if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Expected ASCII'); return this.emit(...new TextEncoder().encode(text), 0); }
  utf16(text) { for (let i = 0; i < text.length; i++) this.u16(text.charCodeAt(i)); return this.u16(0); }
}
export class PE32Image {
  constructor() { this.sections = []; this.imports = new Map(); this.directories = new Map(); this.finished = false; }
  section(name, flags) {
    if (!/^\.[\w]{1,7}$/.test(name) || this.sections.some(s => s.name === name) || this.finished) throw new Error('Invalid or duplicate PE section');
    const section = new BinarySection(name, flags); this.sections.push(section); return section;
  }
  import(dll, symbol) {
    if (!/^[A-Za-z0-9_.-]+\.dll$/i.test(dll) || !(typeof symbol === 'string' && /^[A-Za-z_?@$][\w?@$]*$/.test(symbol) || Number.isInteger(symbol) && symbol > 0 && symbol < 65536)) throw new Error('Invalid DLL import');
    dll = dll.toLowerCase(); const key = dll + '!' + symbol;
    if (!this.imports.has(key)) this.imports.set(key, { dll, symbol, label: 'iat:' + key });
    return this.imports.get(key).label;
  }
  manifest(xml) {
    const r = this.section('.rsrc', 0x40000040), body = new TextEncoder().encode(xml);
    // Three resource-directory levels: RT_MANIFEST -> ID 1 -> LANG_NEUTRAL.
    r.label('resource-root').zero(12).u16(0).u16(1).u32(24).u32(0x80000018);
    r.zero(12).u16(0).u16(1).u32(1).u32(0x80000030);
    r.zero(12).u16(0).u16(1).u32(0).u32(72);
    r.reference('manifest-data', 'rva').u32(body.length).u32(65001).u32(0).label('manifest-data');
    for (const byte of body) r.emit(byte);
    this.directories.set(2, { label: 'resource-root', size: r.length });
  }
  finish(entry, { subsystem = 2 } = {}) {
    if (this.finished) throw new Error('PE image already linked');
    if (!this.imports.size || ![2, 3].includes(subsystem)) throw new Error('Invalid PE executable');
    const idata = this.section('.idata', 0xc0000040), groups = new Map();
    for (const item of this.imports.values()) { if (!groups.has(item.dll)) groups.set(item.dll, []); groups.get(item.dll).push(item); }
    idata.label('imports');
    for (const [dll] of groups) idata.reference('ilt:' + dll, 'rva').u32(0).u32(0).reference('dll:' + dll, 'rva').reference('iat:' + dll, 'rva');
    idata.zero(20);
    this.directories.set(1, { label: 'imports', size: (groups.size + 1) * 20 });
    const thunk = item => typeof item.symbol === 'number' ? idata.u32(0x80000000 + item.symbol) : idata.reference('hint:' + item.label, 'rva');
    for (const [dll, items] of groups) { idata.align(4).label('ilt:' + dll); for (const item of items) thunk(item); idata.u32(0); }
    idata.align(4).label('iat-start'); const iatStart = idata.length;
    for (const [dll, items] of groups) { idata.label('iat:' + dll); for (const item of items) { idata.label(item.label); thunk(item); } idata.u32(0); }
    this.directories.set(12, { label: 'iat-start', size: idata.length - iatStart });
    for (const [dll, items] of groups) {
      idata.label('dll:' + dll).ascii(dll);
      for (const item of items) if (typeof item.symbol === 'string') idata.align(2).label('hint:' + item.label).u16(0).ascii(item.symbol);
    }
    let rva = 4096; const symbols = new Map(), relocationPages = new Map();
    const place = section => {
      if (!section.length) section.zero(1);
      section.rva = rva; rva += align(section.length, 4096);
      for (const [label, offset] of section.labels) {
        if (symbols.has(label)) throw new Error('Duplicate linker symbol: ' + label);
        symbols.set(label, section.rva + offset);
      }
      for (const fixup of section.fixups) if (fixup.kind === 'va') {
        const at = section.rva + fixup.offset, page = Math.floor(at / 4096) * 4096;
        if (!relocationPages.has(page)) relocationPages.set(page, []);
        relocationPages.get(page).push(0x3000 + at - page);
      }
    };
    for (const section of this.sections) place(section);
    const reloc = this.section('.reloc', 0x42000040); reloc.label('relocations');
    for (const [page, entries] of relocationPages) { const size = align(8 + entries.length * 2, 4); reloc.u32(page).u32(size); for (const entry of entries) reloc.u16(entry); reloc.align(4); }
    this.directories.set(5, { label: 'relocations', size: reloc.length }); place(reloc);
    if (rva > 64 * 1024 * 1024 || this.sections.length > 16) throw new Error('Native image exceeds limits');
    const entryRva = symbols.get(entry); if (entryRva === undefined) throw new Error('Missing entry point');
    const headerSize = align(0x80 + 24 + 224 + this.sections.length * 40, 512);
    let fileSize = headerSize;
    for (const section of this.sections) { section.fileOffset = fileSize; section.rawSize = align(section.length, 512); fileSize += section.rawSize; }
    const image = new Uint8Array(fileSize), view = new DataView(image.buffer);
    const word = (at, n) => view.setUint16(at, n, true), dword = (at, n) => view.setUint32(at, n, true);
    image[0] = 77; image[1] = 90; dword(0x3c, 0x80);
    // DOS stub: exit with error; text is not executed on Windows.
    image.set([0x0e, 0x1f, 0xb8, 0x01, 0x4c, 0xcd, 0x21], 0x40);
    image.set([80, 69, 0, 0], 0x80); word(0x84, 0x14c); word(0x86, this.sections.length);
    word(0x94, 224); word(0x96, 0x102);
    const optional = 0x98; word(optional, 0x10b); image[optional + 2] = 1;
    dword(optional + 4, this.sections.filter(s => s.flags & 0x20).reduce((a, s) => a + s.rawSize, 0));
    dword(optional + 8, this.sections.filter(s => !(s.flags & 0x20)).reduce((a, s) => a + s.rawSize, 0));
    dword(optional + 16, entryRva); dword(optional + 20, this.sections[0].rva);
    dword(optional + 24, this.sections.find(s => s.flags & 0x40)?.rva || 0);
    dword(optional + 28, PE32_BASE); dword(optional + 32, 4096); dword(optional + 36, 512);
    word(optional + 40, 6); word(optional + 42, 1); word(optional + 48, 6); word(optional + 50, 1);
    dword(optional + 56, rva); dword(optional + 60, headerSize); word(optional + 68, subsystem); word(optional + 70, 0x8540);
    dword(optional + 72, 1024 * 1024); dword(optional + 76, 4096); dword(optional + 80, 1024 * 1024); dword(optional + 84, 4096); dword(optional + 92, 16);
    for (const [index, directory] of this.directories) { dword(optional + 96 + index * 8, symbols.get(directory.label)); dword(optional + 100 + index * 8, directory.size); }
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i], at = optional + 224 + i * 40;
      image.set(new TextEncoder().encode(section.name), at); dword(at + 8, section.length); dword(at + 12, section.rva);
      dword(at + 16, section.rawSize); dword(at + 20, section.fileOffset); dword(at + 36, section.flags);
      image.set(section.bytes, section.fileOffset);
      for (const fixup of section.fixups) {
        const target = symbols.get(fixup.label); if (target === undefined) throw new Error('Unresolved native symbol: ' + fixup.label);
        let value = target + fixup.addend;
        if (fixup.kind === 'va') value += PE32_BASE;
        else if (fixup.kind === 'rel') value -= section.rva + fixup.offset + 4;
        else if (fixup.kind !== 'rva') throw new Error('Unknown relocation type');
        dword(section.fileOffset + fixup.offset, value);
      }
    }
    this.finished = true;
    return { bytes: image, symbols: Object.fromEntries(symbols), sections: this.sections.map(s => ({ name: s.name, rva: s.rva, offset: s.fileOffset, size: s.length, rawSize: s.rawSize, flags: s.flags })), imports: [...this.imports.values()].map(({dll, symbol}) => ({dll, symbol})) };
  }
}

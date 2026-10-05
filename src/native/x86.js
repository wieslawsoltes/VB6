/** Small checked x86 assembler for the native VB backend (stdcall, 32-bit registers). */
export class X86 {
  constructor(section, image) { this.s = section; this.image = image; this.sequence = 0; }
  label(name) { this.s.label(name); return this; }
  unique(prefix = 'L') { return prefix + ':' + this.sequence++; }
  emit(...values) { this.s.emit(...values); return this; }
  imm(value) { if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) throw new Error('Invalid x86 immediate'); this.s.u32(value); return this; }
  addr(label, addend = 0) { this.s.reference(label, 'va', addend); return this; }
  value(value) {
    if (typeof value === 'number') return this.emit(0xb8).imm(value);
    if (typeof value === 'string') return this.emit(0xb8).addr(value);
    if (value.address !== undefined) return this.local(value.address);
    if (value.memory) return this.emit(0xa1).addr(value.memory, value.addend || 0);
    if (value.argument !== undefined) return this.emit(0x8b, 0x85).imm(value.argument);
    throw new Error('Unsupported native argument');
  }
  push(value) { if (value === undefined) return this.emit(0x50); this.value(value); return this.emit(0x50); }
  store(label, addend = 0) { return this.emit(0xa3).addr(label, addend); }
  local(offset) { return this.emit(0x8d, 0x85).imm(offset); }
  call(label) { this.emit(0xe8); this.s.reference(label, 'rel'); return this; }
  jump(label) { this.emit(0xe9); this.s.reference(label, 'rel'); return this; }
  branch(condition, label) {
    const opcode = {e:0x84, ne:0x85, l:0x8c, le:0x8e, g:0x8f, ge:0x8d, b:0x82, ae:0x83, o:0x80, no:0x81, s:0x88, ns:0x89}[condition];
    if (opcode === undefined) throw new Error('Unknown condition'); this.emit(0x0f, opcode); this.s.reference(label, 'rel'); return this;
  }
  api(dll, name, args = []) { for (const arg of [...args].reverse()) this.push(arg); return this.invoke(dll, name); }
  invoke(dll, name) { return this.emit(0xff, 0x15).addr(this.image.import(dll, name)); }
  test() { return this.emit(0x85, 0xc0); }
  compare(value) { return this.emit(0x3d).imm(value); }
  enter(bytes = 0) {
    this.emit(0x55, 0x89, 0xe5);
    // Probe every page rather than skipping Windows' stack guard with one large subtraction.
    for (let n = bytes; n > 0; n -= 4096) this.emit(0x81, 0xec).imm(Math.min(n, 4096)).emit(0x83, 0x0c, 0x24, 0);
    return this.emit(0x53, 0x56, 0x57);
  }
  leave(args = 0) { this.emit(0x5f, 0x5e, 0x5b, 0x89, 0xec, 0x5d); return args ? this.emit(0xc2).emit(args, args >>> 8) : this.emit(0xc3); }
}

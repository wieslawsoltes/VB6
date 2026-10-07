import {x86ExtendedMethods} from './x86-extended.js';
import {x86OperandMethods, X86_CONDITIONS} from './x86-operands.js';
const checked32=value=>{if(!Number.isInteger(value)||value < -2147483648||value > 4294967295)throw new Error('Invalid x86 immediate');return value;};
const labelName=name=>{if(typeof name!=='string'||!name)throw new Error('Invalid native label');return name;};
function argument(value) {
  if(typeof value==='number'){checked32(value);return;}
  if(typeof value==='string'){labelName(value);return;}
  if(!value||typeof value!=='object')throw new Error('Unsupported native argument');
  if(value.address!==undefined){checked32(value.address);return;}
  if(value.memory!==undefined){labelName(value.memory);checked32(value.addend??0);return;}
  if(value.argument!==undefined){checked32(value.argument);return;}
  throw new Error('Unsupported native argument');
}
/** Checked IA-32 assembler for the native VB backend. Legacy push(value) still
 * loads EAX; pushOperand(value) is the side-effect-free machine PUSH alternative.
 */
export class X86 {
  constructor(section, image) { this.s = section; this.image = image; this.sequence = 0; }
  label(name) { this.s.label(labelName(name)); return this; }
  unique(prefix = 'L') { return prefix + ':' + this.sequence++; }
  emit(...values) { this.s.emit(...values); return this; }
  imm(value) { this.s.u32(checked32(value)); return this; }
  addr(label, addend = 0) { this.s.reference(label, 'va', addend); return this; }
  value(value) {
    argument(value);
    if (typeof value === 'number') return this.emit(0xb8).imm(value);
    if (typeof value === 'string') return this.emit(0xb8).addr(value);
    if (value.address !== undefined) return this.local(value.address);
    if (value.memory !== undefined) return this.emit(0xa1).addr(value.memory, value.addend ?? 0);
    return this.emit(0x8b, 0x85).imm(value.argument);
  }
  push(value) { if (value === undefined) return this.emit(0x50); this.value(value); return this.emit(0x50); }
  store(label, addend = 0) { labelName(label);checked32(addend);return this.emit(0xa3).addr(label, addend); }
  local(offset) { checked32(offset);return this.emit(0x8d, 0x85).imm(offset); }
  call(label) { labelName(label);this.emit(0xe8); this.s.reference(label, 'rel'); return this; }
  jump(label) { labelName(label);this.emit(0xe9); this.s.reference(label, 'rel'); this.s.fixups.at(-1).branch = 0xeb; return this; }
  branch(condition, label) {
    const opcode = Object.hasOwn(X86_CONDITIONS, condition) ? 0x80 + X86_CONDITIONS[condition] : undefined;
    if (opcode === undefined) throw new Error('Unknown condition');labelName(label);
    this.emit(0x0f, opcode); this.s.reference(label, 'rel'); this.s.fixups.at(-1).branch = opcode - 0x10; return this;
  }
  api(dll, name, args = []) {
    if(!Array.isArray(args))throw new Error('Invalid native argument list');for(const value of args)argument(value);
    const label=this.image.import(dll,name);for(const value of [...args].reverse())this.push(value);
    return this.emit(0xff,0x15).addr(label);
  }
  invoke(dll, name) { const label=this.image.import(dll,name);return this.emit(0xff, 0x15).addr(label); }
  test() { return this.emit(0x85, 0xc0); }
  compare(value) { checked32(value);return this.emit(0x3d).imm(value); }
  enter(bytes = 0) {
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > 512 * 1024) throw new Error('Invalid x86 stack frame');
    this.emit(0x55, 0x89, 0xe5);
    // Probe every page rather than skipping Windows' stack guard with one large subtraction.
    for (let n = bytes; n > 0; n -= 4096) this.emit(0x81, 0xec).imm(Math.min(n, 4096)).emit(0x83, 0x0c, 0x24, 0);
    return this.emit(0x53, 0x56, 0x57);
  }
  leave(args = 0) { if (!Number.isInteger(args) || args < 0 || args > 65535) throw new Error('Invalid x86 return cleanup'); this.emit(0x5f, 0x5e, 0x5b, 0x89, 0xec, 0x5d); return args ? this.emit(0xc2).emit(args, args >>> 8) : this.emit(0xc3); }
}

Object.assign(X86.prototype, x86OperandMethods, x86ExtendedMethods);

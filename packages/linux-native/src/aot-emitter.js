/** Checked x86-64 SysV code emitter for the shared AOT helper graph.
 * All project control flow is machine code. Helpers implement language values,
 * never consume a project opcode stream, and never throw across these frames. */
import {BinarySection} from '../../../src/native/binary-section.js';
import {ARM64,linkARM64} from '../../../src/native/arm64.js';
import {aotOptimizationLevel,optimizeAOTOperations} from '../../macos-native/src/aot-optimizer.js';
import {LINUX_LIMITS,linuxTarget} from './target.js';
const integer=(value,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid x86_64 immediate or displacement');return value;};
const register=value=>integer(value,0,15);
const reg={rax:0,rcx:1,rdx:2,rsp:4,rbp:5,rsi:6,rdi:7,r8:8,r9:9,r12:12,r13:13};
/** The restricted assembler encodes only the verified AOT ABI instruction set. */
export class X64AOTAssembler {
  constructor(section=new BinarySection('.vb6code',0x6)){this.s=section;}
  emit(...bytes){this.s.emit(...bytes);return this;}
  u32(value){this.s.u32(integer(value,-0x80000000,0xffffffff));return this;}
  label(name){if(typeof name!=='string'||!name)throw new TypeError('Invalid x86_64 label');this.s.label(name);return this;}
  push(r){register(r);if(r>=8)this.emit(0x41);return this.emit(0x50+(r&7));}
  pop(r){register(r);if(r>=8)this.emit(0x41);return this.emit(0x58+(r&7));}
  mov(to,from){register(to);register(from);return this.emit(0x48+(from>=8?4:0)+(to>=8?1:0),0x89,0xc0+((from&7)<<3)+(to&7));}
  immediate(to,value){
    register(to);if(typeof value==='number'&&!Number.isSafeInteger(value))throw new RangeError('Unsafe x86_64 immediate');
    if(!['number','bigint'].includes(typeof value))throw new TypeError('Expected x86_64 integer immediate');
    const number=BigInt(value);if(number<-(1n<<63n)||number>(1n<<64n)-1n)throw new RangeError('x86_64 immediate exceeds 64 bits');
    if(number>=0n&&number<=0xffffffffn){if(to>=8)this.emit(0x41);return this.emit(0xb8+(to&7)).u32(Number(number));}
    if(number>=-0x80000000n&&number<0n)return this.emit(0x48+(to>=8?1:0),0xc7,0xc0+(to&7)).u32(Number(number));
    this.emit(0x48+(to>=8?1:0),0xb8+(to&7));const bits=BigInt.asUintN(64,number);this.s.u32(Number(bits&0xffffffffn));this.s.u32(Number(bits>>32n));return this;
  }
  load(to,offset){register(to);integer(offset,0,0x7fffffff);return this.emit(0x48+(to>=8?4:0),0x8b,0x84+((to&7)<<3),0x24).u32(offset);}
  store(from,offset){register(from);integer(offset,0,0x7fffffff);return this.emit(0x48+(from>=8?4:0),0x89,0x84+((from&7)<<3),0x24).u32(offset);}
  stack(bytes,subtract=false){integer(bytes,0,0x7fffffff);return this.emit(0x48,0x81,subtract?0xec:0xc4).u32(bytes);}
  test(){return this.emit(0x48,0x85,0xc0);}
  failed(){return this.emit(0x48,0x83,0xf8,0xff);}
  compare(value){return this.emit(0x48,0x3d).u32(integer(value,0,0x7fffffff));}
  relative(label,opcode){if(typeof label!=='string'||!label)throw new TypeError('Invalid x86_64 relocation symbol');this.emit(...opcode);this.s.fixups.push({kind:'x86_64-rel32',offset:this.s.length,label,addend:0,opcode:[...opcode]});this.s.u32(0);return this;}
  call(label){return this.relative(label,[0xe8]);}
  jump(label){return this.relative(label,[0xe9]);}
  branch(condition,label){const code={eq:0x84,ne:0x85,lo:0x82}[condition];if(code===undefined)throw new Error('Unknown x86_64 condition');return this.relative(label,[0x0f,code]);}
  enter(bytes){
    integer(bytes,16,32784);if(bytes%16)throw new RangeError('Misaligned x86_64 stack frame');
    // Entry RSP mod 16 = 8; three saves establish aligned outgoing call frames.
    this.emit(0xf3,0x0f,0x1e,0xfa).push(reg.rbp).mov(reg.rbp,reg.rsp).push(reg.r12).push(reg.r13).mov(reg.r12,reg.rdi);
    for(let remaining=bytes;remaining;){const size=Math.min(remaining,4096);this.stack(size,true).emit(0x48,0x83,0x0c,0x24,0);remaining-=size;}return this;
  }
  leave(bytes){return this.stack(bytes).pop(reg.r13).pop(reg.r12).pop(reg.rbp).emit(0xc3);}
}
function emitFunction(f,a,level){
  const optimized=optimizeAOTOperations(f.ops,level),stats={removedJumps:optimized.removedJumps,elidedStores:0,forwardedLoads:0};
  const prefix='aot_'+f.id+'_',label=name=>prefix+name,frame=Math.ceil((16+f.slots*8)/16)*16;
  const offset=slot=>16+integer(slot,0,f.slots-1)*8;let cachedSlot,sequence=0;
  const load=(to,value)=>{if(level===3&&to===reg.rax&&value&&typeof value==='object'&&value.slot===cachedSlot){stats.forwardedLoads++;return;}if(to===reg.rax)cachedSlot=undefined;if(value&&typeof value==='object')a.load(to,offset(value.slot));else a.immediate(to,value??0);};
  while(a.s.length%16)a.emit(0x90);a.label('aot_entry_'+f.id).enter(frame);
  for(const op of optimized.ops){
    if(op.op==='label'){cachedSlot=undefined;a.label(label(op.name));}
    else if(op.op==='jump'){cachedSlot=undefined;a.jump(label(op.name));}
    else if(op.op==='move'){load(reg.rax,op.value);a.store(reg.rax,offset(op.out.slot));cachedSlot=op.out.slot;}
    else if(op.op==='branch'){load(reg.rax,op.value);a.test().branch(op.zero?'eq':'ne',label(op.name));}
    else if(op.op==='call'){
      cachedSlot=undefined;
      // ABI: Scope*, a,b,c,d,e in registers; h,g at [RSP], [RSP+8].
      a.mov(reg.rdi,reg.r12);[reg.rsi,reg.rdx,reg.rcx,reg.r8,reg.r9].forEach((r,i)=>load(r,op.args[i]));
      load(reg.rax,op.args[5]);a.store(reg.rax,0);load(reg.rax,op.args[6]);a.store(reg.rax,8);
      a.call('vb6_aot_'+op.name);
      if(level>=2&&!optimized.readSlots.has(op.out.slot))stats.elidedStores++;else a.store(reg.rax,offset(op.out.slot));
      cachedSlot=op.out.slot;if(op.checked)a.failed().branch('eq',label('failure'));
    }else if(op.op==='select'){
      load(reg.rax,op.value);
      const tree=pairs=>{if(!pairs.length){a.jump(label(op.fallback));return;}const middle=pairs.length>>1,[key,target]=pairs[middle];a.compare(key).branch('eq',label(target));
        if(pairs.length===1){a.jump(label(op.fallback));return;}const left=label('switch_'+sequence++);a.branch('lo',left);tree(pairs.slice(middle+1));a.label(left);tree(pairs.slice(0,middle));};
      tree([...op.pairs].sort((a,b)=>a[0]-b[0]));
    }else throw new Error('Unknown x86_64 AOT operation '+op.op);
    if(a.s.length>LINUX_LIMITS.codeBytes)throw new RangeError('Linux AOT code exceeds 64 MiB');
  }
  a.label(label('exit')).leave(frame);return stats;
}
/** AAPCS64 passes all eight ABI words in x0..x7. The shared emitter preserves
 * x19/x20 and FP/LR, aligns/probes its stack, and expands distant conditionals.
 * ELF helpers omit the Mach-O leading underscore; no instruction ABI changes. */
export class LinuxARM64AOTAssembler extends ARM64 {
  constructor(section=new BinarySection('.vb6code',0x6)){super(section);}
  bl(label){return super.bl(typeof label==='string'?label.replace(/^_vb6_aot_/,'vb6_aot_'):label);}
}
export function emitLinuxAOTFunctions(functions,optimization=2,architecture='x64'){
  if(linuxTarget(architecture).option==='arm64'){
    const level=aotOptimizationLevel(optimization),assembler=new LinuxARM64AOTAssembler(),stats={level,removedJumps:0,elidedStores:0,forwardedLoads:0};
    for(const f of functions){const result=f.emit(assembler,level);for(const key of ['removedJumps','elidedStores','forwardedLoads'])stats[key]+=result[key];if(assembler.s.length>LINUX_LIMITS.codeBytes)throw new RangeError('Linux AOT code exceeds 64 MiB');}
    assembler.s.optimization=Object.freeze(stats);return assembler.s;
  }
  const level=aotOptimizationLevel(optimization),assembler=new X64AOTAssembler(),stats={level,removedJumps:0,elidedStores:0,forwardedLoads:0};
  for(const f of functions){const result=emitFunction(f,assembler,level);for(const key of ['removedJumps','elidedStores','forwardedLoads'])stats[key]+=result[key];}
  assembler.s.optimization=Object.freeze(stats);return assembler.s;
}
export function linkLinuxARM64AOT(section,baseAddress,externalSymbols=new Map()){
  integer(baseAddress,0,Number.MAX_SAFE_INTEGER);integer(section?.length,16,LINUX_LIMITS.codeBytes);
  if(baseAddress%16||section.length%4||section.bytes?.length!==section.length||!(section.labels instanceof Map)||!Array.isArray(section.fixups))throw new TypeError('Invalid or misaligned ARM64 AOT section');
  return linkARM64(section,baseAddress,externalSymbols);
}
/** All addresses slide together in an ELF PIE; signed relative calls need no
 * dynamic relocations and never introduce writable executable mappings. */
export function linkX64AOT(section,baseAddress,externalSymbols=new Map()){
  integer(baseAddress,0,Number.MAX_SAFE_INTEGER);integer(section.length,1,LINUX_LIMITS.codeBytes);
  if(section.bytes?.length!==section.length||!(section.labels instanceof Map)||!Array.isArray(section.fixups))throw new TypeError('Invalid x86_64 AOT section');
  const symbols=new Map();for(const [name,value]of externalSymbols)symbols.set(name,integer(value,0,Number.MAX_SAFE_INTEGER));
  for(const [name,offset]of section.labels){integer(offset,0,section.length);if(symbols.has(name))throw new Error('Duplicate x86_64 symbol '+name);symbols.set(name,baseAddress+offset);}
  const bytes=Uint8Array.from(section.bytes),view=new DataView(bytes.buffer),used=new Set();
  for(const fixup of section.fixups){
    const {offset,label,kind,addend=0,opcode}=fixup;integer(offset,0,bytes.length-4);integer(addend,-0x7fffffff,0x7fffffff);
    if(kind!=='x86_64-rel32'||!Array.isArray(opcode)||![1,2].includes(opcode.length)||!((opcode.length===1&&[0xe8,0xe9].includes(opcode[0]))||(opcode.length===2&&opcode[0]===0x0f&&[0x82,0x84,0x85].includes(opcode[1]))))throw new Error('Invalid x86_64 relocation');
    if(offset<opcode.length||opcode.some((byte,i)=>bytes[offset-opcode.length+i]!==byte))throw new Error('x86_64 relocation opcode mismatch');
    for(let i=offset;i<offset+4;i++){if(used.has(i))throw new Error('Overlapping x86_64 relocations');used.add(i);}
    if(!symbols.has(label))throw new Error('Undefined x86_64 symbol '+label);
    const displacement=symbols.get(label)+addend-(baseAddress+offset+4);integer(displacement,-0x80000000,0x7fffffff);view.setInt32(offset,displacement,true);
  }
  return bytes;
}

/** Optional checked IA-32 x87, SSE/SSE2 and atomic instructions. These encodings
 * do not change the compiler's x87 precision/rounding policy or enable fast math.
 * The caller is responsible for CPU feature support and x87 stack discipline.
 */
import {X86_REGISTERS,encodeX86RM as rm,emitX86Encoding as emit} from './x86-operands.js';
const own=(o,k)=>Object.hasOwn(o,k);
const stack=i=>{if(!Number.isInteger(i)||i<0||i>7)throw new Error('Invalid x87 stack register');return i;};
const xmm=name=>{if(typeof name!=='string'||!/^xmm[0-7]$/.test(name))throw new Error('Invalid IA-32 XMM register');return Number(name[3]);};
const gpr=(name,width=32)=>{const n=(width===8?X86_REGISTERS.byte:width===16?X86_REGISTERS.word:X86_REGISTERS.gpr).indexOf(name);if(n<0)throw new Error('Invalid x86 register');return n;};
const byte=n=>{if(!Number.isInteger(n)||n<0||n>255)throw new Error('Invalid x86 immediate byte');return n;};
const mem=(operand,widths)=>{if(operand?.kind!=='memory'||!widths.includes(operand.width))throw new Error('Invalid x86 memory width');return operand.width;};
function x87Memory(x,operand,forms) {
  const width=mem(operand,Object.keys(forms).map(Number)),[op,field]=forms[width];
  return emit(x,[op],rm(field,operand,width));
}
const floating={add:0,mul:1,sub:4,subr:5,div:6,divr:7};
function x87Arithmetic(x,name,operand) {
  if(!own(floating,name))throw new Error('Invalid x87 arithmetic operation');
  const field=floating[name];
  if(typeof operand==='number')return emit(x,[0xd8,0xc0+field*8+stack(operand)]);
  return x87Memory(x,operand,{32:[0xd8,field],64:[0xdc,field]});
}
const unary={abs:0xe1,chs:0xe0,sqrt:0xfa,round:0xfc,scale:0xfd,sin:0xfe,cos:0xff,sincos:0xfb,atan:0xf3,tan:0xf2,prem:0xf8,prem1:0xf5,yl2x:0xf1,yl2xp1:0xf9,'2xm1':0xf0,examine:0xe5};
const constants={one:0xe8,log2ten:0xe9,log2e:0xea,pi:0xeb,log10two:0xec,lntwo:0xed,zero:0xee};
function xmmRM(field,operand,width) {
  if(typeof operand==='string')return {bytes:[0xc0|(field<<3)|xmm(operand)]};
  return rm(field,operand,width);
}
// [mandatory prefix, opcode, memory width, optional store opcode].
const simd={};
for(const [suffix,prefix,width]of [['ss',0xf3,32],['sd',0xf2,64],['ps',null,128],['pd',0x66,128]]) {
  for(const [name,opcode]of Object.entries({add:0x58,mul:0x59,sub:0x5c,div:0x5e,sqrt:0x51,min:0x5d,max:0x5f}))simd[name+suffix]=[prefix,opcode,width];
}
Object.assign(simd,{
  movss:[0xf3,0x10,32,0x11],movsd:[0xf2,0x10,64,0x11],movups:[null,0x10,128,0x11],movupd:[0x66,0x10,128,0x11],
  movaps:[null,0x28,128,0x29],movapd:[0x66,0x28,128,0x29],movdqu:[0xf3,0x6f,128,0x7f],movdqa:[0x66,0x6f,128,0x7f],
  andps:[null,0x54,128],andnps:[null,0x55,128],orps:[null,0x56,128],xorps:[null,0x57,128],
  andpd:[0x66,0x54,128],andnpd:[0x66,0x55,128],orpd:[0x66,0x56,128],xorpd:[0x66,0x57,128],
  ucomiss:[null,0x2e,32],comiss:[null,0x2f,32],ucomisd:[0x66,0x2e,64],comisd:[0x66,0x2f,64],
  cvtss2sd:[0xf3,0x5a,32],cvtsd2ss:[0xf2,0x5a,64]
});
for(const [name,opcode]of Object.entries({paddb:0xfc,paddw:0xfd,paddd:0xfe,paddq:0xd4,psubb:0xf8,psubw:0xf9,psubd:0xfa,psubq:0xfb,pand:0xdb,pandn:0xdf,por:0xeb,pxor:0xef,pcmpeqb:0x74,pcmpeqw:0x75,pcmpeqd:0x76,pcmpgtb:0x64,pcmpgtw:0x65,pcmpgtd:0x66,pmullw:0xd5,pmuludq:0xf4,psllw:0xf1,pslld:0xf2,psllq:0xf3,psrlw:0xd1,psrld:0xd2,psrlq:0xd3,psraw:0xe1,psrad:0xe2}))simd[name]=[0x66,opcode,128];
for(const spec of Object.values(simd))Object.freeze(spec);Object.freeze(simd);
export const X86_SIMD_INSTRUCTIONS=Object.freeze(Object.keys(simd));
const opcodes=(prefix,opcode)=>prefix===null?[0x0f,opcode]:[prefix,0x0f,opcode];
export const x86ExtendedMethods={
  fld(operand){if(typeof operand==='number')return emit(this,[0xd9,0xc0+stack(operand)]);return x87Memory(this,operand,{32:[0xd9,0],64:[0xdd,0],80:[0xdb,5]});},
  fst(operand){if(typeof operand==='number')return emit(this,[0xdd,0xd0+stack(operand)]);return x87Memory(this,operand,{32:[0xd9,2],64:[0xdd,2]});},
  fstp(operand){if(typeof operand==='number')return emit(this,[0xdd,0xd8+stack(operand)]);return x87Memory(this,operand,{32:[0xd9,3],64:[0xdd,3],80:[0xdb,7]});},
  fild(operand){return x87Memory(this,operand,{16:[0xdf,0],32:[0xdb,0],64:[0xdf,5]});},
  fist(operand){return x87Memory(this,operand,{16:[0xdf,2],32:[0xdb,2]});},
  fistp(operand){return x87Memory(this,operand,{16:[0xdf,3],32:[0xdb,3],64:[0xdf,7]});},
  fxch(index=1){return emit(this,[0xd9,0xc8+stack(index)]);},
  fadd(operand){return x87Arithmetic(this,'add',operand);},fmul(operand){return x87Arithmetic(this,'mul',operand);},
  fsub(operand){return x87Arithmetic(this,'sub',operand);},fsubr(operand){return x87Arithmetic(this,'subr',operand);},
  fdiv(operand){return x87Arithmetic(this,'div',operand);},fdivr(operand){return x87Arithmetic(this,'divr',operand);},
  faddp(index=1){return emit(this,[0xde,0xc0+stack(index)]);},fmulp(index=1){return emit(this,[0xde,0xc8+stack(index)]);},
  fsubp(index=1){return emit(this,[0xde,0xe8+stack(index)]);},fsubrp(index=1){return emit(this,[0xde,0xe0+stack(index)]);},
  fdivp(index=1){return emit(this,[0xde,0xf8+stack(index)]);},fdivrp(index=1){return emit(this,[0xde,0xf0+stack(index)]);},
  fcompare(index=1,{unordered=true,pop=false}={}){if(typeof unordered!=='boolean'||typeof pop!=='boolean')throw new Error('Invalid x87 comparison options');return emit(this,[pop?0xdf:0xdb,(unordered?0xe8:0xf0)+stack(index)]);},
  x87Unary(name){if(!own(unary,name))throw new Error('Unknown x87 unary operation');return emit(this,[0xd9,unary[name]]);},
  fldConstant(name){if(!own(constants,name))throw new Error('Unknown x87 constant');return emit(this,[0xd9,constants[name]]);},
  fldcw(operand){return x87Memory(this,operand,{16:[0xd9,5]});},
  fnstcw(operand){return x87Memory(this,operand,{16:[0xd9,7]});},
  fnstsw(operand='ax'){if(operand==='ax')return emit(this,[0xdf,0xe0]);return x87Memory(this,operand,{16:[0xdd,7]});},
  fwait(){return emit(this,[0x9b]);},fninit(){return emit(this,[0xdb,0xe3]);},
  sse(name,dst,src) {
    if(!own(simd,name))throw new Error('Unsupported SSE/SSE2 instruction: '+name);
    const [prefix,opcode,width,store]=simd[name];
    if(dst?.kind==='memory'){
      if(store===undefined)throw new Error('SSE instruction has no memory destination');
      return emit(this,opcodes(prefix,store),rm(xmm(src),dst,width));
    }
    return emit(this,opcodes(prefix,opcode),xmmRM(xmm(dst),src,width));
  },
  /** Packed memory operations may require 16-byte alignment even without MOVDQA.
   * Use an explicit, distinct scratch register to support any memory alignment.
   * Validate both plans before emitting either instruction; no hidden clobbers.
   */
  sseUnaligned(name,dst,src,scratch) {
    if(!own(simd,name)||simd[name][2]!==128||simd[name][3]!==undefined)throw new Error('Unaligned SSE helper requires a packed arithmetic/logical instruction');
    mem(src,[128]);const target=xmm(dst),temporary=xmm(scratch);
    if(target===temporary)throw new Error('Unaligned SSE scratch must differ from destination');
    const load=rm(temporary,src,128),operation=xmmRM(target,scratch,128),[prefix,opcode]=simd[name];
    emit(this,opcodes(0xf3,0x6f),load);
    return emit(this,opcodes(prefix,opcode),operation);
  },
  movd(dst,src) {
    if(typeof dst==='string'&&/^xmm/.test(dst))return emit(this,[0x66,0x0f,0x6e],rm(xmm(dst),src,32));
    return emit(this,[0x66,0x0f,0x7e],rm(xmm(src),dst,32));
  },
  movq(dst,src) {
    if(dst?.kind==='memory')return emit(this,[0x66,0x0f,0xd6],rm(xmm(src),dst,64));
    return emit(this,[0xf3,0x0f,0x7e],xmmRM(xmm(dst),src,64));
  },
  ldmxcsr(src){mem(src,[32]);return emit(this,[0x0f,0xae],rm(2,src,32));},
  stmxcsr(dst){mem(dst,[32]);return emit(this,[0x0f,0xae],rm(3,dst,32));},
  sseCompare(kind,dst,src,predicate) {
    const specs={ss:[0xf3,32],sd:[0xf2,64],ps:[null,128],pd:[0x66,128]};
    if(!own(specs,kind)||!Number.isInteger(predicate)||predicate<0||predicate>7)throw new Error('Invalid legacy SSE comparison');
    const [prefix,width]=specs[kind];return emit(this,opcodes(prefix,0xc2),xmmRM(xmm(dst),src,width),[predicate]);
  },
  sseConvert(name,dst,src) {
    if(['cvtsi2ss','cvtsi2sd'].includes(name))return emit(this,opcodes(name==='cvtsi2ss'?0xf3:0xf2,0x2a),rm(xmm(dst),src,32));
    const specs={cvtss2si:[0xf3,0x2d,32],cvttss2si:[0xf3,0x2c,32],cvtsd2si:[0xf2,0x2d,64],cvttsd2si:[0xf2,0x2c,64]};
    if(!own(specs,name))throw new Error('Unsupported SSE scalar conversion');const [prefix,op,width]=specs[name];
    return emit(this,opcodes(prefix,op),xmmRM(gpr(dst),src,width));
  },
  sseShift(name,dst,count) {
    const specs={psrlw:[0x71,2],psraw:[0x71,4],psllw:[0x71,6],psrld:[0x72,2],psrad:[0x72,4],pslld:[0x72,6],psrlq:[0x73,2],psllq:[0x73,6],psrldq:[0x73,3],pslldq:[0x73,7]};
    if(!own(specs,name))throw new Error('Unsupported SSE2 immediate shift');const [op,field]=specs[name];
    return emit(this,[0x66,0x0f,op],{bytes:[0xc0|(field<<3)|xmm(dst)]},[byte(count)]);
  },
  xchg(dst,src) {
    const width=dst?.kind==='memory'?dst.width:X86_REGISTERS.byte.includes(dst)?8:X86_REGISTERS.word.includes(dst)?16:32;
    if(![8,16,32].includes(width))throw new Error('Invalid XCHG width');
    return emit(this,[...(width===16?[0x66]:[]),width===8?0x86:0x87],rm(gpr(src,width),dst,width));
  },
  atomic(name,dst,src) {
    const width=mem(dst,[8,16,32]);if(!['xadd','cmpxchg'].includes(name))throw new Error('Unsupported locked instruction');
    const opcode=name==='xadd'?0xc0:0xb0;
    return emit(this,[0xf0,...(width===16?[0x66]:[]),0x0f,opcode+(width===8?0:1)],rm(gpr(src,width),dst,width));
  },
  cmpxchg8b(dst){mem(dst,[64]);return emit(this,[0xf0,0x0f,0xc7],rm(1,dst,64));}
};

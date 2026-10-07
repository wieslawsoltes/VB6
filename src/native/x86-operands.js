/** Checked IA-32 operands and instruction encodings. No host/native dependencies.
 * Raw X86.emit remains available for instructions not described by this API.
 * Memory operands are explicit: mem32({base:'ebp', displacement:-4}).
 */
const GPR = Object.freeze(['eax','ecx','edx','ebx','esp','ebp','esi','edi']);
const WORD = Object.freeze(['ax','cx','dx','bx','sp','bp','si','di']);
const BYTE = Object.freeze(['al','cl','dl','bl','ah','ch','dh','bh']);
export const X86_REGISTERS = Object.freeze({gpr:GPR,word:WORD,byte:BYTE});
export const X86_CONDITIONS = Object.freeze({o:0,no:1,b:2,c:2,nae:2,ae:3,nb:3,nc:3,e:4,z:4,ne:5,nz:5,be:6,na:6,a:7,nbe:7,s:8,ns:9,p:10,pe:10,np:11,po:11,l:12,nge:12,ge:13,nl:13,le:14,ng:14,g:15,nle:15});
const own=(o,k)=>Object.hasOwn(o,k);
function integer(value,min,max,name) {
  if(!Number.isInteger(value)||value<min||value>max)throw new Error('Invalid x86 '+name);
  return value;
}
function register(name,width=32) {
  const list=width===32?GPR:width===16?WORD:width===8?BYTE:null;
  const n=list?.indexOf(name);
  if(n===undefined||n<0)throw new Error('Invalid x86 '+width+'-bit register: '+name);
  return n;
}
function widthOf(operand) {
  if(typeof operand==='string') {
    if(GPR.includes(operand))return 32;
    if(WORD.includes(operand))return 16;
    if(BYTE.includes(operand))return 8;
  }
  return operand?.kind==='memory'?operand.width:null;
}
export function x86Memory(width, options={}) {
  if(![8,16,32,64,80,128].includes(width)||!options||typeof options!=='object'||Array.isArray(options))throw new Error('Invalid x86 memory operand');
  for(const key of Object.keys(options))if(!['base','index','scale','displacement','label'].includes(key))throw new Error('Unknown x86 memory field: '+key);
  const {base=null,index=null,scale=1,displacement=0,label=null}=options;
  if(base!==null)register(base);
  if(index!==null){register(index);if(index==='esp')throw new Error('ESP cannot be an x86 SIB index');}
  if(![1,2,4,8].includes(scale)||(index===null&&scale!==1))throw new Error('Invalid x86 index scale');
  integer(displacement,-2147483648,4294967295,'displacement');
  if((base!==null||index!==null)&&displacement>2147483647)throw new Error('Invalid signed x86 displacement');
  if(label!==null&&(typeof label!=='string'||!label))throw new Error('Invalid x86 memory label');
  return Object.freeze({kind:'memory',width,base,index,scale,displacement,label});
}
export const mem8=options=>x86Memory(8,options);
export const mem16=options=>x86Memory(16,options);
export const mem32=options=>x86Memory(32,options);
export const mem64=options=>x86Memory(64,options);
export const mem80=options=>x86Memory(80,options);
export const mem128=options=>x86Memory(128,options);
const dword=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
const word=n=>[n&255,(n>>>8)&255];
function immediate(n,width) {
  integer(n,-(2**(width-1)),2**width-1,'immediate');
  return width===8?[n&255]:width===16?word(n):dword(n);
}
function condition(name) {
  if(!own(X86_CONDITIONS,name))throw new Error('Unknown x86 condition: '+name);
  return X86_CONDITIONS[name];
}
/** Return an encoding plan first, so malformed operands never partly emit code. */
function rm(field,operand,width) {
  integer(field,0,7,'ModR/M register');
  if(typeof operand==='string')return {bytes:[0xc0|(field<<3)|register(operand,width)]};
  if(operand?.kind!=='memory'||operand.width!==width)throw new Error('x86 operand width mismatch');
  const {base,index,scale,displacement:d,label}=x86Memory(width,{
    base:operand.base,index:operand.index,scale:operand.scale,displacement:operand.displacement,label:operand.label
  });
  const b=base===null?5:register(base),i=index===null?4:register(index),sib=index!==null||base==='esp';
  const mod=base===null?0:label!==null?2:d===0&&base!=='ebp'?0:d>=-128&&d<=127?1:2;
  const bytes=[(mod<<6)|(field<<3)|(sib?4:b)];
  if(sib)bytes.push(([1,2,4,8].indexOf(scale)<<6)|(i<<3)|b);
  let relocation=null;
  if(base===null||mod===2){if(label!==null)relocation={at:bytes.length,label,addend:d};bytes.push(...dword(label!==null?0:d));}
  else if(mod===1)bytes.push(d&255);
  return {bytes,relocation};
}
function output(x,opcodes,encoding={bytes:[]},suffix=[]) {
  const start=x.s.length,bytes=[...opcodes,...encoding.bytes,...suffix];
  x.emit(...bytes);
  if(encoding.relocation){const r=encoding.relocation;x.s.fixups.push({offset:start+opcodes.length+r.at,label:r.label,kind:'va',addend:r.addend});}
  return x;
}
const prefix=width=>width===16?[0x66]:[];
const arithmetic={add:[0x00,0],or:[0x08,1],adc:[0x10,2],sbb:[0x18,3],and:[0x20,4],sub:[0x28,5],xor:[0x30,6],cmp:[0x38,7]};
function binary(x,name,dst,src) {
  const spec=own(arithmetic,name)?arithmetic[name]:null,width=widthOf(dst);
  if(!spec||![8,16,32].includes(width))throw new Error('Invalid x86 arithmetic operand');
  if(typeof src==='number') {
    const full=immediate(src,width),signed=src|0,short=width!==8&&signed>=-128&&signed<=127&&(width===32||src>=-128&&src<=127);
    return output(x,[...prefix(width),width===8?0x80:short?0x83:0x81],rm(spec[1],dst,width),short?[signed&255]:full);
  }
  if(widthOf(src)!==width)throw new Error('x86 arithmetic width mismatch');
  if(typeof dst==='string')return output(x,[...prefix(width),spec[0]+(width===8?2:3)],rm(register(dst,width),src,width));
  return output(x,[...prefix(width),spec[0]+(width===8?0:1)],rm(register(src,width),dst,width));
}
function unary(x,extension,operand) {
  const width=widthOf(operand);if(![8,16,32].includes(width))throw new Error('Invalid x86 unary operand');
  return output(x,[...prefix(width),width===8?0xf6:0xf7],rm(extension,operand,width));
}
export const x86OperandMethods={
  mov(dst,src) {
    const width=widthOf(dst);if(![8,16,32].includes(width))throw new Error('Invalid x86 MOV destination');
    if(typeof src==='number'){
      const bytes=immediate(src,width);
      if(typeof dst==='string')return output(this,[...prefix(width),(width===8?0xb0:0xb8)+register(dst,width)],undefined,bytes);
      return output(this,[...prefix(width),width===8?0xc6:0xc7],rm(0,dst,width),bytes);
    }
    if(widthOf(src)!==width)throw new Error('x86 MOV width mismatch');
    if(typeof dst==='string')return output(this,[...prefix(width),width===8?0x8a:0x8b],rm(register(dst,width),src,width));
    return output(this,[...prefix(width),width===8?0x88:0x89],rm(register(src,width),dst,width));
  },
  lea(dst,src) {register(dst);if(src?.kind!=='memory')throw new Error('LEA requires memory');return output(this,[0x8d],rm(register(dst),src,src.width));},
  movzx(dst,src) {const w=widthOf(src);if(![8,16].includes(w))throw new Error('MOVZX requires byte/word source');return output(this,[0x0f,w===8?0xb6:0xb7],rm(register(dst),src,w));},
  movsx(dst,src) {const w=widthOf(src);if(![8,16].includes(w))throw new Error('MOVSX requires byte/word source');return output(this,[0x0f,w===8?0xbe:0xbf],rm(register(dst),src,w));},
  alu(name,dst,src) {return binary(this,name,dst,src);},
  add(dst,src){return binary(this,'add',dst,src);},sub(dst,src){return binary(this,'sub',dst,src);},
  adc(dst,src){return binary(this,'adc',dst,src);},sbb(dst,src){return binary(this,'sbb',dst,src);},
  and(dst,src){return binary(this,'and',dst,src);},or(dst,src){return binary(this,'or',dst,src);},
  xor(dst,src){return binary(this,'xor',dst,src);},cmp(dst,src){return binary(this,'cmp',dst,src);},
  testOperand(dst,src) {
    const width=widthOf(dst);if(![8,16,32].includes(width))throw new Error('Invalid x86 TEST destination');
    if(typeof src==='number')return output(this,[...prefix(width),width===8?0xf6:0xf7],rm(0,dst,width),immediate(src,width));
    return output(this,[...prefix(width),width===8?0x84:0x85],rm(register(src,width),dst,width));
  },
  neg(operand){return unary(this,3,operand);},not(operand){return unary(this,2,operand);},
  mul(operand){return unary(this,4,operand);},div(operand){return unary(this,6,operand);},idiv(operand){return unary(this,7,operand);},
  imul(dst,src,imm) {
    if(src===undefined)return unary(this,5,dst);
    const width=widthOf(dst);if(![16,32].includes(width))throw new Error('IMUL requires word/dword destination');
    const enc=rm(register(dst,width),src,width);
    if(imm===undefined)return output(this,[...prefix(width),0x0f,0xaf],enc);
    const full=immediate(imm,width),n=imm|0,short=n>=-128&&n<=127&&(width===32||imm>=-128&&imm<=127);
    return output(this,[...prefix(width),short?0x6b:0x69],enc,short?[n&255]:full);
  },
  shift(name,dst,count) {
    const groups={rol:0,ror:1,rcl:2, rcr:3,shl:4,sal:4,shr:5,sar:7},width=widthOf(dst);
    if(!own(groups,name)||![8,16,32].includes(width))throw new Error('Invalid x86 shift');
    if(count!=='cl')integer(count,0,255,'shift count');
    const opcode=count==='cl'?(width===8?0xd2:0xd3):count===1?(width===8?0xd0:0xd1):(width===8?0xc0:0xc1);
    return output(this,[...prefix(width),opcode],rm(groups[name],dst,width),count==='cl'||count===1?[]:[count]);
  },
  /** INC/DEC intentionally preserve CF; use ADD/SUB when carry must change. */
  inc(dst){const w=widthOf(dst);if(![8,16,32].includes(w))throw new Error('Invalid INC width');return output(this,[...prefix(w),w===8?0xfe:0xff],rm(0,dst,w));},
  dec(dst){const w=widthOf(dst);if(![8,16,32].includes(w))throw new Error('Invalid DEC width');return output(this,[...prefix(w),w===8?0xfe:0xff],rm(1,dst,w));},
  bswap(dst){return output(this,[0x0f,0xc8+register(dst)]);},
  bsf(dst,src){const w=widthOf(dst);if(![16,32].includes(w))throw new Error('Invalid BSF width');return output(this,[...prefix(w),0x0f,0xbc],rm(register(dst,w),src,w));},
  bsr(dst,src){const w=widthOf(dst);if(![16,32].includes(w))throw new Error('Invalid BSR width');return output(this,[...prefix(w),0x0f,0xbd],rm(register(dst,w),src,w));},
  bit(name,dst,index) {
    const groups={bt:[0xa3,4],bts:[0xab,5],btr:[0xb3,6],btc:[0xbb,7]},w=widthOf(dst);
    if(!own(groups,name)||![16,32].includes(w))throw new Error('Invalid bit-test operand');
    const [opcode,extension]=groups[name];
    if(typeof index==='number'){integer(index,0,255,'bit index');return output(this,[...prefix(w),0x0f,0xba],rm(extension,dst,w),[index]);}
    return output(this,[...prefix(w),0x0f,opcode],rm(register(index,w),dst,w));
  },
  doubleShift(name,dst,src,count) {
    const w=widthOf(dst);if(!['shld','shrd'].includes(name)||![16,32].includes(w))throw new Error('Invalid double shift');
    if(count!=='cl')integer(count,0,255,'shift count');
    return output(this,[...prefix(w),0x0f,(name==='shld'?0xa4:0xac)+(count==='cl'?1:0)],rm(register(src,w),dst,w),count==='cl'?[]:[count]);
  },
  setcc(name,dst) {return output(this,[0x0f,0x90+condition(name)],rm(0,dst,8));},
  cmovcc(name,dst,src) {const width=widthOf(dst);if(![16,32].includes(width))throw new Error('CMOV requires word/dword operands');return output(this,[...prefix(width),0x0f,0x40+condition(name)],rm(register(dst,width),src,width));},
  pushOperand(src) {
    if(typeof src==='number'){const full=immediate(src,32),n=src|0;return output(this,[n>=-128&&n<=127?0x6a:0x68],undefined,n>=-128&&n<=127?[n&255]:full);}
    if(typeof src==='string')return output(this,[0x50+register(src)]);
    return output(this,[0xff],rm(6,src,32));
  },
  popOperand(dst) {if(typeof dst==='string')return output(this,[0x58+register(dst)]);return output(this,[0x8f],rm(0,dst,32));},
  callIndirect(operand) {return output(this,[0xff],rm(2,operand,32));},
  jumpIndirect(operand) {return output(this,[0xff],rm(4,operand,32));},
  ret(bytes=0) {integer(bytes,0,65535,'return cleanup');return bytes?output(this,[0xc2],undefined,word(bytes)):output(this,[0xc3]);},
  nop(count=1) {integer(count,0,65536,'NOP count');for(let i=0;i<count;i++)this.emit(0x90);return this;},
  cdq(){return this.emit(0x99);},cld(){return this.emit(0xfc);},
  repMove(width=8) {if(![8,16,32].includes(width))throw new Error('Invalid MOVS width');return this.emit(0xf3,...prefix(width),width===8?0xa4:0xa5);},
  repStore(width=8) {if(![8,16,32].includes(width))throw new Error('Invalid STOS width');return this.emit(0xf3,...prefix(width),width===8?0xaa:0xab);},
  /** cdecl is explicit; existing api() remains stdcall with unchanged EAX effects. */
  cdecl(dll,name,args=[]) {
    if(!Array.isArray(args)||args.length>16383)throw new Error('Invalid cdecl argument area');
    this.api(dll,name,args);
    // LEA preserves the callee's flags and EAX/EDX result registers.
    if(args.length)this.lea('esp',mem32({base:'esp',displacement:args.length*4}));
    return this;
  }
};

// Internal shared encoding plans for the checked x87/SSE2/atomic extension.
export const encodeX86RM=rm;
export const emitX86Encoding=output;

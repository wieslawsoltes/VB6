/** Differential instruction decoding against independently assembled GNU binutils
 * output. Equivalent alternate opcodes are allowed, but every decoded operand,
 * width, flat-32 addressing expression and immediate must be identical.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {BinarySection,PE32Image} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {x86Memory,X86_REGISTERS} from '../src/native/x86-operands.js';
export function encodingCases(){
  const cases=[],add=(source,encode)=>cases.push({source,encode});
  const word={8:'BYTE',16:'WORD',32:'DWORD',64:'QWORD',80:'TBYTE',128:'XMMWORD'};
  const m=(width,base='ebp',displacement=-20,index=null,scale=1)=>x86Memory(width,{base,index,scale,displacement});
  const ms=(width,base='ebp',displacement=-20,index=null,scale=1)=>`${word[width]} PTR [${base??''}${index?(base?'+':'')+index+(scale===1?'':'*'+scale):''}${displacement<0?displacement:'+'+displacement}]`;
  for(const [width,regs]of [[8,X86_REGISTERS.byte],[16,X86_REGISTERS.word],[32,X86_REGISTERS.gpr]])for(const dst of regs)for(const src of regs){
    add(`mov ${dst},${src}`,x=>x.mov(dst,src));
    for(const op of ['add','sub','adc','sbb','and','or','xor','cmp'])add(`${op} ${dst},${src}`,x=>x[op](dst,src));
    add(`xchg ${dst},${src}`,x=>x.xchg(dst,src));
  }
  for(const base of [null,...X86_REGISTERS.gpr])for(const index of [null,'ecx','ebp','edi'])for(const scale of index?[1,2,4,8]:[1])for(const displacement of [-129,-128,0,127,128]){
    const operand=m(32,base,displacement,index,scale),text=ms(32,base,displacement,index,scale);
    add(`mov edx,${text}`,x=>x.mov('edx',operand));add(`lea esi,${text.replace('DWORD PTR ','')}`,x=>x.lea('esi',operand));
  }
  for(const width of [8,16,32]){
    const reg=width===8?'dl':width===16?'cx':'edx',operand=m(width),text=ms(width);
    for(const op of ['add','sub','adc','sbb','and','or','xor','cmp'])for(const value of [-128,-1,0,1,127,128])add(`${op} ${text},${value}`,x=>x[op](operand,value));
    for(const op of ['mov','testOperand'])add(`${op==='mov'?'mov':'test'} ${text},${reg}`,x=>x[op](operand,reg));
    for(const op of ['neg','not','mul','div','idiv'])add(`${op} ${text}`,x=>x[op](operand));
    for(const op of ['rol','ror','rcl','rcr','shl','shr','sar'])for(const count of [0,1,8,31,'cl'])add(`${op} ${text},${count}`,x=>x.shift(op,operand,count));
    for(const name of ['xadd','cmpxchg'])add(`lock ${name} ${text},${reg}`,x=>x.atomic(name,operand,reg));
  }
  for(const width of [8,16])for(const name of ['movsx','movzx'])add(`${name} edx,${ms(width)}`,x=>x[name]('edx',m(width)));
  for(const name of ['fld','fst','fstp'])for(const width of name==='fst'?[32,64]:[32,64,80])add(`${name} ${ms(width)}`,x=>x[name](m(width)));
  for(const name of ['fild','fist','fistp'])for(const width of name==='fist'?[16,32]:[16,32,64])add(`${name} ${ms(width)}`,x=>x[name](m(width)));
  for(const name of ['fadd','fmul','fsub','fsubr','fdiv','fdivr'])for(const width of [32,64])add(`${name} ${ms(width)}`,x=>x[name](m(width)));
  for(let i=0;i<8;i++){
    for(const name of ['fld','fst','fstp','fxch'])add(`${name} st(${i})`,x=>x[name](i));
    for(const name of ['fadd','fmul','fsub','fsubr','fdiv','fdivr'])add(`${name} st,st(${i})`,x=>x[name](i));
    for(const name of ['faddp','fmulp','fsubp','fsubrp','fdivp','fdivrp'])add(`${name} st(${i}),st`,x=>x[name](i));
    for(const unordered of [false,true])for(const pop of [false,true])add(`${unordered?'fucomi':'fcomi'}${pop?'p':''} st,st(${i})`,x=>x.fcompare(i,{unordered,pop}));
  }
  for(const name of ['fldcw','fnstcw','fnstsw'])add(`${name} ${ms(16)}`,x=>x[name](m(16)));
  add('fnstsw ax',x=>x.fnstsw());add('fninit',x=>x.fninit());add('fwait',x=>x.fwait());
  for(const [name,asm]of Object.entries({abs:'fabs',chs:'fchs',sqrt:'fsqrt',round:'frndint',scale:'fscale',sin:'fsin',cos:'fcos',sincos:'fsincos',atan:'fpatan',tan:'fptan',prem:'fprem',prem1:'fprem1',yl2x:'fyl2x',yl2xp1:'fyl2xp1','2xm1':'f2xm1',examine:'fxam'}))add(asm,x=>x.x87Unary(name));
  for(const [name,asm]of Object.entries({one:'fld1',log2ten:'fldl2t',log2e:'fldl2e',pi:'fldpi',log10two:'fldlg2',lntwo:'fldln2',zero:'fldz'}))add(asm,x=>x.fldConstant(name));
  for(const [suffix,width]of [['ss',32],['sd',64],['ps',128],['pd',128]])for(const op of ['add','mul','sub','div','sqrt','min','max'])for(const src of ['xmm0','xmm7',m(width)])add(`${op+suffix} xmm3,${typeof src==='string'?src:ms(width)}`,x=>x.sse(op+suffix,'xmm3',src));
  for(const [op,width]of [['movss',32],['movsd',64],['movups',128],['movupd',128],['movaps',128],['movapd',128],['movdqu',128],['movdqa',128]]){
    add(`${op} xmm3,${ms(width)}`,x=>x.sse(op,'xmm3',m(width)));add(`${op} ${ms(width)},xmm6`,x=>x.sse(op,m(width),'xmm6'));add(`${op} xmm2,xmm7`,x=>x.sse(op,'xmm2','xmm7'));
  }
  for(const op of ['andps','andnps','orps','xorps','andpd','andnpd','orpd','xorpd','paddb','paddw','paddd','paddq','psubb','psubw','psubd','psubq','pand','pandn','por','pxor','pcmpeqb','pcmpeqw','pcmpeqd','pcmpgtb','pcmpgtw','pcmpgtd','pmullw','pmuludq','psllw','pslld','psllq','psrlw','psrld','psrlq','psraw','psrad'])add(`${op} xmm4,${ms(128)}`,x=>x.sse(op,'xmm4',m(128)));
  for(const [op,width]of [['ucomiss',32],['comiss',32],['ucomisd',64],['comisd',64],['cvtss2sd',32],['cvtsd2ss',64]])add(`${op} xmm5,${ms(width)}`,x=>x.sse(op,'xmm5',m(width)));
  for(const [kind,width]of [['ss',32],['sd',64],['ps',128],['pd',128]])for(let i=0;i<8;i++)add(`cmp${kind} xmm3,${ms(width)},${i}`,x=>x.sseCompare(kind,'xmm3',m(width),i));
  for(const name of ['cvtsi2ss','cvtsi2sd']){add(`${name} xmm6,edx`,x=>x.sseConvert(name,'xmm6','edx'));add(`${name} xmm6,${ms(32)}`,x=>x.sseConvert(name,'xmm6',m(32)));}
  for(const name of ['cvtss2si','cvttss2si','cvtsd2si','cvttsd2si']){const width=name.includes('ss')?32:64;add(`${name} edi,xmm6`,x=>x.sseConvert(name,'edi','xmm6'));add(`${name} edi,${ms(width)}`,x=>x.sseConvert(name,'edi',m(width)));}
  for(const name of ['psrlw','psraw','psllw','psrld','psrad','pslld','psrlq','psllq','psrldq','pslldq'])for(const count of [0,1,16,255])add(`${name} xmm6,${count}`,x=>x.sseShift(name,'xmm6',count));
  add(`lock cmpxchg8b ${ms(64)}`,x=>x.cmpxchg8b(m(64)));
  for(const width of [8,16,32])for(const name of ['inc','dec'])add(`${name} ${ms(width)}`,x=>x[name](m(width)));
  for(const reg of X86_REGISTERS.gpr)add(`bswap ${reg}`,x=>x.bswap(reg));
  for(const width of [16,32]){
    const reg=width===16?'dx':'edx';
    for(const name of ['bsf','bsr'])add(`${name} ${reg},${ms(width)}`,x=>x[name](reg,m(width)));
    for(const name of ['bt','bts','btr','btc'])for(const index of [0,15,31,255,reg])add(`${name} ${ms(width)},${index}`,x=>x.bit(name,m(width),index));
    for(const name of ['shld','shrd'])for(const count of [0,1,31,'cl'])add(`${name} ${ms(width)},${reg},${count}`,x=>x.doubleShift(name,m(width),reg,count));
  }
  for(const name of ['ldmxcsr','stmxcsr'])add(`${name} ${ms(32)}`,x=>x[name](m(32)));
  add('movd xmm3,edx',x=>x.movd('xmm3','edx'));add('movd edx,xmm3',x=>x.movd('edx','xmm3'));
  add(`movd xmm7,${ms(32)}`,x=>x.movd('xmm7',m(32)));add(`movd ${ms(32)},xmm7`,x=>x.movd(m(32),'xmm7'));
  add('movq xmm2,xmm7',x=>x.movq('xmm2','xmm7'));add(`movq xmm2,${ms(64)}`,x=>x.movq('xmm2',m(64)));add(`movq ${ms(64)},xmm2`,x=>x.movq(m(64),'xmm2'));
  return cases;
}
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024});if(result.error||result.status!==0)throw new Error(`${command} failed: ${result.error?.message||result.stderr}`);return result.stdout;}
function instructions(file){return run('objdump',['-D','-b','binary','-m','i386','-M','intel','-w','--no-show-raw-insn',file]).split('\n').map(line=>line.match(/^\s*[0-9a-f]+:\s+(.+)$/)?.[1]?.trim().replace(/\s+/g,' ')).filter(Boolean);}
export function verifyX86Encodings(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-x86-')),cases=encodingCases();
  try {
    const source=path.join(directory,'reference.s'),object=path.join(directory,'reference.o'),reference=path.join(directory,'reference.bin'),actual=path.join(directory,'actual.bin');
    fs.writeFileSync(source,'.intel_syntax noprefix\n.code32\n.text\n'+cases.flatMap(c=>[c.source,'nop']).join('\n')+'\n');
    const section=new BinarySection('.text',0x60000020),x=new X86(section,new PE32Image());for(const c of cases){c.encode(x);x.nop();}fs.writeFileSync(actual,Uint8Array.from(section.bytes));
    run('as',['--32','-o',object,source]);run('objcopy',['-O','binary','-j','.text',object,reference]);
    const decode=file=>{const decoded=instructions(file);if(decoded.length!==cases.length*2||decoded.some((s,i)=>i%2===1&&s!=='nop'))throw new Error('Instruction/sentinel boundary mismatch');return decoded.filter((_,i)=>i%2===0).map(text=>{text=text.replace(/\*1(?=[+\-\]])/g,'').replace(/\+0x0\]/g,']');const match=text.match(/^xchg (\w+),(\w+)$/);return match?(match[1]===match[2]?'nop':'xchg '+match.slice(1).sort().join(',')):text;});};
    const want=decode(reference),got=decode(actual),errors=[];
    if(want.length!==cases.length||got.length!==cases.length)throw new Error(`Decoded instruction count mismatch: ${cases.length} expected, GNU ${want.length}, native ${got.length}`);
    for(let i=0;i<cases.length;i++)if(want[i]!==got[i])errors.push({source:cases[i].source,gnu:want[i],native:got[i]});
    if(errors.length)throw new Error(`x86 differential mismatches: ${errors.length}\n`+JSON.stringify(errors.slice(0,20),null,2));
    return {instructions:cases.length,bytes:section.length,reference:'GNU as + objdump',ok:true};
  } finally{fs.rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(verifyX86Encodings(),null,2));

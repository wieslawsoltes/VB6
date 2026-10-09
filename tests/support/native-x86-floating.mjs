/** Test-only x87 extension for the backend's binary32/binary64 materialization
 * paths. This does not emulate Windows or certify arbitrary x87 extended-
 * precision programs. Unsupported instructions fail; control/save/stack state
 * and callee ABI are independently checked with the existing IA-32 machine. */
import assert from 'node:assert/strict';
import {NativeX86Machine} from './native-x86-machine.mjs';
export function roundEven(value){const low=Math.floor(value),fraction=value-low;return fraction<0.5?low:fraction>0.5?low+1:low%2===0?low:low+1;}
export class NativeX86FloatingMachine extends NativeX86Machine{
 constructor(linked){super(linked);this.fp=[];this.fpControl=0x027f;this.fpStatus=0;
  this.hook('oleaut32.dll','VarI4FromR8',3,([low,high,out])=>{
   const bytes=new DataView(new ArrayBuffer(8));bytes.setUint32(0,low,true);bytes.setUint32(4,high,true);const value=roundEven(bytes.getFloat64(0,true));
   if(!Number.isFinite(value)||value< -2147483648||value>2147483647)return 0x8002000a;
   this.memory.write(out,value);return 0;
  });
 }
 readFP(address,width=64){const r=this.memory.region(address,width/8),v=new DataView(r.bytes.buffer);return width===64?v.getFloat64(address-r.address,true):v.getFloat32(address-r.address,true);}
 writeFP(address,value,width=64){const r=this.memory.region(address,width/8,true),v=new DataView(r.bytes.buffer);if(width===64)v.setFloat64(address-r.address,value,true);else v.setFloat32(address-r.address,value,true);}
 pushFP(value){assert.ok(this.fp.length<8,'x87 stack overflow');this.fp.unshift(value);}
 popFP(){assert.ok(this.fp.length,'x87 stack underflow');return this.fp.shift();}
 invoke(name,args=[]){const before=[...this.fp],cw=this.fpControl;const result=super.invoke(name,args);assert.deepEqual(this.fp,before,'no escaped x87 expression values');assert.equal(this.fpControl,cw,'restore x87 control word');return result;}
 step(){
  if(this.hooks.has(this.ip))return super.step();
  const op=this.memory.read(this.ip,8);
  if(op===0x9b){this.ip++;return;}
  if(op===0x9e){this.ip++;const ah=(this.get('eax')>>>8)&255;this.flags.c=!!(ah&1);this.flags.p=!!(ah&4);this.flags.z=!!(ah&64);this.flags.s=!!(ah&128);return;}
  if(![0xd9,0xdb,0xdd,0xde,0xdf].includes(op))return super.step();
  const start=this.ip;this.ip++;const second=this.memory.read(this.ip,8);
  if(op===0xdb&&second===0xe2){this.ip++;this.fpStatus=0;return;}
  if(op===0xdf&&second===0xe0){this.ip++;this.set('eax',(this.get('eax')&0xffff0000)|this.fpStatus);return;}
  if(op===0xde&&second===0xd9){this.ip++;const a=this.popFP(),b=this.popFP();this.fpStatus=Number.isNaN(a)||Number.isNaN(b)?0x4500:a<b?0x100:a===b?0x4000:0;return;}
  if(op===0xde&&[0xc1,0xc9,0xe9,0xf9].includes(second)){
   this.ip++;const right=this.popFP(),left=this.popFP();this.pushFP(second===0xc1?left+right:second===0xc9?left*right:second===0xe9?left-right:left/right);return;
  }
  if(op===0xd9&&[0xe0,0xe1,0xfa,0xfc].includes(second)){
   this.ip++;const value=this.popFP(),round=(this.fpControl>>>10)&3;
   this.pushFP(second===0xe0?-value:second===0xe1?Math.abs(value):second===0xfa?Math.sqrt(value):[roundEven,Math.floor,Math.ceil,Math.trunc][round](value));return;
  }
  assert.ok(second<0xc0,'unsupported x87 register opcode at '+start.toString(16));
  const {reg,operand}=this.rm();assert.notEqual(operand.address,undefined);const address=operand.address;
  if(op===0xd9&&reg===7){this.memory.write(address,this.fpControl,16);return;}
  if(op===0xd9&&reg===5){this.fpControl=this.memory.read(address,16);return;}
  if(op===0xdb&&reg===0){this.pushFP(this.memory.read(address)|0);return;}
  if((op===0xdd||op===0xd9)&&reg===0){this.pushFP(this.readFP(address,op===0xdd?64:32));return;}
  if((op===0xdd||op===0xd9)&&[2,3].includes(reg)){
   assert.ok(this.fp.length);this.writeFP(address,this.fp[0],op===0xdd?64:32);if(reg===3)this.popFP();return;
  }
  throw new Error('unsupported x87 memory opcode at '+start.toString(16));
 }
}

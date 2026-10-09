import test from 'node:test';
import assert from 'node:assert/strict';
import {X86} from '../src/native/x86.js';
import {BinarySection,PE32Image} from '../src/native/pe32.js';
import {nativeRecordStringMethods} from '../src/native/record-strings.js';
import {nativeStringInteropMethods} from '../src/native/string-interop.js';
const make=()=>{const section=new BinarySection('.text',0),x=new X86(section,new PE32Image());return {section,x};};
const hex=section=>Buffer.from(section.bytes).toString('hex');
for(const length of [5,260])test(`inline read and write retain their EAX field pointer while pushing length ${length}`,()=>{
 const lengthPush=length===5?'6a05':'6804010000';
 for(const method of ['loadInlineRecordString','storeInlineRecordString']){
  const {section,x}=make(),c={x,address:()=>x.value(0x12345678),ownString(){}};
  nativeRecordStringMethods[method].call(c,{fixedLength:length});
  const expected=(method==='storeInlineRecordString'?'50':'')+'b878563412'+lengthPush+'50';
  assert.ok(hex(section).startsWith(expected),`${method}: ${hex(section)}`);
 }
});
test('inline String Declare copyback retains the captured destination instead of replacing it with the length',()=>{
 const {section,x}=make(),c={x,temporaryString:()=>({}),rawStorageAddress:()=>x.value(0x12345678),nativeConvertString:()=>x.value(0x76543210)};
 nativeStringInteropMethods.nativeStringCopyBack.call(c,{owner:{},destination:{},fixedLength:5,inline:true});
 assert.equal(hex(section),'b8785634128b00b81032547650b8785634128b006a0550e800000000');
 assert.equal(section.fixups.at(-1).label,'native:record:assign-fixed');
});

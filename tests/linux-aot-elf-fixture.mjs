import {AOT_HELPERS} from '../packages/macos-native/src/aot-abi.js';
import {linuxTarget} from '../packages/linux-native/src/target.js';
const encoder=new TextEncoder();
/** Structural ELF fixture, never executed and never used as an SDK payload. */
export function linuxELFFixture(architecture='x64'){
  const target=linuxTarget(architecture),page=target.pageBytes,bytes=new Uint8Array(page*6),v=new DataView(bytes.buffer);
  const u16=(at,n)=>v.setUint16(at,n,true),u32=(at,n)=>v.setUint32(at,n,true),u64=(at,n)=>v.setBigUint64(at,BigInt(n),true);
  bytes.set([0x7f,0x45,0x4c,0x46,2,1,1]);u16(16,3);u16(18,target.machine);u32(20,1);u64(24,page);u64(32,64);u64(40,page*5+0x100);u16(52,64);u16(54,56);u16(56,9);u16(58,64);u16(60,7);u16(62,6);
  const ph=(i,type,flags,offset,address,size,alignment=page)=>{const at=64+i*56;u32(at,type);u32(at+4,flags);u64(at+8,offset);u64(at+16,address);u64(at+24,address);u64(at+32,size);u64(at+40,size);u64(at+48,alignment);};
  const interpreter=encoder.encode(target.interpreters[0]+'\0');bytes.set(interpreter,0x400);
  ph(0,6,4,64,64,9*56,8);ph(1,3,4,0x400,0x400,interpreter.length,1);
  ph(2,1,4,0,0,page);ph(3,1,5,page,page,page);ph(4,1,4,page*2,page*2,page);ph(5,1,6,page*3,page*3,page);
  ph(6,2,6,page*3,page*3,48,8);ph(7,0x6474e551,6,0,0,0,16);ph(8,0x6474e552,4,page*3,page*3,256,1);
  const dynstr=encoder.encode('\0libgtk-3.so.0\0');bytes.set(dynstr,page*2);u64(page*3,1);u64(page*3+8,1);u64(page*3+16,24);
  const symbolNames=['',...AOT_HELPERS.map(name=>'vb6_aot_'+name)],nameOffsets=[];let names='';for(const name of symbolNames){nameOffsets.push(names.length);names+=name+'\0';}bytes.set(encoder.encode(names),page*4+0x800);
  const ret=at=>target.option==='arm64'?u32(at,0xd65f03c0):bytes[at]=0xc3;
  for(let i=1;i<symbolNames.length;i++){const at=page*4+i*24;u32(at,nameOffsets[i]);bytes[at+4]=0x12;u16(at+6,1);u64(at+8,page+i*16);u64(at+16,target.option==='arm64'?4:1);ret(page+i*16);}ret(page);
  const sectionNames=['','.text','.dynstr','.dynamic','.symtab','.strtab','.shstrtab'],sectionNameOffsets=[];let sectionText='';for(const name of sectionNames){sectionNameOffsets.push(sectionText.length);sectionText+=name+'\0';}bytes.set(encoder.encode(sectionText),page*5);
  const sh=(i,type,flags,address,offset,size,link=0,entrySize=0)=>{const at=page*5+0x100+i*64;u32(at,sectionNameOffsets[i]);u32(at+4,type);u64(at+8,flags);u64(at+16,address);u64(at+24,offset);u64(at+32,size);u32(at+40,link);u64(at+48,1);u64(at+56,entrySize);};
  sh(1,1,6,page,page,page);sh(2,3,2,page*2,page*2,dynstr.length);sh(3,6,3,page*3,page*3,48,2,16);sh(4,2,0,0,page*4,symbolNames.length*24,5,24);sh(5,3,0,0,page*4+0x800,names.length);sh(6,3,0,0,page*5,sectionText.length);
  return bytes;
}

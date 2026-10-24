/** Strict ELF64 PIE reader and append-only linker for the pinned GTK runtime.
 * Existing LOAD addresses, dynamic relocations, GOT/PLT and RELRO never move.
 * Project code receives an RX mapping; metadata and the relocated PHDR table
 * receive an R mapping. No writable code, loader hook or project compiler. */
import {AOT_ABI,AOT_HELPERS} from '../../macos-native/src/aot-abi.js';
import {sha256Bytes} from '../../macos-native/src/archive.js';
import {linkX64AOT,linkLinuxARM64AOT} from './aot-emitter.js';
import {LINUX_LIMITS,linuxTarget} from './target.js';
export const LINUX_CODE_FLAG=0x01000000;
export const LINUX_METADATA_FLAG=0x02000000;
const PHDR_SIZE=56,SHDR_SIZE=64,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const align=(value,unit)=>Math.ceil(value/unit)*unit;
const bounded=(value,min,max,message='Unsafe ELF range')=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(message);return value;};
const libraries=/^lib(?:gtk-3|gdk-3|pangocairo-1\.0|pango-1\.0|gobject-2\.0|glib-2\.0|gio-2\.0|gdk_pixbuf-2\.0|cairo|cairo-gobject|harfbuzz|atk-1\.0|stdc\+\+|gcc_s|m|c|dl|pthread|fontconfig|freetype|cups|z)\.so(?:\.\d+)*$/;
export function inspectLinuxELF(input,{requireProject=false,architecture}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<64||bytes.length>LINUX_LIMITS.imageBytes)throw new Error('Invalid or excessive ELF image');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true);
  const u64=p=>{const n=v.getBigUint64(p,true);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Unsafe ELF address');return Number(n);};
  const range=(offset,size,end=bytes.length)=>{bounded(offset,0,end);bounded(size,0,end);if(offset>end-size)throw new Error('ELF range is outside image');};
  const string=(offset,size)=>{range(offset,size);let end=offset;while(end<offset+size&&bytes[end])end++;if(end===offset+size)throw new Error('Unterminated ELF string');return decoder.decode(bytes.subarray(offset,end));};
  if(u32(0)!==0x464c457f||bytes[4]!==2||bytes[5]!==1||bytes[6]!==1||![0,3].includes(bytes[7])||u16(16)!==3||![62,183].includes(u16(18))||u32(20)!==1||u32(48)!==0||u16(52)!==64)throw new Error('Expected a little-endian Linux x86_64 or ARM64 ELF64 PIE');
  const target=linuxTarget(u16(18)===183?'arm64':'x64'),PAGE=target.pageBytes;
  if(architecture!==undefined&&linuxTarget(architecture)!==target)throw new Error('ELF machine does not match the requested Linux architecture');
  const entry=u64(24),programOffset=u64(32),sectionOffset=u64(40),programCount=u16(56),sectionCount=u16(60),stringSection=u16(62);
  if(u16(54)!==PHDR_SIZE||u16(58)!==SHDR_SIZE||programCount<4||programCount>128||sectionCount<2||sectionCount>4096||stringSection>=sectionCount)throw new Error('Unsupported ELF table layout');
  range(programOffset,programCount*PHDR_SIZE);range(sectionOffset,sectionCount*SHDR_SIZE);
  const segments=[];
  for(let i=0;i<programCount;i++){
    const at=programOffset+i*PHDR_SIZE,s={index:i,command:at,type:u32(at),flags:u32(at+4),offset:u64(at+8),address:u64(at+16),physicalAddress:u64(at+24),fileSize:u64(at+32),size:u64(at+40),alignment:u64(at+48)};
    range(s.offset,s.fileSize);bounded(s.address+s.size,0,Number.MAX_SAFE_INTEGER);
    if(s.type===1){
      if(s.fileSize>s.size||s.alignment<PAGE||s.alignment>2**30||(s.alignment&(s.alignment-1))!==0||s.offset%s.alignment!==s.address%s.alignment)throw new Error('Invalid ELF LOAD alignment or size');
      if((s.flags&3)===3||!(s.flags&4))throw new Error('ELF executable mappings must be readable and never writable');
      if(segments.some(p=>p.type===1&&s.size&&p.size&&s.address<p.address+p.size&&p.address<s.address+s.size))throw new Error('Overlapping ELF virtual LOAD mappings');
    }
    segments.push(s);
  }
  const loads=segments.filter(s=>s.type===1),programHeaders=segments.filter(s=>s.type===6),interpreters=segments.filter(s=>s.type===3),stacks=segments.filter(s=>s.type===0x6474e551);
  if(programHeaders.length!==1||interpreters.length!==1||stacks.length!==1||(stacks[0].flags&1)||!segments.some(s=>s.type===0x6474e552))throw new Error('ELF requires PHDR, interpreter, nonexecutable stack and RELRO');
  const phdr=programHeaders[0],tableSize=programCount*PHDR_SIZE;
  if(phdr.offset!==programOffset||phdr.fileSize!==tableSize||phdr.size!==tableSize||!loads.some(s=>!(s.flags&2)&&phdr.address>=s.address&&phdr.address+tableSize<=s.address+s.fileSize&&phdr.address-s.address===programOffset-s.offset))throw new Error('ELF program headers are not read-only mapped');
  const interpreter=string(interpreters[0].offset,interpreters[0].fileSize);
  if(!target.interpreters.includes(interpreter))throw new Error('ELF interpreter is not the supported system loader for '+target.architecture);
  if(target.option==='arm64'&&entry%4||!loads.some(s=>(s.flags&1)&&entry>=s.address&&entry<s.address+s.fileSize))throw new Error('ELF entry is outside executable code or misaligned');
  const sections=[];
  for(let i=0;i<sectionCount;i++){
    const at=sectionOffset+i*SHDR_SIZE,s={index:i,command:at,nameOffset:u32(at),type:u32(at+4),flags:u64(at+8),address:u64(at+16),offset:u64(at+24),size:u64(at+32),link:u32(at+40),info:u32(at+44),alignment:u64(at+48),entrySize:u64(at+56)};
    if(s.type!==8)range(s.offset,s.size);if(s.link>=sectionCount)throw new Error('Invalid ELF section link');sections.push(s);
  }
  const shstr=sections[stringSection];if(shstr.type!==3||shstr.flags!==0)throw new Error('Invalid ELF section name table');
  for(const s of sections){if(s.nameOffset>=shstr.size)throw new Error('Invalid ELF section name');s.name=string(shstr.offset+s.nameOffset,shstr.size-s.nameOffset);}
  const symbols=new Map(),wanted=new Set(AOT_HELPERS.map(name=>'vb6_aot_'+name)),tables=sections.filter(s=>s.type===2);
  if(tables.length!==1)throw new Error('ELF runtime needs exactly one retained symbol table');
  const table=tables[0],strings=sections[table.link];if(table.entrySize!==24||table.size%24||strings.type!==3)throw new Error('Invalid ELF symbol table');
  for(let offset=table.offset;offset<table.offset+table.size;offset+=24){
    const nameOffset=u32(offset);if(nameOffset>=strings.size)throw new Error('Invalid ELF symbol name');
    const name=string(strings.offset+nameOffset,strings.size-nameOffset);if(!wanted.has(name))continue;
    const info=bytes[offset+4],sectionIndex=u16(offset+6),address=u64(offset+8),size=u64(offset+16),s=sections[sectionIndex];
    if(symbols.has(name)||(info&15)!==2||![1,2].includes(info>>4)||!s||(s.flags&6)!==6||s.flags&1||target.option==='arm64'&&address%4||address<s.address||address+Math.max(size,1)>s.address+s.size||!loads.some(p=>(p.flags&7)===5&&address>=p.address&&address+Math.max(size,1)<=p.address+p.fileSize))throw new Error('Invalid or duplicate ELF AOT helper symbol');
    symbols.set(name,address);
  }
  for(const name of wanted)if(!symbols.has(name))throw new Error('ELF runtime is missing AOT helper '+name);
  const dynamics=sections.filter(s=>s.type===6);if(dynamics.length!==1)throw new Error('Missing ELF dynamic table');
  const dynamic=dynamics[0],dynamicStrings=sections[dynamic.link];if(dynamic.entrySize!==16||dynamic.size%16||dynamicStrings.type!==3)throw new Error('Invalid ELF dynamic table');
  const dependencies=[];let terminated=false,bindNow=false;
  for(let at=dynamic.offset;at<dynamic.offset+dynamic.size;at+=16){
    const kind=u64(at),value=u64(at+8);if(kind===0){terminated=true;break;}
    if(kind===15||kind===29||kind===22)throw new Error('ELF runtime cannot use custom loader paths or text relocations');
    if(kind===24||kind===30&&(value&8)||kind===0x6ffffffb&&(value&1))bindNow=true;
    if(kind===1){if(value>=dynamicStrings.size)throw new Error('Invalid ELF dependency');const name=string(dynamicStrings.offset+value,dynamicStrings.size-value);if((!libraries.test(name)&&name!==interpreter.split('/').at(-1))||dependencies.includes(name))throw new Error('ELF runtime has an unsupported native dependency: '+name);dependencies.push(name);}
  }
  if(!terminated||!bindNow||!dependencies.includes('libgtk-3.so.0'))throw new Error('ELF runtime requires GTK3 and immediate binding');
  const codeSegments=loads.filter(s=>s.flags&LINUX_CODE_FLAG),metadataSegments=loads.filter(s=>s.flags&LINUX_METADATA_FLAG),hasProject=codeSegments.length||metadataSegments.length;
  let code,metadata,metadataOffset,metadataJSON,codeSize,metadataSize;
  if(hasProject){
    if(codeSegments.length!==1||metadataSegments.length!==1)throw new Error('Invalid ELF project segment tags');
    code=codeSegments[0];metadata=metadataSegments[0];
    if(code.flags!==(LINUX_CODE_FLAG|5)||metadata.flags!==(LINUX_METADATA_FLAG|4)||code.size!==code.fileSize||metadata.size!==metadata.fileSize||code.size<16||code.size>LINUX_LIMITS.codeBytes||metadata.size>LINUX_LIMITS.metadataBytes+align(128*PHDR_SIZE,16)+16+PAGE||[code,metadata].some(s=>s.offset%PAGE||s.address%PAGE||s.size%PAGE)||code.address+code.size!==metadata.address||code.offset+code.fileSize!==metadata.offset||phdr.address!==metadata.address||phdr.offset!==metadata.offset)throw new Error('Invalid ELF project mapping');
    metadataOffset=metadata.offset+align(tableSize,16);range(metadataOffset,16,metadata.offset+metadata.fileSize);
    if(!encoder.encode('VB6AOT1\0').every((b,i)=>bytes[metadataOffset+i]===b))throw new Error('Missing ELF AOT metadata marker');
    metadataSize=u32(metadataOffset+8);codeSize=u32(metadataOffset+12);
    if(!metadataSize||metadataSize>LINUX_LIMITS.metadataBytes||codeSize<16||codeSize>code.size||target.option==='arm64'&&codeSize%4||16+metadataSize>metadata.offset+metadata.fileSize-metadataOffset)throw new Error('Invalid ELF AOT project sizes');
    metadataJSON=JSON.parse(decoder.decode(bytes.subarray(metadataOffset+16,metadataOffset+16+metadataSize)));
    if(metadataJSON.abi!==AOT_ABI||!Array.isArray(metadataJSON.entries)||metadataJSON.entries.length<1||metadataJSON.entries.length>65536||metadataJSON.entries.some(n=>!Number.isInteger(n)||n<0||n>=codeSize||n%16)||new Set(metadataJSON.entries).size!==metadataJSON.entries.length)throw new Error('Invalid ELF AOT procedure table');
    for(const address of symbols.values())if(address>=code.address)throw new Error('ELF native helpers cannot occupy project mappings');
  }else if(requireProject)throw new Error('ELF is an unpopulated AOT runtime template');
  return {bytes,target,entry,programOffset,programCount,sectionOffset,sectionCount,stringSection,segments,sections,loads,phdr,shstr,symbols,
    interpreter,dependencies,code,metadata,metadataOffset,metadataJSON,codeSize,metadataSize,
    image:{architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,pageBytes:PAGE,format:'ELF64',pie:true,nonExecutableStack:true,relro:true,bindNow:true,interpreter,dependencies,project:!!hasProject}};
}
export async function createLinuxAOTRuntimeManifest(bytes,provenance={}){
  if(!(bytes instanceof Uint8Array)||bytes.length>LINUX_LIMITS.runtimeBytes)throw new Error('Invalid or excessive Linux runtime template');
  const layout=inspectLinuxELF(bytes);if(layout.code)throw new Error('A Linux runtime template must not contain a linked project');
  return {version:1,layout:'append-load-v1',abi:AOT_ABI,architecture:layout.target.architecture,machine:layout.target.machine,callingConvention:layout.target.callingConvention,pageBytes:layout.target.pageBytes,format:'ELF64',sha256:await sha256Bytes(bytes),bytes:bytes.length,
    helpers:Object.fromEntries(layout.symbols),dependencies:layout.dependencies,provenance};
}
export async function verifyLinuxAOTRuntime(bytes,manifest){
  if(!(bytes instanceof Uint8Array)||bytes.length>LINUX_LIMITS.runtimeBytes||!manifest||manifest.version!==1||manifest.layout!=='append-load-v1'||manifest.abi!==AOT_ABI||!['x86_64','arm64'].includes(manifest.architecture)||manifest.format!=='ELF64'||manifest.bytes!==bytes.length||manifest.sha256!==await sha256Bytes(bytes))throw new Error('Linux AOT runtime integrity or ABI mismatch');
  const layout=inspectLinuxELF(bytes,{architecture:manifest.architecture});if(layout.code)throw new Error('Linux AOT runtime must be an unpopulated template');
  if(['machine','callingConvention','pageBytes'].some(key=>manifest[key]!==undefined&&manifest[key]!==layout.image[key]))throw new Error('Linux AOT runtime manifest has an incorrect machine ABI');
  if(!manifest.helpers||Object.keys(manifest.helpers).length!==layout.symbols.size||[...layout.symbols].some(([name,address])=>manifest.helpers[name]!==address)||JSON.stringify(manifest.dependencies)!==JSON.stringify(layout.dependencies))throw new Error('Linux AOT runtime manifest does not match ELF symbols or dependencies');
  return layout;
}
/** Synchronous linking after the caller has verified the pinned template. */
export function linkLinuxELF(compiled,template,layout=inspectLinuxELF(template)){
  if(layout.code)throw new Error('Cannot link into an already populated ELF application');
  const target=layout.target,PAGE=target.pageBytes;
  if(compiled.report?.architecture!==target.architecture||compiled.report?.target!==target.id||compiled.report?.codegen!==target.codegen)throw new Error('Linux AOT object code and runtime architectures do not match');
  const metadataBytes=encoder.encode(JSON.stringify(compiled.metadata));
  bounded(metadataBytes.length,1,LINUX_LIMITS.metadataBytes,'Linux metadata exceeds 8 MiB');
  bounded(compiled.section?.length,1,LINUX_LIMITS.codeBytes,'Linux AOT code exceeds 64 MiB');
  const loadEnd=Math.max(...layout.loads.map(s=>s.address+s.size)),headerLoad=layout.loads.find(s=>s.offset===0&&s.fileSize>=64);
  if(target.option==='arm64'&&!headerLoad)throw new Error('ARM64 runtime requires a mapped ELF header');
  // Keep appended ARM64 file/virtual offsets consistent with the ELF header
  // mapping. QEMU's Linux-user loader derives AT_PHDR from load_addr + e_phoff.
  // This also works with the kernel's PT_LOAD-based program-header lookup.
  const addressBias=target.option==='arm64'?headerLoad.address:0;
  const codeCapacity=align(compiled.section.length,PAGE),codeOffset=align(Math.max(template.length,target.option==='arm64'?loadEnd-addressBias:0),PAGE),
    codeAddress=target.option==='arm64'?addressBias+codeOffset:align(loadEnd,PAGE),count=layout.programCount+2;
  const metadataOffset=codeOffset+codeCapacity,metadataAddress=codeAddress+codeCapacity,metadataPrefix=align(count*PHDR_SIZE,16),metadataCapacity=align(metadataPrefix+16+metadataBytes.length,PAGE);
  if(count>128||layout.sectionCount+2>4096)throw new Error('Linux project exceeds ELF table limits');
  const names=encoder.encode('.vb6code\0.vb6meta\0'),stringsOffset=metadataOffset+metadataCapacity,stringsSize=layout.shstr.size+names.length,sectionOffset=align(stringsOffset+stringsSize,8),sectionCount=layout.sectionCount+2,length=sectionOffset+sectionCount*SHDR_SIZE;
  bounded(length,1,LINUX_LIMITS.imageBytes,'Linked Linux executable exceeds image limits');
  const bytes=new Uint8Array(length),view=new DataView(bytes.buffer),word=(at,n)=>view.setUint32(at,n,true),wide=(at,n)=>view.setBigUint64(at,BigInt(n),true);
  bytes.set(template);const code=(target.option==='arm64'?linkLinuxARM64AOT:linkX64AOT)(compiled.section,codeAddress,layout.symbols);bytes.set(code,codeOffset);
  // All original load commands are copied byte-for-byte except PT_PHDR, whose
  // backing mapping is relocated alongside the table itself.
  bytes.set(template.subarray(layout.programOffset,layout.programOffset+layout.programCount*PHDR_SIZE),metadataOffset);
  const writeProgram=(index,s)=>{const at=metadataOffset+index*PHDR_SIZE;word(at,s.type);word(at+4,s.flags);wide(at+8,s.offset);wide(at+16,s.address);wide(at+24,s.address);wide(at+32,s.size);wide(at+40,s.size);wide(at+48,s.alignment);};
  writeProgram(layout.phdr.index,{type:6,flags:4,offset:metadataOffset,address:metadataAddress,size:count*PHDR_SIZE,alignment:8});
  writeProgram(layout.programCount,{type:1,flags:LINUX_CODE_FLAG|5,offset:codeOffset,address:codeAddress,size:codeCapacity,alignment:PAGE});
  writeProgram(layout.programCount+1,{type:1,flags:LINUX_METADATA_FLAG|4,offset:metadataOffset,address:metadataAddress,size:metadataCapacity,alignment:PAGE});
  const header=metadataOffset+metadataPrefix;bytes.set(encoder.encode('VB6AOT1\0'),header);word(header+8,metadataBytes.length);word(header+12,code.length);bytes.set(metadataBytes,header+16);
  bytes.set(template.subarray(layout.shstr.offset,layout.shstr.offset+layout.shstr.size),stringsOffset);bytes.set(names,stringsOffset+layout.shstr.size);
  bytes.set(template.subarray(layout.sectionOffset,layout.sectionOffset+layout.sectionCount*SHDR_SIZE),sectionOffset);
  const newStrings=sectionOffset+layout.stringSection*SHDR_SIZE;wide(newStrings+24,stringsOffset);wide(newStrings+32,stringsSize);
  const writeSection=(index,nameOffset,flags,address,offset,size)=>{const at=sectionOffset+index*SHDR_SIZE;word(at,nameOffset);word(at+4,1);wide(at+8,flags);wide(at+16,address);wide(at+24,offset);wide(at+32,size);wide(at+48,16);};
  writeSection(layout.sectionCount,layout.shstr.size,6,codeAddress,codeOffset,code.length);
  writeSection(layout.sectionCount+1,layout.shstr.size+9,2,metadataAddress+metadataPrefix,header,16+metadataBytes.length);
  wide(32,metadataOffset);wide(40,sectionOffset);view.setUint16(56,count,true);view.setUint16(60,sectionCount,true);
  const linked=inspectLinuxELF(bytes,{requireProject:true});
  return {bytes,layout:linked,codeCapacity,metadataCapacity,templateHeader:Array.from(template.subarray(0,64))};
}

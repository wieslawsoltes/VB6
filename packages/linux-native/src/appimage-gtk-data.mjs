/** Relocate GTK's one compile-time ISO XML path in the bundled copy only. */
import {createHash} from 'node:crypto';
const original=Buffer.from('/usr/share/xml/iso-codes\0'),replacement=Buffer.from('/proc/self/fd/9\0');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function relocateAppImageGtkData(input) {
  if(!(input instanceof Uint8Array)||input.length>128*1024*1024)throw new Error('GTK data relocation requires bounded ELF bytes');
  const bytes=Buffer.from(input);
  if(bytes.length<64||bytes.toString('hex',0,6)!=='7f454c460201'||bytes.readUInt16LE(16)!==3||![62,183].includes(bytes.readUInt16LE(18)))throw new Error('GTK data relocation requires a little-endian x64 or ARM64 shared ELF');
  const integer=offset=>{
    const value=bytes.readBigUInt64LE(offset);
    if(value>BigInt(bytes.length))throw new Error('GTK data relocation found an out-of-bounds ELF range');
    return Number(value);
  };
  const table=(at,sizeAt,countAt,expected)=>{
    const offset=integer(at),size=bytes.readUInt16LE(sizeAt),count=bytes.readUInt16LE(countAt);
    if(size!==expected||!count||offset<64||offset+size*count>bytes.length)throw new Error('GTK data relocation requires bounded ELF section and program tables');
    return {offset,size,count};
  };
  const sections=table(40,58,60,64),segments=table(32,54,56,56);
  const offset=bytes.indexOf(original);
  if(offset<=0||bytes[offset-1]!==0||bytes.indexOf(original,offset+1)!==-1)throw new Error('GTK data relocation requires exactly one complete /usr/share/xml/iso-codes string');
  let sectionIndex=-1,segmentIndex=-1;
  for(let index=0;index<sections.count;index++){
    const entry=sections.offset+index*sections.size,flags=bytes.readBigUInt64LE(entry+8);
    if(bytes.readUInt32LE(entry+4)!==1||(flags&2n)!==2n||(flags&0xc05n)!==0n)continue;
    const start=integer(entry+24),length=integer(entry+32);
    if(start+length>bytes.length)throw new Error('GTK data relocation found an out-of-bounds ELF section');
    if(offset>=start&&offset+original.length<=start+length){if(sectionIndex!==-1)throw new Error('GTK data relocation found overlapping ELF data sections');sectionIndex=index;}
  }
  for(let index=0;index<segments.count;index++){
    const entry=segments.offset+index*segments.size;
    if(bytes.readUInt32LE(entry)!==1)continue;
    const start=integer(entry+8),length=integer(entry+32),flags=bytes.readUInt32LE(entry+4);
    if(start+length>bytes.length)throw new Error('GTK data relocation found an out-of-bounds ELF load segment');
    if(offset<start+length&&offset+original.length>start){
      if(offset<start||offset+original.length>start+length||(flags&4)!==4||(flags&2)!==0||segmentIndex!==-1)throw new Error('GTK data relocation requires one read-only ELF load segment');
      segmentIndex=index;
    }
  }
  if(sectionIndex<0||segmentIndex<0)throw new Error('GTK data relocation string is not in allocated read-only ELF data');
  const originalSha256=hash(bytes);bytes.fill(0,offset,offset+original.length);replacement.copy(bytes,offset);
  const change={kind:'gtk-iso-codes-directory',originalSha256,sha256:hash(bytes),offset,length:original.length,sectionIndex,segmentIndex,
    original:original.toString('hex'),replacement:bytes.subarray(offset,offset+original.length).toString('hex'),
    dataDirectory:'usr/share/xml/iso-codes',descriptor:9,
    upstreamSource:'https://github.com/GNOME/gtk/blob/4.14.5/gtk/language-names.c'};
  return {bytes,change};
}

export function appImageGtkDataNotice(changes) {
  return 'AppImage GTK data relocation\n\n'+
    'The bundled GTK shared library has a local data-path modification. The source sysroot and installed system library are unchanged.\n'+
    'On Linux GTK builds this ISO XML directory into allocated read-only ELF data; GTK_DATA_PREFIX does not change that lookup.\n'+
    'AppRun opens the bundled usr/share/xml/iso-codes directory read-only on inherited descriptor 9. The GTK copy reads its language XML through /proc/self/fd/9.\n'+
    'Exactly one complete NUL-terminated path is replaced and the rest of the original byte range is zero-filled. The ELF architecture, allocated non-writable/non-executable data section, and read-only load segment are checked before replacement. No instructions or application payload bytes are changed.\n\n'+
    changes.map(change=>'Library: '+change.path+'\nOriginal SHA256: '+change.originalSha256+'\nPatched SHA256: '+change.sha256+'\nByte offset: '+change.offset+'\nLength: '+change.length+'\nOriginal bytes (hex): '+change.original+'\nReplacement bytes (hex): '+change.replacement+'\nUpstream lookup implementation: '+change.upstreamSource+'\n').join('\n')+
    '\nTo reproduce a modification, verify the original SHA256, validate the ELF ranges above, replace exactly the listed byte range with the replacement hex bytes, and verify the patched SHA256. To restore the source library, replace that range with the original hex bytes and verify the original SHA256. Keep the accompanying GTK copyright and license notices when redistributing either copy.\n';
}

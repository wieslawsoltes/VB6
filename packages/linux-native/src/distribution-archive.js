/** Deterministic Linux package containers. No native tools, shell, or network. */
import {sha256Bytes} from '../../macos-native/src/archive.js';
import {LINUX_LIMITS} from './target.js';
const encoder=new TextEncoder();
export const utf8=value=>encoder.encode(value);
export function joinBytes(parts) {
  const size=parts.reduce((total,part)=>total+part.length,0);
  if(size>LINUX_LIMITS.archiveBytes)throw new Error('Linux package exceeds archive limits');
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
const align=(value,boundary)=>Math.ceil(value/boundary)*boundary;
const hexBytes=hex=>Uint8Array.from(hex.match(/../g)||[],pair=>parseInt(pair,16));
const hex=bytes=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
/** Stored DEFLATE blocks give identical bytes in every browser and Node version. */
export function gzipStore(bytes) {
  const result=new Uint8Array(18+bytes.length+5*Math.max(1,Math.ceil(bytes.length/65535)));
  result.set([31,139,8,0,0,0,0,0,0,3]);const view=new DataView(result.buffer);let at=10,crc=0xffffffff;
  for(let offset=0;;offset+=65535){
    const count=Math.min(65535,bytes.length-offset),last=offset+count===bytes.length;
    result[at++]=last?1:0;view.setUint16(at,count,true);view.setUint16(at+2,count^65535,true);at+=4;
    const block=bytes.subarray(offset,offset+count);result.set(block,at);at+=count;
    for(const value of block)crc=crcTable[(crc^value)&255]^(crc>>>8);
    if(last)break;
  }
  view.setUint32(at,(crc^0xffffffff)>>>0,true);view.setUint32(at+4,bytes.length,true);return result;
}
/** Legacy container checksum required by RPM v4 and Debian md5sums, never trust. */
export function md5Bytes(bytes) {
  const padded=new Uint8Array(align(bytes.length+9,64));padded.set(bytes);padded[bytes.length]=128;
  const view=new DataView(padded.buffer);view.setUint32(padded.length-8,(bytes.length*8)>>>0,true);view.setUint32(padded.length-4,Math.floor(bytes.length/0x20000000),true);
  const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const constants=Uint32Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*0x100000000));
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let offset=0;offset<padded.length;offset+=64){
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let f,g;if(i<16){f=(b&c)|(~b&d);g=i;}else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}else if(i<48){f=b^c^d;g=(3*i+5)%16;}else{f=c^(b|~d);g=(7*i)%16;}
      const sum=(a+f+constants[i]+view.getUint32(offset+g*4,true))>>>0,shift=shifts[Math.floor(i/16)*4+i%4];
      a=d;d=c;c=b;b=(b+((sum<<shift)|(sum>>>(32-shift))))>>>0;
    }
    a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
  }
  const digest=new Uint8Array(16),out=new DataView(digest.buffer);[a0,b0,c0,d0].forEach((value,i)=>out.setUint32(i*4,value,true));return hex(digest);
}
function tarHeader(path,size,mode,type='0',link='') {
  const result=new Uint8Array(512);
  const put=(offset,length,value)=>{const data=utf8(value);if(data.length>length)throw new Error('Tar field exceeds its limit');result.set(data,offset);};
  const octal=(offset,length,value)=>put(offset,length,value.toString(8).padStart(length-1,'0')+'\0');
  let name=path,prefix='';
  if(utf8(name).length>100){
    for(let at=path.lastIndexOf('/');at>0;at=path.lastIndexOf('/',at-1))if(utf8(path.slice(0,at)).length<=155&&utf8(path.slice(at+1)).length<=100){prefix=path.slice(0,at);name=path.slice(at+1);break;}
  }
  if(utf8(name).length>100)name='@LongName';
  put(0,100,name);octal(100,8,mode&0o777);octal(108,8,0);octal(116,8,0);octal(124,12,size);octal(136,12,0);
  result.fill(32,148,156);put(156,1,type);put(157,100,utf8(link).length<=100?link:'@LongLink');put(257,6,'ustar\0');put(263,2,'00');put(265,32,'root');put(297,32,'root');put(345,155,prefix);
  put(148,8,result.reduce((sum,value)=>sum+value,0).toString(8).padStart(6,'0')+'\0 ');return result;
}
export function tarArchive(entries) {
  const parts=[];
  const add=(path,bytes,mode,type,link='')=>{parts.push(tarHeader(path,bytes.length,mode,type,link),bytes,new Uint8Array(align(bytes.length,512)-bytes.length));};
  for(const entry of entries){
    const path=entry.path+(entry.type==='directory'?'/':'');
    // GNU long-name records are accepted by dpkg and preserve UTF-8 components.
    if(utf8(path).length>100)add('././@LongLink',utf8(path+'\0'),0o644,'L');
    if(entry.link&&utf8(entry.link).length>100)add('././@LongLink',utf8(entry.link+'\0'),0o644,'K');
    add(path,entry.bytes||new Uint8Array(),entry.mode,entry.type==='directory'?'5':entry.type==='symlink'?'2':'0',entry.link||'');
  }
  parts.push(new Uint8Array(1024));return joinBytes(parts);
}
export function arArchive(entries) {
  const parts=[utf8('!<arch>\n')];
  for(const {name,bytes}of entries){
    if(!/^[a-z][a-z0-9.-]{0,14}$/.test(name))throw new Error('Invalid Debian archive member');
    const header=(name+'/').padEnd(16,' ')+'0'.padEnd(12,' ')+'0'.padEnd(6,' ')+'0'.padEnd(6,' ')+'100644'.padEnd(8,' ')+String(bytes.length).padEnd(10,' ')+'`\n';
    parts.push(utf8(header),bytes);if(bytes.length%2)parts.push(utf8('\n'));
  }
  return joinBytes(parts);
}
export function cpioArchive(entries) {
  const parts=[];let inode=1;
  for(const entry of [...entries,{path:'TRAILER!!!',mode:0,bytes:new Uint8Array(),trailer:true}]){
    const name=utf8((entry.trailer?'':'./')+entry.path+'\0'),bytes=entry.type==='symlink'?utf8(entry.link):entry.bytes||new Uint8Array();
    const mode=entry.trailer?0:entry.mode|(entry.type==='directory'?0o40000:entry.type==='symlink'?0o120000:0o100000);
    const values=[inode++,mode,0,0,entry.type==='directory'?2:1,0,bytes.length,0,0,0,0,name.length,bytes.reduce((sum,value)=>(sum+value)>>>0,0)];
    parts.push(utf8('070702'+values.map(value=>value.toString(16).padStart(8,'0')).join('')),name,new Uint8Array(align(110+name.length,4)-110-name.length),bytes,new Uint8Array(align(bytes.length,4)-bytes.length));
  }
  return joinBytes(parts);
}
/** Header region and typed tags, RPM's big-endian on-disk format. */
export function rpmHeader(tags,region) {
  const sorted=[...tags].sort((a,b)=>a[0]-b[0]),entries=[],parts=[];let offset=0;
  if(new Set(sorted.map(tag=>tag[0])).size!==sorted.length)throw new Error('Duplicate RPM header tag');
  for(const [tag,type,value]of sorted){
    const boundary=type===3?2:type===4?4:1,padding=align(offset,boundary)-offset;if(padding){parts.push(new Uint8Array(padding));offset+=padding;}
    let data,count;
    if(type===3||type===4){const values=Array.isArray(value)?value:[value];count=values.length;data=new Uint8Array(count*boundary);const view=new DataView(data.buffer);values.forEach((number,i)=>type===3?view.setUint16(i*2,number):view.setUint32(i*4,number));}
    else if(type===6){data=utf8(value+'\0');count=1;}
    else if(type===7){data=value;count=data.length;}
    else if(type===8||type===9){data=utf8(value.join('\0')+'\0');count=value.length;}
    else throw new Error('Unsupported RPM tag type');
    entries.push([tag,type,offset,count]);parts.push(data);offset+=data.length;
  }
  const count=entries.length+1,trailer=new Uint8Array(16),tv=new DataView(trailer.buffer);
  tv.setUint32(0,region);tv.setUint32(4,7);tv.setInt32(8,-16*count);tv.setUint32(12,16);
  const index=new Uint8Array(16+count*16),iv=new DataView(index.buffer);index.set([0x8e,0xad,0xe8,1]);iv.setUint32(8,count);iv.setUint32(12,offset+16);
  [[region,7,offset,16],...entries].forEach((entry,i)=>entry.forEach((value,j)=>iv.setUint32(16+i*16+j*4,value)));
  return joinBytes([index,...parts,trailer]);
}
export async function rpmArchive(entries,metadata,dependencies) {
  const payload=cpioArchive(entries),compressed=gzipStore(payload),count=entries.length;
  const dirs=[],dirIndexes=[],basenames=[],digests=[];
  for(const entry of entries){
    const slash=entry.path.lastIndexOf('/'),directory='/'+entry.path.slice(0,slash+1);let index=dirs.indexOf(directory);if(index<0){index=dirs.length;dirs.push(directory);}
    dirIndexes.push(index);basenames.push(entry.path.slice(slash+1));digests.push(entry.type?'':await sha256Bytes(entry.bytes));
  }
  const strings=value=>Array(count).fill(value),numbers=value=>Array(count).fill(value),arch=metadata.architecture==='arm64'?'aarch64':'x86_64';
  // Both runtimes use GCC's integer/unwind ABI; AArch64 also needs the
  // quad-precision comparison helper __unordtf2@GCC_4.5.0.
  const gccVersions=arch==='aarch64'?['3.0','4.2.0','4.5.0']:['3.0','4.2.0'];
  const requires=[['rpmlib(CompressedFileNames)',16777228,'3.0.4-1'],['rpmlib(PayloadFilesHavePrefix)',16777228,'4.0-1'],['rpmlib(FileDigests)',16777228,'4.6.0-1'],
    ...dependencies.map(name=>[name+'()(64bit)',0,'']),['libc.so.6(GLIBC_2.39)(64bit)',0,''],
    ['libstdc++.so.6(GLIBCXX_3.4.32)(64bit)',0,''],['libstdc++.so.6(CXXABI_1.3.13)(64bit)',0,''],
    ...gccVersions.map(version=>['libgcc_s.so.1(GCC_'+version+')(64bit)',0,'']),['gtk3',12,'3.24']];
  const tags=[
    [100,8,['C']],[1000,6,metadata.packageName],[1001,6,metadata.version],[1002,6,metadata.release],
    [1004,9,[metadata.summary]],[1005,9,[metadata.description]],[1006,4,0],[1007,6,'reproducible.vb6-studio'],
    [1009,4,entries.reduce((sum,entry)=>sum+(entry.bytes?.length||0)+(entry.link?utf8(entry.link).length:0),0)],
    [1014,6,metadata.license],[1015,6,metadata.maintainer],[1016,9,['Applications/Other']],
    [1021,6,'linux'],[1022,6,arch],[1028,4,entries.map(entry=>entry.link?utf8(entry.link).length:entry.bytes?.length||0)],
    [1030,3,entries.map(entry=>entry.mode|(entry.type==='directory'?0o40000:entry.type==='symlink'?0o120000:0o100000))],
    [1033,3,numbers(0)],[1034,4,numbers(0)],[1035,8,digests],[1036,8,entries.map(entry=>entry.link||'')],
    [1037,4,numbers(0)],[1039,8,strings('root')],[1040,8,strings('root')],[1045,4,numbers(0xffffffff)],
    [1046,4,payload.length],[1047,8,[metadata.packageName]],[1048,4,requires.map(item=>item[1])],[1049,8,requires.map(item=>item[0])],[1050,8,requires.map(item=>item[2])],
    [1064,6,'4.18.2'],[1095,4,numbers(0)],[1096,4,entries.map((_,index)=>index+1)],[1097,8,strings('')],
    [1112,4,[8]],[1113,8,[metadata.version+'-'+metadata.release]],[1116,4,dirIndexes],[1117,8,basenames],[1118,8,dirs],
    [1124,6,'cpio'],[1125,6,'gzip'],[1126,6,'0'],[1132,6,arch+'-linux'],[5011,4,8],[5062,6,'utf-8'],
    [5092,8,[await sha256Bytes(compressed)]],[5093,4,8],[5097,8,[await sha256Bytes(payload)]]
  ];
  if(metadata.homepage)tags.push([1020,6,metadata.homepage]);
  const header=rpmHeader(tags,63),body=joinBytes([header,compressed]);
  const signature=rpmHeader([[269,6,hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1',header)))],[273,6,await sha256Bytes(header)],[1000,4,body.length],[1004,7,hexBytes(md5Bytes(body))]],62);
  const lead=new Uint8Array(96),lv=new DataView(lead.buffer);lead.set([0xed,0xab,0xee,0xdb,3,0]);lv.setUint16(8,arch==='x86_64'?1:19);
  lead.set(utf8(metadata.packageName+'-'+metadata.version+'-'+metadata.release).subarray(0,65),10);lv.setUint16(76,1);lv.setUint16(78,5);
  return joinBytes([lead,signature,new Uint8Array(align(signature.length,8)-signature.length),body]);
}

import {decodeNativeBytes} from './native-text.js';
/** ZIP interoperability without a runtime dependency. Writes STORE; reads STORE/DEFLATE. */
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const cp437='ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';
const asBytes=input=>ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function unsafePath(path){return !path||/^[\\/]|^[A-Za-z]:|\0/.test(path)||path.split(/[\\/]/).includes('..');}
function concat(parts){const result=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;}
function header(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
export function writeZip(files){if(Object.keys(files).length>=65535)throw new Error('Too many entries for classic ZIP output');const locals=[],centrals=[],names=new Set();let offset=0;const now=new Date(),dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),dosDate=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  for(const [path,input]of Object.entries(files)){if(unsafePath(path))throw new Error('Unsafe ZIP path');const key=path.replace(/\\/g,'/').split('/').filter(p=>p&&p!=='.').join('/').toLowerCase();if(names.has(key))throw new Error('Duplicate ZIP entry: '+path);names.add(key);const name=encoder.encode(path),data=typeof input==='string'?encoder.encode(input):asBytes(input),crc=crc32(data);if(decoder.decode(name)!==path)throw new Error('ZIP filename contains invalid Unicode');if(name.length>65535||data.length>=0xffffffff)throw new Error('ZIP entry exceeds classic format limits');const h=header(30),v=h.view;v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(10,dosTime,true);v.setUint16(12,dosDate,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);locals.push(h.bytes,name,data);
    const c=header(46),cv=c.view;cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(12,dosTime,true);cv.setUint16(14,dosDate,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);centrals.push(c.bytes,name);offset+=h.bytes.length+name.length+data.length;
  }
  const central=concat(centrals),end=header(22),v=end.view,count=Object.keys(files).length;v.setUint32(0,0x06054b50,true);v.setUint16(8,count,true);v.setUint16(10,count,true);v.setUint32(12,central.length,true);v.setUint32(16,offset,true);return concat([...locals,central,end.bytes]);
}

function extraFields(bytes) {
  const fields = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at < bytes.length;) {
    if (at + 4 > bytes.length) throw new Error('Truncated ZIP extra field');
    const id = view.getUint16(at, true), size = view.getUint16(at + 2, true); at += 4;
    if (at + size > bytes.length) throw new Error('Truncated ZIP extra field');
    if (fields.has(id) && [1, 0x7075].includes(id)) throw new Error('Duplicate ZIP metadata field');
    fields.set(id, bytes.subarray(at, at + size)); at += size;
  }
  return fields;
}
function safe64(view, at) {
  if (at + 8 > view.byteLength) throw new Error('Truncated ZIP64 metadata');
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 value exceeds safe integer limit');
  return Number(value);
}
function extendedValues(values, fields) {
  const data = fields.get(1); let at = 0;
  return values.map(([value, sentinel, width = 8]) => {
    if (value !== sentinel) return value;
    if (!data || at + width > data.length) throw new Error('Missing or truncated ZIP64 extra field');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const result = width === 4 ? view.getUint32(at, true) : safe64(view, at); at += width;
    return result;
  });
}
export const ZIP_FILENAME_ENCODINGS=['cp437','windows-1252','windows-1250','windows-1251','windows-1253','windows-1254','windows-1255','windows-1256','windows-1257','windows-1258','windows-874','shift_jis','gbk','big5','euc-kr','utf-8'];
export function zipFilenameEncoding(value='cp437'){
  if(typeof value!=='string')throw new Error('Invalid ZIP filename encoding');
  if(['cp437','ibm437'].includes(value.toLowerCase()))return 'cp437';
  const label=new TextDecoder(value).encoding;
  if(!ZIP_FILENAME_ENCODINGS.includes(label))throw new Error('Unsupported ZIP filename encoding: '+value);
  return label;
}
function fileName(raw, flags, fields, encoding) {
  if (flags & 0x800) return decoder.decode(raw);
  const unicode = fields.get(0x7075);
  // A stale CRC or unknown version means the optional Unicode name is ignored.
  if (unicode?.length >= 5 && unicode[0] === 1 &&
      new DataView(unicode.buffer, unicode.byteOffset, unicode.byteLength).getUint32(1, true) === crc32(raw)) {
    return decoder.decode(unicode.subarray(5));
  }
  if(encoding!=='cp437')return decodeNativeBytes(raw,encoding);
  return Array.from(raw, b => b < 128 ? String.fromCharCode(b) : cp437[b - 128]).join('');
}

/** Read STORE/DEFLATE, legacy CP437/Unicode names and bounded single-disk ZIP64.
 * Central/local metadata is checked before inflation; nothing is written to disk.
 * Format references: PKWARE APPNOTE 4.3, 4.5.3, 4.6.9 and Appendix D.
 */
export async function readZip(input, {maxExpandedBytes = 50 * 1024 * 1024, maxFiles = 2000, filenameEncoding = 'cp437'} = {}) {
  filenameEncoding=zipFilenameEncoding(filenameEncoding);
  const bytes = asBytes(input), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) {
      const start=v.getUint32(i+16,true),size=v.getUint32(i+12,true);
      const zip64=i>=20&&v.getUint32(i-20,true)===0x07064b50;
      if(!zip64&&start!==0xffffffff&&size!==0xffffffff&&start+size!==i)continue;
      end = i; break;
    }
  }
  if (end < 0) throw new Error('Invalid ZIP: end record not found or truncated comment');
  let count = v.getUint16(end + 10, true), diskCount = v.getUint16(end + 8, true);
  let centralSize = v.getUint32(end + 12, true), central = v.getUint32(end + 16, true), directoryEnd = end;
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw new Error('Multi-disk ZIP is not supported');
  if (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50) {
    const locator = end - 20, z = safe64(v, locator + 8);
    if (v.getUint32(locator + 4, true) || v.getUint32(locator + 16, true) !== 1) throw new Error('Multi-disk ZIP64 is not supported');
    if (z + 56 > locator || v.getUint32(z, true) !== 0x06064b50 || z + 12 + safe64(v, z + 4) !== locator) throw new Error('Invalid ZIP64 end record');
    if (v.getUint32(z + 16, true) || v.getUint32(z + 20, true)) throw new Error('Multi-disk ZIP64 is not supported');
    const n = safe64(v, z + 32), nDisk = safe64(v, z + 24), size = safe64(v, z + 40), start = safe64(v, z + 48);
    for (const [old, value, sentinel] of [[count, n, 65535], [diskCount, nDisk, 65535], [centralSize, size, 0xffffffff], [central, start, 0xffffffff]]) {
      if (old !== sentinel && old !== value) throw new Error('Inconsistent ZIP64 end record');
    }
    count = n; diskCount = nDisk; centralSize = size; central = start; directoryEnd = z;
  } else if (count === 65535 || diskCount === 65535 || centralSize === 0xffffffff || central === 0xffffffff) {
    throw new Error('Missing ZIP64 end record');
  }
  if (count !== diskCount) throw new Error('Multi-disk ZIP is not supported');
  if (count > maxFiles) throw new Error('ZIP has too many files');
  if (central + centralSize !== directoryEnd) throw new Error('Invalid ZIP directory bounds');
  let pos = central, total = 0; const records = [], names = new Set(), ranges = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > directoryEnd || v.getUint32(pos, true) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = v.getUint16(pos + 8, true), method = v.getUint16(pos + 10, true), crc = v.getUint32(pos + 16, true);
    const nameLen = v.getUint16(pos + 28, true), extraLen = v.getUint16(pos + 30, true), commentLen = v.getUint16(pos + 32, true);
    const next = pos + 46 + nameLen + extraLen + commentLen;
    if (next > directoryEnd) throw new Error('Truncated ZIP directory entry');
    const raw = bytes.subarray(pos + 46, pos + 46 + nameLen), fields = extraFields(bytes.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen));
    const [expanded, size, offset, disk] = extendedValues([
      [v.getUint32(pos + 24, true), 0xffffffff], [v.getUint32(pos + 20, true), 0xffffffff],
      [v.getUint32(pos + 42, true), 0xffffffff], [v.getUint16(pos + 34, true), 65535, 4]
    ], fields);
    if (disk) throw new Error('Multi-disk ZIP is not supported');
    if (flags & 0x2041) throw new Error('Encrypted ZIP is not supported');
    if (![0, 8].includes(method)) throw new Error('Unsupported ZIP compression: ' + method);
    const name = fileName(raw, flags, fields, filenameEncoding), normalized = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.').join('/');
    if (unsafePath(name) || /[\x00-\x1f]/.test(name) || (!normalized && !/[\\/]$/.test(name))) throw new Error('Unsafe path in ZIP');
    if (names.has(normalized.toLowerCase())) throw new Error('Duplicate ZIP entry: ' + name);
    names.add(normalized.toLowerCase());
    total += expanded;
    if (total > maxExpandedBytes) throw new Error('ZIP expansion limit exceeded');
    if (offset + 30 > central || v.getUint32(offset, true) !== 0x04034b50) throw new Error('Invalid ZIP file header');
    const localNameLen = v.getUint16(offset + 26, true), localExtraLen = v.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLen + localExtraLen;
    if (start + size > central) throw new Error('Truncated ZIP or overlapping directory');
    if (v.getUint16(offset + 6, true) !== flags || v.getUint16(offset + 8, true) !== method ||
        raw.length !== localNameLen || raw.some((b, n) => b !== bytes[offset + 30 + n])) throw new Error('ZIP local/central header mismatch');
    const localFields = extraFields(bytes.subarray(offset + 30 + localNameLen, start));
    let rangeEnd = start + size;
    if (!(flags & 8)) {
      const [localExpanded, localSize] = extendedValues([[v.getUint32(offset + 22, true), 0xffffffff], [v.getUint32(offset + 18, true), 0xffffffff]], localFields);
      if (localExpanded !== expanded || localSize !== size || v.getUint32(offset + 14, true) !== crc) throw new Error('ZIP size/checksum header mismatch');
    } else {
      const zip64 = localFields.has(1) || fields.has(1), width = zip64 ? 8 : 4;
      // Descriptor signatures are optional; a CRC may itself equal the signature.
      const candidates = [rangeEnd, rangeEnd + 4].filter(at => at === rangeEnd || rangeEnd + 4 <= central && v.getUint32(rangeEnd, true) === 0x08074b50);
      const found = candidates.find(at => {
        if (at + 4 + width * 2 > central || v.getUint32(at, true) !== crc) return false;
        const a = zip64 ? safe64(v, at + 4) : v.getUint32(at + 4, true), b = zip64 ? safe64(v, at + 12) : v.getUint32(at + 8, true);
        return a === size && b === expanded;
      });
      if (found === undefined) throw new Error('Invalid ZIP data descriptor');
      rangeEnd = found + 4 + width * 2;
    }
    ranges.push([offset, rangeEnd]);
    const directory = /[\\/]$/.test(name);
    if (directory && expanded) throw new Error('ZIP directory contains file data');
    records.push({name: normalized, start, size, expanded, method, crc, directory});
    pos = next;
  }
  if (pos < directoryEnd && pos + 6 <= directoryEnd && v.getUint32(pos, true) === 0x05054b50) pos += 6 + v.getUint16(pos + 4, true);
  if (pos !== directoryEnd) throw new Error('Invalid ZIP directory length or entry count');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw new Error('Overlapping ZIP entries');
  const files = new Map();
  for (const record of records) {
    const {name, start, size, expanded, method, crc} = record; let data = bytes.slice(start, start + size);
    if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress ZIP files; extract them and import the source files together.');
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = []; let length = 0;
      try {
        while (true) {
          const result = await reader.read(); if (result.done) break;
          length += result.value.length;
          if (length > expanded || length > maxExpandedBytes) throw new Error('ZIP expansion exceeds declared size');
          chunks.push(result.value);
        }
      } catch (error) { try { await reader.cancel(); } catch {} throw error; }
      finally { reader.releaseLock(); }
      data = concat(chunks);
    }
    if (data.length !== expanded || crc32(data) !== crc) throw new Error('ZIP checksum mismatch: ' + name);
    if(!record.directory)files.set(name, data);
  }
  return files;
}

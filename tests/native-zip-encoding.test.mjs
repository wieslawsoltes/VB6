import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readZip,zipFilenameEncoding} from '../src/project/zip.js';
import {encodeNativeText,bytesOf} from '../src/project/native-text.js';
function crc(data) {
  let value = -1;
  for (const byte of data) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ -1) >>> 0;
}
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
function field(id, data) { const b = Buffer.alloc(4); b.writeUInt16LE(id); b.writeUInt16LE(data.length, 2); return Buffer.concat([b, data]); }
function upath(name, raw, {version = 1, checksum = crc(raw)} = {}) {
  const h = Buffer.alloc(5); h[0] = version; h.writeUInt32LE(checksum, 1);
  return field(0x7075, Buffer.concat([h, Buffer.isBuffer(name) ? name : Buffer.from(name)]));
}
function fixture(entries = [{}], {end64 = false, comment = Buffer.alloc(0)} = {}) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const raw = e.raw || Buffer.from(e.name || 'M.bas'), data = Buffer.from(e.data ?? 'source\r\n');
    const compressed = e.method === 8 ? deflateRawSync(data) : data, checksum = crc(data);
    const flags = e.flags ?? (e.descriptor ? 8 : 0), local64 = !!e.local64, central64 = !!e.central64;
    const extra = e.extra || (e.unicode ? upath(e.unicode, raw, e.unicodeOptions) : Buffer.alloc(0));
    const localExtra = Buffer.concat([local64 ? field(1, Buffer.concat([u64(data.length), u64(compressed.length)])) : Buffer.alloc(0), extra]);
    const centralExtra = Buffer.concat([central64 ? field(1, Buffer.concat([u64(data.length), u64(compressed.length), u64(offset)])) : Buffer.alloc(0), extra]);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(local64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(e.method || 0, 8);
    local.writeUInt32LE(e.descriptor ? 0 : checksum, 14);
    local.writeUInt32LE(local64 ? 0xffffffff : e.descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(local64 ? 0xffffffff : e.descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(raw.length, 26); local.writeUInt16LE(localExtra.length, 28);
    let descriptor = Buffer.alloc(0);
    if (e.descriptor) {
      const signature = e.descriptor === 'unsigned' ? 0 : 4, width = local64 || central64 ? 8 : 4;
      descriptor = Buffer.alloc(signature + 4 + width * 2);
      if (signature) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, signature);
      if (width === 8) { descriptor.writeBigUInt64LE(BigInt(compressed.length), signature + 4); descriptor.writeBigUInt64LE(BigInt(data.length), signature + 12); }
      else { descriptor.writeUInt32LE(compressed.length, signature + 4); descriptor.writeUInt32LE(data.length, signature + 8); }
    }
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(central64 ? 45 : 20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(e.method || 0, 10); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(central64 ? 0xffffffff : compressed.length, 20); central.writeUInt32LE(central64 ? 0xffffffff : data.length, 24);
    central.writeUInt16LE(raw.length, 28); central.writeUInt16LE(centralExtra.length, 30); central.writeUInt32LE(central64 ? 0xffffffff : offset, 42);
    const block = Buffer.concat([local, raw, localExtra, compressed, descriptor]); locals.push(block); offset += block.length;
    centrals.push(central, raw, centralExtra);
  }
  const directory = Buffer.concat(centrals), footer = Buffer.alloc(22), extensions = [];
  if (end64) {
    const end = Buffer.alloc(56), locator = Buffer.alloc(20); end.writeUInt32LE(0x06064b50); end.writeBigUInt64LE(44n, 4);
    end.writeUInt16LE(45, 12); end.writeUInt16LE(45, 14); end.writeBigUInt64LE(BigInt(entries.length), 24); end.writeBigUInt64LE(BigInt(entries.length), 32);
    end.writeBigUInt64LE(BigInt(directory.length), 40); end.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + directory.length), 8); locator.writeUInt32LE(1, 16); extensions.push(end, locator);
  }
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(end64 ? 65535 : entries.length, 8); footer.writeUInt16LE(end64 ? 65535 : entries.length, 10);
  footer.writeUInt32LE(end64 ? 0xffffffff : directory.length, 12); footer.writeUInt32LE(end64 ? 0xffffffff : offset, 16); footer.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, ...extensions, footer, comment]);
}

for(const [encoding,name]of [['windows-1250','zażółć.bas'],['windows-1251','Привет.bas'],['windows-1252','café.bas'],['shift_jis','日本語.bas'],['gbk','中文.bas'],['big5','中文.bas'],['euc-kr','한글.bas']])test('explicit ZIP filename encoding '+encoding,async()=>{const raw=Buffer.from(bytesOf(encodeNativeText(name,{encoding}))),out=await readZip(fixture([{raw}]),{filenameEncoding:encoding});assert.deepEqual([...out.keys()],[name]);});
test('Unicode path field has precedence over explicitly supplied code page',async()=>{const out=await readZip(fixture([{raw:Buffer.from('wrong.bas'),unicode:'日本語.bas'}]),{filenameEncoding:'windows-1250'});assert.deepEqual([...out.keys()],['日本語.bas']);});
test('UTF-8 general-purpose flag has precedence over explicit legacy encoding',async()=>{const out=await readZip(fixture([{name:'Żółć.bas',flags:2048}]),{filenameEncoding:'shift_jis'});assert.deepEqual([...out.keys()],['Żółć.bas']);});
test('default ZIP legacy decoding stays CP437',async()=>{assert.deepEqual([...(await readZip(fixture([{raw:Buffer.from('caf\x82.bas','latin1')}]))).keys()],['café.bas']);});
for(const encoding of ['utf-16le','replacement','bogus',{},null])test('invalid filename encoding rejected '+String(encoding),()=>assert.throws(()=>zipFilenameEncoding(encoding)));
test('truncated DBCS filename fails rather than replacement-character rename',async()=>{await assert.rejects(()=>readZip(fixture([{raw:Buffer.from([0x82])}]),{filenameEncoding:'shift_jis'}));});

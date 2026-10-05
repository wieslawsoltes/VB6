import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readZip, writeZip} from '../src/project/zip.js';

// Independent record builder: it deliberately does not call the production
// writer or CRC function. Layout follows PKWARE APPNOTE 4.3/4.5.3/4.6.9.
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
const directoryAt = b => b.indexOf(Buffer.from('504b0102', 'hex'));
const content = f => new TextDecoder().decode(f.values().next().value);

test('CP437 filenames decode independently of source text encoding', async () => {
  const files = await readZip(fixture([{raw: Buffer.from('caf\x82.bas', 'latin1')}]));
  assert.deepEqual([...files.keys()], ['café.bas']); assert.equal(content(files), 'source\r\n');
});
test('validated Info-ZIP Unicode path overrides the legacy filename', async () => {
  assert.deepEqual([...await readZip(fixture([{raw: Buffer.from('legacy.bas'), unicode: 'żółć/日本語.bas'}]))].map(([n]) => n), ['żółć/日本語.bas']);
});
for (const options of [{checksum: 0}, {version: 2}]) test('stale/unknown Unicode path extra is ignored: ' + JSON.stringify(options), async () => {
  assert.deepEqual([...await readZip(fixture([{name: 'old.bas', unicode: 'new.bas', unicodeOptions: options}]))].map(([n]) => n), ['old.bas']);
});
test('UTF-8 flag is authoritative over stale Unicode extras', async () => {
  assert.deepEqual([...await readZip(fixture([{name: 'żółć.bas', flags: 0x800, unicode: 'obsolete.bas'}]))].map(([n]) => n), ['żółć.bas']);
});
test('invalid UTF-8 flagged filenames are rejected, not replaced', async () => {
  await assert.rejects(() => readZip(fixture([{raw: Buffer.from([0xff, 0x2e, 0x62, 0x61, 0x73]), flags: 0x800}])), /encoding|UTF|valid/i);
});
test('unsafe paths in verified Unicode metadata are rejected', async () => {
  await assert.rejects(() => readZip(fixture([{name: 'safe.bas', unicode: '../escape.bas'}])), /Unsafe path/);
});
test('Unicode extra names participate in case-insensitive collision checks', async () => {
  await assert.rejects(() => readZip(fixture([{name: 'a', unicode: 'M.bas'}, {name: 'b', unicode: 'm.BAS'}])), /Duplicate/);
});
for (const local64 of [false, true]) for (const end64 of [false, true]) test(`bounded ZIP64 local=${local64} footer=${end64}`, async () => {
  const files = await readZip(fixture([{local64, central64: end64, method: 8}], {end64})); assert.equal(content(files), 'source\r\n');
});
for (const descriptor of ['signed', 'unsigned']) for (const local64 of [false, true]) test(`streaming descriptor ${descriptor}, ZIP64=${local64}`, async () => {
  assert.equal(content(await readZip(fixture([{method: 8, descriptor, local64}]))), 'source\r\n');
});
test('ZIP comments may contain a false end-record signature', async () => {
  const comment = Buffer.alloc(22); comment.writeUInt32LE(0x06054b50);
  assert.equal(content(await readZip(fixture([{}], {comment}))), 'source\r\n');
});
test('compressed empty directory records do not become files', async () => {
  assert.deepEqual([...await readZip(fixture([{name: 'dir/', data: '', method: 8}, {name: 'dir/M.bas'}]))].map(([n]) => n), ['dir/M.bas']);
});
test('empty classic and ZIP64 archives remain valid', async () => {
  for (const end64 of [false, true]) assert.equal((await readZip(fixture([], {end64}))).size, 0);
});
for (const [label, mutate] of [
  ['disk count', b => b.writeUInt16LE(1, b.length - 18)],
  ['central entry count', b => { b.writeUInt16LE(0, b.length - 14); b.writeUInt16LE(0, b.length - 12); }],
  ['local method', b => b.writeUInt16LE(8, 8)],
  ['local filename', b => b[30] = 88],
  ['local checksum', b => b.writeUInt32LE(0, 14)],
  ['central variable lengths', b => b.writeUInt16LE(65535, directoryAt(b) + 30)],
  ['missing ZIP64 extra', b => b.writeUInt32LE(0xffffffff, directoryAt(b) + 24)],
  ['truncated end comment', b => b.writeUInt16LE(10, b.length - 2)]
]) test('malformed archive rejects ' + label, async () => {
  const b = fixture(); mutate(b); await assert.rejects(() => readZip(b), /ZIP/);
});
test('corrupt streaming descriptor is rejected', async () => {
  const b = fixture([{descriptor: 'signed'}]); b.writeUInt32LE(0, directoryAt(b) - 12); await assert.rejects(() => readZip(b), /descriptor/);
});
test('ZIP64 safe integer and expansion limits apply before allocation', async () => {
  const b = fixture([{local64: true, central64: true}], {end64: true}), at = directoryAt(b) + 46 + 'M.bas'.length + 4;
  b.writeBigUInt64LE(0xffffffffffffffffn, at); await assert.rejects(() => readZip(b), /safe integer/);
  await assert.rejects(() => readZip(fixture([{data: '123456789', local64: true}], {end64: true}), {maxExpandedBytes: 8}), /expansion limit/);
});
test('all directory metadata is checked before inflating the first file', async () => {
  const original = globalThis.DecompressionStream; let inflations = 0;
  globalThis.DecompressionStream = class extends original { constructor(format) { super(format); inflations++; } };
  try { await assert.rejects(() => readZip(fixture([{method: 8}, {name: 'bad.bas', flags: 1}])), /Encrypted/); assert.equal(inflations, 0); }
  finally { globalThis.DecompressionStream = original; }
});
test('duplicate Unicode metadata is rejected', async () => {
  const raw = Buffer.from('M.bas'), extra = Buffer.concat([upath('M.bas', raw), upath('Other.bas', raw)]);
  await assert.rejects(() => readZip(fixture([{raw, extra}])), /Duplicate ZIP metadata/);
});
test('ZIP writer respects typed-array view boundaries', async () => {
  const data = Uint8Array.of(8, 1, 2, 9); assert.deepEqual((await readZip(writeZip({'M.bin': new DataView(data.buffer, 1, 2)}))).get('M.bin'), Uint8Array.of(1, 2));
});
test('ZIP reader respects typed-array view boundaries', async () => {
  const zip = fixture(), wrapped = Buffer.concat([Buffer.from([1, 2]), zip, Buffer.from([3, 4])]);
  assert.equal(content(await readZip(new DataView(wrapped.buffer, wrapped.byteOffset + 2, zip.length))), 'source\r\n');
});
test('ZIP writer rejects name-length overflow and malformed Unicode', () => {
  assert.throws(() => writeZip({['a'.repeat(65536)]: ''}), /limits/);
  assert.throws(() => writeZip({'bad\ud800.bas': ''}), /Unicode/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {relocateAppImageGtkData,appImageGtkDataNotice} from '../packages/linux-native/src/appimage-gtk-data.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(machine=62) {
  const bytes=Buffer.alloc(640);
  Buffer.from('7f454c4602010100','hex').copy(bytes);
  bytes.writeUInt16LE(3,16);bytes.writeUInt16LE(machine,18);
  bytes.writeBigUInt64LE(64n,32);bytes.writeBigUInt64LE(192n,40);
  bytes.writeUInt16LE(64,52);bytes.writeUInt16LE(56,54);bytes.writeUInt16LE(1,56);bytes.writeUInt16LE(64,58);bytes.writeUInt16LE(2,60);
  bytes.writeUInt32LE(1,64);bytes.writeUInt32LE(4,68);bytes.writeBigUInt64LE(320n,72);bytes.writeBigUInt64LE(320n,96);
  bytes.writeUInt32LE(1,260);bytes.writeBigUInt64LE(2n,264);bytes.writeBigUInt64LE(320n,280);bytes.writeBigUInt64LE(320n,288);
  Buffer.from('/usr/share/xml/iso-codes\0').copy(bytes,384);
  return bytes;
}
for(const machine of [62,183])test('GTK data relocation is reversible and confined to one read-only byte range ('+machine+')',()=>{
  const original=fixture(machine),saved=Buffer.from(original),{bytes,change}=relocateAppImageGtkData(new Uint8Array(original));
  assert.deepEqual(original,saved);assert.equal(change.originalSha256,hash(original));assert.equal(change.sha256,hash(bytes));
  assert.equal(change.offset,384);assert.equal(change.length,25);assert.equal(change.descriptor,9);
  assert.equal(bytes.subarray(384,409).toString('hex'),Buffer.concat([Buffer.from('/proc/self/fd/9\0'),Buffer.alloc(9)]).toString('hex'));
  assert.deepEqual(bytes.subarray(0,384),original.subarray(0,384));assert.deepEqual(bytes.subarray(409),original.subarray(409));
  Buffer.from(change.original,'hex').copy(bytes,change.offset);assert.deepEqual(bytes,original);
  const notice=appImageGtkDataNotice([{path:'usr/lib/libgtk-4.so.1',...change}]);
  assert.ok(notice.includes(change.originalSha256)&&notice.includes(change.sha256)&&notice.includes(change.replacement));
});
test('GTK data relocation rejects missing, partial and ambiguous strings',()=>{
  const missing=fixture();missing[384]=0;assert.throws(()=>relocateAppImageGtkData(missing),/exactly one complete/);
  const partial=fixture();partial[383]=65;assert.throws(()=>relocateAppImageGtkData(partial),/exactly one complete/);
  const ambiguous=fixture();Buffer.from('/usr/share/xml/iso-codes\0').copy(ambiguous,448);assert.throws(()=>relocateAppImageGtkData(ambiguous),/exactly one complete/);
});
test('GTK data relocation rejects writable, executable, compressed and unallocated sections',()=>{
  for(const flags of [0n,3n,6n,0x402n,0x802n]){
    const bytes=fixture();bytes.writeBigUInt64LE(flags,264);assert.throws(()=>relocateAppImageGtkData(bytes),/allocated read-only ELF data/);
  }
  const noData=fixture();noData.writeUInt32LE(8,260);assert.throws(()=>relocateAppImageGtkData(noData),/allocated read-only ELF data/);
});
test('GTK data relocation rejects writable and partially overlapping load segments',()=>{
  const writable=fixture();writable.writeUInt32LE(6,68);assert.throws(()=>relocateAppImageGtkData(writable),/read-only ELF load segment/);
  const overlapping=fixture();overlapping.writeUInt16LE(2,56);overlapping.writeUInt32LE(1,120);overlapping.writeUInt32LE(6,124);
  overlapping.writeBigUInt64LE(390n,128);overlapping.writeBigUInt64LE(2n,152);
  assert.throws(()=>relocateAppImageGtkData(overlapping),/read-only ELF load segment/);
});
test('GTK data relocation rejects malformed ELF tables and invalid architecture',()=>{
  assert.throws(()=>relocateAppImageGtkData(fixture(3)),/shared ELF/);
  const executable=fixture();executable.writeUInt16LE(2,16);assert.throws(()=>relocateAppImageGtkData(executable),/shared ELF/);
  const huge=fixture();huge.writeBigUInt64LE(0xffffffffffffffffn,40);assert.throws(()=>relocateAppImageGtkData(huge),/out-of-bounds/);
  const short=fixture();short.writeUInt16LE(63,58);assert.throws(()=>relocateAppImageGtkData(short),/bounded ELF/);
  const badSection=fixture();badSection.writeBigUInt64LE(600n,288);assert.throws(()=>relocateAppImageGtkData(badSection),/out-of-bounds ELF section/);
  assert.throws(()=>relocateAppImageGtkData(Buffer.alloc(8)),/shared ELF/);
});

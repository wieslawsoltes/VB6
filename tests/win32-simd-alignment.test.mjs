import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblerFixture} from '../tools/win32-optimizer-fixtures.mjs';
for(const optimization of [0,1,2])test(`native SIMD fixture explicitly covers aligned and unaligned memory at O${optimization}`,()=>{
  const {bytes,report,checks}=assemblerFixture(optimization);
  assert.notEqual(report.dataAddresses.packed%16,0,'MOVDQU fixture must remain genuinely unaligned');
  assert.equal(report.dataAddresses.alignedPacked%16,0,'legacy PADDD memory requires 16-byte alignment');
  assert.notEqual(report.dataAddresses.result%16,0,'MOVDQU stores must cover an unaligned destination');
  assert.equal(checks.filter(s=>s.startsWith('aligned SSE2 memory lane')).length,4);
  const text=report.sections.find(s=>s.name==='.text');
  const code=Buffer.from(bytes.subarray(text.offset,text.offset+text.size));
  assert.ok(code.includes(Buffer.from([0xf3,0x0f,0x6f,0x2d])),'unaligned MOVDQU load to xmm5');
  assert.ok(code.includes(Buffer.from([0x66,0x0f,0xfe,0xe5])),'register PADDD consumes the unaligned load');
});

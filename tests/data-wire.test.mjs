import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {encodeCell,decodeCell,encodeResult,decodeResult} from '../src/data/wire.js';

const roundTrip=value=>decodeCell(JSON.parse(JSON.stringify(encodeCell(value))));
test('native ArrayBuffer BLOBs survive JSON transport including empty values',()=>{
 for(const expected of [[],[0,127,128,255],Array.from({length:20000},(_,i)=>i%256)]){
  assert.deepEqual([...roundTrip(Uint8Array.from(expected).buffer)],expected);
 }
});
test('binary views transmit only their byte range, not the backing buffer',()=>{
 const bytes=Uint8Array.of(99,98,0,127,128,255,97,96);
 const expected=[0,127,128,255];
 for(const value of [bytes.subarray(2,6),Buffer.from(bytes.buffer,2,4),new DataView(bytes.buffer,2,4),new Uint16Array(bytes.buffer,2,2)]){
  assert.deepEqual([...roundTrip(value)],expected);
 }
 assert.deepEqual([...roundTrip(new DataView(bytes.buffer,2,0))],[]);
});
test('binary views from another realm preserve bytes',()=>{
 const value=vm.runInNewContext('Uint8Array.of(9,0,128,255,8).subarray(1,4)');
 assert.deepEqual([...roundTrip(value)],[0,128,255]);
});
test('gateway results preserve native BLOBs, nulls and dates together',()=>{
 const date=new Date('2024-01-02T03:04:05.000Z');
 const result={columns:[{Name:'payload'},{Name:'missing'},{Name:'date'}],values:[[Uint8Array.of(0,128,255).buffer,null,date]],rowsAffected:1};
 const decoded=decodeResult(JSON.parse(JSON.stringify(encodeResult(result))));
 assert.deepEqual(decoded,{...result,values:[[Uint8Array.of(0,128,255),null,date]]});
});

test('bare ArrayBuffers from another realm survive JSON transport',()=>{
 for(const expression of ['new ArrayBuffer(0)','Uint8Array.of(0,127,128,255).buffer']){
  const value=vm.runInNewContext(expression);
  assert.deepEqual([...roundTrip(value)],[...new Uint8Array(value)]);
 }
});
test('an ArrayBuffer-looking plain object is not treated as a native buffer',()=>{
 const value={[Symbol.toStringTag]:'ArrayBuffer',byteLength:4,marker:'not a buffer'};
 assert.equal(encodeCell(value),value);
});

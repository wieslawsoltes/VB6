import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {nativeFileMachine} from './support/native-file-machine.mjs';

const code=`Sub Main
Dim value As Byte
Open "x" For Binary As #1
Put #1, , value
Get #1, 1, value
Close #1
End Sub`;
const error=number=>exception=>exception.number===number;
const setup=(t,optimization=1)=>{
  const f=nativeFileMachine(t,{code,optimization});
  f.transfer=(entry,position,buffer,size,writing)=>f.vm.invoke('proc:NativeFileBinary:Transfer',[entry,f.generation(entry),position,buffer,size,writing?-1:0]);
  return f;
};

for(const optimization of [0,1,2])test(`emitted Binary transfers preserve every byte and change I/O direction safely O${optimization}`,t=>{
  const f=setup(t,optimization),entry=f.open('x',1,4|(3<<8)),buffer=f.m.alloc(256);
  for(let i=0;i<256;i++)f.m.write(buffer+i,i,8);
  assert.equal(f.invoke('attr',entry,1),32);assert.equal(f.invoke('eof',entry),0xffffffff);
  f.failures.set('partialWrite',17);f.transfer(entry,0,buffer,256,true);
  assert.deepEqual([...f.files.get('x').bytes],Array.from({length:256},(_,i)=>i));
  assert.equal(f.invoke('length',entry),256);assert.equal(f.invoke('loc',entry),256);assert.equal(f.invoke('seek-position',entry),257);
  f.invoke('seek-to',entry,f.generation(entry),1);assert.equal(f.invoke('eof',entry),0);
  assert.equal(f.invoke('read-byte',entry),0); // read-ahead must not move the next direct write.
  f.m.write(buffer,255,8);f.transfer(entry,0,buffer,1,true);assert.equal(f.files.get('x').bytes[1],255);
  f.failures.set('partial',13);f.transfer(entry,1,buffer,256,false);
  assert.deepEqual(Array.from({length:256},(_,i)=>f.m.read(buffer+i,8)),[0,255,...Array.from({length:254},(_,i)=>i+2)]);
  assert.equal(f.invoke('eof',entry),0xffffffff);f.invoke('close',1);assert.equal(f.handles.size,0);f.m.free(buffer);
});

test('Random transfers use record numbers, preserve existing padding and extend new records with zero bytes',t=>{
  const f=setup(t);f.add('x',[1,2,3,4,5,6,7,8]);const entry=f.open('x',1,5|(3<<8),8),buffer=f.m.alloc(4);
  f.m.write(buffer,0x44332211);f.transfer(entry,1,buffer,4,true);
  assert.deepEqual([...f.files.get('x').bytes],[0x11,0x22,0x33,0x44,5,6,7,8]);
  assert.equal(f.invoke('seek-position',entry),2);assert.equal(f.invoke('loc',entry),1);assert.equal(f.invoke('attr',entry,1),4);
  f.m.write(buffer,0x88776655);f.transfer(entry,2,buffer,4,true);
  assert.deepEqual([...f.files.get('x').bytes],[0x11,0x22,0x33,0x44,5,6,7,8,0x55,0x66,0x77,0x88,0,0,0,0]);
  assert.equal(f.invoke('length',entry),16);assert.equal(f.invoke('seek-position',entry),3);assert.equal(f.invoke('loc',entry),2);
  f.transfer(entry,1,buffer,4,false);assert.equal(f.m.read(buffer),0x44332211);
  assert.equal(f.invoke('seek-position',entry),2);assert.equal(f.invoke('loc',entry),1);f.invoke('close',1);f.m.free(buffer);
});

test('read-only Binary Open requires an existing file and never truncates it',t=>{
  const f=setup(t);assert.throws(()=>f.open('missing',1,4|(1<<8)),error(53));assert.equal(f.files.size,0);
  f.add('x',[0,128,255]);const entry=f.open('x',1,4|(1<<8)),buffer=f.m.alloc(4);
  f.transfer(entry,0,buffer,3,false);assert.deepEqual([0,1,2].map(i=>f.m.read(buffer+i,8)),[0,128,255]);
  assert.throws(()=>f.transfer(entry,0,buffer,1,true),error(54));assert.deepEqual([...f.files.get('x').bytes],[0,128,255]);
});

test('an incomplete record, oversized record, access failure and stale generation fail before changing the destination',t=>{
  const f=setup(t);f.add('x',[1,2,3]);const entry=f.open('x',1,5|(3<<8),4),buffer=f.m.alloc(8);
  f.m.write(buffer,0xaabbccdd);assert.throws(()=>f.transfer(entry,1,buffer,4,false),error(62));assert.equal(f.m.read(buffer),0xaabbccdd);
  assert.throws(()=>f.transfer(entry,1,buffer,5,true),error(59));
  const generation=f.generation(entry);f.invoke('close',1);f.open('x',1,4|(2<<8));
  const count=f.vm.calls.length;
  assert.throws(()=>f.vm.invoke('proc:NativeFileBinary:Transfer',[entry,generation,0,buffer,1,0]),error(52));
  assert.ok(!f.vm.calls.slice(count).some(call=>/ReadFile|WriteFile/.test(call.name)));
});

test('FileLen, Name, FileCopy and Kill use validated Win32 paths',t=>{
  const f=setup(t);f.add('source',[0,128,255]);const from=f.m.string('source'),to=f.m.string('target'),copy=f.m.string('copy');
  assert.equal(f.invoke('path-length',from),3);f.invoke('copy-path',from,copy);f.invoke('rename-path',from,to);
  assert.deepEqual([...f.files.get('target').bytes],[0,128,255]);assert.deepEqual([...f.files.get('copy').bytes],[0,128,255]);assert.ok(!f.files.has('source'));
  f.invoke('delete-path',to);assert.ok(!f.files.has('target'));
  assert.throws(()=>f.invoke('path-length',from),error(53));
  const nul=f.m.string('copy\0hidden');assert.throws(()=>f.invoke('delete-path',nul),error(52));assert.ok(f.files.has('copy'));
});

test('numeric scalar Get/Put including array and record elements compile at every optimization level',()=>{
  const source=`Private Type Item
  Value As Long
End Type
Sub Main
  Dim b As Byte, i As Integer, l As Long, s As Single, d As Double, c As Currency, dt As Date, flag As Boolean
  Dim values(1 To 2) As Integer, item As Item
  Open "x" For Random Access Read Write As #1 Len = 128
  Put #1, 1, b
  Put #1, 2, i
  Put #1, 3, l
  Put #1, 4, s
  Put #1, 5, d
  Put #1, 6, c
  Put #1, 7, dt
  Put #1, 8, flag
  Get #1, 1, values(2)
  Get #1, 2, item.Value
  Close #1
End Sub`;
  const p={schema:1,name:'ScalarFileRecords',startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]},before=structuredClone(p);
  for(const optimization of [0,1,2]){
    const result=compileWin32(p,{optimization});assert.equal(result.report.target,'win32-aot');
    assert.ok(result.report.imports.some(item=>item.symbol==='ReadFile'));assert.ok(result.report.imports.some(item=>item.symbol==='WriteFile'));
  }
  assert.deepEqual(p,before);
});

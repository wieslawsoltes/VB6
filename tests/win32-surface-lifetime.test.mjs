import test from 'node:test';import assert from 'node:assert/strict';
import {surfaceMachine} from './support/native-surface-abi.mjs';
for(const optimization of [0,1,2]){
 test(`surface IA-32 allocation, growth, presentation and disposal O${optimization}`,t=>{
  const m=surfaceMachine(t,optimization),initial=m.count();assert.equal(m.call('TryDC'),0);
  const hdc=m.read('dc');assert.equal(m.count(),initial+2);assert.ok(m.pixels().pixels.every(p=>p===0xabcdef));
  m.pixels().pixels[3]=0x112233;m.dc().transform=9;m.dc().clip=7;m.dc().origin=[3,4,5,6];
  m.resize(12,10);assert.equal(m.call('TryDC'),0);assert.equal(m.read('dc'),hdc,'growth retains the HDC identity');assert.equal(m.count(),initial+2);assert.equal(m.pixels().pixels[3],0x112233);assert.equal(m.pixels().pixels[119],0xabcdef);
  assert.equal(m.dc().transform,9);assert.equal(m.dc().clip,7);assert.deepEqual(m.dc().origin,[3,4,5,6]);
  m.resize(4,3);assert.equal(m.call('TryDC'),0);assert.equal(m.read('width'),12);assert.equal(m.read('height'),10);
  assert.equal(m.call('TryPaint'),0);assert.equal(m.output().pixels[3],0x112233);assert.equal(m.dc().transform,9);assert.equal(m.dc().saved.length,0);
  assert.equal(m.call('TryDestroy'),0);assert.equal(m.read('hwnd'),0);assert.equal(m.read('dc'),0);assert.equal(m.count(),initial);assert.equal(m.call('TryDestroy'),0);assert.equal(m.count(),initial);
 });
 for(const fn of ['CreateCompatibleDC','CreateDIBSection','SelectObject','SaveDC','CreateSolidBrush','FillRect','SetGraphicsMode','ModifyWorldTransform','SetMapMode','SetWindowOrgEx','SetViewportOrgEx','SelectClipRgn'])
 test(`surface initial ${fn} failure releases unpublished ownership O${optimization}`,t=>{
  const m=surfaceMachine(t,optimization),initial=m.count();m.fail(fn);assert.ok([5,7].includes(m.call('TryDC')));assert.equal(m.read('dc'),0);assert.equal(m.read('bitmap'),0);assert.equal(m.count(),initial);
  assert.equal(m.call('TryDC'),0,'failure remains recoverable');assert.equal(m.call('TryDestroy'),0);assert.equal(m.count(),initial);
 });
 for(const [fn,after]of [['CreateDIBSection',1],['CreateSolidBrush',1],['BitBlt',1],['SelectObject',2],['SelectObject',3],['SaveDC',2],['ModifyWorldTransform',2]])
 test(`surface resize ${fn}/${after} rollback preserves old backing O${optimization}`,t=>{
  const m=surfaceMachine(t,optimization);assert.equal(m.call('TryDC'),0);const original=[m.read('dc'),m.read('bitmap'),m.count()];m.pixels().pixels[1]=0x987654;m.dc().transform=11;
  m.resize(16,12);m.fail(fn,after);assert.ok([5,7].includes(m.call('TryDC')));assert.deepEqual([m.read('dc'),m.read('bitmap'),m.count()],original);assert.equal(m.read('width'),8);assert.equal(m.pixels().pixels[1],0x987654);assert.equal(m.dc().transform,11);assert.equal(m.dc().saved.length,0);
  assert.equal(m.call('TryDC'),0);assert.equal(m.pixels().pixels[1],0x987654);assert.equal(m.call('TryDestroy'),0);
 });
 test(`empty/minimized client presentation does not submit invalid blits O${optimization}`,t=>{
  const m=surfaceMachine(t,optimization);assert.equal(m.call('TryDC'),0);const count=m.count(),blits=m.vm.calls.filter(c=>c.name?.endsWith('!BitBlt')).length;
  m.resize(0,0);assert.equal(m.call('TryPaint'),0);assert.equal(m.count(),count);assert.equal(m.dc().saved.length,0);assert.equal(m.vm.calls.filter(c=>c.name?.endsWith('!BitBlt')).length,blits);
 });
 test(`surface bounds and stale-window errors do not allocate O${optimization}`,t=>{
  const m=surfaceMachine(t,optimization),initial=m.count();m.resize(16385,1);assert.equal(m.call('TryDC'),7);assert.equal(m.count(),initial);m.resize(8193,8193);assert.equal(m.call('TryDC'),7);assert.equal(m.count(),initial);m.invalidate();assert.equal(m.call('TryDC'),91);assert.equal(m.count(),initial);
 });
}

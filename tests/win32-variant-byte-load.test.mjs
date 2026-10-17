import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';

// VT_UI1 defines bVal, not the adjacent union padding. Real OleAut32 may copy
// unspecified padding during same-tag coercion; poison it deliberately rather
// than using a zero-filled API double that conceals an over-wide load.
for(const optimization of [0,1,2])test(`Variant Byte conversion reads exactly bVal O${optimization}`,t=>{
  let linked;const finish=PE32Image.prototype.finish;
  const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
  try{
    compileWin32({...newProject('ByteABI'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:
      'Sub Main\nDim v As Variant, b As Byte\nv=CByte(255)\nb=CopyByte(v)\nEnd Sub\nPublic Function CopyByte(ByVal v As Variant) As Byte\nCopyByte=v\nEnd Function'}]}, {optimization});
  }finally{mock.mock.restore();}
  const cpu=new NativeX86Machine(linked),m=cpu.memory;
  cpu.hook('oleaut32.dll','VariantClear',1,([p])=>{m.write(p,0,16);return 0;});
  cpu.hook('oleaut32.dll','VariantCopyInd',2,([out,src])=>{for(let i=0;i<16;i+=4)m.write(out+i,m.read(src+i));return 0;});
  cpu.hook('oleaut32.dll','VariantChangeTypeEx',5,([out,src,locale,flags,vt])=>{
    assert.equal(vt,17);assert.equal(m.read(src,16),17);
    for(let i=0;i<16;i+=4)m.write(out+i,m.read(src+i));return 0;
  });
  const value=m.alloc(16,'VT_UI1');
  for(const byte of [0,1,127,128,255])for(const poison of [0,0x12345600,0x7fffff00,0xffffff00]){
    for(let i=0;i<16;i+=4)m.write(value+i,0);m.write(value,17,16);m.write(value+8,(poison|byte)>>>0);
    assert.equal(cpu.invoke('proc:M:CopyByte',[value]),byte,`bVal=${byte}, padding=${poison.toString(16)}`);
  }
});

for(const optimization of [0,1,2])test(`native padding fixture is admitted with every check O${optimization}`,async()=>{
  const {nativeControlFixtures}=await import('../tools/win32-control-fixtures.mjs');
  const fixture=nativeControlFixtures().find(f=>f.project.name==='AotControlInputFields');
  assert.equal(fixture.checks.filter(s=>s.startsWith('VT_UI1 ')).length,15);
  const a=compileWin32(fixture.project,{optimization}),b=compileWin32(fixture.project,{optimization});
  assert.deepEqual(a.bytes,b.bytes);
});

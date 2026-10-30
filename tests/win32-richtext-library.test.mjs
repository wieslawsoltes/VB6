import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';
import {compileWin32} from '../src/native/compiler.js';
import {newProject,createControl} from '../src/project/model.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';

function machine(t,optimization){
  const project=newProject('RichEditSystemLibrary');
  project.modules[0].form.controls=[createControl('RichTextBox','Rich')];
  let linked;const finish=PE32Image.prototype.finish;
  t.mock.method(PE32Image.prototype,'finish',function(...args){linked=finish.apply(this,args);return linked;});
  const output=compileWin32(project,{optimization});
  assert.ok(output.report.imports.every(({dll})=>!/(?:msvbvm|richtx32)/i.test(dll)));
  return new NativeX86Machine(linked);
}

for(const optimization of [0,1,2]){
  test(`RichEdit uses the restricted System32 loader without a fallback on modern Windows O${optimization}`,t=>{
    const vm=machine(t,optimization);let loads=0;
    vm.hook('kernel32.dll','LoadLibraryExW',3,([name,file,flags])=>{
      assert.equal(vm.memory.utf16(name),'msftedit.dll');assert.equal(file,0);assert.equal(flags,0x800);loads++;return 0x12345000;
    });
    vm.hook('kernel32.dll','GetSystemDirectoryW',2,()=>assert.fail('unnecessary fallback'));
    assert.equal(vm.invoke('native:control-library:msftedit.dll'),0x12345000);assert.equal(loads,1);
  });
  test(`RichEdit tolerates legacy Windows loader flags using an absolute system path O${optimization}`,t=>{
    const vm=machine(t,optimization),directory='X:\\Windows\\System32';let loads=0,queries=0;
    vm.hook('kernel32.dll','LoadLibraryExW',3,([name,file,flags])=>{
      assert.equal(file,0);
      if(!loads++){assert.equal(flags,0x800);assert.equal(vm.memory.utf16(name),'msftedit.dll');return 0;}
      assert.equal(flags,8);assert.equal(vm.memory.utf16(name),directory+'\\msftedit.dll');return 0x12345000;
    });
    vm.hook('kernel32.dll','GetLastError',0,()=>87);
    vm.hook('kernel32.dll','GetSystemDirectoryW',2,([buffer,capacity])=>{
      queries++;assert.equal(capacity,260);
      for(let i=0;i<=directory.length;i++)vm.memory.write(buffer+2*i,i<directory.length?directory.charCodeAt(i):0,16);
      return directory.length;
    });
    assert.equal(vm.invoke('native:control-library:msftedit.dll'),0x12345000);assert.equal(loads,2);assert.equal(queries,1);
  });
  test(`RichEdit preserves a missing system DLL error instead of reporting out of memory O${optimization}`,t=>{
    const vm=machine(t,optimization);let loads=0;
    vm.hook('kernel32.dll','LoadLibraryExW',3,()=>{loads++;return 0;});
    vm.hook('kernel32.dll','GetLastError',0,()=>126);
    vm.hook('kernel32.dll','GetSystemDirectoryW',2,()=>assert.fail('missing DLL must not trigger a wider search'));
    assert.throws(()=>vm.invoke('native:control-library:msftedit.dll'),error=>error.number===48);
    assert.equal(loads,1);assert.equal(vm.memory.read(vm.symbol('native:error:lastdllerror')),126);
  });
  test(`RichEdit refuses a truncated fallback path without loading another DLL O${optimization}`,t=>{
    const vm=machine(t,optimization);let loads=0;
    vm.hook('kernel32.dll','LoadLibraryExW',3,()=>{loads++;return 0;});
    vm.hook('kernel32.dll','GetLastError',0,()=>87);
    vm.hook('kernel32.dll','GetSystemDirectoryW',2,()=>260);
    assert.throws(()=>vm.invoke('native:control-library:msftedit.dll'),error=>error.number===48);
    assert.equal(loads,1);assert.equal(vm.memory.read(vm.symbol('native:error:lastdllerror')),206);
  });
}

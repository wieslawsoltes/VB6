import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';

function machine(t,optimization,code='MkDir "Orders"'){
  const project=newProject('DirectoryCreation');
  project.modules[0].code='Private Sub Form_Load()\n'+code+'\nEnd Sub';
  let linked;const finish=PE32Image.prototype.finish;
  const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
  compileWin32(project,{optimization});mock.mock.restore();
  return new NativeX86Machine(linked);
}

for(const optimization of [0,1,2]){
  test(`emitted MkDir passes the exact counted Unicode path to CreateDirectoryW O${optimization}`,t=>{
    const vm=machine(t,optimization),path='Orders-Ω-中',pointer=vm.memory.string(path);let called=0;
    vm.hook('kernel32.dll','CreateDirectoryW',2,([name,security])=>{
      called++;assert.equal(name,pointer);assert.equal(vm.memory.utf16(name),path);assert.equal(security,0);return 1;
    });
    assert.equal(vm.invoke('native:file:mkdir',[pointer]),0);
    assert.equal(called,1);
  });
  test(`authored MkDir named pathname calls the emitted helper once O${optimization}`,t=>{
    const vm=machine(t,optimization,'MkDir path:="Orders"');let called=0;
    vm.hook('kernel32.dll','CreateDirectoryW',2,([name,security])=>{called++;assert.equal(vm.memory.utf16(name),'Orders');assert.equal(security,0);return 1;});
    vm.invoke('proc:Form1:Form_Load');assert.equal(called,1);
  });
  for(const [system,error,name]of [[183,58,'already exists'],[5,70,'permission denied'],[3,76,'missing parent'],[112,61,'full disk'],[8,7,'allocation failure'],[123,52,'invalid Windows pathname']]){
    test(`emitted MkDir preserves ${name} error mapping O${optimization}`,t=>{
      const vm=machine(t,optimization);let called=0,lastError=0;
      vm.hook('kernel32.dll','CreateDirectoryW',2,()=>{called++;return 0;});
      vm.hook('kernel32.dll','GetLastError',0,()=>{lastError++;return system;});
      assert.throws(()=>vm.invoke('native:file:mkdir',[vm.memory.string('Orders')]),e=>e.number===error);
      assert.equal(called,1);assert.equal(lastError,1);
    });
  }
  for(const [path,name]of [['','empty'],['Orders\0ignored','embedded NUL'],['x'.repeat(32768),'oversized']]){
    test(`emitted MkDir rejects ${name} paths before a filesystem mutation O${optimization}`,t=>{
      const vm=machine(t,optimization);let called=0;
      vm.hook('kernel32.dll','CreateDirectoryW',2,()=>{called++;return 1;});
      assert.throws(()=>vm.invoke('native:file:mkdir',[vm.memory.string(path)]),e=>e.number===52);
      assert.equal(called,0);
    });
  }
}

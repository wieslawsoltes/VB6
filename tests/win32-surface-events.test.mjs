/** Execute actual emitted window procedures and VB Paint handlers. Only foreign
 * Win32 calls and window construction/painting are hooks; this is not a native
 * Windows execution result or a substitute for the retained acceptance EXEs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {PE32Image} from '../src/native/pe32.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
for(const optimization of [0,1,2])for(const kind of ['form','picture'])test(`native ${kind} Paint dispatch and live-font replacement retain callback state O${optimization}`,t=>{
 const p=newProject('PaintRouting'),m=p.modules[0],c=createControl('PictureBox','Canvas');m.form.controls=[c];
 m.code=`Private formPaints As Long,boxPaints As Long,dc As Long
Private Sub Form_Paint()
 formPaints=formPaints+1
 dc=Me.hDC
End Sub
Private Sub Canvas_Paint()
 boxPaints=boxPaints+1
 dc=Canvas.hDC
End Sub`;
 let linked;const finish=PE32Image.prototype.finish;
 const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});compileWin32(p,{optimization});mock.mock.restore();
 const vm=new NativeX86Machine(linked),memory=vm.memory,calls=[];
 const form=vm.symbol('surface:Form1:form'),box=vm.symbol('surface:Form1:canvas'),surface=kind==='form'?form:box,hwnd=kind==='form'?77:78;
 for(const [record,window,dc]of [[form,77,1001],[box,78,1002]]){memory.write(record,window);memory.write(record+4,dc);memory.write(record+24,0);memory.write(record+84,9);}
 memory.write(vm.symbol('hwnd:Form1'),77);memory.write(vm.symbol('hwnd:Form1:canvas'),78);memory.write(vm.symbol('loaded:Form1'),1);
 vm.hooks.set(vm.symbol('create:Form1'),{args:0,callback:()=>77,name:'construct-window-hook'});
 vm.hooks.set(vm.symbol('proc:NativeDrawingSurface:SurfacePaintWindow'),{args:1,callback:([s])=>{calls.push(['paint',s]);return 0;},name:'foreign-paint-hook'});
 vm.hook('kernel32.dll','GetLastError',0,()=>0);
 vm.hook('user32.dll','IsWindow',1,([h])=>h===77||h===78?1:0);
 vm.hook('user32.dll','InvalidateRect',3,()=>{throw new Error('hDC read inside Paint must not start another paint cycle');});
 vm.hook('gdi32.dll','SelectObject',2,args=>{calls.push(['font',...args]);return 400;});
 vm.hook('user32.dll','CallWindowProcW',5,()=>0);vm.hook('user32.dll','DefWindowProcW',4,()=>0);
 const proc=kind==='form'?'wndproc:Form1':'control-procedure:Form1:canvas',count=vm.symbol('global:Form1:'+(kind==='form'?'formPaints':'boxPaints'));
 assert.equal(vm.invoke(proc,[hwnd,0xf,0,0]),0);assert.equal(memory.read(count),1);assert.equal(memory.read(surface+88),0);assert.equal(memory.read(vm.symbol('global:Form1:dc')),kind==='form'?1001:1002);
 memory.write(surface+24,-1);vm.invoke(proc,[hwnd,0xf,0,0]);assert.equal(memory.read(count),1,'retained surfaces do not synthesize Paint');assert.equal(memory.read(surface+88),0);
 memory.write(surface+24,0);memory.write(vm.symbol('loaded:Form1'),0);vm.invoke(proc,[hwnd,0xf,0,0]);assert.equal(memory.read(count),1,'pre-Load paint does not call authored events');
 memory.write(vm.symbol('loaded:Form1'),1);vm.invoke(proc,[hwnd,0x30,401,0]);assert.equal(memory.read(surface+80),401);assert.deepEqual(calls.at(-1),['font',kind==='form'?1001:1002,401]);
 assert.equal(memory.read(vm.symbol('native:error:frame')),0);assert.equal(memory.read(vm.symbol('native:error:pending')),0);
});

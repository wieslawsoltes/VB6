import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';import {PE32Image} from '../src/native/pe32.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
function project(code,type='PictureBox'){
 const p=newProject('SurfaceExport'),c=createControl(type,'Canvas');Object.assign(c.properties,{AutoRedraw:-1,ScaleMode:3});p.modules[0].form.controls=[c];p.modules[0].code='Private Sub Form_Load()\n'+code+'\nEnd Sub';return p;
}
for(const optimization of[0,1,2])test(`unchanged Graphics Lab and Win32 Workbench export at O${optimization}`,()=>{
 for(const name of ['graphics','win32']){
  const p=JSON.parse(fs.readFileSync(new URL('../examples/'+name+'.vb6web',import.meta.url))),before=JSON.stringify(p),a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});
  assert.equal(JSON.stringify(p),before);assert.deepEqual(a.bytes,b.bytes);assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
  assert.ok(!a.report.sourceMap.some(s=>s.source.startsWith('NativeDrawingSurface')));
  for(const api of name==='graphics'?['LineTo','Rectangle','Ellipse','TextOutW','CreateDIBSection']:['CreateDIBSection','GetClassInfoW','RegisterClassW'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
 }
});
for(const name of ['AotControlSurfaceGraphics','AotControlSurfaceText'])test(name+' has independent native assertions and deterministic PE bytes',()=>{
 const f=nativeControlFixtures().find(f=>f.project.name===name),before=JSON.stringify(f.project);
 assert.equal(f.checks.length,name.endsWith('Graphics')?14:10);
 for(const optimization of[0,1,2]){
  const a=compileWin32(f.project,{optimization});assert.deepEqual(a.bytes,compileWin32(f.project,{optimization}).bytes);assert.ok(a.bytes.length<100*1024,'retain the original per-fixture size limit');
 }
 assert.equal(JSON.stringify(f.project),before);
 if(name.endsWith('Text')){assert.ok(f.project.modules[0].code.includes('GetPixel(dc,x,y)<>GetPixel(target,x,y) Then matches=False'));assert.ok(f.project.modules[0].code.includes('target<>0 And bitmap<>0 And matches'));}
});
for(const source of ['Canvas.Print name:="wrong"','Dim w As Single\nw=Canvas.TextWidth()','Dim h As Single\nh=Canvas.TextHeight("a","b")'])test('invalid native drawing call is not silently accepted: '+source,()=>assert.throws(()=>compileWin32(project(source)),/positional|expects/));
test('unsupported drawing receiver is not treated as a Form/PictureBox',()=>{
 assert.throws(()=>compileWin32(project('Canvas.Line (0,0)-(2,2),0','CommandButton')),/drawing requires/);
 assert.throws(()=>compileWin32(project('Canvas.Print "text"','CommandButton')),/not available/);
});
for(const optimization of[0,1,2])test(`actual linked UTF-16 line scanner retains counted NULs and stops at bounds O${optimization}`,t=>{
 let linked;const finish=PE32Image.prototype.finish;
 const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
 compileWin32(project('Canvas.Print "scanner"'),{optimization});mock.mock.restore();const vm=new NativeX86Machine(linked);
 for(const value of ['', 'a\0bΩ中', 'first\r\nlast', '\n', 'abc\r', 'x'.repeat(8192)+'\nlast', '😀text']){
  const count=value.length,address=count?vm.memory.alloc(count*2,'counted-string-without-terminator'):0;
  for(let i=0;i<count;i++)vm.memory.write(address+2*i,value.charCodeAt(i),16);
  const end=value.search(/[\r\n]/),expected=end<0?count:end;
  assert.equal(vm.invoke('proc:NativeDrawingSurface:SurfaceLineLength',[address,count]),expected);
  if(address)vm.memory.free(address);
 }
});

test('surface background adapter forwards live Picture identity and exact drawing ABI',async t=>{
 const {nativeDataUri,nativeTestBitmap}=await import('./support/native-picture-fixtures.mjs');
 const p=project('Canvas.Cls');p.modules[0].form.controls[0].properties.Picture=nativeDataUri(nativeTestBitmap());
 let linked;const finish=PE32Image.prototype.finish;
 const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});compileWin32(p);mock.mock.restore();
 const vm=new NativeX86Machine(linked),calls=[];vm.hooks.set(vm.symbol('native:picture:draw'),{args:7,name:'picture-draw-test-hook',callback:args=>{calls.push(args);return 1;}});
 const surface=vm.memory.alloc(88,'surface-record'),slot=vm.memory.alloc(4,'picture-owner');vm.memory.region(surface).bytes.fill(0);vm.memory.write(slot,0);
 const invoke=()=>vm.invoke('proc:NativeDrawingSurface:SeedPicture',[surface,444,123,456]);
 invoke();assert.equal(calls.length,0);vm.memory.write(surface+76,slot);invoke();assert.equal(calls.length,0);
 vm.memory.write(slot,0x55667788);invoke();assert.deepEqual(calls,[[0x55667788,444,0,0,123,456,0]]);
});

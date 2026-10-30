import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';
import {compileWin32} from '../src/native/compiler.js';
import {newProject,createControl} from '../src/project/model.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';

function machine(t,optimization){
  const project=newProject('ControlBackground'),label=createControl('Label','Title'),frame=createControl('Frame','Group');
  project.modules[0].form.controls=[label,frame];
  let linked;const finish=PE32Image.prototype.finish;
  const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
  compileWin32(project,{optimization});mock.mock.restore();
  const vm=new NativeX86Machine(linked),state=vm.symbol('control-state:Form1:title'),events=[];
  const dc={origin:[3,5],clip:[1,2,38,18],foreground:0,mode:2},saved=[];
  const rect=p=>[0,4,8,12].map(o=>vm.memory.read(p+o)|0);
  const hook=(dll,name,count,body)=>vm.hook(dll,name,count,args=>{events.push([name,...args]);return body?.(args)??1;});
  hook('user32.dll','GetSysColor',1,([index])=>index===15?0xeeeeee:0x123456);
  hook('gdi32.dll','SetTextColor',2,([hdc,color])=>{assert.equal(hdc,900);dc.foreground=color;});
  hook('gdi32.dll','SetBkColor',2,([hdc,color])=>{assert.equal(hdc,900);dc.background=color;});
  hook('gdi32.dll','SetBkMode',2,([hdc,mode])=>{assert.equal(hdc,900);dc.mode=mode;});
  hook('gdi32.dll','CreateSolidBrush',1,()=>66);
  hook('gdi32.dll','GetStockObject',1,([index])=>{assert.equal(index,5);return 55;});
  hook('user32.dll','GetClientRect',2,([hwnd,p])=>{assert.equal(hwnd,101);for(const [i,n]of [0,0,40,20].entries())vm.memory.write(p+i*4,n);});
  hook('user32.dll','GetSysColorBrush',1,([index])=>{assert.equal(index,15);return 77;});
  hook('user32.dll','FillRect',3,([hdc,p,brush])=>{assert.equal(hdc,900);assert.deepEqual(rect(p),[0,0,40,20]);assert.ok([55,66,77].includes(brush));});
  hook('user32.dll','GetParent',1,([hwnd])=>{assert.equal(hwnd,101);return 100;});
  hook('gdi32.dll','SaveDC',1,([hdc])=>{assert.equal(hdc,900);saved.push(structuredClone(dc));return saved.length;});
  hook('gdi32.dll','IntersectClipRect',5,([hdc,l,t,r,b])=>{assert.equal(hdc,900);assert.deepEqual([l,t,r,b],[0,0,40,20]);dc.clip=[l,t,r,b];});
  hook('user32.dll','MapWindowPoints',4,([from,to,p,count])=>{assert.deepEqual([from,to,count],[101,100,1]);assert.equal(vm.memory.read(p),0);assert.equal(vm.memory.read(p+4),0);vm.memory.write(p,12);vm.memory.write(p+4,7);return (7<<16)|12;});
  hook('gdi32.dll','OffsetViewportOrgEx',4,([hdc,x,y,out])=>{assert.deepEqual([hdc,x|0,y|0,out],[900,-12,-7,0]);dc.origin=[dc.origin[0]+(x|0),dc.origin[1]+(y|0)];});
  hook('user32.dll','SendMessageW',4,([hwnd,msg,hdc,flags])=>{assert.equal(hwnd,100);assert.equal(hdc,900);assert.ok([0x14,0x318].includes(msg));assert.equal(flags,msg===0x318?4:0);assert.deepEqual(dc.origin,[-9,-2]);dc.foreground=0xfefefe;});
  hook('gdi32.dll','RestoreDC',2,([hdc,id])=>{assert.equal(hdc,900);assert.equal(id,saved.length);Object.assign(dc,saved.pop());});
  return {vm,state,events,dc,saved};
}

for(const optimization of [0,1,2]){
  test(`transparent label paints its parent before returning a hollow brush O${optimization}`,t=>{
    const {vm,state,events,dc,saved}=machine(t,optimization);
    assert.equal(vm.invoke('native:control:colors',[state,900,101]),55);
    assert.deepEqual(events.filter(e=>e[0]==='SendMessageW').map(e=>e[2]),[0x14,0x318]);
    assert.ok(events.findIndex(e=>e[0]==='FillRect')<events.findIndex(e=>e[0]==='SendMessageW'));
    assert.deepEqual(dc.origin,[3,5]);assert.deepEqual(dc.clip,[1,2,38,18]);assert.equal(dc.foreground,0x123456);assert.equal(dc.mode,1);assert.equal(saved.length,0);
  });
  test(`opaque control caches its brush and does not repaint its parent O${optimization}`,t=>{
    const {vm,state,events}=machine(t,optimization);vm.memory.write(state+68,1);
    assert.equal(vm.invoke('native:control:colors',[state,900,101]),66);
    assert.equal(vm.invoke('native:control:colors',[state,900,101]),66);
    assert.equal(events.filter(e=>e[0]==='CreateSolidBrush').length,1);
    assert.equal(events.some(e=>e[0]==='SendMessageW'),false);
  });
  test(`frame erase fills its entire client with its own background brush O${optimization}`,t=>{
    const {vm,state,events}=machine(t,optimization);vm.memory.write(state+68,1);
    assert.equal(vm.invoke('native:control:erase',[state,900,101]),1);
    const fills=events.filter(e=>e[0]==='FillRect');assert.equal(fills.length,1);assert.equal(fills[0][3],66);
  });
  test(`failed SaveDC retains a deterministic background without changing caller DC state O${optimization}`,t=>{
    const {vm,state,events,dc}=machine(t,optimization);vm.hook('gdi32.dll','SaveDC',1,()=>0);
    assert.equal(vm.invoke('native:control:colors',[state,900,101]),55);
    assert.equal(events.filter(e=>e[0]==='FillRect').length,1);
    assert.equal(events.some(e=>['SendMessageW','RestoreDC'].includes(e[0])),false);
    assert.deepEqual(dc.origin,[3,5]);assert.deepEqual(dc.clip,[1,2,38,18]);
  });
}

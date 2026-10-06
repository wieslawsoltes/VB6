import test from 'node:test';import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeLayoutCoreSource,NATIVE_LAYOUT_FIELDS} from '../src/native/layout-core.js';
import {nativeLayoutSeed} from '../src/native/layout-seed.js';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
import {formNodes,layoutOptions} from '../src/layout/model.js';
const project=()=>{const p=newProject('LayoutOracle');p.settings.anchoring=true;p.modules[0].code='';return p;};
async function kernel(p){
 const seed=nativeLayoutSeed(p),source=nativeLayoutCoreSource(seed.count).replace(/^Private Function (?:Seed|HostApply|HostResize|HostClient|HostShow)\([^\n]*\nEnd Function\n/gm,'')+'\nPrivate Sub Main()\nEnd Sub\n';
 const compiled=compileProject({name:'Kernel',startup:'Sub Main',modules:[{name:'Kernel',kind:'module',code:source}]});assert.deepEqual(compiled.diagnostics,[]);
 const painted=new Map(),clients=new Map(),shown=new Map(),vm=new VirtualMachine(compiled,{}, {instructionLimit:100000000});
 vm.library.set('seed',(node,field)=>seed.rows[node][field]);vm.library.set('hostapply',(hwnd,x,y,width,height)=>{painted.set(hwnd,{x,y,width,height});return 1;});
 vm.library.set('hostresize',(hwnd,width,height)=>{clients.set(hwnd,{width,height});return 1;});vm.library.set('hostclient',(hwnd,axis)=>clients.get(hwnd)[axis?'height':'width']);vm.library.set('hostshow',(hwnd,value)=>{shown.set(hwnd,value);return 1;});
 await vm.start();const instance=vm.instances.get('kernel'),call=(name,...args)=>vm.callProcedure(instance,instance.module.procedures.get(name),args);
 for(const [name,form]of seed.forms){await call('initialize',form.root,form.last);for(let i=form.root;i<=form.last;i++)await call('attach',i,i);clients.set(form.root,{width:seed.rows[form.root][8],height:seed.rows[form.root][9]});}
 return {seed,vm,call,painted,shown,clients,get:async(node,field)=>call('getvalue',node,field),set:async(node,field,value)=>call('setvalue',node,field,value)};
}
function approx(a,b,label){for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<1e-7,`${label}.${k}: ${a[k]} != ${b[k]}`);}
for(let mask=0;mask<16;mask++)test('native kernel matches standalone solver for anchor mask '+mask,async()=>{
 const p=project(),form=p.modules[0].form,c=createControl('CommandButton','Button1',301.5,456.25);Object.assign(c.properties,{Width:1000.5,Height:750.75,Anchor:mask,MinimumWidth:100,MinimumHeight:90,MaximumWidth:1800,MaximumHeight:1300});form.controls=[c];
 const k=await kernel(p),info=k.seed.forms.get('form1'),index=info.controls.get(c.id),e=new LayoutEngine(formNodes(form),layoutOptions(form));
 try{for(const [w,h]of [[9000,6000],[10000,6500],[100,90],[9000,6000],[9234,6173],[20000,13000],[9000,6000]]){await k.call('run',info.root,w,h);e.arrange(w,h);approx(k.painted.get(index),e.getBounds(c.id),'mask '+mask);}}finally{k.vm.stop();}
});
for(const mode of [0,1,2,3])test('native kernel matches nested docking and constrained flow mode '+mode,async()=>{
 const p=project(),form=p.modules[0].form;form.properties.LayoutPadding=25;form.properties.LayoutMode=mode;form.properties.LayoutGap=17;form.properties.LayoutJustify=4;
 const frame=createControl('Frame','Frame1',250,200);Object.assign(frame.properties,{Width:3000,Height:2200,Anchor:15,LayoutMode:mode,LayoutPadding:40,LayoutGap:30});form.controls.push(frame);
 for(let i=0;i<8;i++){const c=createControl('CommandButton','B'+i,100+i*50,100+i*60);c.parent=frame.name;Object.assign(c.properties,{Width:300+i*150,Height:200+i*30,Anchor:i*2,LayoutMargin:20,LayoutGrow:1,LayoutShrink:1,LayoutAlign:i%4,MinimumWidth:100+i*60,MaximumWidth:i===0?400:0});if(i===1)c.properties.Dock=1;if(i===2)c.properties.Dock=4;if(i===3)c.properties.Visible=0;form.controls.push(c);}
 const k=await kernel(p),info=k.seed.forms.get('form1'),e=new LayoutEngine(formNodes(form),layoutOptions(form));
 try{for(const [w,h]of [[9000,6000],[12000,8000],[1800,900],[9000,6000]]){await k.call('run',info.root,w,h);e.arrange(w,h);for(const c of form.controls)approx(k.painted.get(info.controls.get(c.id)),e.getBounds(c.id),c.name);}}finally{k.vm.stop();}
});
test('native live anchor/dock, limits, move, visibility and nested suspension',async()=>{
 const p=project(),form=p.modules[0].form,c=createControl('CommandButton','B',300,300);Object.assign(c.properties,{Width:1500,Height:450,Anchor:10});form.controls=[c];const k=await kernel(p),info=k.seed.forms.get('form1'),id=info.controls.get(c.id),root=info.root;
 try{await k.call('perform',root);await k.set(id,10,15);assert.equal(await k.get(id,11),0);await k.set(id,11,5);assert.equal(await k.get(id,10),5);assert.equal(await k.get(id,8),9000);await k.set(id,10,10);await k.call('movenode',id,300,300,1500,450);await k.call('suspend',root);await k.call('suspend',root);k.clients.set(root,{width:10000,height:7000});await k.call('perform',root);assert.equal(await k.get(root,8),10000);assert.equal(await k.get(id,6),300);await k.call('resumelayout',root,-1);assert.equal(await k.get(id,6),300);await k.call('resumelayout',root,0);assert.equal(await k.get(id,6),300);await k.call('perform',root);assert.equal(await k.get(id,6),1300);await k.set(id,24,0);assert.equal(k.shown.get(id),0);await assert.rejects(k.set(id,10,16),e=>e.number===380);assert.equal(await k.get(id,10),10);}finally{k.vm.stop();}
});
test('freestanding PE32 contains private native layout only when opted in',()=>{
 const p=project(),m=p.modules[0];m.form.controls=[createControl('CommandButton','B')];m.code='Private Sub Form_Load()\nB.Anchor=vbAnchorRight Or vbAnchorBottom\nMe.Width=10000\nB.Move 300, 600, 1500, 450\nMe.SuspendLayout\nB.MinimumWidth=400\nB.Dock=vbDockFill\nMe.ResumeLayout True\nEnd Sub';
 const result=compileWin32(p);assert.equal(result.bytes[0],0x4d);assert.equal(result.report.layout.enabled,true);assert.equal(result.report.layout.nodes,2);assert.ok(result.report.imports.some(i=>i.symbol==='MoveWindow'));assert.ok(result.report.sourceMap.every(s=>!s.source.startsWith('VB6NativeLayout')));assert.deepEqual(compileWin32(p).bytes,result.bytes);
 p.settings.anchoring=false;m.code='';const classic=compileWin32(p);assert.equal(classic.report.layout,undefined);assert.ok(classic.bytes.length<result.bytes.length);
});
test('native static control arrays preserve element identities for live anchoring',()=>{
 const p=project(),m=p.modules[0];m.form.controls=[1,3].map(Index=>{const c=createControl('CommandButton','B');c.properties.Index=Index;return c;});m.code='Private Sub Form_Load()\nDim i As Long\ni=3\nB(i).Anchor=vbAnchorRight\nB(1).Width=B(i).Width+300\nEnd Sub';assert.equal(compileWin32(p).report.layout.nodes,3);
});

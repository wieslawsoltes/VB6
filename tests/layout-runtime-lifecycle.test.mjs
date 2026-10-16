import test from 'node:test';import assert from 'node:assert/strict';
import {FormLayout} from '../src/layout/runtime.js';
let frames=new Map(),serial=0;globalThis.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
function make(){let paints=0,writes=0;const fonts=new EventTarget();
  const view=(id,type='CustomControl')=>{const style={};Object.defineProperty(style,'zIndex',{set(){writes++;},get(){return '0';}});const props={Left:0,Top:0,Width:100,Height:50,Visible:-1};return {model:{id,name:id,type},props,node:{style},set(key,value){this.props[key]=value;},refresh(){paints++;}};};
  const form=view('form','Form');Object.assign(form.props,{ClientWidth:600,ClientHeight:300,LayoutMode:1});form.node.ownerDocument={fonts};form.controls=[view('a'),view('b')];
  const controller=new FormLayout(form);controller.flush();writes=0;paints=0;return {form,controller,fonts,writes:()=>writes,paints:()=>paints};
}
test('unchanged roots and ordinary resizes do not rewrite sibling stacking',()=>{
  const t=make();for(let i=0;i<100;i++)t.controller.arrange();assert.equal(t.writes(),0);
  t.form.props.ClientWidth+=100;t.controller.arrange();assert.equal(t.writes(),0);
  t.form.props.LayoutStacking=1;t.controller.edit(t.form,'LayoutStacking');assert.equal(t.writes(),2);t.controller.dispose();
});
test('text updates avoid an unrelated full Hug/Fill compatibility scan',()=>{
  const t=make();let calls=0;t.controller.resolveSizing=()=>calls++;
  t.form.controls[0].set('Caption','changed');assert.equal(calls,0);
  t.controller.edit(t.form.controls[0],'LayoutWidthMode');assert.equal(calls,1);t.controller.dispose();
});
test('disposal restores methods, cancels painting and detaches font listeners',()=>{
  const t=make(),view=t.form.controls[0],wrapped=view.set;
  t.form.props.LayoutGap=30;t.controller.edit(t.form,'LayoutGap');assert.ok(t.controller.frame);
  t.controller.dispose();const revision=t.controller.engine.revision;
  assert.notEqual(view.set,wrapped);assert.equal(t.controller.frame,0);assert.equal(t.controller.wrapped.size,0);
  t.fonts.dispatchEvent(new Event('loadingdone'));t.controller.perform();t.controller.edit(view,'Caption');t.controller.rebuild();t.controller.dispose();
  assert.equal(t.controller.engine.revision,revision);assert.equal(t.controller.records.size,0);
});
test('nested suspension keeps geometry synchronous only after the final resume',()=>{
  const t=make(),before=t.form.controls[1].props.Left;t.controller.suspend();t.controller.suspend();
  t.form.props.LayoutGap=40;t.controller.edit(t.form,'LayoutGap');assert.equal(t.form.controls[1].props.Left,before);
  t.controller.resume();assert.equal(t.form.controls[1].props.Left,before);t.controller.resume();assert.equal(t.form.controls[1].props.Left,before+40);t.controller.dispose();
});
test('failed live track and variable assignments restore properties and remain usable',()=>{
 const t=make(),c=t.controller;t.form.props.LayoutMode=5;t.form.props.LayoutGridColumns='repeat(auto-fill,minmax(var(--min,100),1fr))';c.edit(t.form,'LayoutMode');
 const before=c.engine.getGridLayout(),props={...t.form.props},rects=Array.from(c.engine.rects);
 assert.throws(()=>c.setProperty(t.form,'LayoutVariables','{"--min":"var(--min)"}'),/Cyclic/);
 assert.deepEqual(t.form.props,props);assert.deepEqual(c.engine.getGridLayout(),before);assert.deepEqual(Array.from(c.engine.rects),rects);
 c.setProperty(t.form,'LayoutVariables','{"--min":200}');assert.equal(c.engine.getGridLayout().columns.length,3);
 c.setProperty(t.form,'LayoutGridColumns','[first] 100 [last] 1fr');const a=t.form.controls[0],old={...a.props};
 assert.throws(()=>c.setProperty(a,'LayoutColumnEnd','missing'),/Unknown|not found/);assert.deepEqual(a.props,old);c.perform();c.dispose();
});
test('live layout validation is atomic and unchanged values avoid solver work',()=>{
 const t=make(),c=t.controller,revision=c.engine.revision;c.setProperty(t.form,'LayoutMode',1);assert.equal(c.engine.revision,revision);
 assert.throws(()=>c.setProperty(t.form,'LayoutGridColumns','repeat(auto-fit,1fr)'),/definite/);assert.equal(t.form.props.LayoutGridColumns,undefined);assert.equal(c.engine.revision,revision);c.dispose();
});
test('failed child sizing rolls back a parent Hug-to-Fixed compatibility change',()=>{
 const t=make(),c=t.controller;t.form.props.LayoutMode=6;t.form.props.LayoutHeightMode=1;c.edit(t.form,'LayoutMode');const before={...t.form.props},a=t.form.controls[0],old={...a.props};
 assert.throws(()=>c.setProperty(a,'LayoutHeightMode',2),/stacking axis/);assert.deepEqual(t.form.props,before);assert.deepEqual(a.props,old);c.perform();c.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormXaml} from '../src/xaml/forms.js';
import {layoutInsets,setWinUI3LayoutValues,getWinUI3LayoutValues} from '../src/layout/model.js';
import {FormLayout} from '../src/layout/runtime.js';
import {winui3ThemeValues} from '../src/theme/winui3-compat.js';

let serial=0;
const frames=new Map();
globalThis.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const rect=view=>['Left','Top','Width','Height'].map(key=>view.props[key]/15);
const literalProps=()=>({LayoutPaddingLeft:75,LayoutPaddingTop:105,LayoutPaddingRight:165,LayoutPaddingBottom:195,
  WinUI3:{version:1,sourceType:'Border',properties:{Padding:[5,7,11,13],BorderThickness:[2,3,4,5]}}});
function compiledBorder(){
  const source='<Page xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="200" Height="100"><Canvas><Border x:Name="Outer" Width="100" Height="50" Padding="5,7,11,13" BorderThickness="2,3,4,5" BorderBrush="#FF000000"><Grid x:Name="Inner"/></Border></Canvas></Page>';
  const result=compileFormXaml(source,{settings:{anchoring:true}});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  return result.form;
}
function liveForm(model){
  const view=model=>({model,props:structuredClone(model.properties),anchoring:true,node:{style:{}},
    refresh(){},set(key,value){this.props[key]=value;},invalidate(){this.invalidated=(this.invalidated??0)+1;}});
  const form=view(model);form.form=form;form.controls=model.controls.map(view);
  for(const child of form.controls)child.form=form;
  const controller=new FormLayout(form);form.layoutController=controller;controller.flush();
  return {form,controller,find:name=>form.controls.find(view=>view.model.name===name)};
}

test('compiled Border child fills the padding and stroke inset exactly once',()=>{
  const model=compiledBorder(),child=model.controls.find(c=>c.name==='Inner'),outer=model.controls.find(c=>c.name==='Outer');
  assert.deepEqual(['Left','Top','Width','Height'].map(key=>child.properties[key]/15),[7,10,78,22]);
  assert.deepEqual(layoutInsets(outer.properties),[150,225,270,105]);
  const live=liveForm(model);
  assert.deepEqual(rect(live.find('Inner')),[7,10,78,22]);
  live.controller.dispose();
});

test('resolved container insets are immutable view state and do not rewrite authored padding',()=>{
  const props=literalProps(),authored=structuredClone(props),values={Padding:[10,20,30,40],BorderThickness:[1,2,3,4]};
  assert.equal(setWinUI3LayoutValues(props,values),true);
  assert.deepEqual(layoutInsets(props),[330,495,660,165]);
  assert.deepEqual(props,authored);
  assert.equal(setWinUI3LayoutValues(props,structuredClone(values)),false);
  values.Padding[0]=100;values.BorderThickness[1]=100;
  assert.deepEqual(layoutInsets(props),[330,495,660,165]);
  assert.ok(Object.isFrozen(getWinUI3LayoutValues(props).Padding));
  assert.throws(()=>setWinUI3LayoutValues(props,{Padding:[1,2,3,Infinity]}),/finite/);
  assert.deepEqual(layoutInsets(props),[330,495,660,165]);
  assert.equal(setWinUI3LayoutValues(props,null),true);
  assert.deepEqual(layoutInsets(props),[150,225,270,105]);
});

test('ordinary layout and margins keep native values, and metadata removal releases the stroke',()=>{
  const native={LayoutPadding:30,LayoutPaddingLeft:60,LayoutMargin:15,LayoutMarginTop:45};
  assert.deepEqual(layoutInsets(native),[30,30,30,60]);
  assert.deepEqual(layoutInsets({...native,WinUI3:{sourceType:'Button',properties:{Padding:[9,9,9,9],BorderThickness:[2,2,2,2]}}}),[30,30,30,60]);
  const props={...literalProps(),...native};setWinUI3LayoutValues(props,{Padding:[1,2,3,4],BorderThickness:[2,3,4,5]});
  assert.deepEqual(layoutInsets(props,'LayoutMargin'),[45,15,15,15]);
  delete props.WinUI3;assert.equal(setWinUI3LayoutValues(props,null),true);
  assert.deepEqual(layoutInsets(props),[105,165,195,60]);
});

test('theme changes synchronously resize descendants and removing live geometry restores native padding',()=>{
  const live=liveForm(compiledBorder()),outer=live.find('Outer'),inner=live.find('Inner'),authored=structuredClone(outer.props);
  assert.equal(setWinUI3LayoutValues(outer.props,{Padding:[10,2,20,4],BorderThickness:[1,2,3,4]}),true);
  live.controller.edit(outer,'WinUI3');
  assert.deepEqual(rect(inner),[11,4,66,38]);
  assert.deepEqual(outer.props,authored);
  assert.equal(setWinUI3LayoutValues(outer.props,null),true);live.controller.edit(outer,'WinUI3');
  assert.deepEqual(rect(inner),[7,10,78,22]);
  live.controller.dispose();
});

test('same-value native padding assignment releases the binding while retaining the active border',()=>{
  const live=liveForm(compiledBorder()),outer=live.find('Outer'),inner=live.find('Inner');
  const original=outer.props.WinUI3;
  original.resources={Padding:{key:'ThemePadding',values:{Light:[5,7,11,13],Dark:[10,2,20,4]}},
    BorderThickness:{key:'ThemeStroke',values:{Light:[2,3,4,5],Dark:[1,2,3,4]}}};
  setWinUI3LayoutValues(outer.props,winui3ThemeValues(original,'Dark'));live.controller.edit(outer,'WinUI3');
  assert.deepEqual(rect(inner),[11,4,66,38]);
  outer.set('LayoutPaddingLeft',75);
  assert.deepEqual(rect(inner),[6,9,80,24]);
  assert.equal(outer.props.WinUI3.properties.Padding,undefined);assert.equal(outer.props.WinUI3.resources.Padding,undefined);
  assert.deepEqual(outer.props.WinUI3.resources.BorderThickness,original.resources.BorderThickness);
  assert.deepEqual(original.properties.Padding,[5,7,11,13]);
  assert.equal(getWinUI3LayoutValues(outer.props).Padding,undefined);
  assert.deepEqual(getWinUI3LayoutValues(outer.props).BorderThickness,[1,2,3,4]);
  const revision=live.controller.engine.revision;outer.set('LayoutPaddingLeft',75);assert.equal(live.controller.engine.revision,revision);
  setWinUI3LayoutValues(outer.props,winui3ThemeValues(outer.props.WinUI3,'Dark'));live.controller.edit(outer,'WinUI3');
  assert.deepEqual(rect(inner),[6,9,80,24]);
  live.controller.dispose();
});

test('failed responsive layout restores native padding, WinUI binding and resolved theme insets',()=>{
  const model={id:'form',name:'Form1',type:'Form',properties:{ClientWidth:20000,ClientHeight:300,LayoutMode:5,LayoutGridColumns:'repeat(auto-fill,10)',LayoutGridRows:'1fr',LayoutPadding:0,
    WinUI3:{version:1,sourceType:'Page',properties:{Padding:[600,0,600,0]},resources:{Padding:{key:'ThemePadding',values:{Dark:[600,0,600,0]}}}}},controls:[]};
  const form={model,props:structuredClone(model.properties),node:{style:{}},controls:[],set(key,value){this.props[key]=value;},refresh(){}};
  setWinUI3LayoutValues(form.props,winui3ThemeValues(form.props.WinUI3,'Dark'));
  const controller=new FormLayout(form),authored=structuredClone(form.props),binding=form.props.WinUI3,before=controller.engine.getGridLayout();
  assert.throws(()=>form.set('LayoutPadding',0),/track budget/);
  assert.deepEqual(form.props,authored);assert.equal(form.props.WinUI3,binding);
  assert.deepEqual(layoutInsets(form.props),[0,9000,0,9000]);
  assert.deepEqual(controller.engine.getGridLayout(),before);
  controller.perform();controller.dispose();
});

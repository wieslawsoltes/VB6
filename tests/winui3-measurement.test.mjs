import test from 'node:test';
import assert from 'node:assert/strict';
import {measureLayoutControl,setWinUI3MeasurementValues,clearLayoutMeasurements} from '../src/layout/measurement.js';
import {layoutNode} from '../src/layout/model.js';

const model=(type,sourceType,values={},properties={})=>({id:'control',type,properties:{Width:1500,Height:600,Caption:'ab',Text:'ab',FontSize:10.5,FontName:'Narrow',FontBold:0,
 LayoutWidthMode:1,LayoutHeightMode:1,WinUI3:{version:1,sourceType,properties:values,resources:{}},...properties}});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('WinUI automatic-layout measurement uses resolved, immutable geometry',async t=>{
 const original=globalThis.OffscreenCanvas;let calls=0;
 const fonts=[];
 globalThis.OffscreenCanvas=class {getContext(){return {font:'',measureText(text){
  calls++;fonts.push(this.font);
  const size=Number(this.font.match(/([\d.]+)px/)[1]);
  const weight=Number(this.font.match(/(?:^| )(\d+) (?=[\d.]+px)/)?.[1]??400);
  return {width:text.length*size*(this.font.includes('Wide')?2:1)*(1+(weight-400)/1000),fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};
 }}};};
 clearLayoutMeasurements();
 try {
  await t.test('initial native metadata preserves DIP font size, family and weight 500',()=>{
   const m=model('Label','TextBlock',{FontFamily:'Wide',FontSize:20,FontWeight:500});
   const measured=measureLayoutControl(m);
   close(measured.preferredWidth,88*15);close(measured.preferredHeight,24*15);close(measured.baseline,16*15);
   assert.ok(fonts.some(font=>font.startsWith('500 20px')&&font.includes('Wide')));
   assert.equal(m.properties.FontBold,0);assert.equal(m.properties.FontSize,10.5);
  });

  await t.test('live font changes affect Hug and baseline without changing authored properties',()=>{
   const m=model('CommandButton','Button',{FontFamily:'Narrow',FontSize:14,FontWeight:400,Padding:[1,2,3,4],BorderThickness:[1,1,1,1]}),p=m.properties;
   const authored=structuredClone(p),initial=measureLayoutControl(m);
   close(initial.preferredWidth,34*15);close(initial.preferredHeight,24.8*15);close(initial.baseline,14.2*15);
   const values={FontFamily:'Wide',FontSize:20,FontWeight:500,Padding:[1,2,3,4],BorderThickness:[1,1,1,1]};
   assert.equal(setWinUI3MeasurementValues(p,values),true);
   const live=measureLayoutControl(m);
   close(live.preferredWidth,94*15);close(live.preferredHeight,32*15);close(live.baseline,19*15);
   assert.deepEqual(p,authored);
   assert.equal(setWinUI3MeasurementValues(p,null),true);assert.deepEqual(measureLayoutControl(m),initial);
   assert.equal(setWinUI3MeasurementValues(p,null),false);
  });

  await t.test('paint-only changes reuse measured geometry and snapshots cannot be mutated by callers',()=>{
   const m=model('TextBox','TextBox'),p=m.properties;
   const values={FontFamily:'Narrow',FontSize:18,FontWeight:450,Padding:[2,3,4,5],BorderThickness:[1,1,1,1]};
   assert.equal(setWinUI3MeasurementValues(p,values),true);
   const measured=measureLayoutControl(m),before=calls;
   assert.equal(setWinUI3MeasurementValues(p,{...values,Background:'#FF000000',Foreground:'#FFFFFFFF'}),false);
   assert.equal(measureLayoutControl(m),measured);assert.equal(calls,before);
   values.Padding[0]=1000;values.BorderThickness[1]=2000;values.FontSize=100;
   assert.equal(measureLayoutControl(m),measured);assert.equal(calls,before);
   assert.equal(setWinUI3MeasurementValues(p,null),true);
  });

  await t.test('exact asymmetric padding and border use top inset for baseline and distinguish cache entries',()=>{
   const values={FontFamily:'Narrow',FontSize:10,FontWeight:400,Padding:[2,3,7,11],BorderThickness:[1,5,2,13]};
   const button=model('CommandButton','Button',values),toggle=model('CheckBox','ToggleButton',values);
   const expected={preferredWidth:32*15,preferredHeight:44*15,baseline:16*15};
   assert.deepEqual(measureLayoutControl(button),expected);assert.deepEqual(measureLayoutControl(toggle),expected);
   assert.equal(setWinUI3MeasurementValues(button.properties,{...values,Padding:[12,3,7,11]}),true);
   close(measureLayoutControl(button).preferredWidth,42*15);
   assert.deepEqual(measureLayoutControl(toggle),expected,'another control with the old chrome keeps its own cached size');
  });

  await t.test('native check, radio and switch measurements do not reinterpret glyph content margins',()=>{
   for(const [type,sourceType] of [['CheckBox','CheckBox'],['OptionButton','RadioButton'],['CheckBox','ToggleSwitch']]) {
    const values={FontSize:10,FontFamily:'Narrow',FontWeight:400,Padding:[100,200,300,400],BorderThickness:[5,6,7,8]},m=model(type,sourceType,values);
    assert.deepEqual(measureLayoutControl(m),{preferredWidth:40*15,preferredHeight:16*15,baseline:10*15});
    assert.equal(setWinUI3MeasurementValues(m.properties,{...values,Padding:[1,2,3,4],BorderThickness:[9,10,11,12]}),false);
   }
  });

  await t.test('constrained layout callbacks retain live properties identity and WinUI wrapping mode',()=>{
   const values={FontFamily:'Narrow',FontSize:10,FontWeight:400,TextWrapping:'WrapWholeWords'};
   const m=model('Label','TextBlock',values,{Caption:'abcdefghij',LayoutWidthMode:2,LayoutHeightMode:1}),p=m.properties;
   const node=layoutNode(m),initial=node.measure({width:450,height:600});
   close(initial.width,1500);close(initial.height,180);
   assert.equal(setWinUI3MeasurementValues(p,{...values,FontSize:20,TextWrapping:'Wrap'}),true);
   const live=node.measure({width:450,height:600});
   close(live.width,300);close(live.height,3600);close(live.baseline,240);
   assert.equal(p.Width,1500);assert.equal(p.Height,600);assert.equal(p.FontSize,10.5);
   assert.equal(setWinUI3MeasurementValues(p,{...values,FontSize:20,TextWrapping:'NoWrap'}),true);
   close(node.measure({width:450,height:600}).height,360);
  });

  await t.test('fixed bounds remain authored while live fonts and top insets change their baseline',()=>{
   const m=model('TextBox','PasswordBox',{FontFamily:'Narrow',FontSize:10,FontWeight:400,Padding:[1,2,3,4],BorderThickness:[1,5,1,7]},{LayoutWidthMode:0,LayoutHeightMode:0});
   assert.deepEqual(measureLayoutControl(m),{preferredWidth:1500,preferredHeight:600,baseline:15*15});
   assert.equal(setWinUI3MeasurementValues(m.properties,{FontFamily:'Narrow',FontSize:20,FontWeight:400,Padding:[1,2,3,4],BorderThickness:[1,5,1,7]}),true);
   assert.deepEqual(measureLayoutControl(m,{width:900,height:450}),{preferredWidth:900,preferredHeight:450,baseline:23*15});
  });

  await t.test('invalid snapshots fail atomically and control lifetime state is cleared without authoring edits',()=>{
   const m=model('CommandButton','Button'),p=m.properties;
   const values={FontSize:20,FontFamily:'Narrow',FontWeight:500,Padding:[1,2,3,4],BorderThickness:[1,1,1,1]};
   setWinUI3MeasurementValues(p,values);const measured=measureLayoutControl(m),authored=structuredClone(p);
   for(const invalid of [{...values,FontSize:Infinity},{...values,FontWeight:1001},{...values,FontFamily:'x'.repeat(1025)},{...values,Padding:[1,2,-1,4]},{...values,BorderThickness:[1,2,3,20001]},{...values,TextWrapping:'Overflow'}]) {
    assert.throws(()=>setWinUI3MeasurementValues(p,invalid),/WinUI/);assert.equal(measureLayoutControl(m),measured);assert.deepEqual(p,authored);
   }
   assert.throws(()=>measureLayoutControl(m,{width:Infinity}),/finite/);
   assert.throws(()=>measureLayoutControl(m,{height:-1}),/finite/);
   delete p.WinUI3;assert.equal(setWinUI3MeasurementValues(p,null),true);assert.equal(setWinUI3MeasurementValues(p,null),false);
   assert.equal(setWinUI3MeasurementValues(model('RichTextBox','RichEditBox').properties,{FontSize:20}),false,'rich text runs retain their separate, unmeasured contract');
  });
 } finally {
  if(original===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=original;
  clearLayoutMeasurements();
 }
});

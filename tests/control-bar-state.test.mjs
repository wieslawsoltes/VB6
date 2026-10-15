import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolbarButtons,StatusPanels} from '../src/controls/collections.js';
import {activateToolbarButton,statusPanelText} from '../src/controls/bar-controls.js';
import {validateCollectionProperty} from '../src/controls/control-contract.js';
const error=n=>e=>e.number===n;
test('toolbar styles toggle or group without activating separators, placeholders or disabled items',()=>{
  const buttons=new ToolbarButtons(),normal=buttons.Add(undefined,'normal','Normal',0),check=buttons.Add(undefined,'check','Check',1),first=buttons.Add(undefined,'a','A',2),second=buttons.Add(undefined,'b','B',2),separator=buttons.Add(undefined,'sep','',3),last=buttons.Add(undefined,'c','C',2),placeholder=buttons.Add(undefined,'space','',4),drop=buttons.Add(undefined,'drop','Drop',5);
  assert.equal(activateToolbarButton(buttons,normal),true);assert.equal(normal.Value,0);
  activateToolbarButton(buttons,check);assert.equal(check.Value,1);activateToolbarButton(buttons,check);assert.equal(check.Value,0);
  activateToolbarButton(buttons,first);activateToolbarButton(buttons,second);assert.equal(first.Value,0);assert.equal(second.Value,1);
  activateToolbarButton(buttons,last);assert.equal(second.Value,1);assert.equal(last.Value,1);
  for(const item of [separator,placeholder])assert.equal(activateToolbarButton(buttons,item),false);
  drop.Enabled=0;assert.equal(activateToolbarButton(buttons,drop),false);drop.Enabled=-1;drop.Visible=0;assert.equal(activateToolbarButton(buttons,drop),false);
  drop.Visible=-1;assert.equal(activateToolbarButton(buttons,drop),true);assert.equal(drop.Value,0);
});
test('toolbar group assignments are atomic and notify once',()=>{
  let updates=0;const buttons=new ToolbarButtons(()=>updates++),a=buttons.Add(undefined,'a','A',2),b=buttons.Add(undefined,'b','B',2);
  a.Value=1;updates=0;b.Value=1;assert.equal(updates,1);assert.deepEqual([a.Value,b.Value],[0,1]);
  assert.throws(()=>{b.Value=2},error(380));assert.equal(b.Value,1);assert.equal(updates,1);
  b.Value=1;assert.equal(updates,1);buttons.Remove('a');assert.throws(()=>activateToolbarButton(buttons,a),error(35601));
});
test('status panels validate enum and geometry mutations before changing observable state',()=>{
  let updates=0;const panels=new StatusPanels(()=>updates++),panel=panels.Add(undefined,'s','State');const baseline=updates;
  for(const [key,values]of Object.entries({AutoSize:[-1,3,1.5],Alignment:[-1,3],Bevel:[-1,3],Style:[-1,7],Width:[-1,Infinity,NaN],MinWidth:[-1,300001]}))for(const value of values)assert.throws(()=>{panel[key]=value},error(380));
  assert.equal(updates,baseline);panel.AutoSize=1;panel.Alignment=2;panel.Bevel=0;panel.MinWidth=200;assert.equal(updates,baseline+4);
});
test('status panel derived captions distinguish all six indicator styles from custom text',()=>{
  const panels=new StatusPanels(),panel=panels.Add(undefined,'s','Custom'),now=new Date(2024,0,2,13,5,9);
  assert.equal(statusPanelText(panel,now),'Custom');const captions=['CAPS','NUM','INS','SCRL',now.toLocaleTimeString(),now.toLocaleDateString()];
  for(let i=0;i<captions.length;i++){panel.Style=i+1;assert.equal(statusPanelText(panel,now),captions[i]);}assert.equal(panel.Text,'Custom');
});
test('bar control dimensions and modes reject nonfinite and out-of-domain values',()=>{
  for(const key of ['ButtonWidth','ButtonHeight'])for(const value of [-1,NaN,Infinity,300001])assert.throws(()=>validateCollectionProperty('Toolbar',key,value),error(380));
  for(const [type,key]of [['Toolbar','TextAlignment'],['StatusBar','Style']])for(const value of [-1,2,NaN,.5])assert.throws(()=>validateCollectionProperty(type,key,value),error(380));
  assert.equal(validateCollectionProperty('Toolbar','ButtonHeight',31.5),31.5);
});

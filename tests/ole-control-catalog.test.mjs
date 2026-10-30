import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {builtinType} from '../src/language/type-catalog.js';
import {declarationTargets,handlerEdit} from '../src/editor/event-completion.js';
import {setOleProperty} from '../src/controls/ole-control.js';
import {OleDocument} from '../src/controls/ole-document.js';

test('intrinsic OLE is discoverable through typed methods, properties and events',()=>{
  const type=builtinType('VB.OLE');assert.ok(type);for(const name of ['Object','CreateEmbed','CreateLink','DoVerb','SaveDocument','SaveToFile','ReadFromFile','ExportDocument','OLEType'])assert.ok(type.members.some(member=>member.name===name),name);
  const project=newProject(),module=project.modules[0],control=createControl('OLE','Document1');control.properties.Index=2;module.form.controls.push(control);
  const service={index:()=>({symbols:[],interfaces:[],procedures:[]})},target=declarationTargets(project,module,service).find(item=>item.name==='Document1');
  for(const name of ['Updated','Click','MouseDown','KeyDown'])assert.ok(target.members.some(member=>member.name===name),name);
  assert.match(handlerEdit(project,module,service,'Document1','Updated').text,/Document1_Updated\(Index As Integer, Code As Integer\)/);
});
test('OLE enum and read-only edits fail before changing control state',()=>{
  const doc=new OleDocument(),control={type:'OLE',props:{OLETypeAllowed:2,SizeMode:0},oleController:{document:doc},invalidate(){}};
  assert.throws(()=>setOleProperty(control,'SizeMode',4),error=>error.number===380);assert.equal(control.props.SizeMode,0);
  for(const key of ['Object','OLEType','Modified','AppIsRunning'])assert.throws(()=>setOleProperty(control,key,1),error=>error.number===383);
  doc.createEmbed();assert.throws(()=>setOleProperty(control,'OLETypeAllowed',0),error=>error.number===380);assert.equal(control.props.OLETypeAllowed,2);
  assert.throws(()=>setOleProperty(control,'SourceDoc','bad\0path'),error=>error.number===380);doc.dispose();
});

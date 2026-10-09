import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {prepareProjectEdits} from '../src/editor/advanced/workspace.js';
import {readXamlDocument} from '../src/xaml/documents.js';
import {createVb6XamlSchema} from '../src/xaml/forms.js';

function fixture(){const p=newProject('Edits'),m=p.modules[0];p.settings.xaml=true;m.code='Option Explicit\n';return {p,m,schema:createVb6XamlSchema(),records:new Map([['vb6',{moduleId:m.id,language:'vb6'}],['xaml',{moduleId:m.id,language:'xaml'}]])};}
test('workspace transaction leaves the original project untouched and validates all documents',()=>{
  const {p,m,schema,records}=fixture(),before=structuredClone(p);
  const next=prepareProjectEdits(p,[{uri:'vb6',before:m.code,after:m.code+'Dim value As Long\n'}],records,{schema});
  assert.deepEqual(p,before);assert.match(next.modules[0].code,/Dim value/);
  assert.throws(()=>prepareProjectEdits(p,[{uri:'unknown',before:'',after:''}],records,{schema}));
  assert.throws(()=>prepareProjectEdits(p,[{uri:'vb6',before:'stale',after:''}],records,{schema}));
});
test('workspace XAML edit updates designer in the same proposal without mutating the live form',()=>{
  const {p,m,schema,records}=fixture(),text=readXamlDocument(m,{schema}).text,caption=m.form.properties.Caption;
  const after=text.replace(/Caption="[^"]*"/,'Caption="Edited"');
  const next=prepareProjectEdits(p,[{uri:'xaml',before:text,after}],records,{schema});
  assert.equal(next.modules[0].form.properties.Caption,'Edited');assert.equal(m.form.properties.Caption,caption);
});
test('invalid XAML, locked forms, running projects and paused XAML edits fail atomically',()=>{
  const {p,m,schema,records}=fixture(),before=structuredClone(p),text=readXamlDocument(m,{schema}).text;
  assert.throws(()=>prepareProjectEdits(p,[{uri:'xaml',before:text,after:'<broken'}],records,{schema}));
  assert.throws(()=>prepareProjectEdits(p,[{uri:'xaml',before:text,after:text}],records,{schema,isLocked:()=>true}));
  assert.throws(()=>prepareProjectEdits(p,[{uri:'xaml',before:text,after:text}],records,{schema,runState:'paused'}));
  assert.throws(()=>prepareProjectEdits(p,[{uri:'vb6',before:m.code,after:''}],records,{schema,runState:'running'}));assert.deepEqual(p,before);
});

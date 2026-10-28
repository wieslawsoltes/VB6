import test from 'node:test';
import assert from 'node:assert/strict';
import {EXAMPLES} from '../src/project/examples.js';
import {compileMacOSAOT,aotScalar} from '../packages/macos-native/src/aot-compiler.js';

// These are code-generation tests, not proof of native control execution.
const sample=id=>EXAMPLES.find(example=>example.id===id).create();
const propertyValue=value=>Array.isArray(value)?value.map(propertyValue):value&&typeof value==='object'?JSON.stringify(value):value;

test('direct AOT preserves structured designer collection properties recursively',()=>{
  const project=sample('controls'),before=JSON.stringify(project),compiled=compileMacOSAOT(project);
  let structuredArrays=0;
  for(const module of project.modules)if(module.form){
    const emitted=compiled.metadata.modules.find(m=>m.name===module.name);
    for(const control of module.form.controls){
      const spec=emitted.controls.find(c=>c.name===control.name);
      for(const [name,value]of Object.entries(control.properties||{}))if(Array.isArray(value)){
        const property=spec.properties.find(([key])=>key===name.toLowerCase());assert.ok(property,control.name+'.'+name);
        // Native tab bootstrap materializes its public defaults. Other
        // designer arrays retain the exact authored record serialization.
        const records=name==='Tabs'&&['TabStrip','SSTab'].includes(control.type)
          ?value.map(item=>({...item,Enabled:-1,Visible:-1,Picture:''})):value;
        const actual=compiled.metadata.literals[property[1]],expected=aotScalar(propertyValue(records));
        assert.deepEqual(actual,expected,control.name+'.'+name);structuredArrays++;
      }
    }
  }
  assert.ok(structuredArrays>=4,'TreeView nodes, ListView columns/items and TabStrip tabs');
  assert.equal(JSON.stringify(project),before);assert.ok(compiled.section.length>0);
});

test('direct AOT tab bootstrap preserves authored flags, logical selection and source records',()=>{
  const project=sample('controls'),control=project.modules.find(module=>module.form).form.controls.find(control=>control.type==='TabStrip');
  Object.assign(control.properties,{MacOSControlStyle:'segmented',Tab:2,Tabs:[
    {Key:'disabled',Caption:'Disabled',Enabled:0},
    {Key:'hidden',Caption:'Hidden',Visible:0},
    {Key:'selected',Caption:'Selected',Enabled:-1,Visible:-1,ToolTipText:'Settings'}
  ]});
  const before=structuredClone(project),compiled=compileMacOSAOT(project);
  const spec=compiled.metadata.modules.find(module=>module.controls).controls.find(item=>item.name===control.name);
  const literal=name=>compiled.metadata.literals[spec.properties.find(([key])=>key===name)[1]];
  assert.deepEqual(literal('tab'),aotScalar(2));
  assert.equal(literal('tabs').type,'array');
  const records=literal('tabs').value.map(value=>{assert.equal(value.type,'string');return JSON.parse(value.value);});
  assert.deepEqual(records,[
    {Key:'disabled',Caption:'Disabled',Enabled:0,Visible:-1,Picture:''},
    {Key:'hidden',Caption:'Hidden',Enabled:-1,Visible:0,Picture:''},
    {Key:'selected',Caption:'Selected',Enabled:-1,Visible:-1,ToolTipText:'Settings',Picture:''}
  ]);
  assert.deepEqual(project,before);
  assert.deepEqual(compiled.project.modules,before.modules);
});

test('nested designer arrays retain empty arrays, scalars and escaped JSON objects',()=>{
  const project=sample('controls'),control=project.modules.find(m=>m.form).form.controls[0];
  const value=[[],[1,'text',null],{Caption:'Zażółć "line"\n\u0000',Items:['A','B']}];
  control.properties.Tag=value;
  const result=compileMacOSAOT(project),spec=result.metadata.modules.find(m=>m.controls).controls.find(c=>c.name===control.name);
  const [,id]=spec.properties.find(([key])=>key==='tag');
  assert.deepEqual(result.metadata.literals[id],aotScalar(propertyValue(value)));
});

for(const id of ['orders','calculator','clock','graphics','data','controls','language','events','richtext','compatibility','mdi']){
  test('portable sample '+id+' produces actual ARM64 procedure code',()=>{
    const result=compileMacOSAOT(sample(id));assert.equal(result.report.codegen,'arm64-aot');
    assert.equal(result.report.artifact,'native-object-code');assert.ok(result.section.length>0);
    assert.ok(result.metadata.entries.every(offset=>offset%16===0));
  });
}

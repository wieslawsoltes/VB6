import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {compileMacOSAOT,DirectLowering} from '../packages/macos-native/src/aot-compiler.js';
import {compileMacOS,MacOSLowering} from '../packages/macos-native/src/compiler.js';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {macOSOptions} from '../packages/macos-native/src/target.js';
import {pascalNativeVerificationProject} from './pascal-integration-fixtures.mjs';

const project=code=>({schema:1,name:'NativeObjectTypes',language:'pascal',startup:'Sub Main',modules:[{name:'MainUnit',kind:'module',language:'pascal',code}]});
const aliases=()=>project(`program Aliases;
type TBase=object X:Integer; procedure Add(N:Integer); end;
TChild=object(TBase) Y:Integer; end;
TOther=object X:Integer; end;
procedure TBase.Add(N:Integer); begin X:=X+N end;
var Child:TChild;
procedure Touch(var Value:TBase); begin Value.X:=Value.X+2 end;
begin Child.X:=3; Child.Y:=11; Child.Add(4); Touch(Child) end.`);
function lowerMutated(change,input=aliases(),Lowering=DirectLowering) {
  const program=compileProject(input);assert.equal(program.valid,true,JSON.stringify(program.diagnostics));
  change(program);
  return new Lowering(program,macOSOptions({name:input.name})).emit();
}

test('both native targets retain qualified Pascal object identity and checked virtual metadata',()=>{
  for(const compile of [compileMacOSAOT,compileLinuxAOT]){
    const result=compile(pascalNativeVerificationProject(),{optimization:2});
    const base=result.metadata.modules.find(module=>module.name==='NativeObjects');
    const derived=result.metadata.modules.find(module=>module.name==='NativeDerived');
    assert.equal(base.language,'pascal');
    assert.equal(base.records[0].name,'nativeobjects.tbase');
    assert.equal(derived.records[0].name,'nativederived.tchild');
    assert.equal(derived.records[0].pascalObject.parent,'nativeobjects.tbase');
    assert.deepEqual(derived.records[0].pascalObject.fields.slice(0,2),base.records[0].pascalObject.fields);
    assert.equal(base.procedures.find(procedure=>procedure.name==='__PascalMethod_5_TBase_Init').parameters[0].type,'nativeobjects.tbase');
    const dispatch=base.procedures.find(procedure=>procedure.pascalDispatch).pascalDispatch;
    assert.deepEqual(dispatch.receiver,{parameter:'__pascalself',identity:'nativeobjects.tbase',vmtField:'__pascaltypeid'});
    const branch=dispatch.branches.find(branch=>branch.targetModule==='nativederived');
    assert.equal(branch.viewType,'nativederived.tchild');
    assert.equal(branch.typeId,derived.records[0].pascalObject.typeId);
    assert.ok(derived.records[0].pascalObject.virtualMethods.includes('nativederived.__pascalmethod_6_tchild_read'));
    assert.ok(!JSON.stringify(result.metadata).includes('"op":'),'metadata contains contracts, not executable instructions');
  }
});

test('C++ source build kits retain Pascal ancestry, parameter identity and virtual receiver guards',()=>{
  const source=compileMacOS(pascalNativeVerificationProject()).files['main.cpp'];
  assert.match(source,/m\.language="pascal"/);
  assert.match(source,/rt\.pascalObjects\["nativederived\.tchild"\]=PascalObjectType\{"nativederived\.tchild","nativeobjects\.tbase",/);
  assert.match(source,/m\.records\["nativederived\.tchild"\]/);
  assert.match(source,/Parameter\{"__PascalSelf","nativeobjects\.tbase",true/);
  assert.match(source,/p\.pascalDispatch=PascalDispatch\{"__pascalself","nativeobjects\.tbase","__pascaltypeid",/);
  assert.match(source,/"nativederived","__pascalmethod_6_tchild_read","nativederived\.tchild"\}/);
});

test('Pascal object metadata describes exact fixed array bounds and nested nominal fields',()=>{
  const input=project(`program Shapes;
const Low=-2; High=1;
type TPair=record X,Y:Integer end;
TBase=object Values:array[Low..High] of String[3]; Pair:TPair end;
TChild=object(TBase) Tail:Byte end;
var Child:TChild;
begin Child.Values[-2]:='abc'; Child.Pair.X:=7 end.`);
  const result=compileMacOSAOT(input),records=result.metadata.modules[0].records;
  const base=records.find(record=>record.name==='mainunit.tbase').pascalObject;
  const child=records.find(record=>record.name==='mainunit.tchild').pascalObject;
  assert.deepEqual(base.fields[1].bounds,[[-2,1]]);
  assert.equal(base.fields[1].type,'string');
  assert.equal(base.fields[2].type,'mainunit.tpair');
  assert.deepEqual(child.fields.slice(0,base.fields.length),base.fields);
  const pair=records.find(record=>record.name==='mainunit.tpair');
  assert.equal(pair.displayName,'TPair');
  assert.equal(pair.pascalObject,undefined);
});

test('VB records and authored generated-looking procedure names do not opt into Pascal compatibility',()=>{
  const input={schema:1,name:'Nominal',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:`Public Type First
 X As Long
End Type
Public Type Second
 X As Long
End Type
Public Sub __PascalDispatch_Authored(ByRef Value As First)
 Value.X = 3
End Sub
Public Sub Main()
 Dim Item As First
 __PascalDispatch_Authored Item
End Sub`}]};
  const module=compileMacOSAOT(input).metadata.modules[0];
  assert.equal(module.language,'vb6');
  assert.deepEqual(module.records.map(record=>[record.name,record.displayName]),[['mainmodule.first','First'],['mainmodule.second','Second']]);
  assert.ok(module.records.every(record=>!record.pascalObject));
  assert.ok(module.procedures.every(procedure=>!procedure.pascalDispatch));
  const source=compileMacOS(input).files['main.cpp'];
  assert.ok(!source.includes('rt.pascalObjects['));
  assert.ok(!source.includes('p.pascalDispatch='));
});

for(const [name,change] of [
  ['unknown parent',module=>{module.pascal.objectTypes.find(object=>object.name==='TChild').parent.identity='other.tbase';}],
  ['different inherited field type',module=>{module.types.TChild[1].type='Long';}],
  ['different inherited field name',module=>{module.types.TChild[1].name='Other';}],
  ['cyclic self ancestor',module=>{const child=module.pascal.objectTypes.find(object=>object.name==='TChild');child.parent={module:module.name,name:child.name,identity:child.identity};}],
])test('native lowering rejects '+name+' before serializing a Pascal ancestor contract',()=>{
  for(const Lowering of [DirectLowering,MacOSLowering])assert.throws(()=>lowerMutated(program=>change(program.modules.get('mainunit')),aliases(),Lowering),/Invalid Pascal object ancestry metadata/);
});

for(const [name,change] of [
  ['incorrect runtime tag',dispatch=>{dispatch.branches[0].typeId+=100;}],
  ['undeclared implementation',dispatch=>{dispatch.branches[0].targetProcedure='Authored';}],
  ['duplicate runtime tag',dispatch=>{dispatch.branches.push({...dispatch.branches[0]});}],
])test('native lowering rejects '+name+' in generated virtual dispatch metadata',()=>{
  for(const Lowering of [DirectLowering,MacOSLowering])assert.throws(()=>lowerMutated(program=>change(program.modules.get('nativeobjects').pascal.objectDispatchers[0]),pascalNativeVerificationProject(),Lowering),/Invalid Pascal virtual dispatch branch metadata/);
});

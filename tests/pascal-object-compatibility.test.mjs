import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {compileWin32} from '../src/native/compiler.js';
import {pascalObjectReferenceCompatible} from '../src/language/pascal/object-compatibility.js';
import {NativeRecordLayouts} from '../src/native/records.js';

const source = `program Aliases;
type TBase = object X: Integer; procedure Add(N: Integer); end;
     TChild = object(TBase) Y: Integer; end;
     TOther = object X: Integer; end;
procedure TBase.Add(N: Integer); begin X := X + N end;
var Child: TChild;
procedure Touch(var B: TBase); begin B.X := B.X + 2 end;
begin Child.X := 3; Child.Y := 11; Child.Add(4); Touch(Child) end.`;
const project = () => ({schema:1,name:'Aliases',language:'pascal',startup:'Sub Main',settings:{},modules:[{id:'main',name:'MainUnit',kind:'module',language:'pascal',code:source}]});
const compile = () => { const p=compileProject(project()); assert.equal(p.valid,true,JSON.stringify(p.diagnostics)); return p; };

test('Pascal object var compatibility follows validated ancestry, not matching fields', () => {
  const {modules}=compile();
  assert.equal(pascalObjectReferenceCompatible(modules,'mainunit.tchild','mainunit.tbase'),true);
  for(const [from,to] of [['mainunit.tbase','mainunit.tchild'],['mainunit.tother','mainunit.tbase'],['mainunit.tchild','mainunit.tother'],['missing.tchild','mainunit.tbase']])
    assert.equal(pascalObjectReferenceCompatible(modules,from,to),false);
});

test('malformed compiler ancestry and mismatched field prefixes fail closed', () => {
  for(const change of [
    m=>{m.language='vb6';},
    m=>{m.pascal.objectTypes.find(t=>t.name==='TChild').parent.identity='other.tbase';},
    m=>{m.types.TChild[1].type='Long';},
    m=>{m.types.TChild[1].name='Different';}
  ]) {
    const {modules}=compile();change(modules.get('mainunit'));
    assert.equal(pascalObjectReferenceCompatible(modules,'mainunit.tchild','mainunit.tbase'),false);
  }
});

test('Win32 object ancestor references also require an identical physical prefix', () => {
  const program=compile(),layouts=new NativeRecordLayouts(program),module=program.modules.get('mainunit');
  const child=layouts.resolve('TChild',module),base=layouts.resolve('TBase',module);
  assert.equal(layouts.referenceCompatible(child,base),true);
  const corrupt={...child,fields:new Map(child.fields)};
  corrupt.fields.set('x',{...child.fields.get('x'),recordOffset:12});
  assert.equal(layouts.referenceCompatible(corrupt,base),false);
  assert.equal(layouts.referenceCompatible(base,child),false);
});

test('Win32 emits static inherited Self and ancestor var calls at O0 and O2', () => {
  for(const optimization of [0,2])assert.ok(compileWin32(project(),{optimization}).bytes.length>0);
});

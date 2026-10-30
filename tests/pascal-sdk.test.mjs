import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {buildPascalPackage} from '../tools/build-pascal.mjs';
import {pascalFormProject} from './pascal-integration-fixtures.mjs';

const root=path.resolve('packages/turbo-pascal');
buildPascalPackage();

test('isolated Pascal SDK contains every declared artifact and resolves no checkout imports',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pascal-sdk-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  for(const item of ['package.json',...manifest.files])await fs.cp(path.join(root,item),path.join(temp,item),{recursive:true});
  const api=await import(pathToFileURL(path.join(temp,'dist/index.js')).href);
  assert.deepEqual(Object.keys(api).sort(),['PASCAL_DIALECT','PASCAL_KEYWORDS','PASCAL_VERSION','PascalError','compileModule','compilePascalModule','compilePascalSource','compileProject','createPascalProject','lowerPascalModule','parsePascalModule','tokenizePascal'].sort());
  assert.equal(manifest.exports['./browser'].types,'./src/browser.d.ts');
  assert.ok(manifest.sideEffects.includes('./dist/browser.js'),'Bundlers must preserve the browser global installation');
  assert.equal(api.PASCAL_DIALECT,'Turbo Pascal 7.0');assert.equal(api.PASCAL_VERSION,manifest.version);
  const source=`program Main; uses Arithmetic; begin WriteLn(Twice(21)) end.`;
  const unit={name:'Arithmetic',code:'unit Arithmetic; interface function Twice(N: Integer): Integer; implementation function Twice(N: Integer): Integer; begin Twice := N * 2 end; end.'};
  const program=api.compilePascalSource(source,{name:'Main',units:[unit]});
  assert.equal(program.valid,true,JSON.stringify(program.diagnostics));assert.equal(program.modules.get('main').source,source);
  assert.equal(program.modules.get('main').language,'pascal');assert.ok(program.modules.get('arithmetic').procedures.has('twice'));
  assert.ok(program.modules.get('main').procedures.get('main').code.length>0);
  assert.equal(api.compileProject(pascalFormProject()).valid,true);
  const mixed=api.createPascalProject('program Main; begin WriteLn(Helper.Answer()) end.',{name:'Main',units:[{name:'Helper',language:'vb6',code:'Public Function Answer() As Integer\nAnswer=42\nEnd Function'}]});
  const linked=api.compileProject(mixed);assert.equal(linked.valid,true,JSON.stringify(linked.diagnostics));
});

test('browser compiler executes without DOM, network or dynamic source evaluation',async()=>{
  const context=vm.createContext({TextEncoder,TextDecoder},{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(await fs.readFile(path.join(root,'dist/browser.js'),'utf8'),{filename:'turbo-pascal.js'}).runInContext(context,{timeout:5000});
  const api=context.TurboPascal,source='program Browser; var I: Integer; begin I := 7 div 2; WriteLn(I) end.';
  const project={schema:1,name:'Browser',startup:'Sub Main',language:'pascal',modules:[{name:'Browser',code:source}],settings:{}};
  assert.equal(api.compileProject(project).valid,true);
  for(const forbidden of ['document','window','fetch','require','structuredClone'])assert.equal(context[forbidden],undefined);
  assert.equal(api.parsePascalModule({name:'Browser',code:source}).kind,'pascalModule');
  const token=api.tokenizePascal('begin\r\n  X := 1\r\nend.').find(t=>t.value==='X');
  assert.equal(token.line,2);assert.equal(token.column,3);
});

test('packaged diagnostics preserve original Pascal source and reject unsupported semantics',async()=>{
  const api=await import('../packages/turbo-pascal/dist/index.js');
  const program=api.compilePascalSource('program Bad;\nbegin Missing := 1 end.',{name:'Bad'});
  assert.equal(program.valid,false);assert.ok(program.diagnostics.some(d=>d.source==='Bad'&&d.line===2));
  const wide=api.compilePascalSource('program Wide; var N: Extended; begin N := 1 end.',{name:'Wide'});
  assert.equal(wide.valid,false);assert.match(wide.diagnostics.map(d=>d.message).join('\n'),/Extended|precision|80/);
  const classInput={name:'PascalClass',kind:'class',language:'pascal',code:'unit PascalClass; interface implementation end.'};
  assert.throws(()=>api.compilePascalModule(classInput),error=>error.code==='TP_CLASS_MODULE'&&error.source==='PascalClass'&&/TP7 object types.*Visual Basic class module/.test(error.message));
  const classProject=api.compileProject({name:'Boundary',language:'pascal',startup:'Sub Main',modules:[classInput]});
  assert.equal(classProject.valid,false);assert.ok(classProject.diagnostics.some(error=>error.source==='PascalClass'&&/does not support VB class modules/.test(error.message)));
});

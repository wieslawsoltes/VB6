import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeStorageMethods} from '../src/native/storage.js';
import {nativeStringInteropMethods} from '../src/native/string-interop.js';
import {parseExpression} from '../src/language/expression.js';
import {compileWin32} from '../src/native/compiler.js';

// StrPtr must use the same binding as String evaluation, not special-case the
// spelling of an authored Const. This is a real emitter-path regression.
for (const text of ['vbNullString', '(vbNullString)']) test('StrPtr preserves authored constant binding: '+text, () => {
  const expression = parseExpression('StrPtr('+text+')');
  let evaluated, value;
  const context = {
    type: () => 'string', variable: () => null,
    expression: node => { evaluated = node; },
    x: { value: n => { value = n; } }
  };
  assert.equal(nativeStorageMethods.stringBuiltin.call(context, expression, 'strptr'), true);
  assert.equal(evaluated, expression.args[0]);
  assert.equal(value, undefined, 'the emitter must not force an authored String to NULL');
});

test('the built-in null String is recognized only after lexical bindings', () => {
  const node=parseExpression('vbNullString');
  const context={...nativeStringInteropMethods, variable:()=>null, nativeConstant:()=>null, nativeFunctionType:()=>null};
  assert.equal(context.nativeNullString(node),true);
  assert.equal(context.nativeNullString(parseExpression('(vbNullString)')),true);
  context.nativeConstant=()=>({type:'string',value:'shadow'});
  assert.equal(context.nativeNullString(node),false);
  context.nativeConstant=()=>null; context.nativeFunctionType=()=> 'string';
  assert.equal(context.nativeNullString(node),false);
});

test('ownership edge fixture has checked dependencies and deterministic output', async()=>{
  const {stringOwnershipFixture}=await import('../tools/win32-string-edge-fixture.mjs');
  const {project,checks}=stringOwnershipFixture(),before=JSON.stringify(project);
  const result=compileWin32(project);
  assert.ok(checks.length>=12);assert.equal(JSON.stringify(project),before);
  assert.deepEqual(result.bytes,compileWin32(project).bytes);
  assert.ok(result.report.imports.some(i=>i.symbol==='AliasBuffers'));
  assert.ok(result.report.imports.some(i=>i.symbol==='PartialOutputs'));
});

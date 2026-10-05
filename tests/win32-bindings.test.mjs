import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {compileProject} from '../src/language/compiler.js';
import {nativeBindingMethods} from '../src/native/bindings.js';
import {parseExpression} from '../src/language/expression.js';
import {newProject} from '../src/project/model.js';

function project(body, declarations='', peers=[]) {
  const p=newProject('Bindings');p.startup='Sub Main';
  p.modules=[{id:'money',name:'Money',kind:'module',code:`${declarations}\nSub Main()\n${body}\nEnd Sub`},...peers];
  return p;
}
const rates={id:'rates',name:'Rates',kind:'module',code:`Public Const Rate As Double = 0.125
Public Const Whole As Double = 2
Public Const Small As Single = 2
Public Const Exact As Currency = 900719925474.0993@
Private Const Secret As Long = 7
Public Enum Modes
 First = 4
 Second = 5
End Enum`};
function context(p) {
  const program=compileProject(p);assert.equal(program.valid,true,JSON.stringify(program.diagnostics));
  const modules=new Map([...program.modules].map(([k,m])=>[k,{module:m,globals:new Map()}]));
  const module=modules.get('money'),proc=module.module.procedures.get('main');
  return {modules,context:{module,proc,locals:new Map()},fail:message=>{throw Error(message);},...nativeBindingMethods};
}
for(const [name,type]of [['Rate','double'],['Whole','double'],['Small','single'],['Exact','currency'],['First','long']])test('native constant preserves declared '+name+' type through public and qualified references',()=>{
  const p=project('Dim result As String', '',[rates]),c=context(p);
  assert.equal(c.nativeConstant(parseExpression(name)).type,type);
  assert.equal(c.nativeConstant(parseExpression('Rates.'+name)).type,type);
  assert.equal(c.nativeConstant(parseExpression('('+name+')')).type,type);
});
test('local and private constants keep their declared type, not the shape of their value',()=>{
  const p=project('Const LocalValue As Single = 2\nDim result As String','Private Const Whole As Double = 2'),c=context(p);
  assert.equal(c.nativeConstant(parseExpression('LocalValue')).type,'single');
  assert.equal(c.nativeConstant(parseExpression('Whole')).type,'double');
  assert.equal(c.nativeConstant(parseExpression('Money.Whole')).type,'double');
});
test('inferred constant representations follow the bound values',()=>{
  const c=context(project('', 'Const Text = "x"\nConst Small = 3\nConst Large = 40000\nConst Fraction = 0.125\nConst Exact = 1.0001@'));
  for(const [name,type]of [['Text','string'],['Small','integer'],['Large','long'],['Fraction','double'],['Exact','currency']])assert.equal(c.nativeConstant(parseExpression(name)).type,type);
});
test('enum namespaces use checked Long constants',()=>{
  const c=context(project('','',[rates]));
  assert.deepEqual(c.nativeConstant(parseExpression('Modes.Second')),{value:5,type:'long'});
});
test('local and module variables shadow public constants',()=>{
  const c=context(project('','',[rates]));
  c.context.locals.set('rate',{name:'Rate',type:'Long'});
  assert.equal(c.nativeConstant(parseExpression('Rate')),null);
  c.context.locals.clear();c.context.module.globals.set('rate',{name:'Rate',type:'Long'});
  assert.equal(c.nativeConstant(parseExpression('Rate')),null);
  assert.equal(c.nativeConstant(parseExpression('Rates.Rate')).type,'double');
});
test('private and ambiguous constants fail rather than reading arbitrary module order',()=>{
  const other={...rates,id:'other',name:'Other'};
  const c=context(project('','',[rates,other]));
  assert.throws(()=>c.nativeConstant(parseExpression('Rate')),/Ambiguous/);
  assert.throws(()=>c.nativeConstant(parseExpression('Rates.Secret')),/Private/);
  assert.throws(()=>c.nativeConstant(parseExpression('Modes.First')),/Ambiguous/);
});
test('native constant use rejects unsupported Date values without lowering a pointer as an integer',()=>{
  assert.throws(()=>compileWin32(project('Dim s As String\ns = CStr(Day)','Private Const Day As Date = #2020-01-01#')),/constant type.*date/i);
});
for(const type of ['Single','Double','Currency','Byte','Integer','Boolean','Long'])test('DLL and project function '+type+' return type resolves from the actual signature',()=>{
  const n=parseExpression('F(1)'),signature={kind:'function',returnType:type};
  for(const target of [signature,{proc:signature}]){
    const c={...nativeBindingMethods,resolveProcedure:()=>target};
    assert.equal(c.nativeFunctionType(n),type.toLowerCase());
    assert.equal(c.nativeFunctionType(parseExpression('M.F(1)')),type.toLowerCase());
    assert.equal(c.nativeFunctionType(parseExpression('F')),type.toLowerCase());
  }
});
test('public numeric/Currency constants compile through assignments and conversions',()=>{
  const p=project('Dim d As Double, c As Currency, s As String\nd = Rates.Rate\nc = Exact\nc = c + Rates.Rate\ns = CStr(Rates.Exact)\ns = TypeName(Whole)\nd = Modes.Second','',[rates]),before=JSON.stringify(p);
  const result=compileWin32(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);
});
test('constant accessibility is enforced at emitted use sites',()=>{
  assert.throws(()=>compileWin32(project('Dim n As Long\nn = Rates.Secret','',[rates])),/Private/);
  assert.throws(()=>compileWin32(project('Dim n As Long\nn = Rate','',[rates,{...rates,id:'other',name:'Other'}])),/Ambiguous/);
});


test('independent Currency/constant/DLL execution fixture builds deterministically', async()=>{
  const {currencyBindingsFixture}=await import('../tools/win32-bindings-fixtures.mjs');
  const {project:p,checks}=currencyBindingsFixture(),before=JSON.stringify(p);
  const result=compileWin32(p);
  assert.equal(checks.length,30);assert.equal(JSON.stringify(p),before);
  assert.deepEqual(result.bytes,compileWin32(p).bytes);
  assert.ok(result.report.imports.some(i=>i.symbol==='EchoCurrency'));
  assert.ok(result.report.imports.some(i=>i.symbol==='EchoDouble'));
});

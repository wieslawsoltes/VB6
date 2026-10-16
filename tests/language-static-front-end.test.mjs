import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExpression} from '../src/language/expression.js';
import {tokenize,logicalLines} from '../src/language/lexer.js';
import {preprocess} from '../src/language/conditional.js';
import {compileProject} from '../src/language/compiler.js';
import {parseParameters} from '../src/language/declarations.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const project=code=>({name:'FrontEnd',startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
for(const [raw,value,type] of [
  ['&0',0,'integer'],['&17',15,'integer'],['&77777',32767,'integer'],
  ['&100000',-32768,'integer'],['&177777',-1,'integer'],['&177777&',65535,'long'],
  ['&200000',65536,'long'],['&37777777777',-1,'long'],['&20000000000&',-2147483648,'long'],
  ['&O177777%',-1,'integer'],['&o100000%',-32768,'integer'],
  ['&HFFFF%',-1,'integer'],['&h8000%',-32768,'integer'],['&HFFFF&',65535,'long'],
  ['&HFFFFFFFF&',-1,'long'],['&H80000000',-2147483648,'long'],
])test('classic radix literal '+raw,()=>{
  const expr=parseExpression(raw);assert.equal(expr.value,value);assert.equal(expr.valueType,type);
  const token=tokenize('  '+raw)[0];assert.equal(token.raw,raw);assert.equal(token.start,2);assert.equal(token.end,2+raw.length);
});
for(const raw of ['&H100000%','&O200000%','&200000%','&H100000000','&40000000000','&O40000000000&'])test('radix overflow is lexical and located: '+raw,()=>{
  assert.throws(()=>tokenize('  '+raw),e=>e.number===6&&e.column===3);
  const result=compileProject(project('Sub Main\nDebug.Print '+raw+'\nEnd Sub'));
  assert.equal(result.valid,false);assert.equal(result.diagnostics[0].source,'M');assert.equal(result.diagnostics[0].line,2);
});
test('radix tokens retain concatenation, comments and exponentiation boundaries',()=>{
  assert.equal(parseExpression('"x" & &17').right.value,15);
  assert.equal(parseExpression('&H2 ^ 3').op,'^');
  assert.equal(parseExpression('&17 \' comment').value,15);
  for(const raw of ['&H','&O','&O8','&O178','&17.2','&H1G'])assert.throws(()=>parseExpression(raw));
});
test('radix widths execute through constants, optional defaults and the VM',async()=>{
  const code='Const AllBits = &HFFFF%\nFunction Width(Optional n As Long = &177777&) As Long\nWidth = n\nEnd Function\nSub Main\nDebug.Print CStr(AllBits) & ":" & CStr(Width()) & ":" & CStr(&17) & ":" & CStr(VarType(&HFFFF%))\nEnd Sub';
  const p=compileProject(project(code));assert.deepEqual(p.diagnostics,[]);const output=[];
  const vm=new VirtualMachine(p,{print:s=>output.push(s)});await vm.start();assert.notEqual(vm.state,'error');assert.deepEqual(output,['-1:65535:15:2']);
});
test('continued conditional directives preserve physical source and instruction lines',()=>{
  const code=['#Const Flag = 1 + _','  2','#If Flag = 3 And _',' True Then','Sub Main','Debug.Print 42','End Sub','#ElseIf False Or _',' False Then','this branch must not parse','#Else','also excluded','#End If'].join('\r\n');
  const expanded=preprocess(code);assert.equal(expanded.split('\n').length,13);
  assert.deepEqual(expanded.split('\n').filter(Boolean),['Sub Main','Debug.Print 42','End Sub']);
  const p=compileProject(project(code));assert.deepEqual(p.diagnostics,[]);
  assert.equal(p.modules.get('m').procedures.get('main').code.find(i=>i.op==='print').line,6);
});
test('continued directive errors point to their opening physical line',()=>{
  for(const code of ['\n#If True And _\nThen\n#End If','\n#Const N = 1 + _\n)'])assert.throws(()=>preprocess(code,{},'M'),e=>e.source==='M'&&e.line===2);
  assert.throws(()=>preprocess('\n#If True _',{},'M'),e=>e.source==='M'&&e.line===2&&/continuation/.test(e.message));
});
test('ordinary code continuations survive preprocessing unchanged',()=>{
  const source='Sub Main\nDebug.Print 1 + _\n2\nEnd Sub';assert.equal(preprocess(source),source);
  assert.equal(logicalLines(preprocess(source))[1].line,2);
});
test('comments, strings and excluded directive expressions keep lexical boundaries',()=>{
  assert.equal(preprocess('#Const X = " _"\n#If X = " _" Then\nkept\n#End If').split('\n')[2],'kept');
  assert.equal(preprocess('#If True Then \' _\nkept\n#End If').split('\n')[1],'kept');
  assert.throws(()=>preprocess('#If False Then\n#If 1 / _\n0 Then\n#End If\n#End If'),e=>e.line===2);
});
test('loop type checks use the same suffix-insensitive identity as the binder and VM',()=>{
  const p=compileProject(project('Option Explicit\nSub Main\nDim n&\nFor n& = 1 To 2\nNext n&\nEnd Sub'));assert.deepEqual(p.diagnostics,[]);
  const bad=compileProject(project('Sub Main\nDim n$\nFor n$ = 1 To 2\nNext\nEnd Sub'));assert.equal(bad.valid,false);assert.match(bad.diagnostics[0].message,/numeric or Variant/);
});
test('parameter suffix aliases cannot redeclare the same identifier',()=>{
  for(const text of ['n&, n As Long','a%, A&','value$, value'])assert.throws(()=>parseParameters(text),/Duplicate parameter/);
  assert.equal(parseParameters('one&, two%').length,2);
});

test('unterminated strings cannot silently continue across physical lines',()=>{
  assert.throws(()=>preprocess('#Const X = "unfinished _\n"\n'),/quotation/);
  const p=compileProject(project('Sub Main\nDebug.Print "unfinished _\n"\nEnd Sub'));
  assert.equal(p.valid,false);assert.equal(p.diagnostics[0].line,2);assert.match(p.diagnostics[0].message,/quotation/);
});

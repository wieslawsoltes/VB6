import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32, extractNativeDeclarations} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {MAX_NATIVE_ANSI_BYTES} from '../src/native/string-interop.js';

function project(body, declarations = '') {
  const p = newProject('NativeStringInterop'); p.startup = 'Sub Main';
  p.modules = [{id:'main',name:'MainModule',kind:'module',code:`Option Explicit\n${declarations}\nSub Main()\n${body}\nEnd Sub`}];
  return p;
}
const declaration = (parameter = 'ByVal value As String', result = 'Long') =>
  `Private Declare Function Probe Lib "probe.dll" (${parameter}) As ${result}`;
const build = (body, declarations = declaration()) => compileWin32(project(body,declarations));

for (const mode of ['ByVal','ByRef']) for (const type of ['Byte','Integer','Long','Boolean','Single','Double','Currency','Date','String']) {
  test(`Declare ${mode} String parameter and ${type} result use native code`, () => {
    const result = build('Dim text As String\ntext="a" & ChrW(0) & "b"\nCall Probe(text)',declaration(`${mode} value As String`,type));
    for (const symbol of ['WideCharToMultiByte','MultiByteToWideChar','SysAllocStringByteLen','SysStringByteLen','GetLastError'])
      assert.ok(result.report.imports.some(i => i.symbol === symbol),symbol);
    assert.equal(result.report.extraction,false);
  });
}
for (const expression of ['"literal"','vbNullString','("literal")','(text)','text & "suffix"','CStr(7)']) {
  test(`String value argument ${expression} receives a private writable conversion`, () => {
    const r=build(`Dim text As String\ntext="original"\nCall Probe(${expression})`);
    assert.ok(r.report.imports.some(i=>i.symbol==='SysAllocStringByteLen'));
  });
}
test('external call-site ByVal String selects a byte-BSTR rather than a pointer-to-pointer',()=>{
  build('Dim s As String\ns="abc"\nCall Probe(ByVal s)',declaration('ByRef value As String'));
  assert.throws(()=>build('Dim s As String\nCall Probe(ByVal s)'),/Call-site ByVal/);
});
test('String array elements and fixed strings bind to one captured copy-back destination',()=>{
  for (const mode of ['ByVal','ByRef'])
    build('Dim a() As String, fixed As String * 12\nReDim a(2)\nCall Probe(a(1))\nCall Probe(fixed)',declaration(mode+' value As String'));
});
test('parenthesized ByRef String arguments are private value copies',()=>{
  build('Dim n As Long, s As String * 7\nCall Probe((n))\nCall Probe((s))',declaration('ByRef value As String'));
  assert.throws(()=>build('Dim n As Long\nCall Probe(n)',declaration('ByRef value As String')),/exact declared type/);
});
test('whole arrays are not silently marshalled as a BSTR',()=>{
  for (const mode of ['ByVal','ByRef'])
    assert.throws(()=>build('Dim a() As String\nCall Probe(a)',declaration(mode+' value As String')),/scalar values/);
});
test('String-returning Declare is owned and uses byte length, not an unbounded LPSTR scan',()=>{
  const r=build('Dim text As String\ntext=Probe()\ntext=Probe() & Probe()',declaration('', 'String'));
  assert.ok(r.report.imports.some(i=>i.symbol==='MultiByteToWideChar'));
  assert.ok(!r.report.imports.some(i=>i.symbol==='lstrlenA'));
});
test('String marshaler is not added to numeric-only projects',()=>{
  const r=build('Call Probe(7)',declaration('ByVal n As Long'));
  assert.ok(!r.report.imports.some(i=>i.symbol==='WideCharToMultiByte'));
  assert.ok(r.report.imports.some(i=>i.symbol==='GetLastError'));
  assert.equal(MAX_NATIVE_ANSI_BYTES,4*1024*1024);
});
test('LastDLLError is a numeric read-only value usable in typed expressions',()=>{
  const r=build('Dim e As Long, s As String\ne=Err.LastDLLError\ns=CStr(Err.LastDLLError)\nIf Err.LastDLLError <> 0 Then e=1');
  assert.ok(r.bytes.length);
  assert.throws(()=>build('Err.LastDLLError=7'),/read.only|Unknown native (?:object|assignment target)|not.*implemented/i);
});
test('Declare continuation preserves every physical source line and qualified access',()=>{
  const source='Option Explicit\nPrivate Declare Function Probe Lib "probe" _\n Alias "Name_With_Underscore" ( _\n ByVal text As String, _\n ByRef count As Long) As String\nSub Main()\nEnd Sub';
  const {code,declarations}=extractNativeDeclarations({name:'M',code:source});
  assert.equal(code.split('\n').length,source.split('\n').length);
  assert.deepEqual(code.split('\n').slice(1,5),['','','','']);
  assert.equal(declarations.get('probe').line,2);
  assert.equal(declarations.get('probe').symbol,'Name_With_Underscore');
  assert.equal(declarations.get('probe').returnType,'String');
});
test('comments and literal underscores cannot masquerade as Declare continuations',()=>{
  const {code,declarations}=extractNativeDeclarations({name:'M',code:'Declare Function Probe Lib "probe" Alias "Name_" (ByVal text As String) As Long \' _\nSub Main()\nEnd Sub'});
  assert.equal(code.split('\n')[1],'Sub Main()');assert.equal(declarations.size,1);
});
test('malformed continued declarations and parameters retain original source diagnostics',()=>{
  for (const code of ['Declare Function Probe Lib "x" _','Declare Function Probe Lib "x" ( _\nByRef ByVal s As String) As Long']) {
    assert.throws(()=>extractNativeDeclarations({name:'Bad',code:'\n'+code}),e=>e.diagnostics?.[0].source==='Bad'&&e.diagnostics?.[0].line===2);
  }
});
test('String declarations retain unsupported ABI and ordinal guards',()=>{
  for(const signature of ['ByVal s() As String','ByRef s() As String','ByVal s As Object','ByVal s As Any','Optional s As String'])
    assert.throws(()=>build('Call Probe()',declaration(signature)));
});
test('String interop is reproducible and never edits authored code',()=>{
  const p=project('Dim s As String\ns="before"\nCall Probe(value:=s)');
  p.modules[0].code=declaration()+'\n'+p.modules[0].code;
  const before=JSON.stringify(p),first=compileWin32(p);
  assert.deepEqual(first.bytes,compileWin32(p).bytes);assert.equal(JSON.stringify(p),before);
});
test('independent String ABI and system-only fixtures compile reproducibly with explicit dependencies',async()=>{
  const {stringInteropFixture,systemStringFixture}=await import('../tools/win32-string-fixtures.mjs');
  for(const [make,count] of [[stringInteropFixture,45],[systemStringFixture,8]]){
    const {project:p,checks}=make(),before=JSON.stringify(p),result=compileWin32(p);
    assert.equal(checks.length,count);assert.equal(JSON.stringify(p),before);
    assert.deepEqual(result.bytes,compileWin32(p).bytes);
    assert.equal(result.report.imports.some(i=>i.dll==='vb6-string-probe.dll'),make===stringInteropFixture);
  }
});
test('Space and Space$ validate argument arity while retaining runtime bounds checks',()=>{
  build('Dim s As String\ns=Space$(0)\ns=Space(3)\ns=Space$(-1)\ns=Space$(1048577)');
  for(const expr of ['Space()','Space$(1,2)'])assert.throws(()=>build('Dim s As String\ns='+expr),/one argument/);
});

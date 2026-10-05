import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32, NativeCompileError} from '../src/native/compiler.js';
import {planNativeArguments,nativeCallMethods} from '../src/native/calls.js';
import {parseExpression} from '../src/language/expression.js';
import {newProject,createControl} from '../src/project/model.js';

function project(body,declarations='',others=[]) {
  const p=newProject('NativeCalls');p.startup='Sub Main';
  p.modules=[{id:'main',name:'Entry',kind:'module',code:`Option Explicit\n${declarations}\nPublic Sub Main()\n${body}\nEnd Sub`},...others];
  return p;
}
const compile=(body,declarations='',others=[])=>compileWin32(project(body,declarations,others));
const signature={name:'Combine',params:[{name:'first',type:'Long',byRef:false},{name:'second',type:'String',byRef:true,optional:true},{name:'third',type:'Double',byRef:false,optional:true}]};
const plan=text=>planNativeArguments(signature,parseExpression(text).args);

test('native argument planning separates source order from formal stack slots',()=>{
  const p=plan('Combine(third:=NextValue(1), FIRST:=NextValue(2), second:=NextValue(3))');
  assert.deepEqual(p.order.map(x=>x.index),[2,0,1]);
  assert.deepEqual(p.slots.map(x=>x.node.args[0].value),[2,3,1]);
});
test('omitted typed defaults fill their own slots after supplied expressions',()=>{
  const p=plan('Combine(1,,3)');assert.deepEqual(p.slots.map(x=>x.omitted),[false,true,false]);
  assert.deepEqual(p.order.map(x=>x.index),[0,2,1]);
  assert.deepEqual(plan('Combine(first:=1)').slots.map(x=>x.omitted),[false,true,true]);
});
for(const [source,message]of [
  ['Combine()',/Missing required/],['Combine(,2)',/not optional/],['Combine(1,2,3,4)',/Too many/],
  ['Combine(unknown:=1)',/Unknown/],['Combine(first:=1,First:=2)',/Duplicate/],
  ['Combine(1,first:=2)',/Duplicate/],['Combine(first:=1,2)',/Positional/],
  ['Combine(1,,second:=3)',/Duplicate/],['Combine(third:=3)',/Missing required/]
])test('native argument planning rejects '+source,()=>assert.throws(()=>plan(source),message));

test('argument planning does not mutate the parsed call or declaration',()=>{
  const args=parseExpression('Combine(third:=3,first:=1)').args,before=JSON.stringify({signature,args});
  const p=planNativeArguments(signature,args);p.slots[1].node={kind:'literal',value:'default'};
  assert.equal(JSON.stringify({signature,args}),before);
});

for(const type of ['Byte','Integer','Long','Boolean','Single','Double','Currency','String']) {
  const value=type==='String'?'"text"':type==='Boolean'?'True':type==='Currency'?'1.0001@':'1';
  test('typed Optional '+type+' supports ByVal, ByRef and a default zero/empty value',()=>{
    compile('Call A()\nCall B()\nCall C()',`Private Sub A(Optional ByVal value As ${type} = ${value})\nEnd Sub\nPrivate Sub B(Optional ByRef value As ${type} = ${value})\nEnd Sub\nPrivate Sub C(Optional value As ${type})\nEnd Sub`);
  });
  test('writable ByRef '+type+' expression temporaries compile independently of read-only constants',()=>{
    compile(`Call Change(${value})\nDim own As ${type}\nCall Change((own))`, `Private Sub Change(ByRef value As ${type})\nvalue = ${value}\nEnd Sub`);
  });
}

test('module-qualified implicit function calls materialize all optional defaults',()=>{
  compile('Dim s As String, n As Long\ns=Other.OptionalText\nn=Other.OptionalNumber',[].join(''),[
    {id:'other',name:'Other',kind:'module',code:'Private Const Seed As Long = 9\nPublic Function OptionalText(Optional ByVal s As String = "value") As String\nOptionalText = s\nEnd Function\nPublic Function OptionalNumber(Optional ByVal n As Long = Seed) As Long\nOptionalNumber=n\nEnd Function'}]);
});
test('named mixed-width values and typed array references compile without changing source',()=>{
  const p=project('Dim a() As Currency, r As Currency\nReDim a(2)\nr=Mix(tail:=3, amount:=1.0001@, values:=a, factor:=CDbl(2))',
    'Private Function Mix(ByRef values() As Currency, ByVal amount As Currency, ByVal factor As Double, Optional ByVal tail As Integer = 0) As Currency\nMix = amount + factor + tail\nEnd Function');
  const before=JSON.stringify(p),r=compileWin32(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(r.bytes,compileWin32(p).bytes);
});
test('parenthesized mismatched ByRef scalars may convert without altering the variable',()=>{
  compile('Dim d As Double, fixed As String * 8\nCall Narrow((d))\nCall Text((fixed))',
    'Private Sub Narrow(ByRef n As Integer)\nn=1\nEnd Sub\nPrivate Sub Text(ByRef s As String)\ns="changed"\nEnd Sub');
});
test('unparenthesized mismatched ByRef variables still diagnose exact type requirements',()=>{
  assert.throws(()=>compile('Dim d As Double\nCall Narrow(d)','Private Sub Narrow(ByRef n As Integer)\nEnd Sub'),/exact declared type/);
});
test('unparenthesized fixed-length String copy-back is not falsely implemented',()=>{
  assert.throws(()=>compile('Dim s As String * 8\nCall Text(s)','Private Sub Text(ByRef s As String)\nEnd Sub'),/Fixed-length String ByRef/);
});
for(const [decl,body,pattern]of [
 ['Private Sub P(Optional x As Variant)\nEnd Sub','P',/supported scalar/],
 ['Private Sub P(ParamArray x() As Variant)\nEnd Sub','P',/ParamArray/],
 ['Private Sub P(Optional ByRef x() As Long)\nEnd Sub','P',/Optional.*array/i],
 ['Private Sub P(Optional x As Date)\nEnd Sub','P',/supported scalar/],
 ['Private Sub P(Optional x As Byte = 256)\nEnd Sub','P',/Invalid.*default|Overflow/i],
 ['Private Sub P(Optional x As Long = 2147483648#)\nEnd Sub','P',/Invalid.*default|Overflow/i],
 ['Private Sub P(Optional x As Integer = "bad")\nEnd Sub','P',/Invalid.*default|mismatch/i],
 ['Private Sub P(Optional x As Single = 1E100)\nEnd Sub','P',/Invalid.*default|Overflow/i],
 ['Private Sub P(Optional x As Currency = "922337203685477.5808")\nEnd Sub','P',/Invalid.*default|Overflow/i],
 ['Private Sub P(Optional x As Long = RuntimeValue())\nEnd Sub\nPrivate Function RuntimeValue() As Long\nEnd Function','P',/constant/i],
 ['Private Sub P(ByRef x As Long)\nEnd Sub','P ByVal 1',/Call-site ByVal/]
])test('unsupported call contract remains a diagnostic: '+decl.split('\n')[0],()=>{
  assert.throws(()=>compile(body,decl),error=>error instanceof NativeCompileError&&pattern.test(error.message));
});

test('Optional Sub Main and Optional event handlers do not corrupt fixed callback signatures',()=>{
  const p=project('');p.modules[0].code='Sub Main(Optional x As Long)\nEnd Sub';assert.throws(()=>compileWin32(p),/parameterless|parameters|startup/i);
  const f=newProject('OptionalEvent');f.modules[0].code='Private Sub Form_Load(Optional x As Long)\nEnd Sub';assert.throws(()=>compileWin32(f),/event.*Optional/);
  f.modules[0].code='Private Sub Command1_Click(Optional Index As Integer)\nEnd Sub';f.modules[0].form.controls=[createControl('CommandButton','Command1')];f.modules[0].form.controls[0].properties.Index=0;
  assert.throws(()=>compileWin32(f),/event.*Optional/);
});

test('external raw ByVal override is restricted to scalar Long signatures',()=>{
  compile('Dim pid As Long\npid=GetProcessId(ByVal GetCurrentProcess())','Private Declare Function GetCurrentProcess Lib "kernel32" () As Long\nPrivate Declare Function GetProcessId Lib "kernel32" (ByRef process As Long) As Long');
  assert.throws(()=>compile('Call F(ByVal 1)','Private Declare Sub F Lib "example.dll" (ByRef p As Currency)'),/external scalar Long/);
});
test('native named external calls use checked declaration names',()=>{
  compile('Dim n As Long\nn=MulDiv(denominator:=2, number:=9, numerator:=2)','Private Declare Function MulDiv Lib "kernel32" (ByVal number As Long, ByVal numerator As Long, ByVal denominator As Long) As Long');
  assert.throws(()=>compile('F wrong:=1','Private Declare Sub F Lib "example.dll" (ByVal value As Long)'),/Unknown native named argument/);
});
test('native call entry stack area is bounded by the RET imm16 ABI',()=>{
  const c={fail:message=>{throw Error(message);}};
  const context={proc:{params:Array.from({length:8192},()=>({type:'Double',byRef:false}))}};
  assert.throws(()=>nativeCallMethods.prepareNativeParameters.call(c,context),/stdcall return limit/);
});

test('call fixture is deterministic and preserves every original declaration',async()=>{
  const {callFixture}=await import('../tools/win32-call-fixtures.mjs');
  const {project:p,checks}=callFixture(),before=JSON.stringify(p);
  const result=compileWin32(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);
  assert.ok(checks.length>=45);
});

// These forms cannot silently become a writable pointer with a different contract.
test('call-site ByVal cannot override an already-ByVal external declaration',()=>{
  assert.throws(()=>compile('Call F(ByVal 1)','Private Declare Sub F Lib "example.dll" (ByVal p As Long)'),/declared ByRef/);
});
test('parenthesized whole-array arguments diagnose instead of aliasing their original storage',()=>{
  assert.throws(()=>compile('Dim a() As Long\nCall F((a))','Private Sub F(ByRef p() As Long)\nEnd Sub'),/Parenthesized whole-array/);
});

test('optional parameter binding uses the shared suffix-insensitive declaration identity',()=>{
  compile('Dim s As String\ns=Echo()\ns=Echo(text:="named")', 'Private Function Echo(Optional text$ = "default") As String\nEcho = text$\nEnd Function');
  const signature={name:'Suffixed',params:[{name:'amount@',type:'Currency',optional:true}]};
  assert.equal(planNativeArguments(signature,parseExpression('Suffixed(amount:=1@)').args).slots[0].index,0);
});

test('invalid Optional defaults identify the declaration source line',()=>{
  assert.throws(()=>compile('P','Private Sub P(Optional x As Byte = 256)\nEnd Sub'),error=>{
    assert.equal(error.diagnostics[0].source,'Entry');assert.equal(error.diagnostics[0].line,2);return true;
  });
});

test('native control-property ByRef value copies compile without unsupported property setters',async()=>{
  const {callPropertiesFixture}=await import('../tools/win32-call-fixtures.mjs');
  const {project:p,checks}=callPropertiesFixture(),before=JSON.stringify(p);
  assert.equal(checks.length,5);assert.ok(compileWin32(p).bytes.length);assert.equal(JSON.stringify(p),before);
});

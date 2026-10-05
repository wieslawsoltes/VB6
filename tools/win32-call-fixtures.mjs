import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

export function callFixture() {
  const p=newProject('AotCalls');p.startup='Sub Main';
  const lines=[],checks=[],procedures=[];
  const add=text=>lines.push(text);
  const check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
  add('Dim n As Long, i As Long, d As Double, cash As Currency, s As String, result As String, flag As Boolean');
  add('Dim fixedText As String * 8\nDim a() As Currency');
  for(const [type,value,set]of [['Byte','7','9'],['Integer','-7','-9'],['Long','70000','90000'],['Boolean','True','False'],['Single','1.25','2.5'],['Double','1.125','2.625'],['Currency','900719925474.0993@','900719925474.0994@'],['String','"default"','"changed"']]) {
    const compare=type==='Boolean'?`Optional${type}()`:type==='String'?`Optional${type}() = ${value}`:`Optional${type}() = ${value}`;
    procedures.push(`Private Function Optional${type}(Optional ByRef value As ${type} = ${value}) As ${type}\nOptional${type} = value\nvalue = ${set}\nEnd Function`);
    check(compare,`omitted ByRef ${type} receives a typed writable default`);
    check(compare,`omitted ByRef ${type} default resets for the next call`);
  }
  procedures.push(`Private Function AllZero(Optional ByVal b As Byte, Optional ByRef i As Integer, Optional l As Long, Optional flag As Boolean, Optional small As Single, Optional big As Double, Optional money As Currency, Optional text As String) As Boolean
 AllZero = b = 0 And i = 0 And l = 0 And Not flag And small = 0 And big = 0 And money = 0@ And text = ""
 text = "caller-local default"
 money = 9@
End Function`);
  check('AllZero() And AllZero()', 'typed Optional parameters without initializers get zero/False/empty defaults');
  check('Mixed() = 10.375@', 'mixed 4-byte and 8-byte defaults follow the formal ABI');
  check('Mixed(, , 0.25, , tail:="ok") = 10.375@', 'empty interior positional slots and trailing named values bind once');
  check('Mixed(tail:="ok", money:=4.125@, factor:=0.25, count:=6) = 10.375@', 'named supplied values map back to mixed-width formal slots');
  add('cash = 0.5@\nd = 1.5\ns = "explicit"');
  check('MutateOptional(money:=cash, number:=d, text:=s) = 2@', 'named explicit variables preserve ByRef alias identity');
  check('cash = 9@ And d = 8 And s = "changed"', 'callee writes all explicit ByRef actual variables');
  add('cash = 0.5@\nd = 1.5\ns = "explicit"');
  check('MutateOptional(text:=(s), number:=(d), money:=(cash)) = 2@', 'parenthesized named values use isolated typed copies');
  check('cash = 0.5@ And d = 1.5 And s = "explicit"', 'parenthesized ByRef writes never copy back');
  add('trace = 0\nn = Compose(c:=Mark(1), a:=Mark(2), b:=Mark(3))');
  check('n = 231 And trace = 123', 'named argument expressions evaluate exactly once in written order');
  add('trace = 0\nn = Compose(Mark(1), c:=Mark(2))');
  check('n = 142 And trace = 12', 'defaults cannot disturb source-order supplied expressions');
  check('Other.ScopeDefault() = 19 And ScopeDefault() = 19 And Other.ScopeDefault = 19', 'defaults bind in the declaring module, including implicit qualified calls');
  check('Other.TextDefault = "module-default" And Other.TextDefault() = "module-default"', 'String defaults support qualified implicit calls without becoming control properties');
  add('d = 2.5\nn = IntegerCopy((d))');
  check('n = 2 And d = 2.5', 'forced Integer ByRef copy performs banker rounding without changing Double actual');
  add('d = 3.5\nn = IntegerCopy((d))');
  check('n = 4 And d = 3.5', 'forced Integer ByRef copy rounds an odd tie to even');
  check('IntegerCopy(1 + 2) = 3 And IntegerCopy(7) = 7', 'nonvariable ByRef values have writable temporary storage');
  add('fixedText = "original"\nresult = StringCopy((fixedText))');
  check('result = "original" And fixedText = "original"', 'fixed-length source may be read into an explicitly isolated BSTR copy');
  check('StringCopy("literal") = "literal" And StringCopy("left" & "right") = "leftright"', 'literal and expression BSTR arguments remain writable without altering read-only strings');
  check('StringPair("one", "two") = "onetwo" And StringPair("one", "two") = "onetwo"', 'two temporary BSTR owners are distinct and remain usable across calls');
  check('StringCopy(OptionalString()) = "default"', 'nested String return and ByRef copy retain independent ownership');
  check('ByValString() = "default!" And ByValString() = "default!"', 'ByVal String defaults have per-invocation mutable owned copies');
  check('RecursiveOptional(8) = 9@ And RecursiveOptional(8) = 9@', 'recursive optional Currency defaults have caller-frame lifetimes');
  add('ReDim a(-1 To 1)\na(-1) = 1.2345@\nArrayCall(delta:=0.0001@, items:=a)');
  check('a(-1) = 1.2346@ And UBound(a) = 2', 'named whole-array ByRef calls preserve resize and element semantics');
  add('ReDim pinned(2)\npinned(0) = 4');
  check('PinnedCall(number:=pinned(0)) = 4 And pinned(0) = 7', 'optional omitted values do not release a live ByRef array pin prematurely');
  add('On Error Resume Next\nErr.Clear\nCall ChangeAndFail((s))');
  check('Err.Number = 11 And s = "explicit"', 'failed callee mutations of a temporary BSTR never reach the source');
  add('Err.Clear\nCall PairFail("owned", Fails())');
  check('Err.Number = 11', 'a later failing argument unwinds earlier caller-owned BSTR copies');
  add('Err.Clear\nCall PairPin(pinned(0), GrowPinned())');
  check('Err.Number = 10', 'source-order argument evaluation protects pinned array storage from resize');
  add('Err.Clear\nReDim pinned(4)');
  check('Err.Number = 0 And UBound(pinned) = 4', 'failed call releases array pins before the next statement');
  add('Err.Clear\nn = IntegerCopy(40000)');
  check('Err.Number = 6', 'forced narrow argument conversion rejects overflow before entering callee');
  add('Err.Clear\nOn Error GoTo 0');
  check('RecoverByHandler("value") = "handled"', 'GoTo/Resume recovery releases a changed temporary String before continuing');
  check('GetProcessId(ByVal GetCurrentProcess()) = GetCurrentProcessId()', 'explicit call-site ByVal sends an external Long value instead of its address');
  check('MulDiv(denominator:=2, numerator:=4, number:=7) = 14', 'named external arguments obey declaration slot order');
  add('For i = 1 To 2000\n result = StringPair("prefix" & CStr(i), "tail")\n cash = RecursiveOptional(4)\nNext');
  check('result = "prefix2000tail" And cash = 5@', '2000 String temporary and recursive mixed-width optional lifetimes complete');
  add('For i = 1 To 2000\nOn Error Resume Next\nCall ChangeAndFail("temporary" & CStr(i))\nErr.Clear\nOn Error GoTo 0\nNext');
  check('StringCopy("after-errors") = "after-errors"', '2000 failed String reference calls leave heap and error frames usable');
  check('Suffixed() = "default" And Suffixed(text:="named") = "named"', 'optional typed suffix parameter resolves named and omitted binding');
  add('ExitProcess 0');
  p.modules=[{id:'entry',name:'Entry',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function GetCurrentProcessId Lib "kernel32" () As Long
Private Declare Function GetProcessId Lib "kernel32" (ByRef process As Long) As Long
Private Declare Function MulDiv Lib "kernel32" (ByVal number As Long, ByVal numerator As Long, ByVal denominator As Long) As Long
Private Const Seed As Long = 3
Private trace As Long
Private pinned() As Long
${procedures.join('\n')}
Private Function Mixed(Optional ByVal count As Integer = 6, Optional ByVal money As Currency = 4.125@, Optional ByVal factor As Double = 0.25, Optional ByRef unused As Byte = 2, Optional ByVal tail As String = "ok") As Currency
 If unused <> 2 Or tail <> "ok" Then ExitProcess 230
 Mixed = count + money + factor
 unused = 3
End Function
Private Function MutateOptional(Optional ByRef money As Currency = 0.5@, Optional ByRef number As Double = 1.5, Optional ByRef text As String = "explicit") As Currency
 MutateOptional = money + number
 money = 9@
 number = 8
 text = "changed"
End Function
Private Function Mark(ByVal digit As Long) As Long
 trace = trace * 10 + digit
 Mark = digit
End Function
Private Function Compose(ByVal a As Long, Optional ByVal b As Long = 4, Optional ByVal c As Long = 5) As Long
 Compose = a * 100 + b * 10 + c
End Function
Private Function IntegerCopy(ByRef number As Integer) As Long
 IntegerCopy = number
 number = 99
End Function
Private Function StringCopy(ByRef text As String) As String
 StringCopy = text
 text = "mutated"
End Function
Private Function StringPair(ByRef a As String, ByRef b As String) As String
 StringPair = a & b
 a = "replaced a"
 b = "replaced b"
End Function
Private Function Suffixed(Optional text$ = "default") As String
 Suffixed = text$
 text$ = "changed"
End Function
Private Function ByValString(Optional ByVal text As String = "default") As String
 text = text & "!"
 ByValString = text
End Function
Private Function RecursiveOptional(ByVal depth As Long, Optional ByRef amount As Currency = 1@) As Currency
 If depth = 0 Then
  RecursiveOptional = amount
 Else
  RecursiveOptional = amount + RecursiveOptional(depth - 1)
 End If
 amount = 99@
End Function
Private Sub ArrayCall(ByRef items() As Currency, Optional ByVal delta As Currency = 1@)
 ReDim Preserve items(-1 To 2)
 items(-1) = items(-1) + delta
End Sub
Private Function PinnedCall(ByRef number As Long, Optional ByRef text As String = "owned") As Long
 On Error Resume Next
 ReDim pinned(10)
 If Err.Number <> 10 Then ExitProcess 231
 Err.Clear
 PinnedCall = number
 number = 7
 text = "changed"
End Function
Private Sub ChangeAndFail(ByRef text As String)
 text = "changed before failure"
 Err.Raise 11
End Sub
Private Sub PairFail(ByRef text As String, ByVal other As Long)
 ExitProcess 232
End Sub
Private Sub PairPin(ByRef number As Long, ByVal other As Long)
 ExitProcess 233
End Sub
Private Function Fails() As Long
 Err.Raise 11
End Function
Private Function GrowPinned() As Long
 ReDim pinned(100)
End Function
Private Function RecoverByHandler(ByVal source As String) As String
 On Error GoTo failed
 Call ChangeAndFail((source))
ready:
 RecoverByHandler = source
 Exit Function
failed:
 source = "handled"
 Resume ready
End Function
Public Sub Main()
${lines.join('\n')}
End Sub`},{id:'other',name:'Other',kind:'module',code:`Option Explicit
Private Const Seed As Long = 19
Public Function ScopeDefault(Optional ByVal value As Long = Seed) As Long
 ScopeDefault = value
End Function
Public Function TextDefault(Optional ByRef value As String = "module-default") As String
 TextDefault = value
 value = "mutated module default"
End Function`}];
  return {project:p,checks};
}
export function callPropertiesFixture() {
  const p=newProject('AotCallProperties'),form=p.modules[0];p.startup='Sub Main';
  const text=createControl('TextBox','Text1');text.properties.Text='original';form.form.controls.push(text);
  form.code=`Option Explicit
Private Sub Form_Load()
 Caption = Helper()
End Sub
Public Function Helper(Optional ByVal prefix As String = "loaded") As String
 Helper = prefix & ":ready"
End Function
Public Function ReadAndChange(ByRef value As String) As String
 ReadAndChange = value
 value = "private copy"
End Function
Public Function ReadFlag(ByRef value As Boolean) As Boolean
 ReadFlag = value
 value = False
End Function`;
  const checks=[
    'control Text property becomes a caller-owned ByRef copy without property copy-back',
    'default calls inside native Form_Load execute with the fixed event ABI',
    'native Boolean property copies normalize true without disabling the source form',
    'named optional arguments invoke a form procedure without treating it as a control method',
    'caption property temporary retains its length and owner across repeated calls'
  ];
  p.modules.push({id:'entry',name:'Entry',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Public Sub Main()
 Dim result As String, i As Long
 result = Form1.ReadAndChange(Form1.Text1.Text)
 If result <> "original" Or Form1.Text1.Text <> "original" Then ExitProcess 1
 If Form1.Caption <> "loaded:ready" Then ExitProcess 2
 If Not Form1.ReadFlag(Form1.Enabled) Or Not Form1.Enabled Then ExitProcess 3
 If Form1.Helper(prefix:="custom") <> "custom:ready" Then ExitProcess 4
 For i = 1 To 2000
  result = Form1.ReadAndChange(Form1.Caption)
 Next
 If result <> "loaded:ready" Or Form1.Caption <> "loaded:ready" Then ExitProcess 5
 Unload Form1
 ExitProcess 0
End Sub`});
  return {project:p,checks};
}
export function writeCallFixtures(directory='validation/calls') {
  fs.mkdirSync(directory,{recursive:true});const reports=[];
  for(const create of [callFixture,callPropertiesFixture]) {
    const {project,checks}=create(),result=compileWin32(project);
    const sha256=createHash('sha256').update(result.bytes).digest('hex');
    fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
    fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
    const report={...result.report,name:project.name,sha256,checks};
    fs.writeFileSync(path.join(directory,project.name+'.build.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({name:project.name,bytes:result.bytes.length,checks:checks.length,sha256}));
    reports.push(report);
  }
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeCallFixtures();

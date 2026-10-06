import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function currencyFixture(){
  const p=newProject('AotCurrency');p.startup='Sub Main';
  const checks=[],lines=[];
  const add=code=>lines.push(code);
  const check=(condition,description)=>{checks.push(description);add(`If Not (${condition}) Then ExitProcess ${checks.length}`);};
  add(`Dim amount As Currency, other As Currency, d As Double, s As Single, n As Long, i As Long
Dim raw(0 To 1) As Long, fixed(-1 To 1) As Currency, copied() As Currency, pinned() As Currency
Dim text As String`);
  check('amount = 0@ And Len(amount) = 8 And LenB(amount) = 8','zero initialization and eight-byte layout');
  add('amount = 900719925474.0993@');
  check('amount + 0.0001@ = 900719925474.0994@','addition below Double precision');
  check('amount - 0.0001@ = 900719925474.0992@','subtraction below Double precision');
  add('amount = 922337203685477.5807@\nReadCurrency raw(0), amount, 8');
  check('raw(0) = -1 And raw(1) = 2147483647','maximum exact raw CY bits');
  add('amount = -922337203685477.5808@\nReadCurrency raw(0), amount, 8');
  check('raw(0) = 0 And raw(1) = -2147483648','minimum exact raw CY bits');
  check('amount < -922337203685477.5807@','comparison at lower limit');
  add('amount = 1.0001@\nReadCurrency raw(0), amount, 8');
  check('raw(0) = 10001 And raw(1) = 0','CY scale is 10000, not floating representation');
  check('1.25@ * 2.5@ = 3.125@','exact Currency multiplication');
  check('0.0001@ * 0.5@ = 0@ And 0.0003@ * 0.5@ = 0.0002@','multiply tie rounding');
  check('1.00005@ = 1@ And 1.00015@ = 1.0002@','literal half-even rounding without Number');
  check('Limit + 0.0001@ = 900719925474.0994@','typed Currency constant binding');
  add('amount = CCur("900719925474.0993")');
  check('amount = Limit','runtime text conversion retains exact value');
  check('CCur("1.00005") = 1@ And CCur("1.00015") = 1.0002@','runtime string conversion half-even rounding');
  check('CCur(0.125) = 0.125@ And CCur(-2) = -2@','floating and integer conversion');
  check('CStr(1.2345@) = "1.2345" And CStr(-0.0001@) = "-0.0001"','text formatting without Double conversion');
  check('CStr(Limit) = "900719925474.0993"','large Currency CStr is exact');
  check('CCur(CStr(-922337203685477.5808@)) = -922337203685477.5808@','minimum formatted value roundtrips');
  check('CLng(2.5@) = 2 And CInt(3.5@) = 4 And CByte(0.5@) = 0','integer conversion half-even rounding');
  check('CLng(-2.5@) = -2 And CLng(-3.5@) = -4','negative integer conversion');
  check('CBool(0.0001@) And Not CBool(0@)','truth checks full 64-bit payload');
  add('If 0.0001@ Then n = 7');check('n = 7','fractional Currency branch');
  check('Abs(-1.2345@) = 1.2345@ And -1.2345@ = -(1.2345@)','negation and Abs');
  check('Fix(-1.9999@) = -1@ And Int(-1.9999@) = -2@','Fix and Int differ for negative fractions');
  check('Sgn(0@) = 0 And Sgn(-0.0001@) = -1 And Sgn(0.0001@) = 1','sign without rounding to integer');
  check('Round(2.5@) = 2@ And Round(3.5@) = 4@','Currency Round ties');
  check('Round(1.2345@, 3) = 1.234@ And Round(1.2355@, 3) = 1.236@','Currency Round decimals');
  check('Round(Limit, 28) = Limit','Round beyond four places preserves exact storage');
  check('CDbl(1.25@) = 1.25 And CSng(1.25@) = 1.25','explicit floating conversions');
  add('d = 1.25@ / 2@');check('d = 0.625','Currency division produces a fractional Double');
  // The documented VB comparison rule converts Single/Double to Currency first.
  // Keep rounding equality distinct from ordinary ordered comparisons.
  check('1.25@ = 1.24999 And 1.24999 = 1.25@','mixed comparison rounds floating operands to Currency in either order');
  check('Not (1.25@ <> 1.25001) And Not (1.25001 <> 1.25@)','mixed inequality respects Currency rounding');
  check('1.25@ > 1.2498 And 1.2498 < 1.25@','mixed strictly ordered values preserve operand order');
  check('1.25@ < 1.2502 And 1.2502 > 1.25@','mixed strictly ordered values preserve reverse operand order');
  check('1.25@ <= 1.24999 And 1.24999 >= 1.25@','mixed inclusive comparisons retain rounded equality');
  check('1.25@ >= 1.25001 And 1.25001 <= 1.25@','reverse mixed inclusive comparisons retain rounded equality');
  check('1.0001@ = CSng(1.0001) And CSng(1.0001) = 1.0001@','Single comparison converts to Currency');
  check('-922337203685477.5808@ < 922337203685477.5807@ And 922337203685477.5807@ > -922337203685477.5808@','comparison across complete signed Currency range');
  check('CyCompare(1.25@, 1.24999) = 1 And CyCompare(1.25@, 1.25001) = 1','native OleAut32 oracle confirms rounded mixed equality');
  check('CyCompare(1.25@, 1.2498) = 2 And CyCompare(1.25@, 1.2502) = 0','native OleAut32 oracle confirms mixed comparison direction');
  check('VarType(amount) = 6 And TypeName(amount) = "Currency"','Currency VarType and TypeName');
  check('VarType(CBool(True)) = 11 And TypeName(CBool(False)) = "Boolean"','explicit Boolean query does not report register width');
  check('VarType(1@ < 2@) = 11 And TypeName(CDbl(1) < CDbl(2)) = "Boolean"','comparison result queries report Boolean');
  check('VarType(Not (1@ < 2@)) = 11 And VarType(CBool(True) And CBool(False)) = 11','Boolean expression queries preserve semantic type');
  check('VarType(1@ + CDbl(0.5)) = 6 And VarType(1@ - CDbl(0.5)) = 6','addition/subtraction Currency promotion');
  check('VarType(1@ * CDbl(0.5)) = 5 And VarType(1@ / 2@) = 5','multiply Double and divide result promotion');
  check('VarType(1@ * CSng(0.5)) = 6','multiply Single stays Currency');
  add('amount = 0.0001@\nother = Blend(2, Limit, 1.5, 4, amount)');
  check('other = Limit + 7.5@ And amount = 0.0002@','mixed-width ByVal/ByRef ABI and Currency return');
  add('amount = Limit\nother = amount + Mutate(amount)');
  check('other = Limit + 0.0001@ And amount = 9@','load snapshot survives later operand mutation');
  check('Identity(Limit) = Limit','Currency return copies both halves before callee frame disappears');
  check('Recursive(7, Limit) = Limit + 0.0007@','recursive Currency parameter and return');
  check('StaticMoney() = 0.0001@ And StaticMoney() = 0.0002@','Currency static storage');
  add('fixed(-1) = Limit\nfixed(1) = -Limit');
  check('fixed(-1) = Limit And fixed(1) = -Limit','fixed Currency array element reads/writes');
  add('copied = fixed\ncopied(-1) = 0@');
  check('fixed(-1) = Limit And copied(-1) = 0@','independent whole-array copy');
  add('Erase fixed');check('fixed(-1) = 0@ And LBound(fixed) = -1','fixed Erase zeros full eight-byte elements');
  add('ReDim values(-2 To 1, 3 To 4)\nvalues(-2, 4) = Limit\nReDim Preserve values(-2 To 1, 3 To 6)');
  check('values(-2, 4) = Limit And values(-2, 6) = 0@','dynamic multidimensional Preserve retains CY bits');
  add('Grow values');check('UBound(values, 2) = 7 And values(-2, 7) = Limit','whole-array forwarding and resize');
  check('VarType(values) = 8198 And TypeName(values) = "Currency()"','Currency array type metadata');
  add('ChangeArray values(-2, 4)');check('values(-2, 4) = 1.2345@','pinned Currency element ByRef');
  add('ReDim values(1 To 2)');check('values(1) = 0@','pin released before next resize');
  add('On Error Resume Next\namount = Identity(Failed())');
  check('Err.Number = 11','error unwinds Currency return chain');
  add('Err.Clear\nReDim pinned(1)\nTakeTwo pinned(0), Failed()');
  check('Err.Number = 11','failed later argument releases Currency element pin');
  add('Err.Clear\nReDim pinned(2)');check('Err.Number = 0 And UBound(pinned) = 2','resize after error cleanup');
  const errorCheck=(code,error,description)=>{add('Err.Clear\n'+code);check('Err.Number = '+error,description);};
  errorCheck('amount = 922337203685477.5807@ + 0.0001@',6,'addition overflow caught by On Error');
  errorCheck('amount = -922337203685477.5808@ - 0.0001@',6,'subtraction underflow caught');
  errorCheck('amount = 922337203685477.5807@ * 2@',6,'multiply overflow caught');
  errorCheck('amount = Abs(-922337203685477.5808@)',6,'Abs lower limit overflow');
  errorCheck('amount = -(-922337203685477.5808@)',6,'negation lower limit overflow');
  errorCheck('amount = CCur("922337203685477.5808")',6,'runtime text overflow');
  errorCheck('amount = CCur("12" & ChrW(0) & "3")',13,'embedded NUL rejected before native text conversion');
  errorCheck('amount = CCur("not-money")',13,'malformed runtime text');
  errorCheck('n = CLng(Limit)',6,'large Currency integer narrowing overflow');
  errorCheck('amount = Round(1@, -1)',5,'invalid Round precision');
  errorCheck('ReDim pinned(268435455)',7,'dynamic Currency x86 backing range uses eight-byte size');
  check('UBound(pinned) = 2','failed resize leaves existing descriptor intact');
  add('Err.Clear\nOn Error GoTo 0\nn = 0\nFor amount = 0.0001@ To 0.0003@ Step 0.0001@\n n = n + 1\nNext');
  check('n = 3 And amount = 0.0004@','fractional Currency For loop');
  add('For amount = 0.0003@ To 0.0001@ Step -0.0001@\n n = n + 1\nNext');
  check('n = 6 And amount = 0@','negative fractional Currency For step');
  add('amount = Limit\nSelect Case amount\nCase Limit - 0.0001@\n n = 1\nCase Limit\n n = 2\nCase Else\n n = 3\nEnd Select');
  check('n = 2','Select Case retains exact CY snapshot');
  add('For i = 1 To 2000\n ReDim pinned(-1 To 3)\n pinned(-1) = Recursive(5, Limit)\n copied = pinned\n Erase pinned\n amount = copied(-1)\n Erase copied\nNext');
  check('amount = Limit + 0.0005@','2000 array/copy/recursive Currency lifetime cycles');
  add('other = 0@\nn = CyAdd(Limit, 0.0001@, other)');
  check('n = 0 And other = Limit + 0.0001@','actual OleAut32 Declare uses full Currency stack and ByRef ABI');
  add('amount = 1.2345@\nn = CyRound(amount, 2, other)');
  check('n = 0 And other = 1.23@','mixed Currency/Long Declare argument ordering');
  add('ExitProcess 0');
  p.modules=[{id:'currency',name:'Money',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Sub ReadCurrency Lib "kernel32" Alias "RtlMoveMemory" (ByRef words As Long, ByRef money As Currency, ByVal count As Long)
Private Declare Function CyAdd Lib "oleaut32" Alias "VarCyAdd" (ByVal a As Currency, ByVal b As Currency, ByRef result As Currency) As Long
Private Declare Function CyCompare Lib "oleaut32" Alias "VarCyCmpR8" (ByVal a As Currency, ByVal b As Double) As Long
Private Declare Function CyRound Lib "oleaut32" Alias "VarCyRound" (ByVal a As Currency, ByVal places As Long, ByRef result As Currency) As Long
Private Const Limit As Currency = 900719925474.0993@
Private values() As Currency
Private Function Blend(ByVal tag As Byte, ByVal a As Currency, ByVal b As Double, ByVal tail As Integer, ByRef result As Currency) As Currency
 result = result + 0.0001@
 Blend = a + tag + b + tail
End Function
Private Function Identity(ByVal value As Currency) As Currency
 Identity = value
End Function
Private Function Mutate(ByRef value As Currency) As Currency
 value = 9@
 Mutate = 0.0001@
End Function
Private Function Recursive(ByVal n As Long, ByVal value As Currency) As Currency
 If n = 0 Then
  Recursive = value
 Else
  Recursive = Recursive(n - 1, value + 0.0001@)
 End If
End Function
Private Function StaticMoney() As Currency
 Static count As Currency
 count = count + 0.0001@
 StaticMoney = count
End Function
Private Sub Grow(ByRef a() As Currency)
 ReDim Preserve a(-2 To 1, 3 To 7)
 a(-2, 7) = a(-2, 4)
End Sub
Private Sub ChangeArray(ByRef element As Currency)
 On Error Resume Next
 ReDim values(9)
 If Err.Number <> 10 Then ExitProcess 240
 element = 1.2345@
End Sub
Private Sub TakeTwo(ByRef a As Currency, ByVal b As Currency)
 a = b
End Sub
Private Function Failed() As Currency
 Dim owned As String, a() As Currency
 owned = "cleanup"
 ReDim a(2)
 Failed = 1@ / 0@
End Function
Public Sub Main()
${lines.join('\n')}
End Sub
`}];
  return {project:p,checks};
}
export function writeCurrencyFixtures(directory='validation/currency'){
  const {project,checks}=currencyFixture();fs.mkdirSync(directory,{recursive:true});
  const result=compileWin32(project),sha256=createHash('sha256').update(result.bytes).digest('hex');
  fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
  fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2));
  fs.writeFileSync(path.join(directory,'currency-build.json'),JSON.stringify({...result.report,sha256,checks},null,2));
  console.log(JSON.stringify({name:project.name,bytes:result.bytes.length,checks:checks.length,sha256}));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeCurrencyFixtures(process.argv[2]);

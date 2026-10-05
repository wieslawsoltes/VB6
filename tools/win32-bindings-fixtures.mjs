import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

export function currencyBindingsFixture() {
  const p=newProject('AotCurrencyBindings');p.startup='Sub Main';
  const code=[],checks=[];
  const add=text=>code.push(text);
  const check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
  add('Dim amount As Currency, result As Currency, d As Double, s As Single, n As Long, text As String');
  add('Const LocalWhole As Double = 2\nConst LocalSmall As Single = 2\nConst LocalMoney As Currency = 900719925474.0993@');
  check('LocalWhole = CDbl(2) And LocalSmall = CSng(2)', 'local integral-valued floating constants use floating storage');
  check('TypeName(LocalWhole) = "Double" And TypeName(LocalSmall) = "Single"', 'explicit constant types survive binding');
  check('TypeName(Rates.UnitDouble) = "Double" And TypeName(Rates.UnitSingle) = "Single"', 'qualified floating constant types');
  add('d = Rates.Fraction\ns = Rates.UnitSingle');
  check('d = 0.125 And s = CSng(2)', 'qualified fractional constants retain address/value representation');
  check('Fraction = 0.125 And UnitDouble = CDbl(2)', 'public constant imports are unwrapped and typed');
  add('amount = Exact\nresult = Rates.Exact');
  check('amount = LocalMoney And result = amount', 'public and qualified Currency constants retain all scaled bits');
  check('Rates.Exact + Rates.Fraction = LocalMoney + 0.125@', 'typed mixed constant expressions preserve Currency promotion');
  check('Modes.Second = 5 And Rates.First = 4 And First = 4', 'enum namespace, module namespace and imported members');
  check('ShadowRate() = 3 And Rates.Fraction = 0.125', 'local variables shadow imported constants without changing qualified access');
  check('ShadowConstant() = 7 And Rates.Fraction = 0.125', 'local constants shadow imported constants');
  check('VarType(Rates.SmallByte) = 17 And VarType(Rates.SmallInteger) = 2 And VarType(Rates.WideLong) = 3', 'narrow constant declarations are not inferred from working registers');
  check('VarType(Rates.Flag) = 11 And Rates.Flag', 'Boolean constant subtype');
  add('amount = Foreign.EchoCurrency(LocalMoney)');
  check('amount = LocalMoney', 'DLL Currency return uses EDX:EAX without integer conversion');
  check('EchoCurrency(-922337203685477.5808@) = -922337203685477.5808@', 'DLL Currency return retains complete minimum payload');
  check('EchoCurrency(922337203685477.5807@) = 922337203685477.5807@', 'DLL Currency return retains complete maximum payload');
  check('EchoCurrency(0.0001@) + EchoCurrency(0.0002@) = 0.0003@', 'DLL Currency calls compose without losing snapshots');
  check('CStr(EchoCurrency(0.0001@)) = "0.0001"', 'DLL Currency formatting uses Currency rather than pointer value');
  add('amount = 900719925474.0993@\nresult = Foreign.BumpCurrency(amount)');
  check('result = 900719925474.0994@ And result = amount', 'independent DLL Currency ByRef mutation and return');
  add('d = EchoDouble(0.125)\ns = Foreign.EchoSingle(1.25)');
  check('d = 0.125 And s = 1.25', 'floating DLL return values use ST0 rather than pointer-to-Long conversion');
  check('EchoDouble(UnitDouble) + EchoSingle(UnitSingle) = 4', 'integral-valued floating constants cross independent DLL ABI');
  check('Foreign.WholeDouble() = CDbl(2) And WholeDouble = CDbl(2)', 'zero-argument qualified and implicit floating DLL calls');
  check('EchoInteger(-32768) = -32768 And EchoByte(255) = 255', 'narrow DLL return widths remain sign/zero extended');
  check('EchoBoolean(True) And Not EchoBoolean(False)', 'Boolean DLL return type remains Boolean');
  add('Foreign.ResetCalls');
  check('VarType(EchoCurrency(1@)) = 6 And Calls() = 1', 'Currency type query evaluates DLL call exactly once');
  check('TypeName(EchoDouble(1)) = "Double" And Calls() = 2', 'Double type query evaluates DLL call exactly once');
  check('TypeName(Foreign.EchoSingle(1)) = "Single" And Calls() = 3', 'Single type query evaluates qualified DLL call exactly once');
  check('VarType(EchoInteger(1)) = 2 And VarType(EchoByte(1)) = 17 And VarType(EchoBoolean(True)) = 11', 'narrow external signature type queries');
  add('On Error Resume Next\nErr.Clear\nd = Foreign.InvalidDouble()');
  check('Err.Number = 6', 'nonfinite DLL return becomes catchable VB overflow');
  add('Err.Clear\nOn Error GoTo 0\nd = EchoDouble(0.125)');
  check('d = 0.125', 'FPU stack and error frame recover after rejected DLL result');
  add('For n = 1 To 2000\namount = EchoCurrency(LocalMoney)\nd = EchoDouble(0.125)\ns = EchoSingle(1.25)\nNext');
  check('amount = LocalMoney And d = 0.125 And s = 1.25', '2000 independent mixed-width DLL return cycles');
  add('ExitProcess 0');
  p.modules=[{id:'money',name:'Money',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function ShadowRate() As Double
 Dim Fraction As Double
 Fraction = 3
 ShadowRate = Fraction
End Function
Private Function ShadowConstant() As Double
 Const Fraction As Double = 7
 ShadowConstant = Fraction
End Function
Public Sub Main()
${code.join('\n')}
End Sub`},{id:'rates',name:'Rates',kind:'module',code:`Option Explicit
Public Const Fraction As Double = 0.125
Public Const UnitDouble As Double = 2
Public Const UnitSingle As Single = 2
Public Const Exact As Currency = 900719925474.0993@
Public Const SmallByte As Byte = 1
Public Const SmallInteger As Integer = 1
Public Const WideLong As Long = 1
Public Const Flag As Boolean = True
Public Enum Modes
 First = 4
 Second = 5
End Enum`},{id:'foreign',name:'Foreign',kind:'module',code:`Option Explicit
Public Declare Function EchoCurrency Lib "vb6-abi-probe.dll" (ByVal value As Currency) As Currency
Public Declare Function BumpCurrency Lib "vb6-abi-probe.dll" (ByRef value As Currency) As Currency
Public Declare Function EchoDouble Lib "vb6-abi-probe.dll" (ByVal value As Double) As Double
Public Declare Function EchoSingle Lib "vb6-abi-probe.dll" (ByVal value As Single) As Single
Public Declare Function EchoInteger Lib "vb6-abi-probe.dll" (ByVal value As Integer) As Integer
Public Declare Function EchoByte Lib "vb6-abi-probe.dll" (ByVal value As Byte) As Byte
Public Declare Function EchoBoolean Lib "vb6-abi-probe.dll" (ByVal value As Boolean) As Boolean
Public Declare Function WholeDouble Lib "vb6-abi-probe.dll" () As Double
Public Declare Function InvalidDouble Lib "vb6-abi-probe.dll" () As Double
Public Declare Function Calls Lib "vb6-abi-probe.dll" () As Long
Public Declare Sub ResetCalls Lib "vb6-abi-probe.dll" ()`}];
  return {project:p,checks};
}
export function writeCurrencyBindingsFixture(directory='validation/currency') {
  const {project,checks}=currencyBindingsFixture(),result=compileWin32(project);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
  fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
  const report={...result.report,checks,sha256:createHash('sha256').update(result.bytes).digest('hex')};
  fs.writeFileSync(path.join(directory,'currency-bindings-build.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${project.name}: ${checks.length} assertions, ${result.bytes.length} bytes`);
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeCurrencyBindingsFixture();

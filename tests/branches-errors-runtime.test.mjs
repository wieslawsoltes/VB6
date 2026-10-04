import test from 'node:test';
import assert from 'node:assert/strict';
import {run,main,invalid,module,pause,finish} from './helpers/compiler-runtime.mjs';
for(const [value,wanted] of [[0,'fall'],[1,'one'],[2,'two'],[3,'fall'],[255,'fall'],[.5,'fall'],[1.5,'two'],[2.5,'two']])test('Computed GoTo selector '+value,async()=>{const code=main(`On ${value} GoTo First, Second\nDebug.Print "fall"\nExit Sub\nFirst:\nDebug.Print "one"\nExit Sub\nSecond:\nDebug.Print "two"`);assert.deepEqual((await run(code)).output,[wanted]);});
for(const value of [-1,256])test('Computed branch rejects selector '+value,async()=>assert.deepEqual((await run(main(`On Error Resume Next\nOn ${value} GoTo Target\nDebug.Print Err.Number\nExit Sub\nTarget:\nDebug.Print "bad"`))).output,['5']));
test('Computed GoSub evaluates selector once and preserves nested returns',async()=>assert.deepEqual((await run(`Dim calls As Long
Function ChooseTarget() As Long
calls = calls + 1
ChooseTarget = 2
End Function
Sub Main()
On ChooseTarget() GoSub First, Second
Debug.Print calls, "done"
Exit Sub
First:
Debug.Print "wrong"
Return
Second:
GoSub Third
Debug.Print "second"
Return
Third:
Debug.Print "third"
Return
End Sub`)).output,['third','second','1 done']));
test('Out-of-range GoSub does not push a return address',async()=>assert.deepEqual((await run(main('On Error Resume Next\nOn 0 GoSub Target\nReturn\nDebug.Print Err.Number\nExit Sub\nTarget:\nDebug.Print "bad"\nReturn'))).output,['3']));
test('Computed numeric labels and inline numbered If resolve',async()=>assert.deepEqual((await run('Sub Main()\n10 On 2 GoTo 100, 0200\n100 Debug.Print "bad"\nExit Sub\n200 If True Then 300\nExit Sub\n300 Debug.Print "ok"\nEnd Sub')).output,['ok']));
for(const source of ['On 1 GoTo Absent','On 1 GoTo A,','On 1 GoTo','70000 Debug.Print 1'])test('Invalid computed/numbered label is diagnosed: '+source,()=>invalid(main(source),/label|Expected|target|65535|identifier/i));
test('Numbered statement preserves Erl through callee unwind and Resume Next clears it',async()=>assert.deepEqual((await run(`Sub Crash()
200 Error 11
End Sub
Sub Main()
On Error GoTo Handler
10 Crash
20 Debug.Print "resumed", Erl, Err.Number
Exit Sub
Handler:
Debug.Print Erl, Err.Number, Err.Description
Resume Next
End Sub`)).output,['200 11 Division by zero','resumed 0 0']));
test('Resume 0 retries failed numbered instruction with retained locals',async()=>assert.deepEqual((await run(`Sub Main()
Dim divisor, answer
divisor = 0
On Error GoTo Handler
50 answer = 10 / divisor
Debug.Print answer, Erl, Err.Number
Exit Sub
Handler:
Debug.Print Erl
divisor = 2
Resume 0
End Sub`)).output,['50','5 0 0']));
test('Erl tracks last executed numeric label not physical editor line',async()=>assert.deepEqual((await run(`Sub Main()
On Error GoTo Handler
100 Debug.Print "before"
Error 5
Exit Sub
Handler:
Debug.Print Erl
Resume Done
Done:
Debug.Print Erl, Err.Number
End Sub`)).output,['before','100','0 0']));
test('Resume without pending error reports error 20',async()=>assert.deepEqual((await run(main('On Error Resume Next\nResume Next\nDebug.Print Err.Number'))).output,['20']));
test('Err default property, Error function, Error$ alias and Clear',async()=>assert.deepEqual((await run(main('On Error Resume Next\nError 11\nDebug.Print Err, Error(), Error$(Err.Number)\nErr.Clear\nDebug.Print Err.Number, Erl, Err.HelpContext, Len(Err.HelpFile)'))).output,['11 Division by zero Division by zero','0 0 0 0']));
test('Err.Raise supports named arguments, metadata, and retained omitted properties',async()=>assert.deepEqual((await run(main('On Error Resume Next\nErr.Raise Number:=5, Source:="origin", Description:="custom", HelpFile:="help.chm", HelpContext:=42\nDebug.Print Err.Number, Err.Source, Err.Description, Err.HelpFile, Err.HelpContext\nErr.Raise 6\nDebug.Print Err.Number, Err.Source, Err.Description, Err.HelpFile, Err.HelpContext'))).output,['5 origin custom help.chm 42','6 origin custom help.chm 42']));
for(const value of [0,-1,65536])test('Error statement rejects invalid code '+value,async()=>assert.deepEqual((await run(main(`On Error Resume Next\nError ${value}\nDebug.Print Err.Number`))).output,['5']));
test('A second failure in an active handler propagates to caller',async()=>assert.deepEqual((await run(`Sub Crash()
On Error GoTo Handler
100 Error 11
Exit Sub
Handler:
200 Error 6
End Sub
Sub Main()
On Error Resume Next
Crash
Debug.Print Err.Number, Erl
End Sub`)).output,['6 200']));
test('Explicit debugger evaluation restores paused Err and Erl context',async()=>{const p=await pause('Function Fail()\n300 Error 6\nEnd Function\nSub Main()\nOn Error Resume Next\n100 Error 11\nDebug.Print Err.Number, Erl\nEnd Sub',7);assert.equal(p.vm.lastErrorErl,100);await assert.rejects(p.vm.evaluateExplicit('Fail()'),e=>e.number===6);assert.equal(p.vm.err.Number,11);assert.equal(p.vm.lastErrorErl,100);await finish(p);assert.deepEqual(p.output,['11 100']);});

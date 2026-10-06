import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, splitTop, logicalLines, VBError } from '../src/language/lexer.js';
import { parseExpression } from '../src/language/expression.js';
import { compileProject, compileModule } from '../src/language/compiler.js';
import { VirtualMachine } from '../src/runtime/vm.js';
import { VBArray, VBCollection, VBDictionary, binary, coerce, bankersRound, VBCurrency } from '../src/runtime/values.js';
import { VirtualFileSystem } from '../src/runtime/filesystem.js';

function project(code,extras=[]){return {name:'Test',startup:'Sub Main',modules:[{name:'Module1',kind:'module',code},...extras]};}
async function run(code,extras=[],options={}){const output=[];const compiled=compileProject(project(code,extras));assert.deepEqual(compiled.diagnostics,[]);const vm=new VirtualMachine(compiled,{print:s=>output.push(s)},options);await vm.start();return {vm,output};}
const main=body=>`Option Explicit\nSub Main()\n${body}\nEnd Sub`;

test('lexer preserves strings, doubled quotes, source offsets and suffixes',()=>{const t=tokenize('Left$("a""b", 2) & &HFF');assert.equal(t[0].value,'Left$');assert.equal(t[2].value,'a"b');assert.equal(t.at(-2).value,255);assert.equal(t[0].start,0);});
test('lexer rejects unterminated strings',()=>assert.throws(()=>tokenize('"bad'),VBError));
test('top-level split respects parentheses and quoted commas',()=>assert.deepEqual(splitTop('a(1, 2), "a,b", c'),['a(1, 2)','"a,b"','c']));
test('logical lines preserve continuation source mapping',()=>assert.deepEqual(logicalLines('a = 1 + _\n 2\nDebug.Print a').map(x=>[x.text,x.line]),[['a = 1 +  2',1],['Debug.Print a',3]]));
test('comments do not corrupt quoted apostrophes',()=>assert.equal(logicalLines('x = "don\'t" \' note')[0].text,'x = "don\'t"'));
test('compiler reports missing End If',()=>assert.equal(compileProject(project(main('If True Then\nDebug.Print 1'))).diagnostics[0].severity,'error'));
test('compiler retains Declare entry point metadata',()=>{const m=compileModule({name:'M',kind:'module',code:'Declare Function GetTickCount Lib "kernel32" () As Long'});assert.deepEqual(m.procedures.get('gettickcount').external,{library:'kernel32',entry:'GetTickCount'});});
test('compiler rejects duplicate procedures',()=>assert.match(compileProject(project('Sub Main()\nEnd Sub\nSub Main()\nEnd Sub')).diagnostics[0].message,/Ambiguous/));
test('source mapping is accurate after comments and blanks',()=>{const m=compileModule({name:'M',code:"'header\n\nSub Main()\n Debug.Print 4\nEnd Sub"});assert.equal(m.procedures.get('main').code[0].line,4);});
const expressionCases=[['1 + 2 * 3','7'],['2 ^ 3 ^ 2','512'],['-2 ^ 2','-4'],['(1 + 2) * 3','9'],['7 \\ 2','3'],['7 Mod 3','1'],['Not 1 = 2','True'],['True And False','False'],['True Or False','True'],['2 < 3','True'],['"a" & 2','a2'],['"abc" Like "a*"','True'],['"a""b"','a"b'],['&HFF + &O10','263'],['Empty + 5','5'],['Null & "x"','x'],['Null + 1','Null'],['5 Xor 3','6'],['5 Eqv 3','-7'],['True Imp False','False']];
for(const [expr,expected]of expressionCases)test('expression '+expr,async()=>assert.deepEqual((await run(main('Debug.Print '+expr))).output,[expected]));
test('For loop is inclusive and preserves final control value',async()=>assert.deepEqual((await run(main('Dim i As Long, total As Long\nFor i = 1 To 10\ntotal = total + i\nNext i\nDebug.Print total, i'))).output,['55 11']));
test('negative For step and Exit For',async()=>assert.deepEqual((await run(main('Dim i As Long\nFor i = 10 To 1 Step -2\nIf i = 6 Then Exit For\nDebug.Print i\nNext'))).output,['10','8']));
test('If ElseIf Else branches',async()=>assert.deepEqual((await run(main('Dim n As Long\nn = 2\nIf n = 1 Then\nDebug.Print "one"\nElseIf n = 2 Then\nDebug.Print "two"\nElse\nDebug.Print "other"\nEnd If'))).output,['two']));
test('single-line If supports colon statements and Else',async()=>assert.deepEqual((await run(main('Dim n As Long\nIf True Then n = 1: n = n + 3 Else n = 9\nDebug.Print n'))).output,['4']));
test('Do While and Loop Until',async()=>assert.deepEqual((await run(main('Dim n As Long\nDo While n < 3\nn = n + 1\nLoop\nDo\nn = n + 1\nLoop Until n = 5\nDebug.Print n'))).output,['5']));
test('While Wend',async()=>assert.deepEqual((await run(main('Dim n As Long\nWhile n < 4\nn = n + 1\nWend\nDebug.Print n'))).output,['4']));
test('Select Case ranges and relational cases',async()=>assert.deepEqual((await run(main('Dim n As Long\nn = 8\nSelect Case n\nCase 1, 2\nDebug.Print "small"\nCase 3 To 7\nDebug.Print "medium"\nCase Is >= 8\nDebug.Print "large"\nCase Else\nDebug.Print "other"\nEnd Select'))).output,['large']));
test('functions recurse and return typed values',async()=>assert.deepEqual((await run('Sub Main()\nDebug.Print Fact(6)\nEnd Sub\nFunction Fact(ByVal n As Long) As Long\nIf n <= 1 Then\nFact = 1\nElse\nFact = n * Fact(n - 1)\nEnd If\nEnd Function')).output,['720']));
test('ByRef changes caller, ByVal does not',async()=>assert.deepEqual((await run('Option Explicit\nSub Main()\nDim x As Long\nx = 2\nAddOne x\nKeep x\nDebug.Print x\nEnd Sub\nSub AddOne(ByRef n As Long)\nn = n + 1\nEnd Sub\nSub Keep(ByVal n As Long)\nn = 99\nEnd Sub')).output,['3']));
test('optional parameters and ParamArray',async()=>assert.deepEqual((await run('Sub Main()\nDebug.Print Add(5)\nDebug.Print CountArgs(1, 2, 3)\nEnd Sub\nFunction Add(ByVal x As Long, Optional ByVal y As Long = 2) As Long\nAdd = x + y\nEnd Function\nFunction CountArgs(ParamArray args() As Variant) As Long\nCountArgs = UBound(args) + 1\nEnd Function')).output,['7','3']));
test('Static local persists between invocations',async()=>assert.deepEqual((await run('Sub Main()\nDebug.Print Counter()\nDebug.Print Counter()\nEnd Sub\nFunction Counter() As Long\nStatic n As Long\nn = n + 1\nCounter = n\nEnd Function')).output,['1','2']));
test('Option Explicit catches missing variable at execution',async()=>await assert.rejects(()=>run(main('oops = 2')),e=>e.number===500));
test('Integer overflow is caught',async()=>await assert.rejects(()=>run(main('Dim n As Integer\nn = 32768')),e=>e.number===6));
test('Option Compare Text applies to comparison',async()=>assert.deepEqual((await run('Option Compare Text\nSub Main()\nDebug.Print "ABC" = "abc"\nEnd Sub')).output,['True']));
test('typed multidimensional arrays and bounds',async()=>assert.deepEqual((await run(main('Dim a(1 To 2, 3 To 4) As Long\na(2, 4) = 9\nDebug.Print a(2, 4), LBound(a, 2), UBound(a, 1)'))).output,['9 3 2']));
test('ReDim Preserve retains elements',async()=>assert.deepEqual((await run(main('Dim a() As Long\nReDim a(1 To 2)\na(2) = 7\nReDim Preserve a(1 To 4)\nDebug.Print a(2), a(4)'))).output,['7 0']));
test('For Each over an Array',async()=>assert.deepEqual((await run(main('Dim item As Variant\nFor Each item In Array("a", "b", "c")\nDebug.Print item\nNext'))).output,['a','b','c']));
test('Collection uses one-based indices and keyed access',async()=>assert.deepEqual((await run(main('Dim c As New Collection\nc.Add "hello", "greeting"\nc.Add "world"\nDebug.Print c.Count, c.Item(1), c("greeting")'))).output,['2 hello hello']));
test('Dictionary supports indexed assignment',async()=>assert.deepEqual((await run(main('Dim d As Object\nSet d = CreateObject("Scripting.Dictionary")\nd.Add "a", 3\nd("a") = 4\nDebug.Print d.Item("a"), d.Exists("a")'))).output,['4 True']));
test('With member access updates objects',async()=>assert.deepEqual((await run(main('Dim d As Object\nSet d = CreateObject("Scripting.Dictionary")\nWith d\n.CompareMode = 1\n.Add "A", 2\nEnd With\nDebug.Print d.Item("a")'))).output,['2']));
test('class fields, initialization, methods and property accessors',async()=>{const extra={name:'Counter',kind:'class',code:'Private n As Long\nPrivate Sub Class_Initialize()\nn = 4\nEnd Sub\nPublic Property Get Value() As Long\nValue = n\nEnd Property\nPublic Property Let Value(ByVal value As Long)\nn = value\nEnd Property\nPublic Sub Increment()\nn = n + 1\nEnd Sub'};assert.deepEqual((await run(main('Dim c As Counter\nSet c = New Counter\nDebug.Print c.Value\nc.Value = 9\nc.Increment\nDebug.Print c.Value'),[extra])).output,['4','10']);});
test('On Error Resume Next sets Err and resumes caller',async()=>assert.deepEqual((await run(main('On Error Resume Next\nDim x As Double\nx = 1 / 0\nDebug.Print Err.Number\nDebug.Print "continued"'))).output,['11','continued']));
test('On Error GoTo and Resume Next',async()=>assert.deepEqual((await run(main('Dim x As Double\nOn Error GoTo Handler\nx = 1 / 0\nDebug.Print "resumed"\nExit Sub\nHandler:\nDebug.Print Err.Number\nResume Next'))).output,['11','resumed']));
test('GoSub and Return',async()=>assert.deepEqual((await run(main('GoSub Work\nDebug.Print "done"\nExit Sub\nWork:\nDebug.Print "work"\nReturn'))).output,['work','done']));
test('Err.Raise participates in error handling',async()=>assert.deepEqual((await run(main('On Error Resume Next\nErr.Raise 42, "Test", "Example"\nDebug.Print Err.Number, Err.Description'))).output,['42 Example']));
test('sequential text files round-trip in isolated virtual filesystem',async()=>{const {vm,output}=await run(main('Dim s As String\nOpen "test.txt" For Output As #1\nPrint #1, "hello"\nClose #1\nOpen "test.txt" For Input As #2\nLine Input #2, s\nDebug.Print s, EOF(2)\nClose #2'));assert.deepEqual(output,['hello True']);assert.equal(vm.fs.read('/test.txt'),'hello\r\n');});
test('Write/Input CSV round-trip strings and numbers',async()=>assert.deepEqual((await run(main('Dim s As String, n As Long\nOpen "csv.txt" For Output As #1\nWrite #1, "a,b", 42\nClose #1\nOpen "csv.txt" For Input As #1\nInput #1, s, n\nDebug.Print s, n'))).output,['a,b 42']));
test('Scripting FileSystemObject text stream',async()=>assert.deepEqual((await run(main('Dim fs As Object, f As Object\nSet fs = CreateObject("Scripting.FileSystemObject")\nSet f = fs.CreateTextFile("hello.txt")\nf.WriteLine "hello"\nf.Close\nSet f = fs.OpenTextFile("hello.txt")\nDebug.Print f.ReadLine'))).output,['hello']));
test('in-memory Recordset fields and navigation',async()=>assert.deepEqual((await run(main('Dim rs As Object\nSet rs = CreateObject("ADODB.Recordset")\nrs.Fields.Append "Name", adVarChar, 40\nrs.Open\nrs.AddNew\nrs.Fields.Item("Name").Value = "Ada"\nrs.Update\nrs.MoveFirst\nDebug.Print rs.RecordCount, rs.Fields.Item(0).Value\nrs.MoveNext\nDebug.Print rs.EOF'))).output,['1 Ada','-1']));
test('prototype escape is rejected',async()=>await assert.rejects(()=>run(main('Dim d As Object\nSet d = CreateObject("Scripting.Dictionary")\nDebug.Print d.constructor')),e=>e.number===438));
test('infinite loops terminate at an instruction budget',async()=>await assert.rejects(()=>run(main('Do\nLoop'),[],{instructionLimit:1000}),e=>e.number===7));
test('breakpoint pauses at source line before side effects, then steps',async()=>{const compiled=compileProject(project(main('Dim n As Long\nn = 5\nDebug.Print n')));const vm=new VirtualMachine(compiled);const pauses=[];vm.setBreakpoint('Module1',4);vm.on('pause',e=>{pauses.push(e.instruction.line);assert.equal(vm.locals()[0].value,pauses.length===1?'0':'5');queueMicrotask(()=>vm.resume(pauses.length===1?'into':'continue'));});await vm.start();assert.deepEqual(pauses,[4,5]);});
test('banker rounding and typed ranges',()=>{assert.equal(bankersRound(2.5),2);assert.equal(bankersRound(3.5),4);assert.equal(bankersRound(-1.5),-2);assert.throws(()=>coerce(256,'Byte'),e=>e.number===6);});
test('Currency stores a scaled integer',()=>{const c=new VBCurrency(12.3456);assert.equal(c.raw,123456n);assert.equal(Number(c),12.3456);});
test('ReDim Preserve disallows first-dimension changes',()=>{const a=new VBArray([[0,1],[0,1]]);assert.throws(()=>a.redim([[0,2],[0,1]],true),e=>e.number===9);});
test('virtual filesystem normalizes traversal within its own root',()=>{const fs=new VirtualFileSystem();fs.write('../../a','x');assert.equal(fs.read('/a'),'x');});
const builtinCases=[['Left$("hello", 2)','he'],['Right$("hello", 2)','lo'],['Mid$("hello", 2, 3)','ell'],['Replace("a-b-a", "a", "x")','x-b-x'],['Join(Split("a,b,c", ","), "|")','a|b|c'],['InStr(2, "banana", "an")','2'],['StrComp("A", "a", vbTextCompare)','0'],['Format$(12.5, "0.00")','12.50'],['Format$(0.25, "0%")','25%'],['RGB(255, 128, 0)','33023'],['CInt(2.5)','2'],['CInt(3.5)','4'],['Month(DateSerial(2024, 2, 29))','2'],['Day(DateAdd("m", 1, DateSerial(2024, 1, 31)))','29'],['DateDiff("d", DateSerial(2024, 1, 1), DateSerial(2024, 1, 4))','3'],['Len("hello")','5'],['Asc("A")','65'],['Chr$(65)','A'],['Hex$(255)','FF'],['Val(" 12.3 apples")','12.3']];
for(const [expr,expected]of builtinCases)test('builtin '+expr,async()=>assert.deepEqual((await run(main('Debug.Print '+expr))).output,[expected]));

const eventSource={name:'Emitter',kind:'class',code:`Option Explicit
Public Event Changing(ByRef Value As Long)
Public Event Finished()
Public Function Fire() As Long
 Dim n As Long
 n = 4
 RaiseEvent Changing(n)
 RaiseEvent Finished
 Fire = n
End Function`};
const eventSink={name:'Listener',kind:'class',code:`Option Explicit
Private WithEvents Source As Emitter
Public Offset As Long
Public Sub Connect(ByVal value As Emitter)
 Set Source = value
End Sub
Private Sub Source_Changing(ByRef Value As Long)
 Value = Value + Offset
 Debug.Print Value
End Sub
Private Sub Source_Finished()
 Debug.Print "finished"
End Sub`};
test('WithEvents dispatches synchronously in connection order with shared ByRef arguments',async()=>{
 const {output}=await run(main(`Dim e As Emitter, a As Listener, b As Listener
 Set e = New Emitter
 Set a = New Listener
 Set b = New Listener
 a.Offset = 2
 b.Offset = 3
 a.Connect e
 b.Connect e
 Debug.Print e.Fire()`),[eventSource,eventSink]);assert.deepEqual(output,['6','9','finished','finished','9']);
});
test('WithEvents detaches on Nothing and reassignment',async()=>{
 const {output}=await run(main(`Dim e As Emitter, f As Emitter, a As Listener
 Set e = New Emitter
 Set f = New Emitter
 Set a = New Listener
 a.Offset = 2
 a.Connect e
 a.Connect f
 Debug.Print e.Fire()
 Debug.Print f.Fire()
 a.Connect Nothing
 Debug.Print f.Fire()`),[eventSource,eventSink]);assert.deepEqual(output,['4','6','finished','6','4']);
});
test('WithEvents rejects standard module and procedure declarations',()=>{
 assert.throws(()=>compileModule({name:'M',kind:'module',code:'Private WithEvents x As Emitter'}),/class/);
 assert.throws(()=>compileModule({name:'C',kind:'class',code:'Sub Test()\nDim WithEvents x As Emitter\nEnd Sub'}),/module level/);
});
test('WithEvents rejects arrays and As New',()=>{
 for(const code of ['Private WithEvents x(2) As Emitter','Private WithEvents x As New Emitter'])assert.throws(()=>compileModule({name:'C',kind:'class',code}),/WithEvents/);
});
test('RaiseEvent rejects undeclared events',async()=>{
 await assert.rejects(()=>run(main('Dim e As Emitter\nSet e = New Emitter\ne.Fire'),[{name:'Emitter',kind:'class',code:'Sub Fire()\nRaiseEvent Unknown\nEnd Sub'}]),/Event not declared/);
});

function mockForm(name,code){return {name,kind:'form',code,form:{name,type:'Form',properties:{Caption:name},controls:[],menus:[]}};}
function fakeFormsHost(onShow=()=>{}){const output=[],forms=[];return {output,forms,print:s=>output.push(s),createForm:async(model,instance,vm)=>{const form={model,instance,controlMap:new Map(),shown:false,Show(){this.shown=true;onShow(instance,vm);},Hide(){this.shown=false;}};forms.push(form);return form;}};}
test('modal forms wait for a queued close handler before resuming the caller',async()=>{
 const code=main('Debug.Print "before"\nDialog.Show vbModal\nDebug.Print "after"');const dialog=mockForm('Dialog','Sub Form_Load()\nDebug.Print "load"\nEnd Sub\nSub cmdClose_Click()\nDebug.Print "closed"\nUnload Me\nEnd Sub');
 const host=fakeFormsHost((instance,vm)=>setTimeout(()=>vm.dispatch(instance,'cmdClose_Click'),0));const vm=new VirtualMachine(compileProject(project(code,[dialog])),host);await vm.start();assert.deepEqual(host.output,['before','load','closed','after']);assert.equal(vm.stack.length,0);assert.equal(host.forms[0].shown,false);
});
test('nested modal forms preserve execution order and unwind the complete stack',async()=>{
 const a=mockForm('DialogA','Sub OpenB()\nDebug.Print "A enter"\nDialogB.Show vbModal\nDebug.Print "A leave"\nUnload Me\nEnd Sub'),b=mockForm('DialogB','Sub CloseB()\nDebug.Print "B"\nUnload Me\nEnd Sub');
 const host=fakeFormsHost((instance,vm)=>setTimeout(()=>vm.dispatch(instance,instance.module.name==='DialogA'?'OpenB':'CloseB'),0));const vm=new VirtualMachine(compileProject(project(main('DialogA.Show vbModal\nDebug.Print "end"'),[a,b])),host);await vm.start();assert.deepEqual(host.output,['A enter','B','A leave','end']);assert.equal(vm.stack.length,0);
});
test('Forms collection includes loaded forms and newly constructed instances',async()=>{
 const host=fakeFormsHost();const code=main('Dim f As Dialog\nSet f = New Dialog\nDebug.Print Forms.Count\nf.Show\nDebug.Print Forms.Count\nLoad Dialog\nDebug.Print Forms.Count\nUnload f\nDebug.Print Forms.Count');const vm=new VirtualMachine(compileProject(project(code,[mockForm('Dialog','')])),host);await vm.start();assert.deepEqual(host.output,['0','1','2','1']);assert.equal(host.forms.length,2);assert.notEqual(host.forms[0].model,host.forms[1].model);
});
test('QueryUnload cancellation leaves the form loaded and visible',async()=>{
 const host=fakeFormsHost();const vm=new VirtualMachine(compileProject(project(main('Dialog.Show\nUnload Dialog\nDebug.Print Forms.Count'),[mockForm('Dialog','Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)\nCancel = True\nEnd Sub')])),host);await vm.start();assert.deepEqual(host.output,['1']);assert.equal(host.forms[0].shown,true);
});
test('DoEvents pumps queued handlers while an enclosing VB procedure is active',async()=>{
 const code='Option Explicit\nPrivate done As Boolean\nSub Main()\nDo While Not done\nDoEvents\nLoop\nDebug.Print "done"\nEnd Sub\nSub Finish()\ndone = True\nEnd Sub';const output=[],vm=new VirtualMachine(compileProject(project(code)),{print:s=>output.push(s)},{instructionLimit:1000});setTimeout(()=>vm.dispatch('Module1','Finish'),0);await vm.start();assert.deepEqual(output,['done']);assert.equal(vm.stack.length,0);
});
test('native object implementation fields stay private; public case-collision APIs remain callable',()=>{
 const vm=new VirtualMachine(compileProject(project(main(''))));class Adapter{constructor(){this.node={nodeType:1};this.vm=vm;this.items=[];this.itemData=[];}ItemData(){return 7;}get Count(){return 0;}}
 const object=new Adapter();for(const key of ['node','vm','items','constructor','__proto__'])assert.throws(()=>vm.nativeMember(object,key),e=>e.number===438);assert.equal(vm.nativeMember(object,'itemdata').__native.call(object),7);assert.equal(vm.nativeMember(object,'count'),0);assert.throws(()=>vm.nativeMember({nodeType:1},'nodeType'),e=>e.number===438);
});

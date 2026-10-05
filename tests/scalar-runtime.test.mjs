import test from 'node:test';
import assert from 'node:assert/strict';
import {run,main,module,pause,finish} from './helpers/compiler-runtime.mjs';
import {Cell,VBArray,VBCollection,VBDictionary,VBScalar,NOTHING,coerce,tagScalar,unbox,storageScalar,scalarType,scalarBinary,scalarUnary} from '../src/runtime/values.js';
import {encodeVariable,decodeVariable} from '../src/runtime/binary-codec.js';

const literals=[['1',2,'Integer'],['32768',3,'Long'],['2147483648',5,'Double'],['1.0',5,'Double'],['1!',4,'Single'],['1#',5,'Double'],['1&',3,'Long'],['1%',2,'Integer'],['1@',6,'Currency'],['-32768',2,'Integer'],['-2147483648',3,'Long'],['&HFFFF',2,'Integer'],['&HFFFF&',3,'Long'],['&HFFFFFFFF',3,'Long'],['&O177777',2,'Integer'],['True',11,'Boolean'],['False',11,'Boolean'],['Empty',0,'Empty'],['Null',1,'Null'],['"x"',8,'String'],['CByte(2)',17,'Byte'],['CDec(".1")',14,'Decimal'],['CDate(2)',7,'Date'],['CVErr(5)',10,'Error']];
for(const [value,type,name]of literals)test('source scalar subtype: '+value,async()=>assert.deepEqual((await run(main(`Dim v\nv = ${value}\nDebug.Print VarType(${value}), TypeName(${value}), VarType(v), TypeName(v)`))).output,[`${type} ${name} ${type} ${name}`]));
for(const [name,id]of [['Byte',17],['Integer',2],['Long',3],['Single',4],['Double',5],['Boolean',11],['Currency',6],['Date',7],['String',8],['Variant',0]])test('default declaration subtype: '+name,async()=>assert.deepEqual((await run(main(`Dim value As ${name}\nDebug.Print VarType(value)`))).output,[String(id)]));
const operators=[
 ['CInt(32767) + CVar(1)','32768 Long'],['CLng(2147483647) + CVar(1)','2147483648 Double'],
 ['CByte(255) + CVar(CByte(1))','256 Integer'],['CSng(3e38) + CVar(CSng(3e38))',null],
 ['CSng(1.25) + CInt(2)','3.25 Single'],['CSng(1.25) + CLng(2)','3.25 Double'],
 ['CCur(1) + CDbl(2)','3 Currency'],['CCur(1) * CDbl(2)','2 Double'],
 ['CDec("0.1") + CCur("0.2")','0.3 Decimal'],['-CByte(1)','-1 Integer'],
 ['Not CByte(1)','254 Byte'],['CByte(1) Eqv CByte(2)','252 Byte'],
 ['CByte(1) Imp CByte(2)','254 Byte'],['True And False','False Boolean'],
 ['CBool(True) + CInt(2)','1 Integer'],['CVar(2) < CVar("1")','True Boolean'],
 ['CInt(2) < CVar("1")','False Boolean'],['CByte(2) > CBool(True)','True Boolean'],
 ['CVar(True) < CVar(CByte(2))','True Boolean'],['CVar(1) + "2"','12 String'],
 ['CVar("1") + CInt(2)','3 Double'],['CVar(Empty) + CVar(True)','-1 Integer'],
 ['CVar(Null) And True','Null Null'],['CVar(Null) And False','False Boolean'],
 ['CVar(Null) Or True','True Boolean'],['CVar(Null) Or False','Null Null'],
 ['CByte(0) And Null','0 Byte'],['CByte(1) Or Null','1 Byte'],
 ['CVar(Null) & CVar(Null)','Null Null'],['CVar(Empty) * CByte(2)','0 Byte']
];
for(const [expression,expected]of operators)test('scalar promotion and comparison: '+expression,async()=>{
 const {output}=await run(main(`Dim result\nresult = ${expression}\nDebug.Print result, TypeName(result)`));
 if(expected)assert.deepEqual(output,[expected]);else {assert.match(output[0],/Double$/);assert.ok(Number(output[0].split(' ')[0])>5e38);}
});
for(const expr of ['CByte(255) + CByte(1)','CInt(32767) + CInt(1)','CLng(2147483647) + CLng(1)','CSng(3e38) + CSng(3e38)','CCur("922337203685477.5807") + CVar(CCur(".0001"))','CDec("79228162514264337593543950335") + CVar(1)'])test('typed/fixed precision overflow: '+expr,async()=>assert.deepEqual((await run(main(`On Error Resume Next\nDim value\nvalue = ${expr}\nDebug.Print Err.Number`))).output,['6']));
test('typed String plus typed numeric is not JavaScript concatenation',async()=>assert.deepEqual((await run(main('On Error Resume Next\nDebug.Print "1" + 2\nDebug.Print Err.Number'))).output,['13']));
test('Boolean textual and numeric representations remain distinct',async()=>assert.deepEqual((await run(main('Debug.Print CStr(True), CStr(False), CInt(True), CByte(True), VarType(True)'))).output,['True False -1 255 11']));
test('hexadecimal signed literal widening is different from an explicit Long suffix',async()=>assert.deepEqual((await run(main('Dim n As Long\nn = &HFF00\nDebug.Print n, &HFF00&, &O177777, &HFFFFFFFF'))).output,['-256 65280 -1 -1']));
test('constants and cross-module optional defaults preserve expression subtypes',async()=>assert.deepEqual((await run('Private Const I = 1\nPrivate Const L As Long = 2\n'+main('Debug.Print TypeName(I), TypeName(L), TypeName(Other.Choice), Pick()').replace('Option Explicit\n','')+'\nFunction Pick(Optional value = Other.Choice) As String\nPick = TypeName(value)\nEnd Function',[module('Other','Public Const Choice = 3!')])).output,['Integer Long Single Single']));
test('source procedure returns and ParamArray retain stored subtypes',async()=>assert.deepEqual((await run(main('Dump CByte(1), One(), CLng(3), CSng(4), True')+'\nFunction One()\nOne = CInt(2)\nEnd Function\nSub Dump(ParamArray values() As Variant)\nDim item\nFor Each item In values\nDebug.Print TypeName(item)\nNext\nEnd Sub')).output,['Byte','Integer','Long','Single','Boolean']));
test('typed ByRef requires matching storage without changing caller on failure',async()=>assert.deepEqual((await run(main('Dim i As Integer, v\ni = 5: v = CInt(6)\nOn Error Resume Next\nSetLong i\nDebug.Print Err.Number, i\nErr.Clear\nSetInteger v\nDebug.Print Err.Number, v')+'\nSub SetLong(ByRef x As Long)\nx = 100\nEnd Sub\nSub SetInteger(ByRef x As Integer)\nx = 200\nEnd Sub')).output,['13 5','13 6']));
test('Variant ByRef reads promote but writes respect caller storage type',async()=>assert.deepEqual((await run(main('Dim i As Integer\ni = 32767\nTouch i\nDebug.Print i')+'\nSub Touch(ByRef value As Variant)\nDebug.Print TypeName(value + 1)\nOn Error Resume Next\nvalue = value + 1\nDebug.Print Err.Number, value\nvalue = 7\nEnd Sub')).output,['Long','6 32767','7']));
test('parenthesized calls, constants, function values and property values create temporaries',async()=>assert.deepEqual((await run(main('Const N = 7\nDim i As Integer, box As New Box\ni = 4\nChange (i)\nChange N\nChange MakeValue()\nChange box.Value\nDebug.Print i, N, box.Reads, box.Writes')+'\nSub Change(ByRef value As Long)\nvalue = 99\nEnd Sub\nFunction MakeValue() As Integer\nMakeValue = 3\nEnd Function',[module('Box','Public Reads As Long\nPublic Writes As Long\nPublic Property Get Value() As Long\nReads = Reads + 1\nValue = 5\nEnd Property\nPublic Property Let Value(ByVal x As Long)\nWrites = Writes + 1\nEnd Property','class')])).output,['4 7 1 0']));
test('property receiver and index each execute exactly once for ByRef temporary',async()=>assert.deepEqual((await run('Dim Reads As Long\nDim IndexCalls As Long\nDim item As New Box\n'+main('Change Pick().Value(Index())\nDebug.Print Reads, IndexCalls, item.Reads, item.Writes').replace('Option Explicit\n','')+'\nFunction Pick() As Box\nReads = Reads + 1\nSet Pick = item\nEnd Function\nFunction Index() As Long\nIndexCalls = IndexCalls + 1\nIndex = 0\nEnd Function\nSub Change(ByRef value As Long)\nvalue = 99\nEnd Sub',[module('Box','Public Reads As Long\nPublic Writes As Long\nPublic Property Get Value(ByVal index As Long) As Long\nReads = Reads + 1\nValue = 5\nEnd Property\nPublic Property Let Value(ByVal index As Long, ByVal x As Long)\nWrites = Writes + 1\nEnd Property','class')])).output,['1 1 1 0']));
test('arrays retain types across assignment, ReDim Preserve and each iteration',async()=>assert.deepEqual((await run(main('Dim a() As Variant, b() As Variant, item\nReDim a(-1 To 1)\na(-1) = CByte(1): a(0) = CInt(2): a(1) = True\nb = a\nReDim Preserve b(-1 To 2)\nFor Each item In b\nDebug.Print TypeName(item)\nNext'))).output,['Byte','Integer','Boolean','Empty']));
test('collection and dictionary default and Item member calls retain tags',async()=>assert.deepEqual((await run(main('Dim c As New Collection, d As Object, item\nSet d = New Scripting.Dictionary\nc.Add CByte(3): d.Add "key", CSng(2)\nDebug.Print TypeName(c(1)), TypeName(c.Item(1)), TypeName(d("key")), TypeName(d.Item("key"))\nd("key") = True\nDebug.Print TypeName(d.Item("key"))\nFor Each item In c\nDebug.Print TypeName(item)\nNext'))).output,['Byte Byte Single Single','Boolean','Byte']));
test('IIf, Choose, Switch and CVar preserve selected subtype',async()=>assert.deepEqual((await run(main('Debug.Print TypeName(IIf(True, CByte(3), 1)), TypeName(Choose(2, 1, CSng(2))), TypeName(Switch(False, 1, True, CInt(3))), TypeName(CVar(CLng(5)))'))).output,['Byte Single Integer Long']));
for(const [value,type]of [['CByte(9)',17],['CInt(-5)',2],['CLng(8)',3],['CSng(1.25)',4],['CDbl(2.5)',5],['True',11],['CCur(".25")',6],['CDec(".3")',14],['CDate(2.5)',7],['"abc"',8],['CVErr(5)',10],['Null',1],['Empty',0]])test('source binary Variant Get/Put retains '+value,async()=>assert.deepEqual((await run(main(`Dim source, result\nsource = ${value}\nOpen "variant.bin" For Binary As #1\nPut #1, , source\nGet #1, 1, result\nDebug.Print VarType(result)\nClose #1`))).output,[String(type)]));
test('direct SDK reads stay raw while scalar reads expose immutable tags',()=>{const cell=new Cell('Variant',tagScalar(3,'byte'));assert.equal(cell.get(),3);assert.equal(cell.getScalar().type,'byte');assert.equal(cell.getScalar().variant,true);assert.ok(Object.isFrozen(cell.getScalar()));assert.equal(unbox(NOTHING),NOTHING);assert.throws(()=>new VBScalar(256,'byte'),e=>e.number===6);});
test('binary decoder exposes raw compatibility result and separate scalar result',()=>{const encoded=encodeVariable(tagScalar(7,'integer',true));assert.deepEqual([...encoded],[2,0,7,0]);const decoded=decodeVariable(encoded);assert.equal(decoded.value,7);assert.equal(decoded.scalar.type,'integer');assert.equal(decoded.scalar.variant,true);});
test('debugger inspect, edit and explicit evaluation preserve subtype without exposing tags as host values',async()=>{const p=await pause('Sub Main()\nDim value\nvalue = CByte(3)\nDebug.Print TypeName(value)\nEnd Sub',4);try{assert.equal(p.vm.inspectDebug('value').type,'Byte');assert.equal(await p.vm.evaluateWatch('VarType(value)'),17);p.vm.assignDebug('value','CSng(2.5)');assert.equal(p.vm.inspectDebug('value').type,'Single');assert.equal(await p.vm.evaluateExplicit('VarType(value)'),4);await finish(p);assert.deepEqual(p.output,['Single']);}finally{p.vm.stop();}});
test('For loop Variant retains subtype while counter advances',async()=>assert.deepEqual((await run(main('Dim i\nFor i = CInt(1) To CInt(2)\nDebug.Print TypeName(i)\nNext\nDebug.Print i, TypeName(i)'))).output,['Integer','Integer','3 Integer']));
test('Step zero may exit normally instead of being refused before the loop',async()=>assert.deepEqual((await run(main('Dim value As Integer\nFor value = 1 To 2 Step 0\nDebug.Print value\nExit For\nNext'))).output,['1']));
test('For increment reports typed overflow without promoting typed storage',async()=>assert.deepEqual((await run(main('Dim value As Integer\nOn Error GoTo Handler\nFor value = 32767 To 32767\nDebug.Print value\nNext\nExit Sub\nHandler:\nDebug.Print Err.Number'))).output,['32767','6']));
test('multiple Double suffixes do not merge comma/colon-separated expressions into a date',async()=>assert.deepEqual((await run(main('Dim x#, y#\nx# = 1#: y# = 2#\nDebug.Print x#, y#, 3#, 4#'))).output,['1 2 3 4']));

test('For Each Dictionary keys retain insertion subtype',async()=>assert.deepEqual((await run(main('Dim d As Object, key\nSet d = CreateObject("Scripting.Dictionary")\nd.Add CByte(2), "byte"\nd.Add CLng(3), "long"\nFor Each key In d\nDebug.Print TypeName(key), key\nNext'))).output,['Byte 2','Long 3']));
test('Immediate Call syntax preserves actual variable aliases',async()=>{
 const p=await pause(main('Dim x As Long\nx = 5\nx = x + 1')+'\nSub Change(ByRef value As Long)\nvalue = 9\nEnd Sub',5);
 try{await p.vm.evaluateExplicit('Call Change(x)',{immediate:true});assert.equal(p.vm.currentFrame.locals.get('x').get(),9);assert.equal(p.vm.currentFrame.locals.get('x').getScalar().type,'long');}
 finally{await finish(p);}
});
test('source events retain Variant numeric and Boolean argument types',async()=>{
 const emitter=module('Emitter',`Public Event Value(ByVal value As Variant)
Public Sub Fire(ByVal value As Variant)
RaiseEvent Value(value)
End Sub`,'class');
 const listener=module('Listener',`Private WithEvents Source As Emitter
Public Sub Attach(ByVal item As Emitter)
Set Source = item
End Sub
Private Sub Source_Value(ByVal value As Variant)
Debug.Print TypeName(value), value
End Sub`,'class');
 assert.deepEqual((await run(main('Dim e As Emitter, s As Listener\nSet e = New Emitter\nSet s = New Listener\ns.Attach e\ne.Fire CByte(1)\ne.Fire CSng(2)\ne.Fire True'),[emitter,listener])).output,['Byte 1','Single 2','Boolean True']);
});
test('RaiseEvent temporary property arguments are evaluated once and not written back',async()=>{
 const emitter=module('Emitter',`Public Event Changing(ByRef value As Long)
Public Reads As Long
Public Writes As Long
Public Property Get Value() As Long
Reads = Reads + 1
Value = 4
End Property
Public Property Let Value(ByVal item As Long)
Writes = Writes + 1
End Property
Public Sub Fire()
RaiseEvent Changing(Value)
End Sub`,'class');
 const listener=module('Listener',`Private WithEvents Source As Emitter
Public Sub Attach(ByVal item As Emitter)
Set Source = item
End Sub
Private Sub Source_Changing(ByRef value As Long)
value = value + 1
Debug.Print TypeName(value), value
End Sub`,'class');
 assert.deepEqual((await run(main('Dim e As Emitter, s As Listener\nSet e = New Emitter\nSet s = New Listener\ns.Attach e\ne.Fire\nDebug.Print e.Reads, e.Writes'),[emitter,listener])).output,['Long 5','1 0']);
});
test('RaiseEvent rejects a differently typed actual variable even with no listener',async()=>{
 const emitter=module('Emitter',`Public Event Changing(ByRef value As Long)
Public Sub Fire()
Dim value As Integer
On Error Resume Next
RaiseEvent Changing(value)
Debug.Print Err.Number
End Sub`,'class');
 assert.deepEqual((await run(main('Dim e As Emitter\nSet e = New Emitter\ne.Fire'),[emitter])).output,['13']);
});

test('shipped Win32 bitmap sample uses positive Long green rather than signed Integer',async()=>{
 const {win32Example}=await import('../src/project/win32-example.js');
 const assignments=win32Example().modules[0].code.split('\n').filter(line=>/^\s*pixels\(\d\)\s*=/.test(line));
 assert.equal(assignments.length,4);
 const {output}=await run(main('Dim pixels(0 To 3) As Long\n'+assignments.join('\n')+'\nDebug.Print pixels(0), pixels(1), pixels(2), pixels(3)'));
 assert.deepEqual(output,['16711680 65280 255 16777215']);
});

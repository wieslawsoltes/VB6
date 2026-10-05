import test from 'node:test';
import assert from 'node:assert/strict';
import {run,main,module} from './helpers/compiler-runtime.mjs';
import {readInputField} from '../src/runtime/sequential-codec.js';
import {VBArray,Cell,tagScalar,storageScalar,unbox,coerce,numeric,scalarType,scalarBinary,VBErrorValue,NOTHING} from '../src/runtime/values.js';
import {parseExpression} from '../src/language/expression.js';

for(const [expression,expected]of [
 ['CByte(True)','255'],['CInt("2.5")','2'],['CInt("3.5")','4'],['CInt("-1.5")','-2'],['CLng("2147483646.5")','2147483646'],
 ['CStr(CSng("1.23456789"))','1.234568'],['CStr(CDbl("0.30000000000000004"))','0.3'],['CStr(CDec(CSng("1.6")))','1.6'],
 ['CStr(CDec(CDbl("1.2345678901234567")))','1.23456789012346'],['CInt("&HFFFF")','-1'],['CLng("&HFFFF")','65535'],
 ['CDbl("1,234.5")','1234.5'],['CBool("True")','True'],['CBool("#TRUE#")','True'],['CByte(CVErr(7))','7']
])test('checked conversion: '+expression,async()=>assert.deepEqual((await run(main('Debug.Print '+expression))).output,[expected]));
for(const [value,number]of [['""',13],['" "',13],['"NaN"',13],['"Infinity"',13],['"0x10"',13],['"12tail"',13],['"1e309"',6],['Null',94],['Nothing',91]])test('invalid numeric conversion is diagnosed: '+value,async()=>assert.deepEqual((await run(main(`On Error Resume Next\nDim x\nx = CDbl(${value})\nDebug.Print Err.Number`))).output,[String(number)]));
test('single conversion and arithmetic round at float32 boundaries',async()=>assert.deepEqual((await run(main('Dim x As Single\nx = 16777216\nDebug.Print CLng(x + CSng(1)), TypeName(x + CSng(1)), CDbl(x) + 1'))).output,['16777216 Single 16777217']));
test('numeric parser bounds are checked before expensive conversion',()=>assert.throws(()=>numeric('1'.repeat(4097)),e=>e.number===7));
test('rejected conversion does not change an existing Cell scalar subtype or value',()=>{const c=new Cell('Byte',7);assert.throws(()=>c.set(256),e=>e.number===6);assert.equal(c.get(),7);assert.equal(c.getScalar().type,'byte');});
test('numeric string Variant comparison differs from declared String comparison',async()=>assert.deepEqual((await run(main('Dim value\nvalue = "2"\nDebug.Print CVar(1) < value, CInt(1) < value, "10" < CVar(2), CVar("10") < CVar(2)'))).output,['True True True False']));
test('Error comparisons stay scalar and invalid Error arithmetic raises type mismatch',async()=>assert.deepEqual((await run(main('Debug.Print CVErr(4) < CVErr(5), CVErr(4) = CVErr(4)\nOn Error Resume Next\nDebug.Print CVErr(4) + 1\nDebug.Print Err.Number'))).output,['True True','13']));
test('typed record fields, fixed arrays and ByRef copies preserve metadata',async()=>assert.deepEqual((await run('Type Row\nB As Byte\nI As Integer\nF As Single\nEnd Type\n'+main('Dim a As Row, b As Row\na.B = 1: a.I = 2: a.F = 3\nb = a\nDebug.Print TypeName(b.B), TypeName(b.I), TypeName(b.F)\nChange b.I\nDebug.Print b.I, a.I').replace('Option Explicit\n','')+'\nSub Change(ByRef value As Integer)\nvalue = value + 1\nEnd Sub')).output,['Byte Integer Single','3 2']));
test('Binary Variant-array descriptors restore per-element subtypes',async()=>assert.deepEqual((await run(main('Dim a(0 To 2), b(0 To 2)\na(0) = CByte(1): a(1) = CSng(2): a(2) = True\nOpen "array.bin" For Binary As #1\nPut #1, , a()\nGet #1, 1, b()\nClose #1\nDebug.Print TypeName(b(0)), TypeName(b(1)), TypeName(b(2))'))).output,['Byte Single Boolean']));
test('Write/Input retain Boolean, Null, Error and Date marker types',async()=>assert.deepEqual((await run(main('Dim a,b,c,d,e\nOpen "values.txt" For Output As #1\nWrite #1, True, False, Null, CVErr(5), CDate(2.5)\nClose #1\nOpen "values.txt" For Input As #1\nInput #1, a,b,c,d,e\nDebug.Print VarType(a), VarType(b), VarType(c), VarType(d), VarType(e), a, b\nClose #1'))).output,['11 11 1 10 7 True False']));
test('successive Input statements consume fields rather than discard each record',async()=>assert.deepEqual((await run(main('Dim a As String,b As Long,c\nOpen "fields.txt" For Output As #1\nWrite #1, "one,two", 42, True\nClose #1\nOpen "fields.txt" For Input As #1\nInput #1, a\nInput #1, b\nInput #1, c\nDebug.Print a, b, c, EOF(1)'))).output,['one,two 42 True True']));
test('Input is not CSV: adjacent quoted strings are separate fields',()=>{const a=readInputField('"a""b",\r\n',0),b=readInputField('"a""b",\r\n',a.next);assert.equal(unbox(a.value),'a');assert.equal(unbox(b.value),'b');});
test('Input into String preserves numeric lexeme',()=>{const x=readInputField('001.20,',0,'String');assert.equal(unbox(x.value),'001.20');});
for(const input of ['"unterminated','no-delimiter',''])test('Input requires a complete delimited record: '+input,()=>assert.throws(()=>readInputField(input),e=>e.number===62));
test('interpreted native Declare preserves declared Long return subtype',async()=>assert.deepEqual((await run('Private Declare Function GetTickCount Lib "kernel32" () As Long\n'+main('Debug.Print TypeName(GetTickCount())').replace('Option Explicit\n',''))).output,['Long']));

test('ADO field Value/default/OriginalValue use trusted declared scalar types',async()=>{
 const body=`Dim rs As Object
Set rs = CreateObject("ADODB.Recordset")
rs.Fields.Append "B", 17
rs.Fields.Append "I", 2
rs.Fields.Append "L", 3
rs.Fields.Append "F", 4
rs.Fields.Append "Flag", 11
rs.Open
rs.AddNew
rs.Fields("B").Value = 3
rs.Fields("I").Value = 4
rs.Fields("L").Value = 5
rs.Fields("F").Value = 6
rs.Fields("Flag").Value = True
rs.Update
Debug.Print TypeName(rs.Fields("B").Value), TypeName(rs.Fields("I").Value), TypeName(rs.Fields("L").Value), TypeName(rs.Fields("F").Value), TypeName(rs.Fields("Flag").Value)
Debug.Print VarType(rs.Fields("B") + CVar(1)), rs.Fields("Flag").Value
Debug.Print TypeName(rs.Fields("B").OriginalValue)
rs.Close`;
 assert.deepEqual((await run(main(body))).output,['Byte Integer Long Single Boolean','2 True','Byte']);
});
test('ADO parameter scalar reads follow its explicit Type without changing raw JavaScript Value',async()=>{
 const {ADOCommand}=await import('../src/data/connection.js');
 const {vm,output}=await run(main('Dim c As Object, p As Object\nSet c = CreateObject("ADODB.Command")\nSet p = c.CreateParameter("x", 17, 1, 0, 4)\nDebug.Print TypeName(p.Value)\np.Type = 3\nDebug.Print TypeName(p.Value)\np.Value = Null\nDebug.Print TypeName(p.Value)'));
 assert.deepEqual(output,['Byte','Long','Null']);
 const p=new ADOCommand({}).CreateParameter('x',17,1,0,4);
 assert.equal(p.Value,4);assert.equal(vm.nativeMember(p,'Value'),4);assert.equal(vm.nativeMemberScalar(p,'Value').type,'byte');
});
test('DAO fields map DAO type IDs independently from ADO IDs',async()=>{
 const {DisconnectedRecordset}=await import('../src/data/recordset.js');
 const {DAORecordset}=await import('../src/data/dao-recordset.js');
 const {vm}=await run(main(''));
 const cursor=new DisconnectedRecordset();cursor.Fields.Append('B',17);cursor.Fields.Append('I',2);cursor.Fields.Append('F',4);cursor.Open();cursor.AddNew();cursor.Fields.Item('B').Value=1;cursor.Fields.Item('I').Value=2;cursor.Fields.Item('F').Value=3;cursor.Update();
 const rs=new DAORecordset(cursor);
 for(const [name,type]of [['B','byte'],['I','integer'],['F','single']]){const field=rs.Fields.Item(name);assert.equal(vm.nativeMemberScalar(field,'Value').type,type);assert.equal(typeof vm.nativeMember(field,'Value'),'number');}
});
test('untrusted objects cannot forge database scalar metadata using Type and __type',async()=>{
 const {vm}=await run(main(''));
 const forged={__type:'DAO.Field',Type:2,Value:7};
 assert.equal(vm.nativeMemberScalar(forged,'Value').type,'double');
 assert.equal(await vm.defaultValue(forged),forged);
});

test('CDate and CVDate aliases keep distinct declared return origins across VMs',async()=>{
 const {vm}=await run(main(''));
 const a=vm.library.get('cdate'),b=vm.library.get('cvdate');
 assert.notEqual(a,b);
 assert.equal(a.vbScalarInvoke([tagScalar(2,'integer')],vm.currentFrame).variant,false);
 assert.equal(b.vbScalarInvoke([tagScalar(2,'integer')],vm.currentFrame).variant,true);
 const second=await run(main('Debug.Print CDate(2) < CVar("1/1/1900"), CVDate(2) < CVar("1/1/1900")'));
 assert.deepEqual(second.output,['False True']);
 assert.equal(a.vbScalarInvoke([tagScalar(2,'integer')],vm.currentFrame).variant,false);
 assert.notEqual(a,second.vm.library.get('cdate'));
});
for(const name of ['CDate','CVDate'])test(name+' rejects Error instead of converting its error number to a date',async()=>assert.deepEqual((await run(main(`On Error Resume Next\nDim value\nvalue=${name}(CVErr(7))\nDebug.Print Err.Number`))).output,['13']));

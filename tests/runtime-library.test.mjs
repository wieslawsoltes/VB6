import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {asDate,dateAdd,dateDiff,datePart,dateSerial,timeSerial,dateToSerial,serialToDate,weekday,monthName,weekdayName} from '../src/runtime/calendar.js';
import {VBErrorValue,Cell,coerce,numeric,binary} from '../src/runtime/values.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {encodeVariable,decodeVariable} from '../src/runtime/binary-codec.js';
const parts=d=>[d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds()];
const main=body=>`Option Explicit\nSub Main()\n${body}\nEnd Sub`;
async function run(code,extras=[]){const program=compileProject({name:'Runtime04',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code},...extras]});assert.deepEqual(program.diagnostics,[]);const output=[];const vm=new VirtualMachine(program,{print:s=>output.push(s)});await vm.start();return {output,vm};}
for(const [date,count,want]of [['2024-02-29',1,[2025,2,28]],['2024-02-29',-4,[2020,2,29]],['2024-01-31',1,[2025,1,31]]])test('DateAdd year clamps '+date+' '+count,()=>assert.deepEqual(parts(dateAdd('yyyy',count,date)).slice(0,3),want));
for(const [part,date,count,want]of [['m','2024-01-31',1,[2024,2,29]],['m','2023-03-31',-1,[2023,2,28]],['q','2024-11-30',1,[2025,2,28]],['d','2024-02-28',1,[2024,2,29]],['w','2024-02-28',1,[2024,2,29]]])test(`DateAdd ${part} ${date} ${count}`,()=>assert.deepEqual(parts(dateAdd(part,count,date)).slice(0,3),want));
test('DateAdd rounds amount ties-to-even',()=>{assert.equal(dateAdd('d',2.5,'2024-01-01').getDate(),3);assert.equal(dateAdd('d',3.5,'2024-01-01').getDate(),5);});
for(const [part,a,b,want]of [['yyyy','2023-12-31','2024-01-01',1],['q','2024-03-31','2024-04-01',1],['m','2024-01-31','2024-02-01',1],['d','2024-01-01 23:59:59','2024-01-02 00:00:00',1],['h','2024-01-01 10:59:59','2024-01-01 11:00:00',1],['n','2024-01-01 10:59:59','2024-01-01 11:00:00',1],['s','2024-01-01 10:59:59.900','2024-01-01 11:00:00.100',1]])test('DateDiff counts '+part+' boundaries',()=>{assert.equal(dateDiff(part,a,b),want);assert.equal(dateDiff(part,b,a),-want);});
test('DateDiff weekday is distinct from calendar week',()=>{assert.equal(dateDiff('w','2024-01-06','2024-01-07'),0);assert.equal(dateDiff('ww','2024-01-06','2024-01-07'),1);assert.equal(dateDiff('ww','2024-01-06','2024-01-07',2),0);assert.equal(dateDiff('ww','2024-01-07','2024-01-08',2),1);});
test('DatePart all supported intervals',()=>{const date='2024-04-05 16:17:18';assert.deepEqual(['yyyy','q','m','y','d','w','ww','h','n','s'].map(p=>datePart(p,date)),[2024,2,4,96,5,6,14,16,17,18]);});
test('DatePart week rules handle previous-year first days',()=>{assert.equal(datePart('ww','2021-01-01',2,2),53);assert.equal(datePart('ww','2021-01-04',2,2),1);assert.equal(datePart('ww','2021-01-03',1,3),1);});
for(const [serial,want]of [[-1.25,[1899,12,29,6,0,0]],[-2.5,[1899,12,28,12,0,0]],[-.5,[1899,12,30,12,0,0]],[0,[1899,12,30,0,0,0]],[2.25,[1900,1,1,6,0,0]]])test('OLE DATE fractional conversion '+serial,()=>{const date=serialToDate(serial);assert.deepEqual(parts(date),want);assert.equal(dateToSerial(date),serial===-.5?.5:serial);});
test('OLE dates at year 100/9999 boundaries and overflow',()=>{assert.equal(asDate('0100-01-01').getFullYear(),100);assert.equal(asDate('9999-12-31').getFullYear(),9999);assert.throws(()=>serialToDate(2958466),e=>e.number===6);assert.throws(()=>dateAdd('yyyy',1,'9999-01-01'),e=>e.number===5);assert.throws(()=>dateAdd('yyyy',-1,'0100-01-01'),e=>e.number===5);});
test('DateSerial rollover and TimeSerial normalization',()=>{assert.deepEqual(parts(dateSerial(2024,3,0)).slice(0,3),[2024,2,29]);assert.deepEqual(parts(timeSerial(25,-30,0)),[1899,12,31,0,30,0]);assert.equal(dateSerial(29,1,1).getFullYear(),2029);assert.equal(dateSerial(30,1,1).getFullYear(),1930);});
test('time-only CDate uses OLE epoch and AM/PM',()=>{assert.deepEqual(parts(asDate('12:34:56 PM')),[1899,12,30,12,34,56]);assert.deepEqual(parts(asDate('12:00 AM')),[1899,12,30,0,0,0]);});
test('Weekday and localized-name defaults have bounded arguments',()=>{assert.equal(weekday('2024-01-07'),1);assert.equal(weekday('2024-01-07',2),7);assert.equal(monthName(2,-1),'Feb');assert.equal(weekdayName(1,0,2),'Monday');for(const f of [()=>weekday('2024-01-07',8),()=>monthName(13),()=>weekdayName(0),()=>datePart('ww','2024-01-01',1,4)])assert.throws(f,e=>e.number===5);});
test('Date conversion rejects invalid civil dates without normalizing them',()=>{for(const text of ['2023-02-29','2024-13-01','2024-01-01 25:00','02/30/2024','12:70'])assert.throws(()=>asDate(text),e=>e.number===13);});
test('civil calculations work across Warsaw daylight-saving boundary',()=>{const url=new URL('../src/runtime/calendar.js',import.meta.url).href;const p=spawnSync(process.execPath,['--input-type=module','-e',`import {dateDiff,dateToSerial,asDate} from '${url}';console.log(JSON.stringify([dateDiff('d','2024-03-30 12:00','2024-03-31 12:00'),dateDiff('h','2024-03-30 12:00','2024-03-31 12:00'),dateToSerial(asDate('2024-03-31'))-dateToSerial(asDate('2024-03-30'))]));`],{encoding:'utf8',env:{...process.env,TZ:'Europe/Warsaw'}});assert.equal(p.status,0,p.stderr);assert.deepEqual(JSON.parse(p.stdout),[1,24,1]);});
test('date literals and source functions use civil date parsing',async()=>assert.deepEqual((await run(main('Debug.Print DatePart("q", #2024-04-01#)\nDebug.Print DateDiff("ww", #2024-01-06#, #2024-01-07#)\nDebug.Print Day(DateAdd("yyyy", 1, #2024-02-29#))\nDebug.Print CDbl(CDate(-1.25))'))).output,['2','1','28','-1.25']));
test('calendar named arguments and week constants',async()=>assert.deepEqual((await run(main('Debug.Print DatePart(interval:="ww", date:=#2021-01-01#, firstdayofweek:=vbMonday, firstweekofyear:=vbFirstFourDays)'))).output,['53']));
test('IsDate and IsNumeric reject Null/Nothing/Error',async()=>assert.deepEqual((await run(main('Debug.Print IsDate(Null), IsDate(Nothing), IsDate(CVErr(7)), IsDate("bad"), IsDate("12:00")\nDebug.Print IsNumeric(Nothing), IsNumeric(CVErr(7)), IsNumeric("123")'))).output,['False False False False True','False False True']));
test('CVErr remains a Variant Error with explicit conversions',async()=>assert.deepEqual((await run(main('Dim value As Variant\nvalue = CVErr(2001)\nDebug.Print IsError(value), VarType(value), TypeName(value), IsObject(value)\nDebug.Print CInt(value), CDbl(value), CStr(value)\nDebug.Print value'))).output,['True 10 Error False','2001 2001 Error 2001','Error 2001']));
for(const type of ['String','Long','Integer','Double','Date','Object'])test('implicit Error conversion rejects '+type,()=>assert.throws(()=>coerce(new VBErrorValue(7),type),e=>e.number===13));
test('Error arithmetic and comparisons reject implicit coercion',()=>{assert.throws(()=>numeric(new VBErrorValue(5)),e=>e.number===13);for(const op of ['+','&','=','<>'])assert.throws(()=>binary(op,new VBErrorValue(5),5),e=>e.number===13);});
test('CVErr range and integral rounding',()=>{assert.equal(new VBErrorValue(2.5).number,2);assert.equal(new VBErrorValue(3.5).number,4);for(const n of [-1,65536,Infinity])assert.throws(()=>new VBErrorValue(n));});
test('Error variants survive typed binary Get/Put',()=>{const original=new VBErrorValue(2001),schema=new Cell('Variant',original),bytes=encodeVariable(original,schema);assert.deepEqual([...bytes],[10,0,209,7,0,0]);const result=decodeVariable(bytes,schema).value;assert.equal(result instanceof VBErrorValue,true);assert.equal(result.number,2001);});
test('negative fractional dates survive typed binary Get/Put',()=>{const original=serialToDate(-1.25),schema=new Cell('Date',original),bytes=encodeVariable(original,schema);assert.equal(new DataView(bytes.buffer).getFloat64(0,true),-1.25);assert.equal(dateToSerial(decodeVariable(bytes,schema).value),-1.25);});
const bag={name:'Bag',kind:'class',code:`Option Explicit
Private hidden As Long
Public Value As Long
Private store(4) As String
Private ref As Object
Public Function Multiply(ByVal n As Long, Optional factor As Long = 2) As Long
Multiply = n * factor
End Function
Private Function Secret() As Long
Secret = 42
End Function
Public Property Get Text(ByVal index As Long) As String
Text = store(index)
End Property
Public Property Let Text(ByVal index As Long, ByVal value As String)
store(index) = value
End Property
Public Property Get Child() As Object
Set Child = ref
End Property
Public Property Set Child(ByVal value As Object)
Set ref = value
End Property
Public Sub CopyFrom(ByVal other As Bag)
hidden = other.hidden
End Sub
`};
test('CallByName dispatches methods, fields and indexed properties',async()=>assert.deepEqual((await run(main('Dim b As New Bag\nCallByName b, "Value", vbLet, 7\nDebug.Print CallByName(b, "Value", vbGet)\nDebug.Print CallByName(b, "Multiply", vbMethod, 6)\nCallByName b, "Text", vbLet, 2, "hello"\nDebug.Print CallByName(b, "Text", vbGet, 2)'),[bag])).output,['7','12','hello']));
test('CallByName vbSet preserves identity and Nothing',async()=>assert.deepEqual((await run(main('Dim b As New Bag, c As New Collection, other As Object\nCallByName b, "Child", vbSet, c\nSet other = CallByName(b, "Child", vbGet)\nDebug.Print other Is c\nCallByName b, "Child", vbSet, Nothing\nDebug.Print CallByName(b, "Child", vbGet) Is Nothing'),[bag])).output,['True','True']));
test('CallByName native dictionary methods and indexed property',async()=>assert.deepEqual((await run(main('Dim d As Object\nSet d = New Scripting.Dictionary\nCallByName d, "Add", vbMethod, "key", 5\nDebug.Print CallByName(d, "Item", vbGet, "key")\nCallByName d, "Item", vbLet, "key", 9\nDebug.Print CallByName(d, "Item", vbGet, "key")\nDebug.Print CallByName(d, "Count", vbGet)'))).output,['5','9','1']));
for(const [body,code]of [
 ['Debug.Print b.hidden',438],['b.hidden = 3',438],['Debug.Print b.Secret()',438],['Debug.Print CallByName(b, "hidden", vbGet)',438],['Debug.Print CallByName(b, "Secret", vbMethod)',438],['CallByName b, "Missing", vbLet, 2',438],['CallByName b, "Value", vbMethod',438],['CallByName b, "Multiply", vbGet, 2',438],['CallByName b, "Value", 99, 1',5],['CallByName b, "Child", vbSet, 2',424],['CallByName b, "Child", vbLet, 2',438],['CallByName b, "Value", vbGet, 2',450],['Debug.Print CallByName(Nothing,"X",vbGet)',91],['Debug.Print CallByName(3,"X",vbGet)',424],['Debug.Print CallByName(b,"constructor",vbMethod)',438],['Debug.Print CallByName(b,"__proto__",vbGet)',438],['Debug.Print CallByName(b,"_runtime",vbGet)',438]
])test('strict dispatch rejects '+body,async()=>await assert.rejects(()=>run(main('Dim b As New Bag\n'+body),[bag]),e=>e.number===code));
test('Private module fields are invisible across modules',async()=>await assert.rejects(()=>run(main('Debug.Print InternalValue'),[{name:'Other',kind:'module',code:'Private InternalValue As Long'}]),e=>e.number===500));
test('Public module fields remain accessible',async()=>assert.deepEqual((await run(main('SharedValue = 12\nDebug.Print SharedValue'),[{name:'Other',kind:'module',code:'Public SharedValue As Long'}])).output,['12']));
test('same class code can access Private fields of peer instances',async()=>assert.deepEqual((await run(main('Dim a As New Bag, b As New Bag\na.CopyFrom b\nDebug.Print "ok"'),[bag])).output,['ok']));

test('Error variants cannot be truth values',async()=>await assert.rejects(()=>run(main('If CVErr(7) Then Debug.Print "wrong"')),e=>e.number===13));
test('TypeOf rejects Variant Error rather than treating it as an object',async()=>await assert.rejects(()=>run(main('Debug.Print TypeOf CVErr(7) Is Object')),e=>e.number===424));
test('indexed private property setter cannot bypass public getter visibility',async()=>await assert.rejects(()=>run(main('Dim b As New Bag\nb.Text(0) = "bad"'),[{...bag,code:bag.code.replace('Public Property Let Text','Private Property Let Text')}]),e=>e.number===438));

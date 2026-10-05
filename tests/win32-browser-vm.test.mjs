import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {exportApplication} from '../src/exporter/exporter.js';
const program=code=>({id:'win32-test',name:'Win32 test',startup:'Sub Main',modules:[{name:'Module1',kind:'module',code}]});
async function run(t,code,options={}){const out=[],project=program(code),compiled=compileProject(project);assert.deepEqual(compiled.diagnostics,[]);const vm=new VirtualMachine(compiled,{print:s=>out.push(s),...options});t.after(()=>vm.stop());await vm.start();if(vm.state==='error')throw vm.lastError;return {vm,out,project};}

test('Declare Alias resolves normalized DLLs, exact export names and signed Long return values',async t=>{let n=0;const {out}=await run(t,`Private Declare Function Tick Lib "C:\\Windows\\KERNEL32.DLL" Alias "GetTickCount" () As Long
Private Declare Function RoundProduct Lib "kernel32" Alias "MulDiv" (ByVal a As Long, ByVal b As Long, ByVal c As Long) As Long
Sub Main()
Debug.Print Tick()
Debug.Print RoundProduct(7, 3, 2)
End Sub`,{win32Options:{clock:()=>n++===0?0:4294967295}});assert.deepEqual(out,['-1','11']);});
test('unknown API/library preserve runtime error distinctions and Err.LastDLLError',async t=>{const {out}=await run(t,`Declare Function Missing Lib "kernel32" () As Long
Declare Function Other Lib "not-a-dll" () As Long
Sub Main()
On Error Resume Next
Debug.Print Missing()
Debug.Print Err.Number, Err.LastDLLError
Err.Clear
Debug.Print Other()
Debug.Print Err.Number, Err.LastDLLError
End Sub`);assert.deepEqual(out,['453 127','48 126']);});
test('GetSystemTime marshals SYSTEMTIME ByRef UDT, including 16-bit members',async t=>{const {out}=await run(t,`Private Type SYSTEMTIME
Year As Integer
Month As Integer
DayOfWeek As Integer
Day As Integer
Hour As Integer
Minute As Integer
Second As Integer
Milliseconds As Integer
End Type
Private Declare Sub GetSystemTime Lib "kernel32" (ByRef value As SYSTEMTIME)
Sub Main()
Dim value As SYSTEMTIME
GetSystemTime value
Debug.Print value.Year, value.Month, value.Day, value.Milliseconds
End Sub`,{win32Options:{now:()=>new Date('2020-01-02T03:04:05.006Z')}});assert.deepEqual(out,['2020 1 2 6']);});
test('INI String buffers copy back with original length and standard truncation return',async t=>{const {out,vm}=await run(t,`Declare Function WriteIni Lib "kernel32" Alias "WritePrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal value As String, ByVal file As String) As Long
Declare Function ReadIni Lib "kernel32" Alias "GetPrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal def As String, ByVal buffer As String, ByVal size As Long, ByVal file As String) As Long
Sub Main()
Dim buffer As String, n As Long
Debug.Print WriteIni("Demo", "Title", "café", "test.ini")
buffer = String$(32, 0)
n = ReadIni("demo", "title", "", buffer, Len(buffer), "test.ini")
Debug.Print n, Len(buffer), Left$(buffer, n)
End Sub`);assert.deepEqual(out,['1','4 32 café']);assert.equal(vm.win32.api.memory.used,0);assert.match(vm.fs.read('/Windows/test.ini'),/café/);});
test('As Any buffers, ByVal pointer override, CopyMemory and array-element copyback',async t=>{const {out,vm}=await run(t,`Declare Function GlobalAlloc Lib "kernel32" (ByVal flags As Long, ByVal bytes As Long) As Long
Declare Function GlobalFree Lib "kernel32" (ByVal pointer As Long) As Long
Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (destination As Any, source As Any, ByVal bytes As Long)
Sub Main()
Dim ptr As Long, value As Long, bytes(0 To 3) As Byte, result As Long
value = &H12345678
ptr = GlobalAlloc(64, 4)
CopyMemory ByVal ptr, value, 4
CopyMemory bytes(0), ByVal ptr, 4
CopyMemory result, bytes(0), 4
Debug.Print bytes(0), bytes(1), bytes(2), bytes(3), result
Debug.Print GlobalFree(ptr)
End Sub`);assert.deepEqual(out,['120 86 52 18 305419896','0']);assert.equal(vm.win32.api.memory.used,0);});
test('UDTs have aligned Win32 storage, fixed strings and nested records, not packed file layout',async t=>{const {out}=await run(t,`Private Type INNER
flag As Byte
number As Long
End Type
Private Type OUTER
marker As Byte
child As INNER
text As String * 4
End Type
Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (destination As Any, source As Any, ByVal bytes As Long)
Sub Main()
Dim value As OUTER, bytes(0 To 15) As Byte
value.marker = 1
value.child.flag = 2
value.child.number = &H12345678
value.text = "ABCD"
CopyMemory bytes(0), value, 16
Debug.Print bytes(0), bytes(1), bytes(4), bytes(8), bytes(12), bytes(15)
End Sub`);assert.deepEqual(out,['1 0 2 120 65 68']);});
test('native file APIs share bytes with the VB virtual filesystem',async t=>{const {out,vm}=await run(t,`Declare Function CreateFile Lib "kernel32" Alias "CreateFileA" (ByVal path As String, ByVal access As Long, ByVal sharing As Long, ByVal security As Long, ByVal disposition As Long, ByVal flags As Long, ByVal template As Long) As Long
Declare Function WriteFile Lib "kernel32" (ByVal handle As Long, data As Any, ByVal size As Long, count As Long, ByVal overlapped As Long) As Long
Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Sub Main()
Dim file As Long, count As Long, data As Long
file = CreateFile("/raw.bin", &H40000000, 0, 0, 2, 128, 0)
data = &H41424344
Debug.Print WriteFile(file, data, 4, count, 0), count
Debug.Print CloseHandle(file)
End Sub`);assert.deepEqual(out,['1 4','1']);assert.deepEqual([...vm.fs.readBytes('/raw.bin')],[68,67,66,65]);});
test('Declare registry ByRef handles and output buffers survive persistence snapshot',async t=>{const {out,vm}=await run(t,`Declare Function RegCreateKeyEx Lib "advapi32" Alias "RegCreateKeyExA" (ByVal root As Long, ByVal key As String, ByVal reserved As Long, ByVal klass As Long, ByVal options As Long, ByVal access As Long, ByVal security As Long, result As Long, disposition As Long) As Long
Declare Function RegSetValueEx Lib "advapi32" Alias "RegSetValueExA" (ByVal key As Long, ByVal name As String, ByVal reserved As Long, ByVal typ As Long, data As Any, ByVal size As Long) As Long
Declare Function RegCloseKey Lib "advapi32" (ByVal key As Long) As Long
Sub Main()
Dim key As Long, disposition As Long, value As Long
Debug.Print RegCreateKeyEx(&H80000001, "Software\\Demo", 0, 0, 0, &HF003F, 0, key, disposition), disposition
value = 42
Debug.Print RegSetValueEx(key, "Answer", 0, 4, value, 4)
Debug.Print RegCloseKey(key)
End Sub`);assert.deepEqual(out,['0 1','0','0']);assert.ok(vm.settings.__win32Registry.some(([key])=>key==='HKCU\\software\\demo'));});
test('AddressOf callbacks execute through the VB VM and retain callback parameter types',async t=>{const {out,vm}=await run(t,`Declare Function EnumWindows Lib "user32" (ByVal callback As Long, ByVal data As Long) As Long
Public Function WindowProc(ByVal hwnd As Long, ByVal data As Long) As Long
Debug.Print data
WindowProc = 1
End Function
Sub Main()
End Sub`);vm.win32.api.registerWindow({});vm.win32.api.registerWindow({});await vm.immediate('Debug.Print EnumWindows(AddressOf WindowProc, 77)');assert.deepEqual(out,['77','77','1']);});
test('timer callbacks queue rather than reenter an executing VB stack and stop releases handles',async t=>{const {vm,out}=await run(t,`Declare Function SetTimer Lib "user32" (ByVal hwnd As Long, ByVal id As Long, ByVal interval As Long, ByVal callback As Long) As Long
Declare Function KillTimer Lib "user32" (ByVal hwnd As Long, ByVal id As Long) As Long
Public timer As Long
Sub Tick(ByVal hwnd As Long, ByVal message As Long, ByVal id As Long, ByVal time As Long)
Debug.Print "tick"
Debug.Print KillTimer(0, id)
End Sub
Sub Main()
timer = SetTimer(0, 0, 10, AddressOf Tick)
End Sub`);
// Debug.Print is observable before callProcedure's finally pops the frame. Wait
// for dispatch completion as well as output; a slow runner may yield between them.
for(let until=Date.now()+2000;(out.length<2||vm.stack.length||vm.processing)&&Date.now()<until;)await new Promise(r=>setTimeout(r,10));
assert.deepEqual(out,['tick','1']);assert.equal(vm.stack.length,0);assert.equal(vm.processing,false);assert.equal(vm.win32.api.timers.size,0);
vm.stop();assert.equal(vm.win32.api.handles.entries.size,0);
});
test('bad signatures and unsupported Variant ABI fail before calls; writable buffers are bounded',async t=>{const {out,vm}=await run(t,`Declare Function Bad Lib "kernel32" Alias "GetTickCount" (ByVal extra As Long) As Long
Declare Function ReadText Lib "kernel32" Alias "lstrcpynA" (ByVal dst As String, ByVal src As String, ByVal size As Long) As Long
Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (destination As Any, source As Any, ByVal bytes As Long)
Sub Main()
Dim s As String, v As Variant, n As Long
On Error Resume Next
Debug.Print Bad(0)
Debug.Print Err.Number
Err.Clear
s = "x"
Debug.Print ReadText(s, "overflow", 99), Err.LastDLLError, s
CopyMemory v, n, 4
Debug.Print Err.Number
End Sub`);assert.deepEqual(out,['49','0 87 x','49']);assert.equal(vm.win32.api.memory.used,0);});

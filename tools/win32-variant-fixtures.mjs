import {appendParamArrayReferenceChecks,NATIVE_PARAMARRAY_REFERENCE_PROCEDURES} from './win32-paramarray-reference-fixtures.mjs';
/** Scalar VARIANT conformance in actual generated PE32 applications.
 * These programs use OleAut32, not the JavaScript runtime or a mock interpreter.
 */
import {appendParamArrayChecks,NATIVE_PARAMARRAY_PROCEDURES,NATIVE_PARAMARRAY_BASE_MODULE} from './win32-paramarray-fixtures.mjs';
import {newProject} from '../src/project/model.js';
import {appendVariantReferenceChecks,NATIVE_VARIANT_REFERENCE_PROCEDURES} from './win32-variant-reference-fixtures.mjs';
import {appendVariantDivisionChecks} from './win32-variant-division-fixtures.mjs';
export function nativeVariantFixture(){
 const checks=[],body=['On Error GoTo Unexpected','Dim v As Variant, w As Variant, q As Variant, n As Long, i As Long, b As Boolean','Dim s As String, f As Single, d As Double, money As Currency, stamp As Date','Dim fixed(1 To 3) As Variant, values() As Variant, copied() As Variant'];
 const add=s=>body.push(s),check=(expression,label)=>{checks.push(label);add(`If Not (${expression}) Then ExitProcess ${checks.length}`);};
 check('IsEmpty(v) And VarType(v)=0 And TypeName(v)="Empty"','Variant starts Empty with its runtime subtype');
 check('CLng(v)=0 And CDbl(v)=0# And CStr(v)="" And Not CBool(v)','Empty numeric, Boolean and String conversions');
 add('v=CByte(255)');check('VarType(v)=17 And TypeName(v)="Byte" And CLng(v)=255','Byte retains unsigned payload and subtype');
 add('v=CInt(-32768)');check('VarType(v)=2 And TypeName(v)="Integer" And CLng(v)=-32768','Integer retains its signed 16-bit subtype');
 add('v=CLng(2147483647)');check('VarType(v)=3 And TypeName(v)="Long" And CLng(v)=2147483647','Long preserves full signed range');
 add('v=CSng(12.25)\nf=v');check('VarType(v)=4 And TypeName(v)="Single" And f=12.25! And CSng(v)=12.25!','Single boxed R4 converts to the compiler R8 snapshot ABI');
 add('v=16777217#\nd=v');check('VarType(v)=5 And TypeName(v)="Double" And d=16777217#','Double subtype does not narrow while boxing');
 add('v=922337203685477.5807@\nmoney=v');check('VarType(v)=6 And TypeName(v)="Currency" And money=922337203685477.5807@','Currency boxing retains every scaled integer bit');
 add('v=CDate(42.5)\nstamp=v');check('VarType(v)=7 And TypeName(v)="Date" And CDbl(stamp)=42.5# And IsDate(v)','Date retains its Automation tag and serial value');
 add('v=True\nb=v');check('VarType(v)=11 And TypeName(v)="Boolean" And b And CLng(v)=-1 And CStr(v)="True"','Boolean tag and alphabetic String conversion');
 add('v="A" & ChrW(0) & ChrW(&HD800) & "B"\nw=v\nv="changed"\ns=w');check('VarType(w)=8 And TypeName(w)="String" And Len(s)=4 And AscW(Mid$(s,2,1))=0 And AscW(Mid$(s,3,1))=-10240','BSTR snapshots preserve embedded NUL and unpaired UTF-16 code units');
 add('w=w');check('CStr(w)=s','Variant self-assignment does not free the source prematurely');
 add('v=CDec("79228162514264337593543950335")');check('VarType(v)=14 And TypeName(v)="Decimal" And CStr(v)="79228162514264337593543950335"','Decimal maximum value is not converted through Double');
 add('v=CDec("0.0000000000000000000000000001")\nw=v+v');check('VarType(w)=14 And w=CDec("0.0000000000000000000000000002")','Decimal addition preserves 28 fractional digits');
 add('v=Null');check('IsNull(v) And VarType(v)=1 And TypeName(v)="Null" And Not IsEmpty(v)','Null is distinct from Empty');
 add('n=0\nIf v Then n=1');check('n=0','Null condition does not branch');
 check('IsNull(v=1) And IsNull(v<>1) And IsNull(v+1) And IsNull(-v) And IsNull(Not v)','Null arithmetic, relational and unary propagation');
 check('IsNull(v And True) And (v And False)=False And (v Or True)=True And IsNull(v Or False)','three-valued Null Boolean semantics');
 check('(v & "x")="x" And ("x" & v)="x"','String concatenation treats Null as an empty operand');
 add('v=CVErr(2042)');check('IsError(v) And VarType(v)=10 And TypeName(v)="Error" And CLng(v)=2042','CVErr is data, and explicit numeric conversion exposes its code');
 check('CStr(v)="Error 2042"','explicit Error-to-String conversion keeps the documented prefix');
 add('On Error Resume Next\nErr.Clear\nn=73\nn=v');check('Err.Number=13 And n=73','implicit Error conversion raises 13 without changing typed destination');
 add('Err.Clear\nstamp=CDate(7)\nstamp=CDate(v)');check('Err.Number=13 And CDbl(stamp)=7#','Error is not an explicitly convertible Date');
 add('Err.Clear\nv=Null\nn=v');check('Err.Number=94 And n=73','Null typed assignment raises 94 transactionally');
 add('Err.Clear\ns="retained"\ns=CStr(v)');check('Err.Number=94 And s="retained"','explicit String conversion of Null preserves old BSTR');
 add('Err.Clear\ns=Trim$(v)');check('Err.Number=94 And s="retained"','Null dollar-string argument raises 94 rather than becoming empty');
 add('Err.Clear\nv="not a number"\nn=v');check('Err.Number=13 And n=73','failed numeric String coercion preserves destination');
 add('Err.Clear\nv=32767.5\ni=CInt(v)');check('Err.Number=6','Integer narrowing detects rounded overflow');
 add('Err.Clear\nv=2.5\nn=v\nw=3.5\ni=w');check('Err.Number=0 And n=2 And i=4','Variant integer conversion rounds ties to even');
 add('Err.Clear\nv="retained"\nv=CDec("79228162514264337593543950336")');check('Err.Number=6 And v="retained"','failed Decimal conversion preserves Variant destination');
 add('Err.Clear\nv=1\nv=v/CVar(0)');check('Err.Number=11 And v=1','division error does not publish partial Variant result');
 add('Err.Clear\nOn Error GoTo Unexpected');
 add('v=CInt(32767)\nv=v+1');check('v=32768 And VarType(v)=3','Variant Integer arithmetic promotes on overflow');
 add('v=CLng(2147483647)\nv=v+1');check('v=2147483648# And VarType(v)=5','Variant Long arithmetic promotes on overflow');
 add('v=CInt(-7)\nw=CInt(3)');check('v\\w=-2 And v Mod w=-1 And v*w=-21 And v-w=-10 And v+w=-4','signed Variant integer and arithmetic operators');
 check('CVar(2)^CVar(10)=1024 And CVar(7)/CVar(2)=3.5','Variant power and division return real results');
 check('(CVar(2) And CVar(3))=2 And (CVar(2) Or CVar(3))=3 And (CVar(2) Xor CVar(3))=1 And (CVar(2) Eqv CVar(3))=-2 And (CVar(2) Imp CVar(3))=-1','eager Variant bitwise operators');
 check('Abs(CVar(-2.5))=2.5 And Fix(CVar(-2.5))=-2 And Int(CVar(-2.5))=-3','Variant Abs, Fix and Int');
 check('CVar("A" & ChrW(0))<CVar("a" & ChrW(0)) And CVar("x")=CVar("x") And CVar("x")<>CVar("y")','binary comparisons use counted ordinal UTF-16');
 check('TextVariantEqual()','text comparison uses the procedure Option Compare');
 add('v="123.5"');check('IsNumeric(v) And Not IsNumeric(Null) And Not IsNumeric(CVErr(7)) And Not IsNumeric(CDate(7)) And Not IsNumeric("bad")','IsNumeric checks value and subtype without raising');
 check('PredicateKeepsError()','predicate conversion does not replace caller Err state');
 check('Not IsArray(v) And Not IsObject(v) And Not IsMissing(v)','scalar Variant type predicates do not invent object or array identity');
 check('DefaultMissing() And Not DefaultMissing(Empty) And Not DefaultMissing(Null)','optional Variant omission differs from explicitly supplied Empty or Null');
 check('DefaultTag()=5 And DefaultTag(1)=2','Optional Variant default retains authored Double subtype');
 check('MissingConversion()=449','converting an omitted optional argument raises error 449');
 add('v="old"\nw=Echo(v)\nv="new"');check('w="old"','Variant function hidden result outlives callee storage');
 add('ChangeByVal w');check('w="old"','ByVal callee owns an isolated Variant copy');
 add('ChangeByRef w');check('w="updated"','ByRef Variant aliases caller storage');
 add('ChangeByRef (w)');check('w="updated"','parenthesized ByRef Variant uses an isolated temporary');
 add('v="old"\nw=SnapshotPair(v,Mutate(v))');check('w="old/changed" And v="changed"','ByVal arguments are snapshotted in authored evaluation order');
 add('sequence=0\nv=Ordered(b:=Mark(2),a:=Mark(1))');check('sequence=21 And v=12','named Variant arguments preserve authored order and formal slots');
 check('Factorial(CVar(8))=40320','recursive Variant arguments and caller-owned return storage');
 check('StaticValue()="x" And StaticValue()="xx"','static Variant owns its value across calls');
 add('On Error Resume Next\nv="keep"\nv=FailingReturn(v)');check('Err.Number=6 And v="keep"','failed callee return leaves caller destination intact');
 add('Err.Clear\nOn Error GoTo Unexpected');
 check('IsEmpty(fixed(1)) And LBound(fixed)=1 And UBound(fixed)=3 And VarType(fixed)=8204 And TypeName(fixed)="Variant()"','fixed Variant array initializes Empty values and advertises element type');
 add('fixed(1)="A" & ChrW(0) & "B"\nfixed(2)=CDec("1.25")\nfixed(3)=Null\ncopied=fixed\nfixed(1)="new"');check('copied(1)="A" & ChrW(0) & "B" And copied(2)=CDec("1.25") And IsNull(copied(3))','SafeArrayCopy deep-copies String, Decimal and Null elements');
 add('Erase fixed');check('IsEmpty(fixed(1)) And IsEmpty(fixed(2)) And IsEmpty(fixed(3)) And UBound(fixed)=3','fixed Erase clears managed Variant elements and retains bounds');
 add('ReDim values(-2 To 1)\nvalues(-2)="preserved"\nvalues(1)=CVErr(7)\nReDim Preserve values(-2 To 4)');check('values(-2)="preserved" And IsError(values(1)) And IsEmpty(values(4))','ReDim Preserve retains Variant elements and initializes growth');
 add('ReDim Preserve values(-2 To 0)');check('UBound(values)=0 And values(-2)="preserved"','shrinking Variant arrays releases removed managed values');
 add('sequence=0\nvalues(IndexOnce())="once"');check('sequence=1 And values(-2)="once"','Variant array subscripts execute exactly once');
 add('ChangeArray values');check('values(-2)="array ByRef"','ByRef Variant array uses a descriptor slot');
 add('On Error Resume Next\nErr.Clear\nvalues(12)="out"');check('Err.Number=9 And values(-2)="array ByRef"','bounds error preserves Variant array data');
 add('Err.Clear\nOn Error GoTo Unexpected\nvalues(-2)="before"\nw=LockedResize(values,values(-2))');check('w=10 And values(-2)="before"','Variant element argument pins its array during callee ReDim');
 add('Erase values\nReDim values(1 To 1)');check('IsEmpty(values(1)) And UBound(values)=1','Erase dynamic Variant arrays releases storage and permits reallocation');
 add('n=0\nFor v=1 To 5\n n=n+v\nNext');check('n=15 And v=6','Variant For counter uses numeric payload rather than pointer truth');
 add('n=0\nv="match"\nSelect Case v\n Case "other"\n n=1\n Case "match"\n n=2\n Case Else\n n=3\nEnd Select');check('n=2','Select Case retains an owned Variant snapshot');
 add('For i=1 To 1000\n v="owner" & CStr(i)\n w=Echo(v)\n values(1)=w\n ChangeByVal w\nNext');check('v="owner1000" And w=v And values(1)=v','repeated Variant/String/call/array ownership is stable');
 appendVariantDivisionChecks(add,check);
 appendVariantReferenceChecks(add,check);
 appendParamArrayChecks(add,check);
 appendParamArrayReferenceChecks(add,check);
 add('ExitProcess 0\nUnexpected:\nExitProcess 10000+Err.Number');
 const project=newProject('AotVariants');project.startup='Sub Main';project.modules=[{id:'m',name:'Entry',kind:'module',code:`Option Explicit
Private sequence As Long
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function Echo(ByVal value As Variant) As Variant
 Echo=value
End Function
Private Sub ChangeByVal(ByVal value As Variant)
 value="private"
End Sub
Private Sub ChangeByRef(ByRef value As Variant)
 value="updated"
End Sub
Private Function Mutate(ByRef value As Variant) As Variant
 value="changed"
 Mutate=value
End Function
Private Function SnapshotPair(ByVal a As Variant,ByVal b As Variant) As Variant
 SnapshotPair=a & "/" & b
End Function
Private Function Mark(ByVal n As Long) As Variant
 sequence=sequence*10+n
 Mark=n
End Function
Private Function Ordered(ByVal a As Variant,ByVal b As Variant) As Variant
 Ordered=a*10+b
End Function
Private Function Factorial(ByVal value As Variant) As Variant
 If value<=1 Then
  Factorial=1
 Else
  Factorial=value*Factorial(value-1)
 End If
End Function
Private Function StaticValue() As Variant
 Static stored As Variant
 If IsEmpty(stored) Then stored=""
 stored=stored & "x"
 StaticValue=stored
End Function
Private Function FailingReturn(ByVal source As Variant) As Variant
 FailingReturn=source & "discard"
 Err.Raise 6
End Function
Private Function DefaultMissing(Optional value As Variant) As Boolean
 DefaultMissing=IsMissing(value)
End Function
Private Function DefaultTag(Optional value As Variant=1#) As Long
 DefaultTag=VarType(value)
End Function
Private Function MissingConversion(Optional value As Variant) As Long
 On Error Resume Next
 Dim n As Long
 n=value
 MissingConversion=Err.Number
 Err.Clear
End Function
Private Function PredicateKeepsError() As Boolean
 On Error Resume Next
 Err.Raise 13
 Dim n As Long
 n=IsNumeric("nonsense")
 PredicateKeepsError=Err.Number=13 And n=0
 Err.Clear
End Function
Private Function IndexOnce() As Long
 sequence=sequence+1
 IndexOnce=-2
End Function
Private Sub ChangeArray(ByRef values() As Variant)
 values(-2)="array ByRef"
End Sub
Private Function LockedResize(ByRef values() As Variant,ByRef item As Variant) As Variant
 On Error Resume Next
 ReDim values(-2 To 10)
 LockedResize=Err.Number
 Err.Clear
End Function
Private Sub NeverCalled()
 Dim unused As Variant
 unused="unreachable"
End Sub
Sub Main()
 ${body.join('\n ')}
End Sub`},{id:'t',name:'TextPolicy',kind:'module',code:`Option Compare Text
Public Function TextVariantEqual() As Boolean
 Dim v As Variant,w As Variant
 v="AbC":w="aBc"
 TextVariantEqual=v=w
End Function`}];project.modules[0].code+='\n'+NATIVE_VARIANT_REFERENCE_PROCEDURES+'\n'+NATIVE_PARAMARRAY_PROCEDURES+'\n'+NATIVE_PARAMARRAY_REFERENCE_PROCEDURES;project.modules.push({...NATIVE_PARAMARRAY_BASE_MODULE});return {project,checks};
}

import {appendNativeVariantByteChecks} from './win32-variant-byte-fixture.mjs';
/** Native Write/Input round trips plus independently authored interchange text.
 * Expected scalar types and values are asserted in freestanding Windows EXEs. */
export function nativeFileFieldsFixture(fixture){
 const {add,check,finish}=fixture('AotControlInputFields');
 add('Dim s As String, n As Long, small As Integer, value As Variant, other As Variant, b As Boolean, d As Date, c As Currency, r As Double, bytes As Byte, fixed As String * 6');
 add('Open "fields.txt" For Output As #1\nWrite #1,"alpha,beta",123,True,#2024-02-29 08:09:10#,CCur(12.3456),CDbl(-1.25),CByte(255)\nClose #1\nOpen "fields.txt" For Input As #1 Len=1\nInput #1,s,n,b,d,c,r,bytes');
 check('s="alpha,beta" And n=123 And b And d=DateSerial(2024,2,29)+TimeSerial(8,9,10) And c=CCur(12.3456) And r=-1.25 And bytes=255','Write/Input typed scalar round trip with single-byte buffering');
 check('EOF(1)','field delimiters and final CRLF are consumed exactly once');
 add('Close #1\nOpen "fields.txt" For Output As #1\nWrite #1,Empty,Null,True,False,CVErr(23),#2024-02-29#,42.5,"42.5"\nClose #1\nOpen "fields.txt" For Input As #1\nInput #1,value');check('IsEmpty(value)','an empty interchange field yields an Empty Variant');
 add('Input #1,value');check('IsNull(value)','NULL marker retains the Null Variant subtype');
 add('Input #1,value,other');check('VarType(value)=vbBoolean And value=True And VarType(other)=vbBoolean And other=False','Boolean markers retain Boolean Variant subtypes');
 add('Input #1,value');check('IsError(value) And CStr(value)="Error 23"','ERROR marker retains its exact Error Variant value');
 add('Input #1,value');check('VarType(value)=vbDate And value=DateSerial(2024,2,29)','universal date text yields a Date Variant');
 add('Input #1,value,other');check('VarType(value)=vbDouble And value=42.5 And VarType(other)=vbString And other="42.5"','quoted numeric text remains String while unquoted numeric text becomes Double');
 add('Close #1\nOpen "fields.txt" For Output As #1\nPrint #1,Chr$(34) & "first" & Chr$(34) & Chr$(34) & "second" & Chr$(34)\nPrint #1,"  +1.25E2 , .5 , -2e-3 "\nPrint #1,"not-a-number," & Chr$(34) & "12" & Chr$(34)\nClose #1\nOpen "fields.txt" For Input As #1 Len=2\nInput #1,s,fixed');
 check('s="first" And fixed="second"','adjacent quoted fields are separate values, not CSV quote escapes');
 add('Input #1,n,r,value');check('n=125 And r=.5 And value=-.002','invariant number grammar accepts signs, decimal points, exponents and surrounding spaces');
 add('n=9\nsmall=9\nInput #1,n,small');check('n=0 And small=0','nonnumeric or quoted fields set numeric destinations to their default value');
 add('Close #1\nOpen "fields.txt" For Output As #1\nPrint #1,"#NULL#,#TRUE#,#ERROR 42#"\nPrint #1,"1,2"\nClose #1\nOpen "fields.txt" For Input As #1\nInput #1,s,fixed,value');check('s="#NULL#" And fixed="#TRUE#" And IsError(value)','declared Strings retain literal marker text rather than Variant special values');
 add('Input #1,value,value');check('value=2','repeated destinations are assigned in source order');
 add('Close #1\nOpen "fields.txt" For Output As #1\nPrint #1,"10,99999"\nClose #1\nOpen "fields.txt" For Input As #1\nsmall=7\nOn Error Resume Next\nErr.Clear\nInput #1,n,small');check('Err.Number=6 And n=10 And small=7','a later conversion overflow retains earlier committed fields and the failed destination');
 add('Err.Clear\nOn Error GoTo 0\nClose #1\nOpen "fields.txt" For Output As #1\nPrint #1,Chr$(34) & "unterminated";\nClose #1\nOpen "fields.txt" For Input As #1\ns="keep"\nOn Error Resume Next\nErr.Clear\nInput #1,s');check('Err.Number=62 And s="keep"','unterminated quoted input raises 62 without replacing the target');
 add('Err.Clear\nOn Error GoTo 0\nClose #1\nOpen "fields.txt" For Output As #1\nPrint #1,"123";\nClose #1\nOpen "fields.txt" For Input As #1\nn=7\nOn Error Resume Next\nErr.Clear\nInput #1,n');check('Err.Number=62 And n=7','unterminated numeric input raises 62 rather than fabricating a completed field');
 add('Err.Clear\nOn Error GoTo 0\nClose #1\nOpen "fields.txt" For Output As #1\nPrint #1,"1,not-date"\nClose #1\nOpen "fields.txt" For Input As #1\nOn Error Resume Next\nErr.Clear\nInput #1,b');check('Err.Number=6','numeric text is not silently converted to a Boolean by Input');
 add('Err.Clear\nInput #1,d');check('Err.Number=6','a Date input requires an interchange date marker');
 add('Err.Clear\nOn Error GoTo 0\nClose\nn=DeleteFileW(StrPtr("fields.txt"))');
 appendNativeVariantByteChecks({add,check});
 return finish('Private Declare Function DeleteFileW Lib "kernel32" (ByVal path As Long) As Long\nPrivate Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (ByVal destination As Long, ByVal source As Long, ByVal count As Long)');
}

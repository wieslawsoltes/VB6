/** Permanent ParamArray assertions in the existing real-Windows PE32 matrix.
 * Helpers consume native SAFEARRAY/VARIANT storage, never browser emulation. */
export function appendParamArrayChecks(add,check) {
 check('PAEmpty() And PAEmptyPrefix(9)','ParamArray with zero actuals has lower 0, upper -1 and is not Missing');
 check('PACount(1,2,3)=3 And PACount("one")=1','ParamArray argument count is independent of the one-slot ABI');
 check('PAValue(1,1,"A" & ChrW(0) & "B",3)="A" & ChrW(0) & "B"','ParamArray preserves counted BSTR elements and caller-owned Variant results');
 check('VarType(PAValue(0,CByte(255)))=17 And VarType(PAValue(0,CInt(-7)))=2 And VarType(PAValue(0,CLng(9)))=3','ParamArray preserves narrow and Long integral subtype tags');
 check('VarType(PAValue(0,CSng(1.25)))=4 And VarType(PAValue(0,1.25#))=5','ParamArray preserves Single and Double payload types');
 check('PAValue(0,922337203685477.5807@)=922337203685477.5807@ And VarType(PAValue(0,True))=11','ParamArray preserves exact Currency and Boolean payloads');
 check('CDbl(PAValue(0,CDate(7.5)))=7.5# And VarType(PAValue(0,CDate(7.5)))=7','ParamArray Date values retain their Automation subtype');
 check('PAValue(0,CDec("0.0000000000000000000000000001"))=CDec("0.0000000000000000000000000001")','ParamArray Decimal does not round through Double');
 check('IsNull(PAValue(0,Null)) And IsEmpty(PAValue(0,Empty)) And IsError(PAValue(0,CVErr(7)))','ParamArray distinguishes Null, Empty and Error values');
 check('PAHoles(7,,9,Empty)','ParamArray comma placeholders carry Missing rather than Empty');
 add('v="before"\nw=PASnapshot((v),Mutate(v))');check('w="before/changed" And v="changed"','parenthesized ParamArray elements snapshot before later actuals mutate their source');
 add('sequence=0\nv=PAOrder(Mark(1),Mark(2),Mark(3))');check('sequence=123 And v=123','ParamArray required prefix and rest retain authored evaluation order');
 add('v="source"\nPAMutate (v)');check('v="source"','parenthesized ParamArray element assignment does not overwrite the actual scalar variable');
 check('PAMutateElement("before")="updated"','ParamArray elements support typed project ByRef Variant calls');
 check('PARecursive(5,"root")="root....."','recursive ParamArray calls retain independent owned argument arrays');
 check('PAPassTyped("a","b")="a/b"','ParamArray can be passed directly to an ordinary typed Variant array parameter');
 add('On Error Resume Next\nErr.Clear\nv="retained"\nv=PAValue(0,"allocated",PAFailure())');check('Err.Number=6 And v="retained"','failure in a later actual leaves the outer destination and releases the partial ParamArray');
 add('Err.Clear\nv="caller"\nPAThrow (v)');check('Err.Number=77 And v="caller"','callee error retains caller value after changing its parenthesized ParamArray value');
 add('Err.Clear\nv=PAValue(4,"one")');check('Err.Number=9 And v="caller"','ParamArray bounds failure propagates without corrupting caller ownership');
 add('Err.Clear\nOn Error GoTo Unexpected');check('PAValue(0,"recovered")="recovered"','ParamArray packing remains usable after caller and callee error recovery');
 add('For i=1 To 1000\n v=PAValue(1,"unused" & CStr(i),"value" & CStr(i))\nNext');check('v="value1000"','repeated ParamArray calls retain only current statement ownership');
 check('PAOptionBaseOne()','ParamArray lower bound is zero even in an Option Base 1 callee');
}
export const NATIVE_PARAMARRAY_PROCEDURES=`
Private Function PAEmpty(ParamArray values() As Variant) As Boolean
 PAEmpty=LBound(values)=0 And UBound(values)=-1 And Not IsMissing(values) And IsArray(values)
End Function
Private Function PAEmptyPrefix(ByVal prefix As Long,ParamArray values() As Variant) As Boolean
 PAEmptyPrefix=prefix=9 And LBound(values)=0 And UBound(values)=-1
End Function
Private Function PACount(ParamArray values() As Variant) As Long
 PACount=UBound(values)-LBound(values)+1
End Function
Private Function PAValue(ByVal index As Long,ParamArray values() As Variant) As Variant
 PAValue=values(index)
End Function
Private Function PAHoles(ParamArray values() As Variant) As Boolean
 PAHoles=UBound(values)=3 And values(0)=7 And IsMissing(values(1)) And values(2)=9 And IsEmpty(values(3)) And Not IsMissing(values)
End Function
Private Function PASnapshot(ParamArray values() As Variant) As Variant
 PASnapshot=CStr(values(0)) & "/" & CStr(values(1))
End Function
Private Function PAOrder(ByVal first As Variant,ParamArray values() As Variant) As Variant
 PAOrder=first*100+values(0)*10+values(1)
End Function
Private Sub PAMutate(ParamArray values() As Variant)
 values(0)="private"
End Sub
Private Function PAMutateElement(ParamArray values() As Variant) As Variant
 ChangeByRef values(0)
 PAMutateElement=values(0)
End Function
Private Function PARecursive(ByVal depth As Long,ParamArray values() As Variant) As Variant
 If depth=0 Then
  PARecursive=values(0)
 Else
  PARecursive=PARecursive(depth-1,CStr(values(0)) & ".")
 End If
End Function
Private Function PAPassTyped(ParamArray values() As Variant) As Variant
 PAPassTyped=PATyped(values)
End Function
Private Function PATyped(ByRef values() As Variant) As Variant
 PATyped=CStr(values(0)) & "/" & CStr(values(1))
End Function
Private Function PAFailure() As Variant
 Err.Raise 6
End Function
Private Sub PAThrow(ParamArray values() As Variant)
 values(0)="callee"
 Err.Raise 77
End Sub
`;
export const NATIVE_PARAMARRAY_BASE_MODULE={id:'param-array-base',name:'ParamArrayBase',kind:'module',code:`Option Explicit
Option Base 1
Public Function PAOptionBaseOne() As Boolean
 PAOptionBaseOne=PAInspectBase(5,6)
End Function
Private Function PAInspectBase(ParamArray values() As Variant) As Boolean
 PAInspectBase=LBound(values)=0 And UBound(values)=1 And values(0)=5 And values(1)=6
End Function`};

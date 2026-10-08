/** MS-VBAL 5.3.1.5: ParamArray elements behave as ByRef Variant parameters.
 * These are compiled PE32 assertions, not a JavaScript reference implementation.
 */
export function appendParamArrayReferenceChecks(add,check){
 add('Dim pb As Byte, pi As Integer, pl As Long, ps As String, pa() As Long, savedPA() As Variant');
 add('v="before"\nw=PASnapshot(v,Mutate(v))');check('w="changed/changed" And v="changed"','ParamArray variable observes mutation by a later argument');
 add('v="source"\nPAMutate v');check('v="private"','ParamArray variable element writes the actual Variant owner');
 add('v=7\nw=PAAliases(v,v)');check('v=42 And w=42','two ParamArray variable elements retain live aliases');
 add('pl=7\nw=PAAliases(pl,pl)');check('pl=42 And w=42','two typed ParamArray elements share their true Long referent');
 add('pl=1\nPASet 255,pl');check('pl=255 And VarType(pl)=3','ParamArray typed write preserves Long storage');
 add('PASet 255,pb\nPASet -32768,pi');check('pb=255 And pi=-32768','ParamArray writes preserve one-byte and two-byte storage');
 add('PASet 12.25#,f\nPASet 16777217#,d');check('f=12.25! And d=16777217#','ParamArray references preserve Single and Double storage');
 add('PASet 123.4567@,money\nPASet CDate(42.5),stamp\nPASet True,b');check('money=123.4567@ And CDbl(stamp)=42.5# And b','ParamArray Currency Date and Boolean references retain their types');
 add('ps="A" & ChrW(0) & "B"\nPAAppend ps');check('ps="A" & ChrW(0) & "B!"','ParamArray String write-through owns counted BSTR contents');
 add('pl=5\nPAForward pl');check('pl=18','ParamArray forwarding retains a canonical typed reference');
 add('v="before"\nPAForward v');check('v=18 And VarType(v)=3','ParamArray forwarding updates an ordinary Variant owner');
 add('pl=5\nPAForward (pl)');check('pl=5','parenthesized variable remains isolated through ParamArray forwarding');
 add('pl=5\nPAAliases (pl),(pl)');check('pl=5','separately parenthesized arguments do not alias the original');
 add('On Error Resume Next\nErr.Clear\npb=12\nPASet -1,pb');check('Err.Number=6 And pb=12','failed ParamArray Byte narrowing preserves its referent');
 add('Err.Clear\npi=12\nPASet 32768,pi');check('Err.Number=6 And pi=12','failed ParamArray Integer narrowing preserves its referent');
 add('Err.Clear\npl=73\nPASet "bad",pl');check('Err.Number=13 And pl=73','ParamArray type mismatch is transactional');
 add('Err.Clear\nPASet Null,pl');check('Err.Number=94 And pl=73','ParamArray Null conversion preserves typed caller data');
 add('Err.Clear\nv="caller"\nPAThrow v');check('Err.Number=77 And v="callee"','completed ParamArray write survives a later callee error');
 add('Err.Clear\nOn Error GoTo Unexpected\nReDim pa(-2 To 0)\nsequence=0\nPASet 77,pa(IndexOnce())');check('pa(-2)=77 And sequence=1','ParamArray array element index is evaluated once');
 add('v=PALock(pa,pa(-2))');check('v=10 And pa(-2)=77 And UBound(pa)=0','ParamArray array element stays pinned through the call');
 add('v=PAValue(0,pa(-2))+PAGrow(pa)');check('v=77 And UBound(pa)=1','normal ParamArray return releases pins before the next operand');
 add('On Error Resume Next\nErr.Clear\nv=PAValue(0,pa(-2),PAFailure())');check('Err.Number=6 And pa(-2)=77','failure in a later ParamArray actual preserves pinned referent');
 add('Err.Clear\nOn Error GoTo Unexpected\nReDim Preserve pa(-2 To 2)');check('UBound(pa)=2','failed ParamArray evaluation releases earlier pins');
 add('v="copied" & ChrW(0) & "text"\nPACopy savedPA,v\nv="changed"');check('savedPA(0)="copied" & ChrW(0) & "text" And LBound(savedPA)=0','escaping array copy dereferences live Variant elements');
 add('PACopyLocal savedPA');check('savedPA(0)="local" & ChrW(0) & "value" And savedPA(1)=42','copied ParamArray outlives both local String and local Long');
 add('savedPA(0)="independent"');check('savedPA(0)="independent"','escaped ParamArray copy contains owned values, not borrowed stack addresses');
 add('PACopyForward savedPA');check('savedPA(0)="forwarded" And savedPA(1)=9','copy through an ordinary typed Variant array detaches every borrowed element');
 add('PAEmptyCopy savedPA');check('LBound(savedPA)=0 And UBound(savedPA)=-1','zero-element ParamArray copy preserves empty bounds');
 add('PAResizedCopy savedPA');check('LBound(savedPA)=-1 And UBound(savedPA,2)=1 And savedPA(-1,0)="matrix"','resized multidimensional ParamArray copies retain bounds and values');
 add('For i=1 To 1000\n ps="owner" & CStr(i)\n PAAppend ps\n PACopy savedPA,ps\nNext');check('savedPA(0)="owner1000!" And ps=savedPA(0)','repeated borrowed String packs and escaping copies retain independent ownership');
}
export const NATIVE_PARAMARRAY_REFERENCE_PROCEDURES=`
Private Function PAAliases(ParamArray values() As Variant) As Variant
 values(0)=41
 If values(1)=41 Then
  values(1)=values(1)+1
 End If
 PAAliases=values(0)
End Function
Private Sub PASet(ByVal replacement As Variant,ParamArray values() As Variant)
 values(0)=replacement
End Sub
Private Sub PAAppend(ParamArray values() As Variant)
 values(0)=values(0) & "!"
End Sub
Private Sub PAForward(ParamArray values() As Variant)
 PASet CLng(18),values(0)
End Sub
Private Function PALock(ByRef storage() As Long,ParamArray values() As Variant) As Variant
 On Error Resume Next
 ReDim Preserve storage(-2 To 10)
 PALock=Err.Number
 Err.Clear
End Function
Private Function PAGrow(ByRef storage() As Long) As Variant
 ReDim Preserve storage(-2 To 1)
 PAGrow=0
End Function
Private Sub PACopy(ByRef result() As Variant,ParamArray values() As Variant)
 result=values
End Sub
Private Sub PACopyLocal(ByRef result() As Variant)
 Dim text As String, number As Long
 text="local" & ChrW(0) & "value"
 number=42
 PACopy result,text,number
End Sub
Private Sub PACopyForward(ByRef result() As Variant)
 Dim text As String, number As Long
 text="forwarded":number=9
 PACopyViaTyped result,text,number
End Sub
Private Sub PACopyViaTyped(ByRef result() As Variant,ParamArray values() As Variant)
 PACopyTyped result,values
End Sub
Private Sub PACopyTyped(ByRef result() As Variant,ByRef values() As Variant)
 result=values
End Sub
Private Sub PAEmptyCopy(ByRef result() As Variant,ParamArray values() As Variant)
 result=values
End Sub
Private Sub PAResizedCopy(ByRef result() As Variant,ParamArray values() As Variant)
 ReDim values(-1 To 0,0 To 1)
 values(-1,0)="matrix"
 result=values
End Sub
`;

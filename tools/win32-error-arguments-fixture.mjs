/** Actual x86 error transfers and independently owned, counted error metadata. */
export function nativeErrorArgumentFixture(fixture){
 const {add,check,finish}=fixture('AotControlRichErrors');
 add('Dim source As String,description As String,help As String,n As Long,i As Long,code As Long');
 add('source="Owner." & ChrW$(937)\ndescription="Detail" & ChrW$(0) & String$(8192,"x")\nhelp="help-" & ChrW$(20013) & ".chm"\nOn Error Resume Next');
 add('Err.Raise 513,source,description,help,123');
 check('Err.Number=513 And Err.Source=source And Err.Description=description And Err.HelpFile=help And Err.HelpContext=123','five-argument Raise preserves all counted metadata across statement cleanup');
 add('source="changed"\ndescription="changed"\nhelp="changed"');
 check('Err.Source="Owner." & ChrW$(937) And Len(Err.Description)=8199 And AscW(Mid$(Err.Description,7,1))=0 And Err.HelpFile="help-" & ChrW$(20013) & ".chm"','subsequent assignments cannot mutate the independent Err BSTR owners');
 add('Err.Raise 514');
 check('Err.Number=514 And Left$(Err.Description,6)="Detail" And Err.HelpContext=123','omitted Raise metadata inherits uncleared property values');
 add('Err.Clear');
 check('Err.Number=0 And Err.Source="" And Err.Description="" And Err.HelpFile="" And Err.HelpContext=0','Clear releases owned text and resets the complete error object');
 add('Err.Raise description:="named",number:=515,helpcontext:=7,source:="named source",helpfile:="named.chm"');
 check('Err.Number=515 And Err.Description="named" And Err.Source="named source" And Err.HelpFile="named.chm" And Err.HelpContext=7','named arguments bind to the documented error slots');
 add('Err.Clear\nErr.Raise 5, , "CreateDIBSection failed"');
 check('Err.Number=5 And Err.Source="AotControlRichErrors" And Err.Description="CreateDIBSection failed"','omitted middle arguments used by Win32 Workbench retain custom descriptions');
 add('Err.Clear\nErr.Raise 11');
 check('Err.Number=11 And Err.Description="Division by zero" And Err.Source="AotControlRichErrors"','missing metadata uses the known runtime description and current project ID');
 add('Err.Clear\nErr.Raise 60001');
 check('Err.Description="Application-defined or object-defined error"','unknown user error numbers receive the documented generic description');
 add('Err.Clear\nErr.Raise vbObjectError+513,"Object.Class","negative HRESULT"');
 check('Err.Number=vbObjectError+513 And Err.Source="Object.Class" And Err.Description="negative HRESULT"','object errors retain their complete negative signed Long HRESULT');
 add('Err.Clear\nErr.Source="assigned source"\nErr.Description="assigned detail"\nErr.HelpFile="assigned.chm"\nErr.HelpContext=321\nErr.Number=517');
 check('Err.Number=517 And Err.Source="assigned source" And Err.Description="assigned detail" And Err.HelpFile="assigned.chm" And Err.HelpContext=321','all mutable Err properties round-trip without raising an error');
 add('Err.Raise 518');
 check('Err.Number=518 And Err.Source="assigned source" And Err.Description="assigned detail" And Err.HelpContext=321','Raise inherits explicitly assigned properties until Clear');
 add('Err.Raise 519,"","","",0');
 check('Err.Number=519 And Err.Source="" And Err.Description="" And Err.HelpFile="" And Err.HelpContext=0','explicit empty arguments do not masquerade as omissions');
 add('Err.Clear\nsequence=0\nErr.Raise description:=MarkText("D",1),source:=MarkText("S",2),number:=MarkNumber(520,3),helpcontext:=MarkNumber(9,4),helpfile:=MarkText("H",5)');
 check('sequence=12345 And Err.Number=520 And Err.Source="S" And Err.Description="D" And Err.HelpFile="H" And Err.HelpContext=9','named metadata expressions execute once in authored order');
 add('Err.Clear\nsource="snapshot"\nErr.Raise 521,source,Mutate(source)');
 check('source="changed" And Err.Source="snapshot" And Err.Description="tail"','an earlier text argument is snapshotted before later ByRef mutation');
 add('Err.Clear\n700 Err.Raise 522,"line source","line detail"');
 check('Erl=700 And Err.Number=522 And Err.Source="line source"','rich Raise records the actual numbered VB line');
 add('Err.Clear\nErr.Raise 0');check('Err.Number=5','Raise rejects error number zero');
 add('Err.Clear\nErr.Raise 65536');check('Err.Number=5','Raise rejects positive error numbers outside the VB range');
 add('Err.Clear\nErr.Raise 523, , Null');check('Err.Number=94','Null text metadata raises invalid-use-of-Null instead of publishing partial fields');
 add('Err.Clear\nErr.Raise "524","coerced",True');
 check('Err.Number=524 And Err.Source="coerced" And Err.Description="True"','numeric and text arguments use native Automation coercion');
 add('Err.Clear\nErr.Raise 525,"custom","custom","custom.chm",9\nn=1\ni=0\nn=n\\i');
 check('Err.Number=11 And Err.Description="Division by zero" And Err.Source="Form1" And Err.HelpFile="" And Err.HelpContext=0','ordinary runtime errors replace and release prior rich metadata');
 add('Err.Clear\nOn Error GoTo 0\ncode=CaptureError()');
 check('code=526 And caughtSource="callee" And caughtDescription="propagated" And caughtHelp=88','custom metadata survives callee cleanup and propagates to an outer handler');
 add('On Error Resume Next\nFor i=1 To 500\n Err.Clear\n Err.Raise 527,"cycle" & CStr(i),String$(1024,"x") & CStr(i)\nNext');
 check('Err.Number=527 And Err.Source="cycle500" And Len(Err.Description)=1027','repeated Raise/Clear cycles preserve ownership and the final metadata');
 add('Err.Clear\nErr.Number=0');check('Err.Number=0 And Err.Description=""','assigning Number zero is allowed without raising');
 add('Err.Clear\nOn Error GoTo 0');
 return finish('Private sequence As Long,caughtHelp As Long\nPrivate caughtSource As String,caughtDescription As String',`Private Function MarkText(ByVal text As String,ByVal digit As Long) As String
 sequence=sequence*10+digit
 MarkText=text
End Function
Private Function MarkNumber(ByVal value As Long,ByVal digit As Long) As Long
 sequence=sequence*10+digit
 MarkNumber=value
End Function
Private Function Mutate(ByRef text As String) As String
 text="changed"
 Mutate="tail"
End Function
Private Sub RaiseInCallee()
 Err.Raise 526,"callee","propagated","callee.chm",88
End Sub
Private Function CaptureError() As Long
 On Error GoTo Failed
 RaiseInCallee
 Exit Function
Failed:
 CaptureError=Err.Number
 caughtSource=Err.Source
 caughtDescription=Err.Description
 caughtHelp=Err.HelpContext
 Resume Next
End Function`);
}

import {newProject} from '../src/project/model.js';
/** Counted string library contracts; actual execution is a separate Windows gate. */
export function nativeStringLibraryFixture(){
 const checks=[],body=['Dim s As String,n As Long,i As Long'];
 const add=s=>body.push(s),check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
 check('Trim$("  A  ")="A" And LTrim$("  A  ")="A  " And RTrim$("  A  ")="  A"','trim functions remove only their designated edge spaces');
 check('Len(Trim$("    "))=0 And Len(Trim$(""))=0','all-space and empty BSTR trims return empty strings');
 check('Trim$(vbTab & " X " & vbTab)=vbTab & " X " & vbTab','Trim does not remove tabs or internal spaces');
 add('s=" A" & ChrW(0) & "Z "\ns=Trim$(s)');check('Len(s)=3 And AscW(Mid$(s,2,1))=0 And Right$(s,1)="Z"','trim uses counted BSTR length and retains embedded NUL');
 add('s=StrReverse(s)');check('s="Z" & ChrW(0) & "A" And Len(s)=3','reverse counts code units across embedded NUL');
 check('StrReverse("")="" And StrReverse("ABCD")="DCBA"','reverse handles empty and ordinary strings');
 check('String$(4,"ABC")="AAAA" And String$(3,65)="AAA"','String accepts first-character and ANSI numeric character forms');
 check('String$(2,321)="AA"','String numeric character codes wrap modulo 256');
 add('s=String$(4,ChrW(0))');check('Len(s)=4 And AscW(Right$(s,1))=0','repeated NUL characters have a nonzero counted length');
 check('Len(String$(0,"X"))=0','zero repetition returns empty BSTR');
 check('StrComp("A","a",0)=-1 And StrComp("A","a",1)=0 And VarType(StrComp("a","b"))=2','StrComp returns typed Integer and distinguishes binary/text modes');
 check('StrComp("", "",1)=0 And StrComp("", "A",1)=-1 And StrComp("A", "",1)=1','text comparison handles empty values explicitly');
 check('StrComp("A" & ChrW(0) & "B","A" & ChrW(0) & "C",0)=-1','binary comparison includes text beyond NUL');
 check('InStrRev("abABab","ab")=5 And InStrRev("abABab","ab",4,0)=1 And InStrRev("abABab","ab",4,1)=3','InStrRev respects reverse start/end bounds and explicit text mode');
 check('InStrRev("abcabc","abc",5)=1 And InStrRev("abc","bc",2)=0','reverse matches must end at or before start');
 check('InStrRev("abc","",2)=2 And InStrRev("abc","x",4)=0 And InStrRev("","x")=0','reverse empty needle, beyond-end and empty haystack rules');
 add('s="A" & ChrW(0) & "BA" & ChrW(0)');check('InStrRev(s,ChrW(0))=5','reverse search sees embedded NUL');
 add('sequence=0\nn=StrComp(string2:=Mark("B"),string1:=Mark("A"),compare:=0)');check('sequence=21 And n=-1','named arguments execute in authored order and occupy formal ABI slots');
 check('InStrRev("abcabc","a",,0)=4','omitted positional start uses -1 default');
 add('On Error Resume Next\nErr.Clear\ns=String$(-1,"X")');check('Err.Number=5','negative repeated length raises error 5');
 add('Err.Clear\ns=String$(1048577,"X")');check('Err.Number=7','repeated allocation obeys native BSTR budget');
 add('Err.Clear\nn=StrComp("a","a",2)');check('Err.Number=5','Access-only compare mode is rejected');
 add('Err.Clear\nn=InStrRev("abc","a",0)');check('Err.Number=5','zero reverse-search start is invalid');
 add('Err.Clear\nn=Abs(-32768)');check('Err.Number=6','Abs retains Integer intermediate overflow');
 add('Err.Clear\nOn Error GoTo 0\nFor i=1 To 2000\ns=StrReverse(Trim$(" abc "))\nNext');check('s="cba"','repeated allocating helpers retain per-statement ownership');
 add('ExitProcess 0');
 const project=newProject('AotStringLibrary');project.startup='Sub Main';project.modules=[{id:'m',name:'Entry',kind:'module',code:`Option Explicit
Private sequence As Long
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function Mark(ByVal s As String) As String
 If s="A" Then
  sequence=sequence*10+1
 Else
  sequence=sequence*10+2
 End If
 Mark=s
End Function
Private Sub NeverCalled()
 Dim unused As String
 unused="unreachable"
End Sub
Sub Main()
 ${body.join('\n ')}
End Sub`}];return {project,checks};
}

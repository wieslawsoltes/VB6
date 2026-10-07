import {newProject} from '../../src/project/model.js';
/** Self-checking native semantics, also used by Node compilation/SDK regressions. */
export function nativeLanguageFixture(){
  const checks=[],lines=[],add=s=>lines.push(s);
  const check=(expression,name)=>{checks.push(name);add(`If Not (${expression}) Then ExitProcess ${checks.length}`);};
  add('Dim n As Long, i As Long, s As String, box As BOX\nn=0\nGoSub Outer');
  check('n=111','nested GoSub return order');
  add('n=0\nsequence=0\nOn ChooseOnce() GoSub One, Two');
  check('n=20 And sequence=1','computed GoSub evaluates selector once');
  add('On 0 GoSub One, Two\nOn 3 GoSub One, Two');
  check('n=20','out-of-list selectors fall through without pushing a return');
  add('On 1.5 GoSub One, Two');
  check('n=40','computed selector uses nearest-even numeric conversion');
  add('On Error Resume Next\nErr.Clear\nOn -1 GoTo One, Two');
  check('Err.Number=5','negative computed selector error');
  add('Err.Clear\nOn 256 GoTo One, Two');
  check('Err.Number=5','computed selector upper bound');
  add('Err.Clear\nReturn');
  check('Err.Number=3','Return without GoSub is recoverable');
  add('Err.Clear\nOn Error GoTo 0\nn=0\nOn 2 GoTo GotoOne, GotoTwo\nGotoOne:\nn=1\nGoTo GotoDone\nGotoTwo:\nn=2\nGotoDone:');
  check('n=2','computed GoTo reaches the selected label');
  add('n=0\nDo Until n=4\nn=n+1\nIf n>10 Then ExitProcess 201\nLoop');
  check('n=4','pre-tested Until uses inverted branch polarity');
  add('Do\nn=n+1\nIf n>10 Then ExitProcess 202\nLoop Until n=6');
  check('n=6','post-tested Until uses inverted branch polarity');
  add('Do While n<8\nn=n+1\nLoop\nDo\nn=n-1\nLoop While n>6');
  check('n=6','While polarity is preserved in both loop forms');
  add('sequence=0\nWith box\n.tag=7\nWith .points(IndexOnce())\n.x=40\nCall Bump(.x)\n.y=.x+1\nEnd With\n.tag=.tag+1\nEnd With');
  check('sequence=1 And box.tag=8 And box.points(1).x=41 And box.points(1).y=42','nested With records capture indexed addresses once and preserve ByRef aliases');
  add('Do\nWith box\n.tag=9\nExit Do\nEnd With\nLoop\nWith box\n.tag=.tag+1\nEnd With');
  check('box.tag=10','Exit Do unwinds runtime With captures without losing lexical bindings');
  add('On Error Resume Next\nErr.Clear\nGoTo UnenteredWith\nWith box\nUnenteredWith:\nn=.tag\nEnd With');
  check('Err.Number=91','jump into an unentered With reports an unset binding');
  add('Err.Clear\nn=0\nGoSub Dive');
  check('Err.Number=28 And n=1024','bounded GoSub recursion unwinds its independent return stack');
  add('Err.Clear\nOn Error GoTo 0\nsequence=0\nn=LenB(box.points(IndexOnce()).x)');
  check('n=4 And sequence=1','LenB retains field-index evaluation');
  check('Trim$("  A  ")="A" And LTrim$("  A  ")="A  " And RTrim$("  A  ")="  A"','native trimming sides');
  check('Trim$(" " & vbTab & "A" & vbTab & " ")=vbTab & "A" & vbTab','trim removes spaces rather than all whitespace');
  check('Len(Trim$("   "))=0 And Len(StrReverse(""))=0','empty BSTR results');
  check('StrReverse("A" & ChrW(0) & "B")="B" & ChrW(0) & "A"','reversal preserves embedded NUL code units');
  add('s="Ab" & ChrW(0) & "Cd"');
  check('StrComp(UCase$(s),"AB" & ChrW(0) & "CD",vbBinaryCompare)=0','uppercase maps an explicit BSTR length');
  check('StrComp(LCase$(s),"ab" & ChrW(0) & "cd",vbBinaryCompare)=0','lowercase maps an explicit BSTR length');
  check('StrComp(s,"Ab" & ChrW(0) & "Cd",vbBinaryCompare)=0','case conversion never mutates source ownership');
  check('AscW(LCase$(ChrW(&H17B)))=&H17C','Unicode case mapping delegates to installed Windows');
  check('StrComp("A","a")=0 And StrComp("A","a",vbBinaryCompare)<>0','StrComp honors module default and explicit binary comparison');
  check('StrComp(vbNullString,"",vbTextCompare)=0 And StrComp("","a",1)=-1 And StrComp("a","",1)=1','text comparison handles empty and null BSTRs');
  check('"ABC"="abc" And "ABC"<>"abd"','Option Compare Text applies to native operators');
  check('StrComp("a","A",vbUseCompareOption)=0','vbUseCompareOption resolves in caller scope');
  add('On Error Resume Next\nErr.Clear\nn=StrComp("a","b",2)');
  check('Err.Number=5','unsupported compare mode remains a runtime error');
  add('Err.Clear\nOn Error GoTo 0');
  check('StraightLine()=24 And JoinBranch(0)=11 And JoinBranch(1)=13 And AliasBarrier()=9','local constant propagation respects branches and aliases');
  add('For i=1 To 1000\ns=UCase$(StrReverse(Trim$(" AbCd ")))\nNext');
  check('StrComp(s,"DCBA",0)=0','nested String results retain ownership through repeated calls');
  add('ExitProcess 0\nOuter:\nn=n+1\nGoSub Inner\nn=n+10\nReturn\nInner:\nn=n+100\nReturn\nOne:\nn=n+10\nReturn\nTwo:\nn=n+20\nReturn\nDive:\nn=n+1\nIf n<2048 Then GoSub Dive\nReturn');
  const project=newProject('AotLanguage');project.startup='Sub Main';
  project.modules=[{id:'language',name:'Language',kind:'module',code:`Option Explicit
Option Compare Text
Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Type BOX
 tag As Long
 points(0 To 2) As POINTAPI
End Type
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private sequence As Long
Private Function ChooseOnce() As Long
 sequence=sequence+1
 ChooseOnce=2
End Function
Private Function IndexOnce() As Long
 sequence=sequence+1
 IndexOnce=1
End Function
Private Sub Bump(n As Long)
 n=n+1
End Sub
Private Function StraightLine() As Long
 Dim a As Long, b As Long, c As Long
 a=7
 b=5
 c=(a+b)*(a-b)
 StraightLine=c
End Function
Private Function JoinBranch(ByVal selector As Long) As Long
 Dim a As Long
 If selector=0 Then
 a=11
 Else
 a=13
 End If
 JoinBranch=a
End Function
Private Function AliasBarrier() As Long
 Dim a As Long
 a=8
 Bump a
 AliasBarrier=a
End Function
Public Sub Main()
${lines.join('\n')}
End Sub
`}];return {project,checks};
}

import {extendNativeFormatFixture} from './win32-format-intrinsics-fixture.mjs';
import {extendNativeStringArrayFixture,nativeStringArrayPolicyModule} from './win32-string-array-fixtures.mjs';
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

 // These assertions execute in the existing O0/O1/O2 and O2-pruned Windows
 // fixture matrix. They are not JS emulation of the generated machine code.
 check('Replace("abcabc","ab","X")="XcXc"','Replace emits all non-overlapping substitutions');
 check('Replace$("aaaaa","aa","X")="XXa"','Replace advances by the complete matched substring');
 check('Replace("abcabc","a","XYZ",1,1)="XYZbcabc"','Replace count caps the number of substitutions');
 check('Replace("abcabc","a","",1,-1)="bcbc"','Replace accepts an empty replacement');
 check('Replace("abcabc","a","X",3)="cXbc"','Replace returns the suffix beginning at start');
 check('Replace("abc","","X",2)="bc" And Replace("abc","b","X",2,0)="bc"','empty find and zero count retain the selected suffix');
 check('Replace("","a","b")="" And Replace("abc","a","b",4)=""','empty or past-end replacement source');
 check('Replace("abc","abcd","X")="abc" And Replace("abc","z","X")="abc"','unmatched searches copy the original suffix');
 check('Replace("aAa","a","X",1,-1,0)="XAX" And Replace("aAa","a","X",1,-1,1)="XXX"','Replace binary and Windows NLS text modes');
 check('Replace("abcabc","a","X",,1,)="Xbcabc"','Replace omitted trailing and interior defaults');
 add('s="a" & ChrW(0) & "ba" & ChrW(0)\ns=Replace(s,ChrW(0),"XY")');
 check('s="aXYbaXY" And Len(s)=7','Replace finds text after and including embedded NUL');
 add('s=Replace("ababa","b",ChrW(0))');check('Len(s)=5 And AscW(Mid$(s,2,1))=0 And Right$(s,1)="a"','Replace retains NUL replacement code units');
 check('Replace(ChrW(&HD800) & "X" & ChrW(&HDC00),"X",ChrW(0))=ChrW(&HD800) & ChrW(0) & ChrW(&HDC00)','binary Replace operates on UTF-16 units without surrogate rewriting');
 add('sequence=0\ns=Replace(replace:=Mark("B"),find:=Mark("A"),expression:=Mark("A"))');
 check('sequence=211 And s="B"','Replace named arguments retain source evaluation order');
 add('sequence=0\nn=InStr(string2:=Mark("B"),string1:=Mark("A"))');
 check('sequence=21 And n=0','InStr named arguments retain source evaluation order');
 check('InStr(start:=2,string1:="aBc",string2:="b",compare:=1)=2 And InStr(,"abc","b")=2','InStr formal names and explicit omitted start');
 add('s="abcabc"\ns=Replace(s,"a",MutateSource(s))');check('s="XbcXbc"','Replace snapshots earlier inputs before a later ByRef mutation');
 add('s="abc"\nn=InStr(s,MutateSource(s))');check('n=0 And s="changed"','InStr snapshots its source before a later ByRef mutation');
 add('On Error Resume Next\nErr.Clear\ns=Replace("abc","a","b",0)');check('Err.Number=5','invalid Replace start is recoverable');
 add('Err.Clear\ns=Replace("abc","a","b",1,-2)');check('Err.Number=5','invalid Replace count is recoverable');
 add('Err.Clear\ns=Replace("abc","a","b",1,-1,2)');check('Err.Number=5','unsupported Replace compare is recoverable');
 add('Err.Clear\ns="unchanged"\ns=Replace(String$(524289,"a"),"a","bb")');check('Err.Number=7 And s="unchanged"','Replace checks final output budget before assignment');
 add('Err.Clear\nOn Error GoTo 0\ns=Replace(String$(524288,"a"),"a","bb")');check('Len(s)=1048576 And Left$(s,1)="b" And Right$(s,1)="b"','Replace accepts the exact native BSTR length budget');
 add('For i=1 To 1000\ns=Replace(Replace("aabbaabb","aa","X"),"bb","Y")\nNext');check('s="XYXY"','nested replacement ownership survives repeated allocations');
 check('TextPolicy()="XXa" And TextSearch()=2','caller Option Compare and explicit binary overrides are kept across modules');
 extendNativeFormatFixture({add,check});
 const arrays=extendNativeStringArrayFixture({add,check});
 add('ExitProcess 0');
 const project=newProject('AotStringLibrary');project.startup='Sub Main';project.modules=[{id:'m',name:'Entry',kind:'module',code:`Option Explicit
Private sequence As Long
${arrays.declarations}
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function Mark(ByVal s As String) As String
 If s="A" Then
  sequence=sequence*10+1
 Else
  sequence=sequence*10+2
 End If
 Mark=s
End Function
Private Function MutateSource(ByRef source As String) As String
 source="changed"
 MutateSource="X"
End Function
${arrays.handlers}
Private Sub NeverCalled()
 Dim unused As String
 unused="unreachable"
End Sub
Sub Main()
 ${body.join('\n ')}
End Sub`},{id:'text',name:'TextPolicyModule',kind:'module',code:`Option Compare Text
Public Function TextPolicy() As String
 TextPolicy=Replace("aA","a","X") & Replace("Aa","A","",1,-1,0)
End Function
Public Function TextSearch() As Long
 TextSearch=InStr(string1:="AB",string2:="b")
End Function`},nativeStringArrayPolicyModule];return {project,checks};
}

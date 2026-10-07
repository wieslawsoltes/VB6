/** Authored, self-checking native-language regression. Windows execution, not
 * successful compilation, establishes runtime validity for this fixture. */
import {newProject} from '../src/project/model.js';
export function nativeLanguageFixture(){
 const checks=[],body=[];const add=s=>body.push(s),check=(condition,label)=>{checks.push(label);add(`If Not (${condition}) Then ExitProcess ${checks.length}`);};
 add('Dim n As Long, i As Integer, a As Byte, b As Byte, p As POINTAPI, box As BOX\nn=1\nGoSub First');
 check('n=7','nested GoSub returns in LIFO order without losing the caller');
 add('On 2 GoSub One,Two');check('n=27','computed GoSub returns to the following statement');
 add('On 0 GoSub One,Two\nOn 3 GoSub One,Two');check('n=27','computed out-of-list and zero selectors fall through');
 add('On 2 GoTo Wrong,Selected\nWrong:\nExitProcess 200\nSelected:');
 add('On Error Resume Next\nErr.Clear\nOn -1 GoTo Wrong\nn=Err.Number');check('n=5','negative computed selector raises error 5 and resumes after the branch');
 add('Err.Clear\nOn 256 GoSub One,Two\nn=Err.Number');check('n=5','computed selectors above 255 raise error 5 without pushing a continuation');
 add('Err.Clear\nReturn\nn=Err.Number');check('n=3','Return without GoSub is error 3, not a native RET');
 add('Err.Clear\nGoSub RecoverInside');check('n=41 And Err.Number=11','GoSub continuation survives Resume Next expression-stack restoration');
 add('Err.Clear\nn=10\nn=2000*365');check('Err.Number=6 And n=10','Integer literal multiplication overflows before assignment to Long');
 add('Err.Clear\nn=2000&*365');check('n=730000 And Err.Number=0','explicit Long operand widens arithmetic');
 add('Err.Clear\ni=32767\nn=i+1');check('Err.Number=6 And n=730000','Integer variable arithmetic keeps its intermediate overflow');
 add('Err.Clear\nn=2147483647\nn=(2147483647+1)-1');check('Err.Number=6 And n=2147483647','optimization cannot cancel an overflowing subtree');
 add('Err.Clear\na=255\nb=1\nn=a+b');check('Err.Number=6','Byte arithmetic retains its width');
 add('Err.Clear\nn=Not a');check('n=0','Not Byte masks to eight bits rather than sign-extending');
 add('n=a Eqv b');check('n=1','Byte Eqv uses eight-bit result semantics');
 add('n=-2147483648 Mod -1');check('n=0','Long minimum Mod minus one does not execute a faulting IDIV');
 check('VarType(1)=2 And VarType(1&)=3 And VarType(1!)=4 And VarType(1#)=5','literal type characters survive native VarType');
 check('VarType(-32768)=2 And VarType(-2147483648)=3','signed literal endpoints keep VB inference');
 add('On Error GoTo 0\ni=0\nDo\ni=i+1\nLoop Until i=3');check('i=3','Until branch inversion is respected');
 add('p.x=7\np.y=8\nWith p\n .x=.x+2\n .y=.x+1\nEnd With');check('p.x=9 And p.y=10','With record writes alias original storage');
 add('sequence=0\nWith box.points(IndexOnce())\n .x=123\n .y=.x+1\nEnd With');check('sequence=1 And box.points(1).x=123 And box.points(1).y=124','With indexed record evaluates subscript once');
 add('With box\n With .points(0)\n  .x=19\n End With\n .tag=20\nEnd With');check('box.points(0).x=19 And box.tag=20','nested record With restores outer lexical binding');
 add('Do\n With p\n  .x=33\n  Exit Do\n End With\nLoop\nWith p\n .y=34\nEnd With');check('p.x=33 And p.y=34','early loop exit unwinds runtime With state without changing lexical lowering');
 add('On Error Resume Next\nErr.Clear\nGoTo Unentered\nWith p\nUnentered:\n .x=99\nEnd With');check('Err.Number=91 And p.x=33','jumping into an unentered With is diagnosed before dereferencing storage');
 add('Err.Clear\nOn Error GoTo Handler\nGoSub Throwing');check('n=55','Resume Next from a handler returns through the preserved GoSub continuation');
 add('ExitProcess 0\nHandler:\n Resume Next\nFirst:\n n=n+1\n GoSub Second\n n=n+3\n Return\nSecond:\n n=n+2\n Return\nOne:\n n=n+10\n Return\nTwo:\n n=n+20\n Return\nRecoverInside:\n n=1\\0\n n=41\n Return\nThrowing:\n n=1\\0\n n=55\n Return');
 const project=newProject('AotContinuationLanguage');project.startup='Sub Main';project.modules=[{id:'m',name:'Entry',kind:'module',code:`Option Explicit
Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Type BOX
 tag As Long
 points(0 To 1) As POINTAPI
End Type
Private sequence As Long
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function IndexOnce() As Long
 sequence=sequence+1
 IndexOnce=1
End Function
Private Sub NeverCalled()
 Dim n As Long
 n=123
End Sub
Sub Main()
 ${body.join('\n ')}
End Sub`}];return {project,checks};
}

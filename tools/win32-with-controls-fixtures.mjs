import {newProject,createControl} from '../src/project/model.js';
/** Self-checking real HWND/With fixture. No user input is needed. */
export function nativeWithControlsFixture(){
 const project=newProject('AotWithControls'),form=project.modules[0],checks=[],body=[];
 const add=s=>body.push(s),check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
 const button=createControl('CommandButton','Button'),a=createControl('CommandButton','Item'),b=createControl('CommandButton','Item');
 a.properties.Index=2;b.properties.Index=4;form.form.controls=[button,a,b];
 add('Dim n As Long\nWith Me\n .Caption="With form"\nEnd With');check('Me.Caption="With form"','With form captures the existing default instance');
 add('With Button\n .Caption="outer"\n With Me\n  .Caption="nested"\n End With\n .Caption=.Caption & " restored"\nEnd With');check('Button.Caption="outer restored" And Me.Caption="nested"','nested form/control With restores the outer binding');
 add('sequence=0\nWith Item(ChooseIndex())\n .Caption="indexed"\n n=.Index\n .Enabled=True\nEnd With');check('sequence=1 And n=4 And Item(4).Caption="indexed" And Item(2).Caption<>"indexed"','indexed With evaluates selector once and keeps the captured Index');
 add('On Error Resume Next\nErr.Clear\nGoTo Unentered\nWith Button\nUnentered:\n .Caption="invalid"\nEnd With');check('Err.Number=91 And Button.Caption="outer restored"','jump into an unentered control With fails without mutating the control');
 add('Err.Clear\nOn Error GoTo 0\nExitProcess 0');
 form.code=`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private sequence As Long
Private Function ChooseIndex() As Integer
 sequence=sequence+1
 ChooseIndex=4
End Function
Private Sub Form_Load()
 ${body.join('\n ')}
End Sub`;
 return {project,checks};
}

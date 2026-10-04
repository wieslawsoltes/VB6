import fs from 'node:fs';
import { newProject, createForm, createControl } from '../src/project/model.js';
const p = newProject('NativeSmoke');
p.settings.renderer = 'auto';
p.modules[0].code = `Option Explicit
Public RejectClose As Boolean
Public ResizeCount As Long
Private Sub Form_Load()
    RejectClose = True
    Me.Line (5, 5)-(60, 40), vbRed, BF
End Sub
Private Sub Command1_Click()
    Text1.Text = "Native event OK"
End Sub
Private Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)
    If RejectClose Then Cancel = 1
End Sub
Private Sub Form_Resize()
    ResizeCount = ResizeCount + 1
End Sub
`;
p.modules[0].form.controls.push(createControl('CommandButton', 'Command1'), createControl('TextBox', 'Text1', 300, 1000));
p.modules.push(createForm('Form2', 'Second native window'));
fs.mkdirSync('validation', { recursive: true });
fs.writeFileSync('validation/NativeSmoke.vb6web', JSON.stringify(p, null, 2));

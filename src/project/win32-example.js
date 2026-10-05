import {newProject,createForm,createControl} from './model.js';
/** Ordinary Declare statements; the exporter embeds the same reusable package. */
export function win32Example(){
  const p=newProject('Win32Workbench'),form=createForm('frmWin32','Win32 API Workbench');p.modules=[form];p.startup='frmWin32';p.description='Browser Win32 Declare APIs: handles, messages, timing, INI files, memory and GDI.';
  Object.assign(form.form.properties,{ClientWidth:7800,ClientHeight:4800});
  const c=(type,name,x,y,w,h,properties)=>{const control=createControl(type,name,x*15,y*15);Object.assign(control.properties,{Width:w*15,Height:h*15,...properties});return control;};
  form.form.controls=[c('Label','lblTitle',16,16,488,24,{Caption:'Win32 APIs in a browser',FontBold:-1,FontSize:12}),c('TextBox','txtValue',16,56,488,24,{Text:'',BackColor:16777215}),c('CommandButton','cmdText',16,96,152,28,{Caption:'SetWindowText'}),c('CommandButton','cmdToggle',184,96,152,28,{Caption:'EnableWindow'}),c('CommandButton','cmdDraw',352,96,152,28,{Caption:'GDI drawing'}),c('PictureBox','picCanvas',16,144,488,104,{BackColor:16777215}),c('Label','lblStatus',16,264,488,36,{Caption:'Starting compatibility process...',WordWrap:-1})];
  form.code=`Option Explicit
Private Declare Function GetTickCount Lib "kernel32" () As Long
Private Declare Function IsWindow Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function EnableWindow Lib "user32" (ByVal hwnd As Long, ByVal enabled As Long) As Long
Private Declare Function IsWindowEnabled Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function SetWindowText Lib "user32" Alias "SetWindowTextA" (ByVal hwnd As Long, ByVal value As String) As Long
Private Declare Function WriteIni Lib "kernel32" Alias "WritePrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal value As String, ByVal file As String) As Long
Private Declare Function ReadIni Lib "kernel32" Alias "GetPrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal def As String, ByVal buffer As String, ByVal size As Long, ByVal file As String) As Long
Private Declare Function GetDC Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function ReleaseDC Lib "user32" (ByVal hwnd As Long, ByVal dc As Long) As Long
Private Declare Function CreateSolidBrush Lib "gdi32" (ByVal color As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long, ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function Rectangle Lib "gdi32" (ByVal dc As Long, ByVal left As Long, ByVal top As Long, ByVal right As Long, ByVal bottom As Long) As Long
Private Sub Form_Load()
    Dim buffer As String, count As Long
    WriteIni "Demo", "Message", "Hello from kernel32 and user32!", "win32-demo.ini"
    buffer = String$(128, 0)
    count = ReadIni("Demo", "Message", "", buffer, Len(buffer), "win32-demo.ini")
    txtValue.Text = Left$(buffer, count)
    lblStatus.Caption = "Ready. hWnd=" & CStr(Me.hWnd) & " | Valid=" & CStr(IsWindow(Me.hWnd)) & " | Tick=" & CStr(GetTickCount())
    Debug.Print "Win32 Workbench ready"
End Sub
Private Sub cmdText_Click()
    SetWindowText txtValue.hWnd, "Text changed by user32.SetWindowTextA"
End Sub
Private Sub cmdToggle_Click()
    EnableWindow txtValue.hWnd, 1 - IsWindowEnabled(txtValue.hWnd)
End Sub
Private Sub cmdDraw_Click()
    Dim dc As Long, brush As Long, oldBrush As Long
    dc = GetDC(picCanvas.hWnd)
    brush = CreateSolidBrush(RGB(70, 130, 180))
    oldBrush = SelectObject(dc, brush)
    Rectangle dc, 12, 12, 476, 92
    SelectObject dc, oldBrush
    DeleteObject brush
    ReleaseDC picCanvas.hWnd, dc
    lblStatus.Caption = "GDI drawing uses the existing WebGPU / Canvas2D surface."
End Sub
`;
  return p;
}

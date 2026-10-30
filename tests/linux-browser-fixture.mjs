/** Shared by browser export and native execution; its bytes are reproducible. */
export function linuxBrowserProject(architecture='x64',toolkit='gtk3') {
  if(!['x64','arm64'].includes(architecture))throw new Error('Unknown Linux fixture architecture');
  if(!['gtk3','gtk4'].includes(toolkit))throw new Error('Unknown Linux fixture toolkit');
  return {schema: 1, id: 'linux-browser-project', name: 'LinuxBrowser', startup: 'Sub Main', modules: [{
    id: 'linux-browser-main', name: 'MainModule', kind: 'module', code: `Option Explicit
Public Sub Main()
#If Linux And (Win32 = 0) And (Mac = 0) And ${toolkit==='gtk4'?'GTK4 And (GTK3 = 0)':'GTK3 And (GTK4 = 0)'} And ${architecture==='arm64'?'ARM64 And (X86_64 = 0)':'X86_64 And (ARM64 = 0)'} Then
    Dim values(1 To 3) As Long
    Dim i As Long, total As Long
    For i = 1 To 3
        values(i) = i * i
        total = total + values(i)
    Next i
    Debug.Assert total = 14
    Dim amount As Currency
    amount = 0.1@ + 0.2@
    Debug.Assert amount = 0.3@
    Debug.Assert Len("Zażółć") = 6
    Debug.Print "LINUX_BROWSER_AOT_OK"
#Else
    Error 5
#End If
End Sub`
  }]};
}

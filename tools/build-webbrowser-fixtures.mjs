import fs from 'node:fs';
import {exportApplication,exportApplicationFiles} from '../src/exporter/exporter.js';
import {webBrowserExample} from '../src/project/webbrowser-example.js';
const directory=new URL('../reports/webbrowser/fixtures/',import.meta.url);fs.mkdirSync(directory,{recursive:true});
const project=webBrowserExample(),module=project.modules[0];
module.code=module.code.replace('Option Explicit','Option Explicit\nPrivate CancelNext As Boolean\nPrivate SavedDocument As Object\nPrivate Completions As Long\nPrivate PopupCount As Long');
module.code=module.code.replace('    Dim item As Object','    Completions = Completions + 1\n    Dim item As Object');
module.code=module.code.replace('    Cancel = True','    PopupCount = PopupCount + 1\n    Cancel = True');
module.code+=`
Private Sub WebBrowser1_BeforeNavigate2(ByVal pDisp As Object, ByRef URL As Variant, ByRef Flags As Variant, ByRef TargetFrameName As Variant, ByRef PostData As Variant, ByRef Headers As Variant, ByRef Cancel As Boolean)
    If CancelNext Then
        Cancel = True
        CancelNext = False
    End If
End Sub
Public Sub CancelNavigation()
    CancelNext = True
End Sub
Public Function CompletionCount() As Long
    CompletionCount = Completions
End Function
Public Function Popups() As Long
    Popups = PopupCount
End Function
Public Sub SaveDocument()
    Set SavedDocument = WebBrowser1.Document
End Sub
Public Function StaleDocumentError() As Long
    On Error GoTo Failed
    Dim s As String
    s = SavedDocument.Title
    Exit Function
Failed:
    StaleDocumentError = Err.Number
End Function
Public Function DOMProbe() As String
    Dim d As Object, item As Object, count As Long
    Set d = WebBrowser1.Document
    d.Open
    d.Write "<title>Written HTML5</title><p id='answer'>Before</p><p name='named'>Two</p><input id='flag' type='checkbox'><script>window.domRuns=41+1;</script>"
    d.Close
    d.GetElementById("answer").InnerText = "After"
    d.GetElementById("flag").Checked = True
    For Each item In d.GetElementsByTagName("p")
        count = count + 1
    Next item
    DOMProbe = d.Title & "|" & d.All("answer").InnerText & "|" & count & "|" & VarType(d.GetElementById("flag").Checked) & "|" & WebBrowser1.ExecuteScript("Promise.resolve(window.domRuns)")
End Function
Public Function Dimensions() As String
    Dim x As Long, y As Long, zoom As Variant
    x = 200: y = 100
    WebBrowser1.ClientToWindow x, y
    WebBrowser1.ExecWB OLECMDID_OPTICAL_ZOOM, OLECMDEXECOPT_DODEFAULT, 125, zoom
    Dimensions = x & "|" & y & "|" & zoom
End Function
`;
fs.writeFileSync(new URL('inline.html',directory),exportApplication(project,{persist:false,nativeWindows:false}));
const split=new URL('split/',directory);fs.mkdirSync(split,{recursive:true});for(const [name,content]of Object.entries(exportApplicationFiles(project,{persist:false,nativeWindows:false}).files))fs.writeFileSync(new URL(name,split),content);
fs.writeFileSync(new URL('project.json',directory),JSON.stringify(project));
console.log('Built HTML5 WebBrowser source/inline/split integration fixtures.');

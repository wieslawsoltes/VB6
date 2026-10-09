import {newProject,createForm,createControl} from './model.js';

export const WEB_BROWSER_SAMPLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HTML5 in VB6</title><style>
body{margin:0;padding:28px;font:16px/1.5 system-ui,sans-serif;background:#f4f7fb;color:#18283a}h1{margin:0;font-size:30px}small{letter-spacing:.1em;color:#456078}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}.card{padding:18px;border:1px solid #cad7e4;border-radius:12px;background:white}canvas{width:100%;height:120px}button,input{font:inherit}button{padding:6px 16px}#status{font-size:14px;color:#294d36}a{color:#225eab}@media(max-width:500px){.grid{grid-template-columns:1fr}}
</style></head><body><small>CLASSIC VB6 API · MODERN RENDERING</small><h1>HTML5 WebBrowser</h1><p id="status">Waiting for the VB6 DocumentComplete handler…</p><div class="grid"><section class="card"><b>Canvas and JavaScript</b><canvas id="chart" width="420" height="120"></canvas><button id="counter" onclick="this.textContent='Clicks: '+(++window.count)">Clicks: 0</button></section><section class="card"><b>Native HTML controls</b><p><label>Name <input id="name" value="Visual Basic"></label></p><input type="range" aria-label="Range"><p><a href="#details">Same-document navigation</a></p><p><a href="https://example.com/">External website</a></p></section></div><details id="details"><summary>What is running?</summary>This page is rendered by the host browser, in its own sandboxed document. VB6 can address the document through the WebBrowser control.</details><script>window.count=0;const c=document.getElementById('chart').getContext('2d');[42,74,59,98,82,110].forEach((h,i)=>{c.fillStyle=['#356fa5','#429887'][i%2];c.fillRect(15+i*65,120-h,42,h)});</script></body></html>`;

export function webBrowserExample(){
  const project=newProject('HTML5Browser');const form=createForm('BrowserForm');project.modules=[form];project.startup=form.name;
  Object.assign(form.form.properties,{Caption:'WebBrowser — classic API, HTML5 engine',ClientWidth:9720,ClientHeight:7380,Width:9720,Height:7380});
  const add=(type,name,left,top,width,height,properties={})=>{const control=createControl(type,name,left,top);Object.assign(control.properties,{Width:width,Height:height,...properties});form.form.controls.push(control);return control;};
  add('CommandButton','cmdBack',120,120,900,375,{Caption:'&Back',Enabled:0});
  add('CommandButton','cmdForward',1080,120,990,375,{Caption:'&Forward',Enabled:0});
  add('CommandButton','cmdRefresh',2130,120,990,375,{Caption:'&Refresh'});
  add('CommandButton','cmdStop',3180,120,840,375,{Caption:'&Stop'});
  add('CommandButton','cmdHTML',4080,120,990,375,{Caption:'&HTML5'});
  add('TextBox','txtURL',5130,120,3420,375,{Text:'https://example.com/'});
  add('CommandButton','cmdGo',8610,120,960,375,{Caption:'&Go'});
  add('WebBrowser','WebBrowser1',120,600,9450,6060);
  add('Label','lblStatus',120,6780,9450,420,{Caption:'Ready',BackStyle:0});
  const html=WEB_BROWSER_SAMPLE_HTML.replace(/\r?\n/g,'').replace(/"/g,'""');
  form.code=`Option Explicit
Private Sub Form_Load()
    ShowHTML
End Sub
Private Sub ShowHTML()
    WebBrowser1.NavigateToString "${html}"
End Sub
Private Sub cmdHTML_Click()
    ShowHTML
End Sub
Private Sub cmdBack_Click()
    If WebBrowser1.CanGoBack Then WebBrowser1.GoBack
End Sub
Private Sub cmdForward_Click()
    If WebBrowser1.CanGoForward Then WebBrowser1.GoForward
End Sub
Private Sub cmdRefresh_Click()
    WebBrowser1.Refresh
End Sub
Private Sub cmdStop_Click()
    WebBrowser1.Stop
End Sub
Private Sub cmdGo_Click()
    On Error GoTo Failed
    WebBrowser1.Navigate txtURL.Text
    Exit Sub
Failed:
    lblStatus.Caption = Err.Description
End Sub
Private Sub WebBrowser1_CommandStateChange(ByVal Command As Long, ByVal Enable As Boolean)
    If Command = CSC_NAVIGATEBACK Then cmdBack.Enabled = Enable
    If Command = CSC_NAVIGATEFORWARD Then cmdForward.Enabled = Enable
End Sub
Private Sub WebBrowser1_DocumentComplete(ByVal pDisp As Object, ByRef URL As Variant)
    Dim item As Object
    lblStatus.Caption = WebBrowser1.NavigationStatus & " | " & WebBrowser1.LocationURL
    If WebBrowser1.DocumentAvailable Then
        Set item = WebBrowser1.Document.GetElementById("status")
        If Not item Is Nothing Then item.InnerText = "Updated from VB6 through Document.GetElementById."
    End If
End Sub
Private Sub WebBrowser1_TitleChange(ByVal Text As String)
    Me.Caption = "WebBrowser — " & Text
End Sub
Private Sub WebBrowser1_StatusTextChange(ByVal Text As String)
    lblStatus.Caption = Text
End Sub
Private Sub WebBrowser1_NewWindow2(ByRef ppDisp As Object, ByRef Cancel As Boolean)
    Cancel = True
    lblStatus.Caption = "Popup cancelled by the VB6 event handler."
End Sub
`;
  return project;
}
export const WEB_BROWSER_EXAMPLE={id:'webbrowser-html5',name:'HTML5 WebBrowser',description:'Classic navigation/events, isolated DOM automation, HTML5 Canvas, forms and JavaScript.',create:webBrowserExample};

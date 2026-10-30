import {newProject,createControl} from './model.js';

export function oleDocumentExample(){
  const project=newProject('OLEDocuments'),module=project.modules[0],form=module.form;
  project.description='Portable embedded and linked documents. HTML export supports text, RTF, raster images and byte-preserving file packages.';
  Object.assign(form.properties,{Caption:'OLE Document Workbench',ClientWidth:9600,ClientHeight:6300});
  const add=(type,name,left,top,width,height,properties={})=>{const control=createControl(type,name,left,top);Object.assign(control.properties,{Width:width,Height:height,...properties});form.controls.push(control);};
  add('OLE','Document1',180,180,9240,4680,{SizeMode:3});
  add('CommandButton','cmdText',180,5010,1380,420,{Caption:'&Text'});
  add('CommandButton','cmdRich',1680,5010,1380,420,{Caption:'&Rich text'});
  add('CommandButton','cmdInsert',3180,5010,1380,420,{Caption:'&Insert file'});
  add('CommandButton','cmdLink',4680,5010,1380,420,{Caption:'&Link note'});
  add('CommandButton','cmdSave',6180,5010,1380,420,{Caption:'&Save to disk'});
  add('CommandButton','cmdExport',7680,5010,1740,420,{Caption:'&Export download'});
  add('Label','lblStatus',180,5580,9240,510,{Caption:'Double-click a document to edit. Use the document menu for link update/save and deletion.'});
  project.vfs.files['/note.txt']='This note is on the private application disk.\r\nLink it, edit it and choose Save to source in the document menu.';
  module.code=`Option Explicit
Private Sub Form_Load()
    Document1.CreateEmbed "", "VB6.RichTextDocument"
    Document1.Object.Text = "OLE documents are ready." & vbCrLf & "Try text, rich text, image or file embedding. Export download saves the real bytes to your computer."
End Sub
Private Sub cmdText_Click()
    Document1.CreateEmbed "", "VB6.TextDocument"
    Document1.DoVerb
End Sub
Private Sub cmdRich_Click()
    Document1.CreateEmbed "", "VB6.RichTextDocument"
    Document1.DoVerb
End Sub
Private Sub cmdInsert_Click()
    Document1.InsertObjDlg
End Sub
Private Sub cmdLink_Click()
    Document1.CreateLink "/note.txt"
    Document1.DoVerb
End Sub
Private Sub cmdSave_Click()
    On Error GoTo Failed
    Document1.SaveDocument "/saved-document.dat"
    lblStatus.Caption = "Saved exact document bytes to /saved-document.dat in the application disk. Export download saves them to your computer."
    Exit Sub
Failed:
    lblStatus.Caption = Err.Description
End Sub
Private Sub cmdExport_Click()
    Document1.ExportDocument
End Sub
Private Sub Document1_Updated(ByVal Code As Integer)
    lblStatus.Caption = "Document type: " & CStr(Document1.OLEType) & " | Class: " & Document1.Class
End Sub
`;
  return project;
}
export const OLE_DOCUMENT_EXAMPLE={id:'ole-documents',name:'OLE Document Workbench',description:'Embed and edit text/RTF, display images, link private-disk files, persist objects and export exact bytes. Browser document servers; no native COM activation.',create:oleDocumentExample};

import {WIN32_SERVICE_EXAMPLES} from './win32-service-examples.js';
import {win32Example} from './win32-example.js';
import {DATA_EXAMPLES} from './data-examples.js';
import { newProject, createForm, createControl, newId } from './model.js';
import {setResourceString, setResource} from './res.js';
function c(type,name,x,y,w,h,props={},parent=null){const node=createControl(type,name,x*15,y*15);Object.assign(node.properties,{Width:w*15,Height:h*15,...props});node.parent=parent;return node;}
function formProject(name,formName,caption,width,height){const p=newProject(name),form=createForm(formName,caption);form.form.properties.ClientWidth=width*15;form.form.properties.ClientHeight=height*15;p.modules=[form];p.startup=formName;return {p,form};}
export function orderEntryExample(){const {p,form}=formProject('Project1','frmOrders','Order Entry',648,446);p.description='Classic order-entry form with real VB event handlers, control properties, private file I/O and persistence.';
  form.form.controls=[
    c('Label','lblTitle',20,16,420,28,{Caption:'Northwind Traders',FontSize:16,FontBold:-1,ForeColor:8388608}),
    c('Label','lblSubtitle',21,47,570,16,{Caption:'Order entry  ·  Sales and customer services',ForeColor:4210752}),
    c('Frame','fraCustomer',20,76,608,78,{Caption:'Customer information'}),
    c('Label','lblCustomer',14,25,77,17,{Caption:'&Customer:'},'fraCustomer'),
    c('ComboBox','cboCustomer',94,22,240,23,{Style:2,List:['Alfreds Futterkiste','Around the Horn','Berglunds snabbköp','Bon app’','Eastern Connection'],ListIndex:0},'fraCustomer'),
    c('Label','lblOrderNo',358,26,74,17,{Caption:'Order &number:'},'fraCustomer'),
    c('TextBox','txtOrderNo',442,22,146,22,{Text:'1001',BackColor:16777215},'fraCustomer'),
    c('Label','lblTerms',14,53,560,16,{Caption:'Payment terms: Net 30     |     Shipping: Standard delivery',ForeColor:4210752},'fraCustomer'),
    c('Label','lblItems',20,171,300,16,{Caption:'Order &items:',FontBold:-1}),
    c('ListBox','lstItems',20,192,404,145,{List:['Chai  ×  2                            $36.00','Chang  ×  1                         $19.00','Aniseed Syrup  ×  3              $30.00','Chef Anton’s Seasoning  ×  1   $22.00'],ListIndex:0,BackColor:16777215}),
    c('Frame','fraAdd',441,179,187,158,{Caption:'Add an item'}),
    c('Label','lblProduct',12,23,155,15,{Caption:'&Product:'},'fraAdd'),
    c('ComboBox','cboProduct',12,41,163,23,{Style:2,List:['Chai','Chang','Aniseed Syrup','Chef Anton’s Seasoning'],ListIndex:0},'fraAdd'),
    c('Label','lblQty',12,78,86,17,{Caption:'&Quantity:'},'fraAdd'),
    c('TextBox','txtQuantity',104,73,71,23,{Text:'1',Alignment:1,BackColor:16777215},'fraAdd'),
    c('CommandButton','cmdAdd',12,112,163,27,{Caption:'&Add to order',Default:-1},'fraAdd'),
    c('Label','lblTotalCaption',20,350,245,22,{Caption:'Order total:',FontBold:-1}),
    c('Label','lblTotal',285,346,139,26,{Caption:'$107.00',FontSize:14,FontBold:-1,Alignment:1,ForeColor:8388608}),
    c('CheckBox','chkPriority',441,348,187,22,{Caption:'&Priority handling',Value:0}),
    c('CommandButton','cmdRemove',20,388,101,27,{Caption:'&Remove item'}),
    c('CommandButton','cmdNew',130,388,101,27,{Caption:'&New order'}),
    c('CommandButton','cmdSave',441,388,91,27,{Caption:'&Save order'}),
    c('CommandButton','cmdClose',541,388,87,27,{Caption:'&Close',Cancel:-1}),
    c('StatusBar','StatusBar1',0,423,648,23,{SimpleText:'Ready  |  4 items in order',Style:1})
  ];
  form.form.menus=[{id:newId(),name:'mnuFile',type:'Menu',parent:null,properties:{Caption:'&File'}},{id:newId(),name:'mnuNew',type:'Menu',parent:'mnuFile',properties:{Caption:'&New order'}},{id:newId(),name:'mnuSave',type:'Menu',parent:'mnuFile',properties:{Caption:'&Save order'}},{id:newId(),name:'mnuSep',type:'Menu',parent:'mnuFile',properties:{Caption:'-'}},{id:newId(),name:'mnuExit',type:'Menu',parent:'mnuFile',properties:{Caption:'E&xit'}},{id:newId(),name:'mnuHelp',type:'Menu',parent:null,properties:{Caption:'&Help'}},{id:newId(),name:'mnuAbout',type:'Menu',parent:'mnuHelp',properties:{Caption:'&About Order Entry'}}];
  form.code=`Option Explicit

Private orderTotal As Currency

Private Sub Form_Load()
    orderTotal = 107
    lstItems.ItemData(0) = 3600
    lstItems.ItemData(1) = 1900
    lstItems.ItemData(2) = 3000
    lstItems.ItemData(3) = 2200
    UpdateTotal
    Debug.Print "Order Entry is ready."
End Sub

Private Sub cmdAdd_Click()
    Dim quantity As Long
    Dim price As Currency
    quantity = CLng(Val(txtQuantity.Text))
    If quantity < 1 Or quantity > 999 Then
        MsgBox "Enter a quantity between 1 and 999.", vbExclamation, "Order Entry"
        txtQuantity.SetFocus
        Exit Sub
    End If

    Select Case cboProduct.ListIndex
        Case 0
            price = 18
        Case 1
            price = 19
        Case 2
            price = 10
        Case 3
            price = 22
        Case Else
            MsgBox "Select a product first.", vbInformation
            Exit Sub
    End Select

    lstItems.AddItem cboProduct.Text & "  x  " & CStr(quantity) & "     " & Format$(price * quantity, "Currency")
    lstItems.ItemData(lstItems.NewIndex) = CLng(price * quantity * 100)
    orderTotal = orderTotal + price * quantity
    UpdateTotal
End Sub

Private Sub cmdRemove_Click()
    If lstItems.ListIndex < 0 Then
        MsgBox "Select an order item to remove.", vbInformation
        Exit Sub
    End If
    orderTotal = orderTotal - CCur(lstItems.ItemData(lstItems.ListIndex) / 100)
    lstItems.RemoveItem lstItems.ListIndex
    UpdateTotal
End Sub

Private Sub cmdNew_Click()
    lstItems.Clear
    orderTotal = 0
    txtOrderNo.Text = CStr(Val(txtOrderNo.Text) + 1)
    txtQuantity.Text = "1"
    chkPriority.Value = vbUnchecked
    UpdateTotal
End Sub

Private Sub UpdateTotal()
    lblTotal.Caption = Format$(orderTotal, "Currency")
    StatusBar1.SimpleText = "Ready  |  " & CStr(lstItems.ListCount) & " items in order"
End Sub

Private Sub cmdSave_Click()
    On Error GoTo SaveError
    Dim fileNumber As Integer
    Dim i As Long
    fileNumber = FreeFile
    Open "Orders/Order-" & txtOrderNo.Text & ".txt" For Output As #fileNumber
    Print #fileNumber, "NORTHWIND TRADERS"
    Print #fileNumber, "Order: " & txtOrderNo.Text
    Print #fileNumber, "Customer: " & cboCustomer.Text
    For i = 0 To lstItems.ListCount - 1
        Print #fileNumber, lstItems.List(i)
    Next i
    Print #fileNumber, "TOTAL: " & lblTotal.Caption
    Close #fileNumber
    StatusBar1.SimpleText = "Order " & txtOrderNo.Text & " saved."
    MsgBox "The order was saved in this application's private virtual disk.", vbInformation, "Order saved"
    Exit Sub
SaveError:
    MsgBox Err.Description, vbExclamation, "Save error"
End Sub

Private Sub cmdClose_Click()
    Unload Me
End Sub

Private Sub mnuNew_Click()
    cmdNew_Click
End Sub

Private Sub mnuSave_Click()
    cmdSave_Click
End Sub

Private Sub mnuExit_Click()
    Unload Me
End Sub

Private Sub mnuAbout_Click()
    MsgBox "Northwind Traders - Order Entry" & vbCrLf & "Built with VB6 Studio Web.", vbInformation, "About"
End Sub
`;
  p.modules.push({id:newId(),name:'modUtilities',kind:'module',code:`Option Explicit\n\nPublic Function SafeNumber(ByVal text As String) As Double\n    SafeNumber = Val(text)\nEnd Function\n\nPublic Function ApplicationTitle() As String\n    ApplicationTitle = "Northwind Traders"\nEnd Function\n`});return p;
}
export function calculatorExample(){const {p,form}=formProject('Calculator','frmCalculator','Calculator',292,302);form.form.controls=[c('TextBox','txtDisplay',14,14,264,40,{Text:'0',Alignment:1,FontSize:20,BackColor:16777215,Locked:-1})];for(let digit=0;digit<=9;digit++){const pos=digit===0?[0,3]:[(digit-1)%3,2-Math.floor((digit-1)/3)];form.form.controls.push(c('CommandButton','cmdDigit',14+pos[0]*66,68+pos[1]*48,58,40,{Caption:String(digit),FontSize:13,Index:digit}));}for(const [index,caption]of ['+','−','×','÷'].entries())form.form.controls.push(c('CommandButton','cmdOperator',212,68+index*48,66,40,{Caption:caption,FontSize:13,Index:index}));form.form.controls.push(c('CommandButton','cmdDecimal',80,212,58,40,{Caption:'.',FontSize:13}),c('CommandButton','cmdEquals',146,212,58,40,{Caption:'=',FontSize:13,Default:-1}),c('CommandButton','cmdClear',14,265,264,25,{Caption:'Clear',Cancel:-1}));form.code=`Option Explicit
Private firstNumber As Double
Private operation As Integer
Private newNumber As Boolean

Private Sub Form_Load()
    newNumber = True
    operation = -1
End Sub

Private Sub cmdDigit_Click(Index As Integer)
    If newNumber Or txtDisplay.Text = "0" Then
        txtDisplay.Text = CStr(Index)
        newNumber = False
    Else
        txtDisplay.Text = txtDisplay.Text & CStr(Index)
    End If
End Sub

Private Sub cmdDecimal_Click()
    If newNumber Then txtDisplay.Text = "0"
    If InStr(txtDisplay.Text, ".") = 0 Then txtDisplay.Text = txtDisplay.Text & "."
    newNumber = False
End Sub

Private Sub cmdOperator_Click(Index As Integer)
    firstNumber = Val(txtDisplay.Text)
    operation = Index
    newNumber = True
End Sub

Private Sub cmdEquals_Click()
    On Error GoTo CalculateError
    Dim secondNumber As Double
    Dim result As Double
    secondNumber = Val(txtDisplay.Text)
    Select Case operation
        Case 0
            result = firstNumber + secondNumber
        Case 1
            result = firstNumber - secondNumber
        Case 2
            result = firstNumber * secondNumber
        Case 3
            result = firstNumber / secondNumber
        Case Else
            result = secondNumber
    End Select
    txtDisplay.Text = CStr(result)
    newNumber = True
    Exit Sub
CalculateError:
    MsgBox Err.Description, vbExclamation, "Calculator"
    newNumber = True
End Sub

Private Sub cmdClear_Click()
    txtDisplay.Text = "0"
    firstNumber = 0
    operation = -1
    newNumber = True
End Sub
`;return p;}
export function clockExample(){const {p,form}=formProject('Clock','frmClock','Digital Clock',408,202);form.form.controls=[c('Label','lblTime',20,24,368,60,{Caption:'12:00:00',FontSize:36,FontBold:-1,Alignment:2,ForeColor:8388608}),c('Label','lblDate',20,92,368,23,{Caption:'Saturday, October 3, 2026',Alignment:2}),c('ProgressBar','ProgressBar1',20,126,368,20,{Max:59,Value:0}),c('CheckBox','chkRunning',20,163,210,22,{Caption:'Clock is running',Value:1}),c('CommandButton','cmdClose',302,158,86,28,{Caption:'Close',Cancel:-1}),c('Timer','Timer1',248,163,28,28,{Interval:250,Enabled:-1})];form.code=`Option Explicit
Private Sub Form_Load()
    Timer1_Timer
End Sub
Private Sub Timer1_Timer()
    lblTime.Caption = Format$(Now, "hh:nn:ss")
    lblDate.Caption = Format$(Now, "Long Date")
    ProgressBar1.Value = Second(Now)
End Sub
Private Sub chkRunning_Click()
    Timer1.Enabled = chkRunning.Value
End Sub
Private Sub cmdClose_Click()
    Unload Me
End Sub
`;return p;}
export function graphicsExample(){const {p,form}=formProject('GraphicsLab','frmGraphics','Graphics Lab',614,380);form.form.controls=[c('Label','lblTitle',16,16,570,25,{Caption:'Visual Basic graphics methods',FontBold:-1,FontSize:13}),c('PictureBox','Picture1',16,56,582,250,{BackColor:16777215,ScaleMode:3}),c('Label','lblInfo',16,320,406,40,{Caption:'Line, Circle, RGB, Cls and Print\nWebGPU acceleration with a Canvas2D fallback.'}),c('CommandButton','cmdDraw',462,326,136,30,{Caption:'&Draw again',Default:-1})];form.code=`Option Explicit
Private Sub Form_Load()
    DrawScene
End Sub
Private Sub cmdDraw_Click()
    DrawScene
End Sub
Private Sub DrawScene()
    Dim i As Long
    Dim x As Double, y As Double
    Dim color As Long
    Picture1.Cls
    Randomize
    For i = 0 To 89
        x = 16 + i * 6
        y = 115 - Sin(i / 11) * 70 - Rnd * 12
        color = RGB(25 + i * 2, 70, 160)
        Picture1.Line (x, 220)-(x + 4, y), color, BF
    Next i
    Picture1.Line (14, 220)-(560, 220), vbBlack
    Picture1.Circle (500, 53), 24, vbBlue
    Picture1.CurrentX = 20
    Picture1.CurrentY = 18
    Picture1.Print "90 source-driven primitives"
    Debug.Print "Graphics scene rendered."
End Sub
`;return p;}
export function dataExample(){const {p,form}=formProject('DataBrowser','frmData','Data Browser',672,404);form.form.controls=[c('Label','lblHeading',18,17,600,26,{Caption:'In-memory ADO-style data browser',FontSize:14,FontBold:-1}),c('Label','lblInfo',18,49,620,20,{Caption:'Create a Recordset, append fields, add rows, sort and bind to a grid.'}),c('MSFlexGrid','grdCustomers',18,87,636,239,{Rows:6,Cols:3,FixedRows:1,FixedCols:0,GridData:[['ID','Customer','Country'],['1','Alfreds Futterkiste','Germany'],['2','Around the Horn','UK'],['3','Berglunds snabbköp','Sweden'],['4','Bon app’','France'],['5','Eastern Connection','UK']]}),c('CommandButton','cmdSort',18,348,137,29,{Caption:'Sort by customer'}),c('CommandButton','cmdAdd',165,348,137,29,{Caption:'Add customer'}),c('Label','lblCount',330,354,200,20,{Caption:'5 customers'}),c('CommandButton','cmdClose',554,348,100,29,{Caption:'Close'})];form.code=`Option Explicit
Private rs As Object
Private nextId As Long

Private Sub Form_Load()
    Set rs = CreateObject("ADODB.Recordset")
    rs.Fields.Append "ID", adInteger
    rs.Fields.Append "Customer", adVarChar, 80
    rs.Fields.Append "Country", adVarChar, 40
    rs.Open
    AddCustomer "Alfreds Futterkiste", "Germany"
    AddCustomer "Around the Horn", "UK"
    AddCustomer "Berglunds snabbkop", "Sweden"
    AddCustomer "Bon app", "France"
    AddCustomer "Eastern Connection", "UK"
    RefreshGrid
End Sub

Private Sub AddCustomer(ByVal customer As String, ByVal country As String)
    nextId = nextId + 1
    rs.AddNew
    rs.Fields.Item("ID").Value = nextId
    rs.Fields.Item("Customer").Value = customer
    rs.Fields.Item("Country").Value = country
    rs.Update
End Sub

Private Sub RefreshGrid()
    grdCustomers.DataSource = rs
    grdCustomers.ColWidth(0) = 600
    grdCustomers.ColWidth(1) = 4800
    grdCustomers.ColWidth(2) = 2400
    lblCount.Caption = CStr(rs.RecordCount) & " customers"
End Sub

Private Sub cmdSort_Click()
    rs.Sort = "Customer ASC"
    RefreshGrid
End Sub

Private Sub cmdAdd_Click()
    Dim name As String
    name = InputBox("Customer name:", "New customer", "New customer")
    If Len(Trim$(name)) = 0 Then Exit Sub
    AddCustomer name, "Unknown"
    RefreshGrid
End Sub

Private Sub cmdClose_Click()
    Unload Me
End Sub
`;return p;}
export function controlsExample(){const {p,form}=formProject('ControlGallery','frmControls','Common Controls Gallery',730,454);form.form.controls=[c('Label','lblTitle',18,16,650,25,{Caption:'Windows common controls',FontSize:14,FontBold:-1}),c('TreeView','TreeView1',18,64,210,274,{Nodes:[{Key:'root',Text:'My workspace',Expanded:-1},{Parent:'root',Key:'forms',Text:'Forms',Expanded:-1},{Parent:'forms',Key:'main',Text:'Main Form'},{Parent:'forms',Key:'about',Text:'About Dialog'},{Parent:'root',Key:'modules',Text:'Modules'},{Parent:'root',Key:'classes',Text:'Classes'}]}),c('ListView','ListView1',242,64,470,158,{Columns:[{Text:'Name',Width:3000},{Text:'Type',Width:1500},{Text:'Size',Width:1200}],Items:[{Key:'one',Text:'Customer Form',SubItems:['Form','4 KB']},{Key:'two',Text:'Utilities',SubItems:['Module','2 KB']},{Key:'three',Text:'Customer',SubItems:['Class','3 KB']}]}),c('TabStrip','TabStrip1',242,244,470,94,{Tabs:[{Key:'general',Caption:'General'},{Key:'details',Caption:'Details'},{Key:'settings',Caption:'Settings'}]}),c('Label','lblTabInfo',18,12,410,34,{Caption:'Select a tree node or list item.\nAll events are handled by Visual Basic source code.'},'TabStrip1'),c('Slider','Slider1',18,357,210,35,{Min:0,Max:100,Value:45}),c('ProgressBar','ProgressBar1',242,362,270,23,{Min:0,Max:100,Value:45}),c('CommandButton','cmdClose',602,358,110,30,{Caption:'Close'}),c('StatusBar','StatusBar1',0,429,730,25,{SimpleText:'Ready'})];form.code=`Option Explicit
Private Sub TreeView1_NodeClick(ByVal Node As Object)
    StatusBar1.SimpleText = "Tree node: " & Node.Text
End Sub
Private Sub ListView1_ItemClick(ByVal Item As Object)
    StatusBar1.SimpleText = "Selected: " & Item.Text
End Sub
Private Sub TabStrip1_Click()
    StatusBar1.SimpleText = "Tab: " & TabStrip1.SelectedItem.Caption
End Sub
Private Sub Slider1_Change()
    ProgressBar1.Value = Slider1.Value
    StatusBar1.SimpleText = "Value: " & CStr(Slider1.Value)
End Sub
Private Sub cmdClose_Click()
    Unload Me
End Sub
`;return p;}
export function languageExample(){const p=newProject('LanguageLab');p.startup='Sub Main';p.modules=[{id:newId(),name:'modMain',kind:'module',code:`Option Explicit

Public Sub Main()
    Dim values(1 To 5) As Long
    Dim i As Long
    Dim total As Long
    Debug.Print "VB6 Studio Web - Language Lab"
    Debug.Print String$(36, "-")
    For i = 1 To 5
        values(i) = Factorial(i)
        total = total + values(i)
        Debug.Print CStr(i) & "! = " & CStr(values(i))
    Next i
    Debug.Print "Total: " & CStr(total)
    Debug.Print "Banker's rounding: " & CStr(CInt(2.5)) & ", " & CStr(CInt(3.5))
    Debug.Print "Collection:"
    Dim names As New Collection
    Dim item As Variant
    names.Add "Ada"
    names.Add "Grace"
    names.Add "Alan"
    For Each item In names
        Debug.Print "  " & item
    Next item
    On Error Resume Next
    Dim quotient As Double
    quotient = 1 / 0
    Debug.Print "Handled error: " & Err.Description
    Debug.Print "Complete."
End Sub

Private Function Factorial(ByVal n As Long) As Long
    If n <= 1 Then
        Factorial = 1
    Else
        Factorial = n * Factorial(n - 1)
    End If
End Function
`}];return p;}
export function eventsExample(){
  const {p,form}=formProject('EventWorkbench','frmEvents','Events and Dynamic Controls',612,396);
  form.form.controls=[c('Label','lblHeading',18,18,560,28,{Caption:'Class events and dynamic control arrays',FontSize:14,FontBold:-1}),c('Label','lblInfo',18,55,560,32,{Caption:'Buttons are created by Load at run time. The class event can cancel changes.'}),c('CommandButton','cmdAction',22,116,100,32,{Caption:'+1',Index:0}),c('Label','lblCount',160,114,420,40,{Caption:'Total: 0',FontSize:20,FontBold:-1}),c('Label','lblStatus',160,179,420,50,{Caption:'Click +1 to +4. The +5 button is rejected by a ByRef cancellation event.'}),c('CommandButton','cmdRemove',160,278,172,30,{Caption:'Unload last button'}),c('CommandButton','cmdReset',346,278,104,30,{Caption:'Reset'}),c('CommandButton','cmdClose',482,342,106,30,{Caption:'Close'})];
  form.code=`Option Explicit
Private WithEvents counter As CounterModel

Private Sub Form_Load()
    Dim i As Integer
    Set counter = New CounterModel
    For i = 1 To 4
        Load cmdAction(i)
        cmdAction(i).Top = cmdAction(0).Top + i * 570
        cmdAction(i).Caption = "+" & CStr(i + 1)
        cmdAction(i).Visible = True
    Next i
    Dim status As Object
    Set status = Controls.Add("VB.Label", "lblDynamic", Me)
    status.Move 2400, 3585, 6150, 330
    status.Caption = "This label was created by Controls.Add."
    status.Visible = True
End Sub

Private Sub cmdAction_Click(Index As Integer)
    counter.Add Index + 1
End Sub

Private Sub counter_BeforeChange(Cancel As Boolean, ByVal Amount As Long)
    If Amount > 4 Then
        Cancel = True
        lblStatus.Caption = "Change cancelled by the form's BeforeChange event."
    End If
End Sub

Private Sub counter_Changed(ByVal Value As Long)
    lblCount.Caption = "Total: " & CStr(Value)
    lblStatus.Caption = "The Changed event ran synchronously."
End Sub

Private Sub cmdRemove_Click()
    If cmdAction.Count > 1 Then
        Unload cmdAction(cmdAction.UBound)
        lblStatus.Caption = "Control array now has " & CStr(cmdAction.Count) & " elements."
    End If
End Sub

Private Sub cmdReset_Click()
    counter.Reset
End Sub

Private Sub cmdClose_Click()
    Unload Me
End Sub
`;
  p.modules.push({id:newId(),name:'CounterModel',kind:'class',code:`Option Explicit
Private total As Long
Public Event BeforeChange(Cancel As Boolean, ByVal Amount As Long)
Public Event Changed(ByVal Value As Long)

Public Sub Add(ByVal Amount As Long)
    Dim cancel As Boolean
    RaiseEvent BeforeChange(cancel, Amount)
    If Not cancel Then
        total = total + Amount
        RaiseEvent Changed(total)
    End If
End Sub

Public Sub Reset()
    total = 0
    RaiseEvent Changed(total)
End Sub

Public Property Get Value() As Long
    Value = total
End Property
`});return p;
}

export function richTextExample(){const {p,form}=formProject('RichTextEditor','frmEditor','Rich Text Editor',740,510);p.description='Structured RTF editing, selection formatting, undo/redo, rich-text files and browser-safe embedded content.';
  form.form.controls=[
    c('Label','lblTitle',16,12,640,25,{Caption:'Rich Text Editor',FontBold:-1,FontSize:14}),
    c('CommandButton','cmdBold',16,49,62,26,{Caption:'&Bold',FontBold:-1}),
    c('CommandButton','cmdItalic',84,49,62,26,{Caption:'&Italic',FontItalic:-1}),
    c('CommandButton','cmdUnderline',152,49,80,26,{Caption:'&Underline',FontUnderline:-1}),
    c('CommandButton','cmdRed',238,49,62,26,{Caption:'&Red',ForeColor:255}),
    c('CommandButton','cmdCenter',306,49,72,26,{Caption:'&Center'}),
    c('CommandButton','cmdUndo',392,49,62,26,{Caption:'Undo'}),
    c('CommandButton','cmdRedo',460,49,62,26,{Caption:'Redo'}),
    c('CommandButton','cmdOpen',580,49,62,26,{Caption:'&Open…'}),
    c('CommandButton','cmdSave',648,49,76,26,{Caption:'&Save…'}),
    c('RichTextBox','rtbDocument',16,87,708,354,{Text:'',FontName:'Arial',FontSize:11,BackColor:16777215,ScrollBars:3,TabIndex:0}),
    c('Label','lblSelection',16,452,708,20,{Caption:'Select text to format it. Ctrl+B / Ctrl+I / Ctrl+U; Ctrl+Z to undo.'}),
    c('Label','lblStatus',16,478,708,20,{Caption:'RTF formatting is stored in the document, not in executable HTML.'}),
    c('CommonDialog','Dialog1',0,0,0,0,{Filter:'Rich Text Files (*.rtf)|*.rtf|All Files (*.*)|*.*',CancelError:-1})
  ];form.code=String.raw`Option Explicit
Private Sub Form_Load()
    rtbDocument.TextRTF = "{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue128;}\f0\fs32\b\cf1 Browser-native rich text\par\pard\fs22\b0\cf0 Select a word and apply formatting.\par\par This document supports {\b bold}, {\i italic}, {\ul underline}, colors, Unicode \u8364? and paragraph alignment.\par\par Save a real RTF file, reopen it, or export this entire app as a standalone HTML file.}"
End Sub
Private Sub cmdBold_Click()
    If rtbDocument.SelBold = True Then
        rtbDocument.SelBold = False
    Else
        rtbDocument.SelBold = True
    End If
End Sub
Private Sub cmdItalic_Click()
    If rtbDocument.SelItalic = True Then
        rtbDocument.SelItalic = False
    Else
        rtbDocument.SelItalic = True
    End If
End Sub
Private Sub cmdUnderline_Click()
    If rtbDocument.SelUnderline = True Then
        rtbDocument.SelUnderline = False
    Else
        rtbDocument.SelUnderline = True
    End If
End Sub
Private Sub cmdRed_Click()
    rtbDocument.SelColor = vbRed
End Sub
Private Sub cmdCenter_Click()
    rtbDocument.SelAlignment = rtfCenter
End Sub
Private Sub cmdUndo_Click()
    rtbDocument.Undo
End Sub
Private Sub cmdRedo_Click()
    rtbDocument.Redo
End Sub
Private Sub rtbDocument_SelChange()
    lblSelection.Caption = "Selection: " & CStr(rtbDocument.SelStart) & "  Length: " & CStr(rtbDocument.SelLength)
End Sub
Private Sub rtbDocument_Change()
    lblStatus.Caption = "Document length: " & CStr(Len(rtbDocument.Text)) & " UTF-16 units"
End Sub
Private Sub cmdSave_Click()
    On Error GoTo Failed
    rtbDocument.SaveFile "/Document.rtf", rtfRTF
    Dialog1.FileName = "/Document.rtf"
    Dialog1.ShowSave
    lblStatus.Caption = "Saved Document.rtf"
    Exit Sub
Failed:
    lblStatus.Caption = Err.Description
End Sub
Private Sub cmdOpen_Click()
    On Error GoTo Failed
    Dialog1.ShowOpen
    rtbDocument.LoadFile Dialog1.FileName, rtfRTF
    lblStatus.Caption = "Opened " & Dialog1.FileName
    Exit Sub
Failed:
    lblStatus.Caption = Err.Description
End Sub
`;return p;}

export function compatibilityExample(){const {p,form}=formProject('CompatibilityLab','frmCompatibility','Language and Runtime Workbench',650,462);
  p.description='Interactive checks for named arguments, Missing/Empty, per-instance static locals, civil dates, string assignments and late binding.';
  form.form.controls=[
    c('Label','lblTitle',18,14,610,26,{Caption:'Language and Runtime Workbench',FontSize:14,FontBold:-1}),
    c('Label','lblIntro',18,45,610,32,{Caption:'Source-driven examples of the 0.4 runtime. Open the form code or Counter class to explore.'}),
    c('Label','lblDatePrompt',18,84,90,20,{Caption:'Starting date:'}),c('TextBox','txtDate',110,81,125,23,{Text:'2024-02-29'}),
    c('Label','lblYearsPrompt',248,84,40,20,{Caption:'Years:'}),c('TextBox','txtYears',292,81,40,23,{Text:'1'}),
    c('CommandButton','cmdCalendar',345,79,120,27,{Caption:'Add years'}),c('Label','lblCalendar',480,84,145,20,{Caption:'',FontBold:-1}),
    c('CommandButton','cmdA',18,118,120,28,{Caption:'Increment A'}),c('CommandButton','cmdB',145,118,120,28,{Caption:'Increment B'}),
    c('Label','lblCounters',282,125,342,20,{Caption:'A = 0     B = 0'}),
    c('CommandButton','cmdArguments',18,158,146,28,{Caption:'Named / Optional'}),c('CommandButton','cmdStrings',171,158,146,28,{Caption:'String statements'}),
    c('CommandButton','cmdError',324,158,146,28,{Caption:'Variant Error'}),c('CommandButton','cmdClear',477,158,146,28,{Caption:'Clear output'}),
    c('TextBox','txtOutput',18,202,605,224,{MultiLine:-1,ScrollBars:3,Text:'',Locked:-1,FontName:'Courier New',FontSize:9}),
    c('Label','lblFooter',18,435,610,18,{Caption:'Independent browser runtime; native COM/OCX and full VB6 conformance remain outside this release.'})
  ];
  form.code=`Option Explicit
Private counterA As New Counter
Private counterB As New Counter
Private valueA As Long
Private valueB As Long

Private Sub Form_Load()
    cmdCalendar_Click
    cmdArguments_Click
    cmdStrings_Click
    cmdError_Click
End Sub
Private Sub AppendLine(ByVal text As String)
    txtOutput.Text = txtOutput.Text & text & vbCrLf
End Sub
Private Sub cmdCalendar_Click()
    On Error GoTo Failed
    Dim result As Date
    result = DateAdd(interval:="yyyy", number:=CInt(txtYears.Text), date:=CDate(txtDate.Text))
    CallByName lblCalendar, "Caption", vbLet, Format(result, "yyyy-mm-dd")
    Exit Sub
Failed:
    lblCalendar.Caption = Err.Description
End Sub
Private Sub cmdA_Click()
    valueA = CallByName(counterA, "NextValue", vbMethod)
    ShowCounters
End Sub
Private Sub cmdB_Click()
    valueB = counterB.NextValue()
    ShowCounters
End Sub
Private Sub ShowCounters()
    lblCounters.Caption = "A = " & valueA & "     B = " & valueB
End Sub
Private Function DescribeOptional(Optional value As Variant) As String
    If IsMissing(value) Then
        DescribeOptional = "Missing"
    ElseIf IsEmpty(value) Then
        DescribeOptional = "Empty"
    Else
        DescribeOptional = CStr(value)
    End If
End Function
Private Function Combine(ByVal left As String, ByVal right As String, Optional separator As String = " / ") As String
    Combine = left & separator & right
End Function
Private Sub cmdArguments_Click()
    AppendLine "Named: " & Combine(right:="right", left:="left")
    AppendLine "Optional: " & DescribeOptional() & " versus " & DescribeOptional(Empty)
    AppendLine "TypeOf Counter: " & CStr(TypeOf counterA Is Counter)
End Sub
Private Sub cmdStrings_Click()
    Dim text As String, padded As String
    text = "abcdef"
    Mid$(text, 2, 2) = "XY"
    AppendLine "Mid$: " & text
    padded = Space(10)
    LSet padded = text
    AppendLine "LSet: [" & padded & "]"
    RSet padded = text
    AppendLine "RSet: [" & padded & "]"
End Sub
Private Sub cmdError_Click()
    Dim value As Variant
    value = CVErr(2001)
    AppendLine "CVErr: " & CStr(value) & " / type " & VarType(value)
    AppendLine "Negative DATE round trip: " & CStr(CDbl(CDate(-1.25)))
End Sub
Private Sub cmdClear_Click()
    txtOutput.Text = ""
End Sub
`;
  p.modules.push({id:newId(),name:'Counter',kind:'class',code:`Option Explicit
Public Function NextValue() As Long
    Static count As Long
    count = count + 1
    NextValue = count
End Function
`});return p;
}

export function mdiExample(){
  const {p,form}=formProject('MDIWorkspace','frmWorkspace','Resource Workspace',884,546);
  p.description='Real MDI windows, native resource strings, cancellable unloading and dynamically created VB form instances.';
  form.form.type='MDIForm';form.form.originalType='VB.MDIForm';
  form.form.menus=[
    {name:'mnuFile',caption:'&File',children:[{name:'mnuNew',caption:'&New document'},{name:'mnuClose',caption:'&Close document'},{name:'mnuExit',caption:'E&xit'}]},
    {name:'mnuWindow',caption:'&Window',WindowList:-1,children:[{name:'mnuCascade',caption:'&Cascade'},{name:'mnuTileH',caption:'Tile &Horizontally'},{name:'mnuTileV',caption:'Tile &Vertically'},{name:'mnuIcons',caption:'Arrange &Icons'}]}
  ].flatMap(root=>[{id:newId(),name:root.name,type:'Menu',parent:null,properties:{Caption:root.caption,WindowList:root.WindowList||0}},...root.children.map(item=>({id:newId(),name:item.name,type:'Menu',parent:root.name,properties:{Caption:item.caption}}))]);
  form.code=`Option Explicit
Private documents As New Collection
Private serial As Long
Private Sub MDIForm_Load()
    Me.Caption = LoadResString(101)
    mnuNew_Click
    mnuNew_Click
    Me.Arrange vbTileVertical
End Sub
Private Sub mnuNew_Click()
    Dim doc As New frmDocument
    serial = serial + 1
    doc.Caption = "Document " & serial
    doc.Show
    documents.Add doc
End Sub
Private Sub mnuClose_Click()
    If Not Me.ActiveForm Is Nothing Then
        Unload Me.ActiveForm
    End If
End Sub
Private Sub mnuExit_Click()
    Unload Me
End Sub
Private Sub mnuCascade_Click()
    Me.Arrange vbCascade
End Sub
Private Sub mnuTileH_Click()
    Me.Arrange vbTileHorizontal
End Sub
Private Sub mnuTileV_Click()
    Me.Arrange vbTileVertical
End Sub
Private Sub mnuIcons_Click()
    Me.Arrange vbArrangeIcons
End Sub
`;
  const child=createForm('frmDocument','Document');child.form.properties.MDIChild=-1;
  child.form.properties.ClientWidth=420*15;child.form.properties.ClientHeight=430*15;
  child.form.controls=[c('TextBox','txtDocument',12,12,396,330,{Text:'',MultiLine:-1,ScrollBars:2}),c('CheckBox','chkKeepOpen',12,355,300,22,{Caption:'Prevent closing this document',Value:0}),c('Label','lblInfo',12,390,396,22,{Caption:'Resource 102 · Editable text · Independent form instance'})];
  child.code=`Option Explicit
Private Sub Form_Load()
    txtDocument.Text = LoadResString(102)
End Sub
Private Sub Form_Resize()
    If Me.ScaleWidth > 600 Then
        txtDocument.Width = Me.ScaleWidth - 360
    End If
    If Me.ScaleHeight > 1500 Then
        txtDocument.Height = Me.ScaleHeight - 1500
        chkKeepOpen.Top = Me.ScaleHeight - 1125
        lblInfo.Top = Me.ScaleHeight - 600
    End If
End Sub
Private Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)
    If chkKeepOpen.Value = 1 Then Cancel = True
End Sub
`;
  p.modules.push(child);
  p.resources=setResourceString(null,101,'MDI Resource Workspace',1033);
  p.resources=setResourceString(p.resources,102,'This text comes from a native resource string.\r\n\r\nUse File > New document to create another instance.\r\nUse the Window menu to arrange or activate documents.\r\n\r\nCheck Prevent closing to test cancellable parent unloading.',1033);
  p.resources=setResource(p.resources,{type:10,name:201,language:1033,data:'AAECA4D/'});
  return p;
}

export const EXAMPLES=[{id:'orders',name:'Order Entry',description:'Forms, events, collections and private file I/O',create:orderEntryExample},{id:'calculator',name:'Calculator',description:'Control arrays, arithmetic and error handling',create:calculatorExample},{id:'clock',name:'Digital Clock',description:'Timers, date formatting and live controls',create:clockExample},{id:'graphics',name:'Graphics Lab',description:'VB graphics on WebGPU / Canvas2D',create:graphicsExample},{id:'data',name:'Data Browser',description:'In-memory Recordset and a bound grid',create:dataExample},{id:'controls',name:'Common Controls',description:'TreeView, ListView, tabs, slider and status bar',create:controlsExample},{id:'language',name:'Language Lab',description:'Recursion, arrays, variants and error trapping',create:languageExample},{id:'events',name:'Events and Controls',description:'WithEvents, cancellable events, Load/Unload and Controls.Add',create:eventsExample},{id:'richtext',name:'Rich Text Editor',description:'Structured RTF, selection formatting, undo, file dialogs and Unicode',create:richTextExample},{id:'compatibility',name:'Runtime Workbench',description:'Named arguments, Missing, statics, dates, string assignment and late binding',create:compatibilityExample},{id:'mdi',name:'MDI Resource Workspace',description:'MDI parent/child windows, native resources and cancellable unloading',create:mdiExample},...DATA_EXAMPLES,{id:'win32',name:'Win32 API Workbench',description:'Declare calls, window handles, messages, INI settings and GDI',create:win32Example},...WIN32_SERVICE_EXAMPLES];

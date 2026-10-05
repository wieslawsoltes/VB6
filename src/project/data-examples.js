import {newProject,createForm,createControl} from './model.js';
function shell(name,caption,note){
 const p=newProject(name),form=createForm('frmData',caption);p.modules=[form];p.startup=form.name;p.description=note;form.form.properties.ClientWidth=10200;form.form.properties.ClientHeight=6900;
 const c=(type,name,x,y,w,h,props={})=>{const value=createControl(type,name,x*15,y*15);Object.assign(value.properties,{Width:w*15,Height:h*15,...props});return value;};
 form.form.controls=[c('Label','lblTitle',16,12,640,24,{Caption:caption,FontSize:12,FontBold:-1}),c('Label','lblNote',16,43,640,40,{Caption:note}),c('DataGrid','grdCustomers',16,90,640,236,{DataSource:'Data1'}),c('Adodc','Data1',16,336,640,26,{Caption:'Customers',LockType:3}),c('Label','lblName',16,374,70,22,{Caption:'&Name:'}),c('TextBox','txtName',85,370,255,24,{DataSource:'Data1',DataField:'name',Text:''}),c('CommandButton','cmdLoad',16,412,100,27,{Caption:'&Reload'}),c('CommandButton','cmdSave',126,412,100,27,{Caption:'&Save'}),c('CommandButton','cmdNew',236,412,100,27,{Caption:'&Add New'}),c('CommandButton','cmdDelete',346,412,100,27,{Caption:'&Delete'}),c('Label','lblStatus',460,417,196,20,{Caption:'Ready'})];
 p.dataSources={version:1,connections:[],commands:[]};return {p,form};
}
const errorHandler=`Failed:
    lblStatus.Caption = "Error " & CStr(Err.Number)
    MsgBox Err.Description, vbExclamation, "Data Source"
End Sub`;
function code(open,{writable=true,start=true}={}){return `Option Explicit
Private cn As ADODB.Connection
Private rs As ADODB.Recordset
Private Sub Form_Load()
    ${start?'cmdLoad_Click':'lblStatus.Caption = "Click Reload to connect"'}
End Sub
Private Sub cmdLoad_Click()
    On Error GoTo Failed
    ${open}
    Set Data1.Recordset = rs
    grdCustomers.ColWidth(0) = 900
    grdCustomers.ColWidth(1) = 2850
    grdCustomers.ColWidth(2) = 3450
    If grdCustomers.Cols > 3 Then grdCustomers.ColWidth(3) = 1500
    lblStatus.Caption = CStr(rs.RecordCount) & " records loaded"
    Exit Sub
${errorHandler}
Private Sub cmdSave_Click()
    On Error GoTo Failed
    ${writable?'rs.Update':'MsgBox "This example is read-only.", vbInformation'}
    lblStatus.Caption = "Ready"
    Exit Sub
${errorHandler}
Private Sub cmdNew_Click()
    On Error GoTo Failed
    ${writable?'rs.AddNew\n    rs.Fields("name").Value = "New customer"\n    rs.Update':'MsgBox "This example is read-only.", vbInformation'}
    Exit Sub
${errorHandler}
Private Sub cmdDelete_Click()
    On Error GoTo Failed
    ${writable?'If Not rs.EOF Then rs.Delete':'MsgBox "This example is read-only.", vbInformation'}
    Exit Sub
${errorHandler}
Private Sub Form_Unload(Cancel As Integer)
    If Not cn Is Nothing Then cn.Close
End Sub
`;}
export function sqliteCustomersExample(){
 const {p,form}=shell('SQLiteCustomers','SQLite Customers','Embedded SQLite: editable records, parameterized commands and transactions. The database stays with the app; no server or CDN is needed.');
 p.dataSources.connections=[{name:'Local',provider:'sqlite',database:'/customers.sqlite'}];p.dataSources.commands=[{name:'Customers',connection:'Local',type:2,text:'customers',parameters:[]},{name:'FindCustomer',connection:'Local',type:1,text:'SELECT id,name,email FROM customers WHERE name LIKE ?',parameters:[{name:'Name',type:202,value:'%'}]}];
 form.code=code(`If cn Is Nothing Then
        Set cn = New ADODB.Connection
        cn.Open "Local"
        cn.Execute "CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)"
        Set rs = cn.Execute("SELECT COUNT(*) AS total FROM customers")
        If rs.Fields("total").Value = 0 Then
            cn.BeginTrans
            cn.Execute "INSERT INTO customers(name,email) VALUES('Ada Lovelace','ada@example.test'),('Grace Hopper','grace@example.test')"
            cn.CommitTrans
        End If
    End If
    If Not rs Is Nothing Then
        If rs.State = adStateOpen Then rs.Close
    End If
    Set rs = New ADODB.Recordset
    rs.Open "customers", cn, adOpenStatic, adLockOptimistic, adCmdTable`);
 return p;
}
export function restCustomersExample(){
 const {p,form}=shell('RESTCustomers','REST Customers — Editable Service','Start node tools/data-example-server.mjs, then click Reload. Real HTTP paging, POST/PATCH/DELETE and optimistic ETags; sample data resets when the server stops.');
 p.dataSources.connections=[{name:'CustomersAPI',provider:'rest',url:'http://127.0.0.1:4286/customers',rowsPath:'items',keyField:'id',etagField:'etag',requireETag:true,pagination:{mode:'page',size:2,hasMorePath:'hasMore'},fields:[{name:'id',type:3},{name:'name',type:202},{name:'email',type:202},{name:'active',type:11}],write:{insert:{url:'/customers'},update:{url:'/customers/{id}'},delete:{url:'/customers/{id}'}}}];
 p.dataSources.commands=[{name:'Customers',connection:'CustomersAPI',text:'',parameters:[]}];
 form.code=code(`If cn Is Nothing Then
        Set cn = New ADODB.Connection
        cn.Open "CustomersAPI"
    End If
    If Not rs Is Nothing Then
        If rs.State = adStateOpen Then rs.Close
    End If
    Set rs = New ADODB.Recordset
    rs.Open "", cn, adOpenStatic, adLockOptimistic`,{start:false});return p;
}
export function publicRESTExample(){
 const {p,form}=shell('PublicRESTUsers','Public REST — User Directory','Public JSONPlaceholder users (read-only). Click Reload to make a real HTTPS request. The endpoint must allow browser CORS; results are not bundled or simulated.');
 p.dataSources.connections=[{name:'PublicUsers',provider:'rest',url:'https://jsonplaceholder.typicode.com/users',readOnly:true,fields:[{name:'id',type:3},{name:'name',type:202},{name:'email',type:202},{name:'city',path:'address.city',type:202},{name:'company',path:'company.name',type:202}]}];
 p.dataSources.commands=[{name:'Users',connection:'PublicUsers',text:'',parameters:[]}];
 form.code=code(`If cn Is Nothing Then
        Set cn = New ADODB.Connection
        cn.Open "PublicUsers"
    End If
    Set rs = cn.Execute("")`,{writable:false,start:false});
 form.form.controls.find(c=>c.name==='txtName').properties.Locked=-1;return p;
}
export function graphqlCustomersExample(){
 const {p,form}=shell('GraphQLCustomers','GraphQL / OData — Customer Queries','Start the local example server. A typed Boolean parameter filters GraphQL customers. The Data Environment also contains an OData connection with next-link paging.');
 p.dataSources.connections=[{name:'Graph',provider:'graphql',url:'http://127.0.0.1:4286/graphql',rowsPath:'data.customers',readOnly:true,fields:[{name:'id',type:3},{name:'name',type:202},{name:'email',type:202},{name:'active',type:11}]},{name:'OData',provider:'odata',url:'http://127.0.0.1:4286/odata/Customers',readOnly:true}];
 p.dataSources.commands=[{name:'ActiveCustomers',connection:'Graph',text:'query($active: Boolean) { customers(active:$active) { id name email active } }',parameters:[{name:'active',type:11,value:-1}]}];
 form.code=code(`DataEnvironment1.ActiveCustomers True
    Set rs = DataEnvironment1.rsActiveCustomers`,{writable:false,start:false});form.form.controls.find(c=>c.name==='txtName').properties.Locked=-1;return p;
}
export const DATA_EXAMPLES=[{id:'sqlite-customers',name:'SQLite Customers',description:'Embedded SQLite, bound editing, persistence and transactions',create:sqliteCustomersExample},{id:'rest-customers',name:'REST Customers',description:'Real REST CRUD, paging and ETag conflicts (local example server)',create:restCustomersExample},{id:'rest-public-users',name:'Public REST Users',description:'Live HTTPS users with nested JSON field mappings',create:publicRESTExample},{id:'graphql-customers',name:'GraphQL and OData',description:'Typed GraphQL variables and OData next links',create:graphqlCustomersExample}];

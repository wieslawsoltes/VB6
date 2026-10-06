import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {normalizeProject,newProject} from '../src/project/model.js';
import {sourceFiles,importFiles} from '../src/project/formats.js';
import {DataContext} from '../src/data/context.js';
import {createNativeDriver} from '../tools/data/drivers.mjs';
const config={version:1,connections:[{name:'Local',provider:'sqlite',database:'/data.sqlite',timeout:2}],commands:[{name:'ById',connection:'Local',text:'SELECT name FROM customers WHERE id=?',parameters:[{name:'id',type:3}]}]};
async function run(code){
 const project=normalizeProject({schema:1,name:'DataTest',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Option Explicit\nSub Main()\n'+code+'\nEnd Sub'}],dataSources:config});
 const compiled=compileProject(project);assert.deepEqual(compiled.diagnostics,[]);const output=[];const vm=new VirtualMachine(compiled,{print:s=>output.push(s)});
 try{await vm.start();return output;}finally{await vm.data.close();}
}
test('VB ADO declarations begin as Nothing; native calls await and RecordsAffected writes ByRef',async()=>{
 assert.deepEqual(await run(`Dim cn As ADODB.Connection
Dim rs As ADODB.Recordset
Dim affected As Long
Debug.Print cn Is Nothing
Set cn = New ADODB.Connection
cn.Open "Local"
cn.Execute "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT)"
cn.Execute "INSERT INTO customers(name) VALUES('Ada')", affected
Debug.Print affected
Set rs = cn.Execute("SELECT name FROM customers")
Debug.Print rs.Fields("name").Value, rs.EOF
cn.Close
Debug.Print cn.State`),['True','1','Ada 0','0']);
});
test('VB typed commands, DataEnvironment commands and DAO convenience use real SQLite',async()=>{
 assert.deepEqual(await run(`Dim cn As Object, cmd As ADODB.Command, rs As Object, db As Object
Set cn = CreateObject("ADODB.Connection")
cn.Open "Local"
cn.Execute "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT)"
Set cmd = New ADODB.Command
Set cmd.ActiveConnection = cn
cmd.CommandText = "INSERT INTO customers(name) VALUES(?)"
cmd.Parameters.Append cmd.CreateParameter("name", adVarWChar, adParamInput, 20, "Grace")
cmd.Execute
DataEnvironment1.ById 1
Debug.Print DataEnvironment1.rsById.Fields("name").Value
Set db = OpenDatabase("Local")
Set rs = db.OpenRecordset("customers")
rs.Edit
rs.Fields("name").Value = "Updated"
rs.Update
rs.Requery
Debug.Print rs.Fields("name").Value
rs.Close
cn.Close
db.Close`),['Grace','Updated']);
});
test('VB provider errors remain catchable with On Error',async()=>{
 assert.deepEqual(await run(`Dim cn As New ADODB.Connection
On Error Resume Next
cn.Open "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=x.mdb"
Debug.Print Err.Number
Err.Clear
cn.Open "Local"
cn.Execute "SELECT missing FROM missing"
Debug.Print Err.Number <> 0
cn.Close`),['3706','True']);
});
test('native source sidecars restore named connections and virtual binary data without modifying pure classic projects',async()=>{
 const p=newProject('DataPortable');p.dataSources=config;const context=new DataContext(p),cn=context.connection();await cn.Open('Local');await cn.Execute('CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT)');await cn.Execute("INSERT INTO customers VALUES(1,'Saved')");p.vfs=context.fs.snapshot();await context.close();
 const files=sourceFiles(p);assert(files['DataPortable.vbp.vb6data.json']);
 const imported=await importFiles(Object.entries(files),{entryPath:'DataPortable.vbp'});assert.deepEqual(imported.project.dataSources,config);
 const reloaded=new DataContext(imported.project),other=reloaded.connection();await other.Open('Local');assert.equal((await other.Execute('SELECT name FROM customers')).Item('name'),'Saved');await reloaded.close();
 const twice=sourceFiles(imported.project);assert.equal(Object.keys(twice).filter(k=>k.endsWith('.vb6data.json')).length,1);
 assert.equal(Object.keys(sourceFiles(newProject('Classic'))).some(k=>k.endsWith('.vb6data.json')),false);
 const sidecar=JSON.parse(new TextDecoder().decode(files['DataPortable.vbp.vb6data.json']));sidecar.dataSources.connections[0].password='do-not-save';files['DataPortable.vbp.vb6data.json']=new TextEncoder().encode(JSON.stringify(sidecar));
 await assert.rejects(()=>importFiles(Object.entries(files),{entryPath:'DataPortable.vbp'}),/credential|secret|password/i);
});
test('named provider timeout applies unless explicitly overridden, including commands',async()=>{
 const context=new DataContext({dataSources:config}),cn=context.connection();await cn.Open('Local');assert.equal(cn.CommandTimeout,2);const cmd=context.command();cmd.ActiveConnection=cn;cmd.CommandText='SELECT 1';await cmd.Execute();assert.equal(cn.adapter.timeout,2);cmd.CommandTimeout=4;await cmd.Execute();assert.equal(cn.adapter.timeout,4);assert.equal(cn.CommandTimeout,2);await context.close();
 assert.throws(()=>{cn.CommandTimeout=Infinity;});assert.throws(()=>{cmd.CommandTimeout=-1;});
});
test('native drivers never pretend the client readOnly flag replaces server database permissions',async()=>{
 await assert.rejects(()=>createNativeDriver({driver:'pg',readOnly:true},{load:()=>{throw Error('must not load');}}),/read-only database account/);
});

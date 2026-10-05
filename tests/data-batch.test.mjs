import test from 'node:test';
import assert from 'node:assert/strict';
import {DataContext} from '../src/data/context.js';
import {ConnectedRecordset} from '../src/data/connected-recordset.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {normalizeProject} from '../src/project/model.js';
const number=n=>e=>e.number===n;
async function fixture(t,lock=4){
  const ctx=new DataContext(),cn=ctx.connection();t.after(()=>ctx.close());await cn.Open({provider:'sqlite',database:'/batch.db'});
  await cn.Execute('CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT UNIQUE, note BLOB)');
  await cn.Execute("INSERT INTO people VALUES(1,'Ada',X'0001'),(2,'Grace',X'0203'),(3,'Linus',NULL)");
  const rs=new ConnectedRecordset(ctx);await rs.Open('people',cn,3,lock,2);return {ctx,cn,rs};
}
async function names(cn){return (await cn.query('SELECT name FROM people ORDER BY id')).values.map(r=>r[0]);}
test('batch Update and navigation never transmit changes; UpdateBatch posts pending edits',async t=>{
 const {cn,rs}=await fixture(t);rs.Fields.Item('name').Value='A';rs.Update();rs.MoveNext();rs.Fields.Item('name').Value='B';
 assert.deepEqual(await names(cn),['Ada','Grace','Linus']);assert.equal(rs.Fields.Item('name').OriginalValue,'Grace');
 await rs.UpdateBatch();assert.deepEqual(await names(cn),['A','B','Linus']);assert.equal(rs.Item('name'),'B');assert.equal(rs.Status,0);
});
test('OriginalValue survives repeated cached edits and cancelling the current edit',async t=>{
 const {rs}=await fixture(t);const field=rs.Fields.Item('name');field.Value='A';rs.Update();field.Value='B';rs.CancelUpdate();assert.equal(field.Value,'A');assert.equal(field.OriginalValue,'Ada');rs.CancelBatch();assert.equal(field.Value,'Ada');
});
test('CancelBatch restores inserts updates and deletes without provider writes',async t=>{
 const {cn,rs}=await fixture(t);rs.Update('name','A');rs.MoveNext();rs.Delete();assert.equal(rs.Status,4);assert.throws(()=>rs.Item('name'),number(3167));rs.MoveNext();assert.equal(rs.Item('name'),'Linus');rs.AddNew(['id','name'],[4,'New']);rs.CancelBatch();rs.MoveFirst();assert.deepEqual(rs.view().map(r=>r.name),['Ada','Grace','Linus']);assert.deepEqual(await names(cn),['Ada','Grace','Linus']);
});
test('batch inserts receive generated keys and survive a binary database reopen',async t=>{
 const {cn,rs,ctx}=await fixture(t);rs.AddNew('name','Fourth');assert.equal(rs.Item('id'),null);await rs.UpdateBatch();assert.equal(rs.Item('id'),4);rs.MoveFirst();rs.Delete();await rs.UpdateBatch();assert.deepEqual(await names(cn),['Grace','Linus','Fourth']);
 const snapshot=ctx.fs.snapshot();const other=new DataContext({vfs:snapshot});t.after(()=>other.close());const c=other.connection();await c.Open({provider:'sqlite',database:'/batch.db'});assert.deepEqual(await names(c),['Grace','Linus','Fourth']);
});
test('inserting and then deleting a cached row generates no SQL',async t=>{
 const {cn,rs}=await fixture(t);rs.AddNew('name','Fourth');rs.Delete();assert.equal(rs._family.batch.size,0);await rs.UpdateBatch();assert.deepEqual(await names(cn),['Ada','Grace','Linus']);
});
test('batch conflicts retain local and original values, collect errors, and allow Resync',async t=>{
 const {cn,rs}=await fixture(t);rs.Update('name','Local');rs.MoveNext();rs.Update('name','Good');await cn.Execute("UPDATE people SET name='External' WHERE id=1");
 await assert.rejects(()=>rs.UpdateBatch(),number(3197));assert.equal(cn.Errors.Count,1);assert.deepEqual(await names(cn),['External','Good','Linus']);rs.Filter=5;assert.equal(rs.RecordCount,1);assert.equal(rs.Item('name'),'Local');assert.equal(rs.Fields.Item('name').OriginalValue,'Ada');assert.equal(rs.Status&2048,2048);assert.equal(await rs.Fields.Item('name').UnderlyingValue,'External');
 await rs.Resync(1,2);rs.Filter=0;assert.equal(rs.Item('name'),'External');rs.Update('name','Resolved');await rs.UpdateBatch();assert.deepEqual(await names(cn),['Resolved','Good','Linus']);
});
test('batch duplicate-key failures preserve failed new rows and successful siblings',async t=>{
 const {cn,rs}=await fixture(t);rs.AddNew(['id','name'],[1,'Duplicate']);rs.AddNew(['id','name'],[4,'Good']);await assert.rejects(()=>rs.UpdateBatch());rs.Filter=5;assert.equal(rs.RecordCount,1);assert.equal(rs.Status&4096,4096);rs.CancelBatch();rs.Filter=0;assert.deepEqual(await names(cn),['Ada','Grace','Linus','Good']);
});
test('adAffectCurrent and adAffectGroup honor scope and empty groups reject',async t=>{
 const {cn,rs}=await fixture(t);rs.Update('name','A');rs.MoveNext();rs.Update('name','B');await rs.UpdateBatch(1);assert.deepEqual(await names(cn),['Ada','B','Linus']);rs.Filter='id = 1';await rs.UpdateBatch(2);assert.deepEqual(await names(cn),['A','B','Linus']);rs.Filter='id = 100';await assert.rejects(()=>rs.UpdateBatch(2),number(3021));
});
test('affected pending fetched and bookmark filters use independent scopes',async t=>{
 const {rs}=await fixture(t);const first=rs.Bookmark;rs.Update('name','A');rs.MoveNext();const second=rs.Bookmark;rs.Delete();rs.Filter=1;assert.equal(rs.RecordCount,2);rs.Filter=2;assert.equal(rs.Status,4);rs.Filter=[first];assert.equal(rs.Item('name'),'A');rs.Filter=[second];assert.throws(()=>rs.Item('name'),number(3167));rs.Filter=3;assert.equal(rs.RecordCount,2);rs.CancelBatch();rs.Filter=0;assert.equal(rs.RecordCount,3);
});
test('Clone shares updates and bookmarks, not cursor positions or filters',async t=>{
 const {rs}=await fixture(t);rs.Filter='id > 1';rs.MoveLast();const mark=rs.Bookmark,clone=rs.Clone();assert.equal(clone.RecordCount,3);assert.equal(clone.Item('id'),1);clone.Bookmark=mark;assert.equal(clone.Item('id'),3);clone.Update('name','Shared');rs.Filter=0;rs.Bookmark=mark;assert.equal(rs.Item('name'),'Shared');rs.MoveFirst();assert.equal(clone.Item('id'),3);await clone.UpdateBatch();assert.equal(rs._family.batch.size,0);
});
test('clone bookmarks remain unique when either cursor adds rows',async t=>{
 const {rs}=await fixture(t),clone=rs.Clone();rs.AddNew(['id','name'],[4,'Four']);const a=rs.Bookmark;clone.AddNew(['id','name'],[5,'Five']);const b=clone.Bookmark;assert.notEqual(a,b);clone.Bookmark=a;assert.equal(clone.Item('name'),'Four');rs.Bookmark=b;assert.equal(rs.Item('name'),'Five');
});
test('read-only clone rejects mutations and original Close does not close the clone',async t=>{
 const {rs}=await fixture(t),clone=rs.Clone(1);assert.throws(()=>clone.Update('name','bad'),number(3251));await rs.Close();assert.equal(clone.State,1);assert.equal(clone.Item('name'),'Ada');await clone.Close();assert.equal(clone.State,0);
});
test('Requery separates original cursor from clones',async t=>{
 const {cn,rs}=await fixture(t),clone=rs.Clone();await cn.Execute("UPDATE people SET name='External' WHERE id=1");await rs.Requery();assert.equal(rs.Item('name'),'External');assert.equal(clone.Item('name'),'Ada');
});
test('batch can detach for edits and reconnect to original connection; writes require reconnect',async t=>{
 const {cn,rs}=await fixture(t);rs.ActiveConnection=null;assert.equal(cn.recordsets.has(rs),false);rs.Update('name','Offline');await assert.rejects(()=>rs.UpdateBatch(),number(3709));rs.ActiveConnection=cn;await rs.UpdateBatch();assert.equal((await names(cn))[0],'Offline');
});
test('Close in immediate mode rejects uncommitted edits; batch Close discards changes',async t=>{
 const {cn,rs}=await fixture(t,3);rs.Fields.Item('name').Value='lost';await assert.rejects(()=>rs.Close(),number(3219));assert.equal(rs.State,1);rs.CancelUpdate();await rs.Close();const batch=new ConnectedRecordset(rs.context);await batch.Open('people',cn,3,4,2);batch.Update('name','Not saved');await batch.Close();assert.equal((await names(cn))[0],'Ada');
});
test('Resync underlying-values-only leaves pending edits and OriginalValue unchanged',async t=>{
 const {cn,rs}=await fixture(t);rs.Update('name','Local');await cn.Execute("UPDATE people SET name='Remote' WHERE id=1");await rs.Resync(1,1);assert.equal(rs.Item('name'),'Local');assert.equal(rs.Fields.Item('name').OriginalValue,'Ada');assert.equal(rs._underlying.get(rs.current()).name,'Remote');
});
test('Supports reports actual materialized/provider capabilities',async t=>{
 const {rs}=await fixture(t);for(const flag of [8192,16384,512,256,524288,65536,131072,16778240,16779264,16809984])assert.equal(rs.Supports(flag),-1,flag);for(const flag of [0,1048576,2097152,262144])assert.equal(rs.Supports(flag),0,flag);const ro=rs.Clone(1);assert.equal(ro.Supports(65536),0);assert.equal(ro.Supports(16778240),0);
});
test('PageCount and AbsolutePage follow filtered view and validate sizes',async t=>{
 const {rs}=await fixture(t);rs.PageSize=2;assert.equal(rs.PageCount,2);rs.AbsolutePage=2;assert.equal(rs.Item('id'),3);assert.equal(rs.AbsolutePage,2);rs.MoveNext();assert.equal(rs.AbsolutePage,-3);rs.Filter='id > 1';assert.equal(rs.PageCount,1);assert.throws(()=>rs.PageSize=0,number(5));assert.throws(()=>rs.AbsolutePage=2,number(3001));
});
test('binary and Unicode field chunks preserve values and reset position on row change',async t=>{
 const {rs}=await fixture(t);const f=rs.Fields.Item('note');assert.deepEqual(f.GetChunk(1),new Uint8Array([0]));assert.deepEqual(f.GetChunk(5),new Uint8Array([1]));rs.MoveNext();assert.deepEqual(f.GetChunk(1),new Uint8Array([2]));f.AppendChunk(new Uint8Array([255]));assert.deepEqual(f.Value,new Uint8Array([2,3,255]));assert.equal(f.ActualSize,3);rs.CancelUpdate();const text=rs.Fields.Item('name');text.AppendChunk(' 🦊');assert.equal(text.Value,'Grace 🦊');
});
test('group Delete marks only visible rows and CancelBatch can restore the group',async t=>{
 const {rs,cn}=await fixture(t);rs.Filter='id < 3';rs.Delete(2);rs.Filter=1;assert.equal(rs.RecordCount,2);rs.CancelBatch(2);rs.Filter=0;assert.equal(rs.RecordCount,3);assert.deepEqual(await names(cn),['Ada','Grace','Linus']);
});
test('clones reject overlapping pending edits and async writes without corrupting cache',async t=>{
 const {rs}=await fixture(t),clone=rs.Clone();rs.Fields.Item('name').Value='A';assert.throws(()=>clone.Update('name','B'),number(3219));rs.CancelUpdate();clone.Update('name','B');let complete;rs._writer=()=>new Promise(r=>complete=r);const operation=rs.UpdateBatch();assert.throws(()=>clone.AddNew(),number(3219));complete();await operation;assert.equal(clone.Item('name'),'B');
});
test('disconnected batch recordsets stage and cancel without requiring a provider',async()=>{
 const rs=new ConnectedRecordset();rs.Fields.Append('id',3);rs.LockType=4;await rs.Open();rs.AddNew('id',1);assert.equal(rs.Status,1);await rs.UpdateBatch();assert.equal(rs.Status,0);rs.Update('id',2);rs.CancelBatch();assert.equal(rs.Item('id'),1);await rs.Close();
});
test('invalid batch/filter operations leave previous data and cursor intact',async t=>{
 const {rs}=await fixture(t);rs.Filter='id > 1';const mark=rs.Bookmark;for(const value of [99,[999],'missing = 1'])assert.throws(()=>rs.Filter=value);assert.equal(rs.Bookmark,mark);await assert.rejects(()=>rs.UpdateBatch(99),number(3001));assert.throws(()=>rs.Delete(3),number(3001));assert.equal(rs.Item('id'),2);
});
test('actual VB source uses batch constants, clones, named fields and awaited UpdateBatch',async()=>{
 const project=normalizeProject({schema:1,name:'BatchVB',startup:'Sub Main',modules:[{name:'Module1',kind:'module',code:`Option Explicit
Sub Main()
 Dim cn As New ADODB.Connection, rs As New ADODB.Recordset, other As ADODB.Recordset
 cn.Open "Provider=SQLite;Data Source=:memory:"
 cn.Execute "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)"
 cn.Execute "INSERT INTO t VALUES(1,'Old')"
 rs.Open "t", cn, adOpenStatic, adLockBatchOptimistic, adCmdTable
 rs.Fields("name").Value = "New"
 rs.Update
 Debug.Print rs.Fields("name").OriginalValue
 Set other = rs.Clone(adLockReadOnly)
 Debug.Print other.Fields("name").Value
 rs.UpdateBatch
 Debug.Print rs.Status
 rs.Close
 Debug.Print other.Fields("name").Value
 cn.Close
End Sub`} ]});
 const program=compileProject(project);assert.deepEqual(program.diagnostics,[]);const output=[];const vm=new VirtualMachine(program,{print:s=>output.push(s)});try{await vm.start();assert.deepEqual(output,['Old','New','0','New']);}finally{await vm.data.close();}
});

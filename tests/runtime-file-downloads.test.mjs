import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';
import {BrowserControl} from '../src/controls/controls.js';

function setup(code,{name='Report.rtf',previous='Document.rtf',cancelError=-1}={}){
  const saved=[],errors=[];
  const vm=new VirtualMachine({name:'SaveDialog',startup:'Sub Main',settings:{},modules:[{name:'Main',kind:'module',code}]},{
    inputBox:async()=>name,saveFile:(name,bytes)=>saved.push({name,bytes:Array.from(bytes)}),error:error=>errors.push(error)
  });
  assert.equal(vm.program.valid,true,JSON.stringify(vm.program.diagnostics));
  const control={vm,props:{FileName:previous,CancelError:cancelError,DialogTitle:'Save As'}};
  vm.library.set('dialog1',{
    get FileName(){return control.props.FileName;},
    set FileName(value){control.props.FileName=value;},
    ShowSave:()=>BrowserControl.prototype.ShowSave.call(control)
  });
  vm.library.set('observesave',()=>assert.equal(saved.length,0,'no download while VB is still writing'));
  return {vm,control,saved,errors};
}
const main=code=>'Sub Main()\n'+code+'\nEnd Sub';
const write=String.raw`Dim h As Integer
Dialog1.ShowSave
ObserveSave
h=FreeFile
Open Dialog1.FileName For Output As #h
Print #h, "New content"
Print #h, "Second line"
Close #h
ObserveSave`;
const text=bytes=>Buffer.from(bytes).toString('latin1');

test('CommonDialog selects first and downloads the complete post-dialog VB output',async()=>{
  const {vm,saved}=setup(main(write));await vm.start();
  assert.deepEqual(saved.map(({name,bytes})=>({name,text:text(bytes)})),[{name:'Report.rtf',text:'New content\r\nSecond line\r\n'}]);
  assert.equal(vm.listenerCount('procedureComplete'),0);assert.equal(vm.listenerCount('state'),0);
});
test('a renamed prewritten file keeps exact bytes for existing browser applications',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave\nObserveSave'));
  const bytes=Uint8Array.of(0,255,128,13,10,65);vm.fs.writeBytes('Document.rtf',bytes);vm.fs.write('Report.rtf','unrelated');await vm.start();
  assert.deepEqual(saved,[{name:'Report.rtf',bytes:[...bytes]}]);assert.equal(vm.fs.read('Report.rtf'),'unrelated');
});
test('a new write to an existing destination takes precedence over the old source',async()=>{
  const {vm,saved}=setup(main(write));vm.fs.write('Document.rtf','old source');vm.fs.write('Report.rtf','old destination');await vm.start();
  assert.equal(text(saved[0].bytes),'New content\r\nSecond line\r\n');
});
test('dialog selection without any file does not fabricate an empty download',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave'));await vm.start();assert.deepEqual(saved,[]);assert.equal(vm.fs.exists('Report.rtf'),false);
});
test('an intentionally written zero-byte document is still downloaded',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave\nOpen Dialog1.FileName For Output As #1\nClose #1'));await vm.start();
  assert.deepEqual(saved,[{name:'Report.rtf',bytes:[]}]);
});
test('nested VB calls finish before the save is published',async()=>{
  const code=main('Worker\nObserveSave\nOpen Dialog1.FileName For Append As #1\nPrint #1, "outer"\nClose #1')+'\nSub Worker()\nDialog1.ShowSave\nOpen Dialog1.FileName For Output As #1\nPrint #1, "inner"\nClose #1\nEnd Sub';
  const {vm,saved}=setup(code);await vm.start();assert.equal(text(saved[0].bytes),'inner\r\nouter\r\n');
});
test('failed handlers discard pending saves without exporting stale files',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave\nError 5'));vm.fs.write('Document.rtf','old source');
  await assert.rejects(()=>vm.start(),error=>error.number===5);assert.deepEqual(saved,[]);assert.equal(vm.listenerCount('procedureComplete'),0);
});
test('handled write failures do not turn an old source into a successful save',async()=>{
  const {vm,saved}=setup(main('On Error Resume Next\nDialog1.ShowSave\nOpen "/missing/path.rtf" For Output As #1'));
  vm.fs.write('Document.rtf','old source');await vm.start();assert.equal(vm.err.Number,76);assert.deepEqual(saved,[]);
});
test('cancel retains FileName and does not queue a download',async()=>{
  const {vm,control,saved}=setup(main('On Error Resume Next\nDialog1.ShowSave'),{name:''});await vm.start();
  assert.equal(vm.err.Number,32755);assert.equal(control.props.FileName,'Document.rtf');assert.deepEqual(saved,[]);assert.equal(vm.listenerCount('procedureComplete'),0);
});
test('repeated selection of one destination produces one final download',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave\nDialog1.ShowSave\nOpen Dialog1.FileName For Output As #1\nPrint #1, "once"\nClose #1'));
  await vm.start();assert.equal(saved.length,1);assert.equal(text(saved[0].bytes),'once\r\n');
});
test('End cancels pending downloads and releases their VM listeners',async()=>{
  const {vm,saved}=setup(main('Dialog1.ShowSave\nEnd'));vm.fs.write('Document.rtf','old');await vm.start();
  assert.deepEqual(saved,[]);assert.equal(vm.listenerCount('procedureComplete'),0);assert.equal(vm.listenerCount('state'),0);
});

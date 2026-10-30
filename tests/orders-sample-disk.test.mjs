import test from 'node:test';
import assert from 'node:assert/strict';
import {orderEntryExample} from '../src/project/examples.js';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileProject} from '../src/language/compiler.js';
import {compileWin32} from '../src/native/compiler.js';
import {VBError} from '../src/language/errors.js';

async function runOrderSample(disk=new VirtualFileSystem()) {
  const project=orderEntryExample(),messages=[],controls=new Map();
  const compiled=compileProject(project);
  assert.deepEqual(compiled.diagnostics,[]);
  const vm=new VirtualMachine(compiled,{
    fs:disk,print(){},msgBox:(text,style,title)=>{messages.push({text,style,title});return 1;},
    createForm:async model=>{
      for(const modelControl of model.controls){
        const props=structuredClone(modelControl.properties),items=props.List||[],itemData=[];
        const control={...props,Text:props.Text||items[props.ListIndex]||'',ListCount:items.length,
          List:index=>items[index],ItemData:index=>itemData[index],
          setIndexed:(name,args,value)=>{assert.equal(name.toLowerCase(),'itemdata');itemData[args[0]]=value;}};
        controls.set(modelControl.name.toLowerCase(),control);
      }
      return {controlMap:controls,Show(){},Hide(){},suspendTimers(){}};
    }
  });
  await vm.start();
  return {vm,controls,messages,disk};
}

test('Order Entry presents an empty Orders folder without fabricating saved orders',()=>{
  const project=orderEntryExample(),before=structuredClone(project.vfs),disk=new VirtualFileSystem(project.vfs);
  assert.ok(disk.directories.has('/Orders'));
  assert.deepEqual(project.vfs,before);
  assert.equal(disk.files.size,0);
});

test('the authored Save handler creates its missing folder and writes the current order',async()=>{
  const {vm,controls,messages,disk}=await runOrderSample();
  assert.equal(disk.directories.has('/Orders'),false);
  await vm.dispatch('frmOrders','cmdSave_Click');
  assert.equal(vm.state,'running');
  const text=disk.read('/Orders/Order-1001.txt');
  assert.match(text,/^NORTHWIND TRADERS\r\nOrder: 1001\r\nCustomer: Alfreds Futterkiste\r\n/);
  assert.ok(text.endsWith('TOTAL: '+controls.get('lbltotal').Caption+'\r\n'));
  assert.equal(disk.handles.size,0);
  assert.deepEqual(messages.map(m=>m.title),['Order saved']);
  assert.match(messages[0].text,/Orders\/Order-1001\.txt/);
  assert.doesNotMatch(messages[0].text,/virtual disk/);
  controls.get('txtorderno').Text='1002';
  await vm.dispatch('frmOrders','cmdSave_Click');
  assert.match(disk.read('/Orders/Order-1002.txt'),/Order: 1002/);
  assert.equal(disk.handles.size,0);
  vm.stop();
});

test('the authored Save handler closes a failed write and preserves the original error',async()=>{
  const {vm,messages,disk}=await runOrderSample();
  disk.print=()=>{throw new VBError('Disk full during order write',61);};
  await vm.dispatch('frmOrders','cmdSave_Click');
  assert.equal(disk.handles.size,0);
  assert.deepEqual(messages.map(m=>[m.title,m.text]),[['Save error','Disk full during order write']]);
  vm.stop();
});

for(const optimization of [0,1,2])test(`Order Entry's portable Save handler compiles as independent Win32 AOT O${optimization}`,()=>{
  const result=compileWin32(orderEntryExample(),{optimization});
  const imports=result.report.imports.map(i=>i.dll+':'+i.symbol);
  assert.ok(imports.includes('kernel32.dll:CreateDirectoryW'));
  assert.ok(imports.includes('kernel32.dll:CreateFileW'));
  assert.equal(result.report.extraction,false);
  assert.equal(imports.some(i=>/MSVBVM|VBRUN/i.test(i)),false);
});

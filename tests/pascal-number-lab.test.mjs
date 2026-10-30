import test from 'node:test';
import assert from 'node:assert/strict';
import {createPascalNumberLab,EXAMPLES} from '../src/project/examples.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {compileWin32} from '../src/native/compiler.js';

test('the public catalog contains an independently editable Pascal Number Lab', () => {
  const entry=EXAMPLES.find(example=>example.id==='pascal-number-lab'),project=entry.create();
  assert.equal(project.language,'pascal');assert.equal(project.modules.length,2);
  const compiled=compileProject(project);assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));
  assert.ok(compileWin32(project).bytes.length);
});

test('authored Pascal calculates, rejects invalid input and writes complete exact results', async () => {
  const project=createPascalNumberLab(),compiled=compileProject(project),disk=new VirtualFileSystem(),lines=[];
  assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));
  const controls={InputText:{Text:'10',SetFocus(){}},StatusLabel:{Caption:''},
    ResultsList:{Clear(){lines.length=0;},AddItem(line){lines.push(String(line));}}};
  const vm=new VirtualMachine(compiled,{fs:disk,createForm:()=>({controlMap:new Map(Object.entries(controls)),Show(){}})});
  await vm.start();assert.deepEqual(lines,['N = 10','Fibonacci(N) = 55','1 + ... + N = 55']);
  await vm.dispatch('Form1','SaveButton_Click');
  assert.equal(disk.read('/Pascal-Results.txt'),'TURBO PASCAL NUMBER LAB\r\nN = 10\r\nFibonacci(N) = 55\r\n1 + ... + N = 55\r\n');
  controls.InputText.Text='40';await vm.dispatch('Form1','CalculateButton_Click');
  assert.deepEqual(lines,['N = 40','Fibonacci(N) = 102334155','1 + ... + N = 820']);
  for(const text of ['-1','41','abc','3.5']) {
    controls.InputText.Text=text;await vm.dispatch('Form1','CalculateButton_Click');
    assert.equal(controls.StatusLabel.Caption,'Enter a whole number from 0 to 40.');
    await vm.dispatch('Form1','SaveButton_Click');
    assert.equal(controls.StatusLabel.Caption,'Calculate valid results before saving.');
  }
  assert.equal(disk.handles.size,0);vm.stop();
});

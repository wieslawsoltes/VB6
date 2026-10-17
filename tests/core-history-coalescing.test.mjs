import test from 'node:test';
import assert from 'node:assert/strict';
import {History} from '../src/core/history.js';

const valueApply=(model,text)=>{model.text=text;return model;};
const patchApply=(model,patches,undo)=>{
  for(const patch of undo?[...patches].reverse():patches){
    const before=undo?patch.after:patch.before,after=undo?patch.before:patch.after;
    assert.equal(model.text.slice(patch.start,patch.start+before.length),before);
    model.text=model.text.slice(0,patch.start)+after+model.text.slice(patch.start+before.length);
  }
  return model;
};
const append=(history,model,text='a',key='module',apply=patchApply)=>{
  const patch={start:model.text.length,before:'',after:text};
  // A false merge hint models a native editor's expired typing timeout.
  history.recordPatch(key,patch,apply,'Typing',false);
  return patchApply(model,[patch],false);
};

test('streaming insert commits 769 slow patches as one undo step with bounded segments',()=>{
  const h=new History(),original={text:'x'.repeat(1000000)},end=h.beginCoalescing('module','Vim insert');let model={...original},notifications=0;
  h.on('change',()=>notifications++);
  for(let i=0;i<769;i++){
    model=append(h,model,i%2?'😀':'a');
    assert.equal(h.transactionDepth,0);assert.equal(h.pendingBytes,0);assert.equal(h.canUndo,true);
  }
  assert.equal(h.undoStack.length,1);assert.equal(h.undoLabel,'Vim insert');assert.equal(notifications,769);
  assert.deepEqual(h.undoStack[0].entries.map(entry=>entry.patches.length),[256,256,256,1]);
  assert.ok(h.bytes<100000,'retained history follows changed text, not whole source copies');assert.equal(end.active,true);
  const final={...model};model=h.undo(model);assert.deepEqual(model,original);assert.equal(end.active,false);assert.equal(h.isDirty,false);
  assert.deepEqual(h.redo(model),final);assert.equal(h.isDirty,true);assert.equal(end(),false);
});

test('a change deletion and later insertions share the session opened before commit',()=>{
  const h=new History(),original={text:'keep replace tail'};let model={...original};h.beginCoalescing('module');
  const deletion={start:5,before:'replace ',after:''};h.recordPatch('module',deletion,patchApply,'Change',false);model=patchApply(model,[deletion],false);
  for(const text of ['new ','value ']){const patch={start:5,before:'',after:text};h.recordPatch('module',patch,patchApply,'Typing',false);model=patchApply(model,[patch],false);}
  assert.equal(h.undoStack.length,1);assert.deepEqual(h.undo(model),original);
});

test('streaming XAML value snapshots compact and returning to the initial value removes the undo step',()=>{
  const h=new History(),before='<Form />',end=h.beginCoalescing('xaml:project:form','Edit XAML');let text=before;
  for(let i=0;i<400;i++){const next=`<Form Caption="${i}" />`;h.recordValue('xaml:project:form',text,next,valueApply,'Edit XAML',false);text=next;}
  assert.equal(h.undoStack.length,1);assert.equal(h.undoStack[0].entries.length,1);assert.equal(h.bytes,(before.length+text.length)*2);
  h.recordValue('xaml:project:form',text,before,valueApply,'Edit XAML',false);
  assert.equal(h.undoStack.length,0);assert.equal(h.bytes,0);assert.equal(h.isDirty,false);assert.equal(end.active,true);
  h.recordValue('xaml:project:form',before,'<Form Caption="a" />',valueApply,'Edit XAML',false);
  assert.equal(h.undoStack.length,1);assert.deepEqual(h.undo({text:'<Form Caption="a" />'}),{text:before});
});

for(const [name,boundary]of [
  ['stopMerging',h=>h.stopMerging()],['savepoint',h=>h.markClean()],['capture',h=>h.capture()],
  ['undo',h=>h.undo({text:'a'})],['redo',h=>h.redo({text:'a'})],['reset',h=>h.reset()],
  ['restore',h=>h.restore({undo:[],redo:[],revision:0,clean:0,sequence:0})],
  ['undo stack replacement',h=>{h.undoStack=h.undoStack.slice();}],['redo stack replacement',h=>{h.redoStack=[];}],
  ['explicit transaction',h=>{h.beginTransaction('Other');h.commitTransaction();}]
])test('streaming scopes finish at '+name+' boundaries without leaving a transaction',()=>{
  const h=new History(),end=h.beginCoalescing('module');h.recordValue('module','','a',valueApply,'Type',false);
  boundary(h);assert.equal(end.active,false);assert.equal(end(),false);assert.equal(h.transactionDepth,0);
});

for(const [name,record]of [
  ['key',h=>h.recordValue('other','a','b',valueApply)],
  ['entry kind',h=>h.recordPatch('module',{start:0,before:'a',after:'b'},patchApply)],
  ['replay callback',h=>h.recordValue('module','a','b',(model,text)=>valueApply(model,text))],
  ['value continuity',h=>h.recordValue('module','outside','b',valueApply)],
  ['project snapshot',h=>h.record({text:'a'},{text:'b'})]
])test('unrelated '+name+' ends streaming coalescing and preserves separate undo entries',()=>{
  const h=new History(),end=h.beginCoalescing('module');h.recordValue('module','','a',valueApply);record(h);
  assert.equal(end.active,false);assert.equal(h.undoStack.length,2);
  h.recordValue('module','b','c',valueApply,'Type',false);assert.equal(h.undoStack.length,3);
  assert.deepEqual(h.undo({text:'c'}),{text:'b'});
});

test('cleanup tokens cannot finish newer editing sessions even when their keys are identical',()=>{
  const h=new History(),first=h.beginCoalescing('module');h.recordValue('module','','a',valueApply);
  const second=h.beginCoalescing('module');assert.equal(first.active,false);assert.equal(first.dispose,first);assert.equal(first(),false);assert.equal(second.active,true);
  h.recordValue('module','a','ab',valueApply);h.recordValue('module','ab','abc',valueApply);
  assert.equal(h.undoStack.length,2);assert.equal(second.dispose(),true);assert.equal(second(),false);
  assert.deepEqual(h.undo({text:'abc'}),{text:'a'});assert.deepEqual(h.undo({text:'a'}),{text:''});
});

test('live streaming appends preserve previously exposed group and segment references',()=>{
  const h=new History();h.beginCoalescing('module');let model=append(h,{text:''});
  const first=h.undoStack[0],segment=first.entries[0],revision=first.afterRevision;
  for(let i=0;i<300;i++)model=append(h,model);
  assert.notEqual(h.undoStack[0],first);assert.equal(first.entries.length,1);assert.equal(segment.patches.length,1);assert.equal(first.afterRevision,revision);
  assert.deepEqual(h.undo(model),{text:''});
});

test('streaming byte-budget rollovers retain a contiguous replayable suffix',()=>{
  const h=new History({limit:3,maxBytes:700,retainNewest:false}),end=h.beginCoalescing('module');let model={text:''};
  for(let i=0;i<500;i++){
    model=append(h,model);assert.equal(h.overBudget,false);assert.ok(h.bytes<=700);assert.ok(h.undoStack.length<=3);
    assert.ok(h.undoStack.every(group=>group.bytes<=700&&group.entries.every(entry=>entry.patches.length<=256)));
  }
  assert.equal(end.active,true);const final={...model};let steps=0;
  while(h.canUndo){model=h.undo(model);steps++;}assert.ok(steps>0);assert.ok(model.text.length>0,'older retained segments can be evicted by the configured budget');assert.ok(final.text.startsWith(model.text));
  while(h.canRedo)model=h.redo(model);assert.deepEqual(model,final);
});

test('zero and strict budgets do not resurrect evicted session entries; newest exception stays single-edit',()=>{
  for(const h of [new History({limit:0}),new History({maxBytes:0}),new History({maxBytes:1,retainNewest:false})]){
    const end=h.beginCoalescing('module');let model={text:''};for(let i=0;i<20;i++)model=append(h,model);
    assert.equal(h.bytes,0);assert.equal(h.canUndo,false);assert.equal(h.isDirty,true);end();
  }
  const legacy=new History({maxBytes:1}),end=legacy.beginCoalescing('module');let model={text:''};for(let i=0;i<3;i++)model=append(legacy,model);
  assert.equal(legacy.undoStack.length,1);assert.equal(legacy.undoStack[0].entries.length,1);assert.equal(legacy.undoStack[0].entries[0].patches.length,1);assert.equal(legacy.overBudget,true);
  assert.deepEqual(legacy.undo(model),{text:'aa'});assert.equal(end.active,false);
});

test('streaming savepoints and captures are immutable boundaries across following edits',()=>{
  const h=new History();h.beginCoalescing('module');h.recordValue('module','','a',valueApply);h.recordValue('module','a','ab',valueApply);h.markClean();
  const saved=h.capture(),capturedGroup=saved.undo[0];h.beginCoalescing('module');h.recordValue('module','ab','abc',valueApply);h.recordValue('module','abc','abcd',valueApply);
  assert.equal(capturedGroup.entries[0].after,'ab');assert.equal(h.undoStack.length,2);assert.equal(h.isDirty,true);
  assert.deepEqual(h.undo({text:'abcd'}),{text:'ab'});assert.equal(h.isDirty,false);
  h.restore(saved);assert.equal(h.undoStack[0],capturedGroup);assert.equal(h.isDirty,false);assert.deepEqual(h.undo({text:'ab'}),{text:''});
});

test('failed grouped replay is atomic even after an earlier segment mutated its private clone',()=>{
  const h=new History();let fail=false,model={text:'',nested:{value:1}};
  const apply=(value,patches,undo)=>{value.nested.value=9;if(fail&&undo&&patches[0].start===0)throw new Error('Segment failed');return patchApply(value,patches,undo);};
  h.beginCoalescing('module');for(let i=0;i<300;i++)model=append(h,model,'a','module',apply);
  const before=h.capture();fail=true;assert.throws(()=>h.undo(model),/Segment failed/);assert.deepEqual(h.capture(),before);assert.equal(model.text,'a'.repeat(300));assert.equal(model.nested.value,1);
});

test('coalescing validates before replacing a live scope and rejects history replay reentrancy',()=>{
  const h=new History(),end=h.beginCoalescing('module');
  for(const key of [undefined,null,'',3,{}])assert.throws(()=>h.beginCoalescing(key),TypeError);
  assert.throws(()=>h.beginCoalescing('other',{}),TypeError);assert.equal(end.active,true);
  h.stopMerging();h.beginTransaction();assert.throws(()=>h.beginCoalescing('module'),/transaction first/);h.commitTransaction();
  h.recordValue('module','','a',()=>{h.beginCoalescing('module');return {};});const saved=h.capture();assert.throws(()=>h.undo({text:'a'}),/during replay/);assert.deepEqual(h.capture(),saved);
});

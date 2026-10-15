import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeList,addListItem,removeListItem,clearList,setListIndex,setListIndexed,sortList,listIndex} from '../src/controls/list-state.js';
const make=(items=[],props={})=>{const c={type:'ListBox',items,props:{ListIndex:-1,...props},itemData:[],selectedIndices:new Set(),invalidate(){this.paints=(this.paints||0)+1;}};initializeList(c);return c;};
const state=c=>({items:c.items,data:c.itemData,selected:[...c.selectedIndices],index:c.props.ListIndex,insert:c._newIndex,revision:c.itemsRevision});
test('sorted insertions retain ItemData, selection, caret and actual NewIndex',()=>{
  const c=make(['B','D'],{Sorted:-1,ListIndex:1,ItemData:[22,44]});addListItem(c,'A');
  assert.deepEqual(c.items,['A','B','D']);assert.deepEqual(c.itemData,[0,22,44]);assert.equal(c._newIndex,0);assert.equal(c.props.ListIndex,2);assert.deepEqual([...c.selectedIndices],[2]);
  addListItem(c,'C',1);assert.deepEqual(c.items,['A','B','C','D']);assert.equal(c._newIndex,2);assert.equal(c.props.ListIndex,3);assert.equal(c.itemData[3],44);
});
test('equal labels sort stably and do not exchange their item data',()=>{
  const c=make(['same','same'],{Sorted:-1,ItemData:[11,22]});addListItem(c,'same');assert.deepEqual(c.itemData,[11,22,0]);assert.equal(c._newIndex,2);
});
test('removal before the caret shifts every selected index but preserves identities',()=>{
  const c=make(['A','B','C','D'],{MultiSelect:2,ListIndex:3,ItemData:[1,2,3,4]});setListIndexed(c,'selected',[1],-1);setListIndex(c,3);removeListItem(c,0);
  assert.deepEqual(c.items,['B','C','D']);assert.deepEqual(c.itemData,[2,3,4]);assert.deepEqual([...c.selectedIndices],[0,2]);assert.equal(c.props.ListIndex,2);
  removeListItem(c,2);assert.equal(c.props.ListIndex,-1);assert.deepEqual([...c.selectedIndices],[0]);
});
test('sorted text mutation reorders the complete entry, including the last-added index',()=>{
  const c=make(['A','B'],{Sorted:-1,ItemData:[1,2]});addListItem(c,'C');setListIndex(c,2);setListIndexed(c,'itemdata',[2],99);setListIndexed(c,'list',[2],'0');
  assert.deepEqual(c.items,['0','A','B']);assert.deepEqual(c.itemData,[99,1,2]);assert.equal(c._newIndex,0);assert.equal(c.props.ListIndex,0);assert.deepEqual([...c.selectedIndices],[0]);
});
test('all invalid list indices reject atomically including NaN and fractions',()=>{
  const c=make(['A']);const before=state(c);
  for(const index of [-1,.5,2,NaN,Infinity]){assert.throws(()=>addListItem(c,'B',index),e=>e.number===380);assert.deepEqual(state(c),before);}
  for(const index of [-1,.5,1,NaN,Infinity])for(const fn of [()=>removeListItem(c,index),()=>listIndex(c,index),()=>setListIndexed(c,'selected',[index],-1)])assert.throws(fn,e=>e.number===381);
  for(const index of [-2,.5,1,NaN,Infinity])assert.throws(()=>setListIndex(c,index),e=>e.number===380);
  assert.deepEqual(state(c),before);
});
test('ItemData uses signed Long coercion instead of overflow wrapping',()=>{
  const c=make(['A']);setListIndexed(c,'itemdata',[0],2147483647);assert.equal(c.itemData[0],2147483647);
  assert.throws(()=>setListIndexed(c,'itemdata',[0],2147483648),e=>e.number===6);assert.equal(c.itemData[0],2147483647);
  setListIndexed(c,'itemdata',[0],2.5);assert.equal(c.itemData[0],2);
});
test('single selection properties and ListIndex agree, including clearing',()=>{
  const c=make(['A','B']);setListIndexed(c,'selected',[0],-1);setListIndexed(c,'selected',[1],-1);assert.deepEqual([...c.selectedIndices],[1]);assert.equal(c.props.ListIndex,1);
  setListIndexed(c,'selected',[1],0);assert.equal(c.props.ListIndex,-1);assert.equal(c.selectedIndices.size,0);
  setListIndex(c,0);assert.deepEqual([...c.selectedIndices],[0]);clearList(c);assert.equal(c.props.ListIndex,-1);assert.equal(c._newIndex,-1);assert.equal(c.selectedIndices.size,0);
});
test('turning on sorting and changing combo text preserve selected entry data',()=>{
  const c=make(['Z','A'],{ListIndex:0,ItemData:[9,1]});c.type='ComboBox';c.props.Sorted=-1;sortList(c);assert.equal(c.props.ListIndex,1);assert.equal(c.props.Text,'Z');assert.deepEqual(c.itemData,[1,9]);
  setListIndexed(c,'list',[1],'B');assert.equal(c.props.Text,'B');
});

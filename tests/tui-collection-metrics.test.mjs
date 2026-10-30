import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCollectionMetrics,leaseCollectionMetrics} from '../src/rendering/collection-metrics.js';
import {CellBuffer} from '../src/tui/cells.js';
import {paintControl} from '../src/tui/controls.js';
import {tuiAttribute} from '../src/tui/appearance.js';
import {BrowserControl} from '../src/controls/controls.js';
import {projectionGrid} from '../src/tui/projection.js';

test('collection metric leases stack independently, update atomically and restore native pitch',()=>{
  const node={},values=[],off=bindCollectionMetrics(node,height=>values.push(height));
  const first=leaseCollectionMetrics(node,16),second=leaseCollectionMetrics(node,18);
  first.update(20);assert.deepEqual(values,[16,18]);
  second.dispose();second.dispose();assert.deepEqual(values,[16,18,20]);
  first.update(20);first.update(14.5);assert.deepEqual(values,[16,18,20,14.5]);
  first.dispose();assert.deepEqual(values,[16,18,20,14.5,null]);
  off();off();assert.equal(leaseCollectionMetrics(node,16),null);
});

test('provider replacement retires old leases without touching a new control binding',()=>{
  const node={},oldValues=[],values=[];
  const oldOff=bindCollectionMetrics(node,v=>oldValues.push(v)),old=leaseCollectionMetrics(node,16);
  const off=bindCollectionMetrics(node,v=>values.push(v)),current=leaseCollectionMetrics(node,24);
  oldOff();old.dispose();old.update(14);assert.deepEqual(oldValues,[16]);assert.deepEqual(values,[24]);
  off();current.dispose();assert.deepEqual(values,[24,null]);
});

test('collection metric validation rejects non-finite and unbounded requests before changing a provider',()=>{
  const node={},values=[];bindCollectionMetrics(node,v=>values.push(v));const lease=leaseCollectionMetrics(node,16);
  for(const value of [0,-1,513,NaN,Infinity,'16',null]){
    assert.throws(()=>lease.update(value),RangeError);assert.throws(()=>leaseCollectionMetrics(node,value),RangeError);
  }
  assert.deepEqual(values,[16]);lease.dispose();
});

test('metric callback failure preserves the active lease',()=>{
  const node={},values=[];bindCollectionMetrics(node,height=>{if(height===24)throw Error('unavailable');values.push(height);});
  const lease=leaseCollectionMetrics(node,16);
  assert.throws(()=>lease.update(24),/unavailable/);assert.throws(()=>leaseCollectionMetrics(node,24),/unavailable/);
  lease.update(18);lease.dispose();assert.deepEqual(values,[16,18,null]);
});

for(const type of ['TreeView','ListView'])test(`${type} metric changes preserve the logical scroll anchor and canonical selection`,()=>{
  const control=Object.create(BrowserControl.prototype),selected={key:'selected'},rows=Array(200).fill({});
  Object.assign(control,{type,node:{},viewport:{scrollTop:1005},spacer:{style:{}},treeRows:rows,listRows:rows,
    _selectedNode:selected,_selectedItem:selected,paintTreeRows(){this.painted=true;},paintListRows(){this.painted=true;}});
  control.setCollectionRowHeight(16);
  assert.equal(control.collectionRowHeight,16);assert.equal(control.viewport.scrollTop,804);
  assert.equal(control.spacer.style.height,'3200px');assert.equal(control._selectedNode,selected);assert.equal(control._selectedItem,selected);
  control.setCollectionRowHeight(null);assert.equal(control.collectionRowHeight,20);assert.equal(control.viewport.scrollTop,1005);
});

test('grid pitch switches retain an active editor while updating sticky offsets and virtual spacers',()=>{
  const cell={style:{}},spacer={dataset:{gridSpacerRows:'100'},style:{},children:[cell]},header={style:{},getAttribute:()=>3};
  const control=Object.create(BrowserControl.prototype),editor={input:{value:'unfinished'}};
  Object.assign(control,{type:'DataGrid',node:{},viewport:{scrollTop:2121},gridEditor:editor,
    table:{querySelectorAll:selector=>selector.includes('spacer')?[spacer]:[header]},paintGridRows(){assert.equal(this.gridEditor,editor);}});
  control.setCollectionRowHeight(18);
  assert.equal(control.collectionRowHeight,18);assert.equal(control.viewport.scrollTop,1818);
  assert.equal(spacer.style.height,'1800px');assert.equal(cell.style.height,'1800px');assert.equal(header.style.top,'36px');
  assert.equal(control.gridEditor.input.value,'unfinished');assert.equal(control.RowHeight(),315);
  control.setCollectionRowHeight(null);assert.equal(control.viewport.scrollTop,2121);assert.equal(control.collectionRowHeight,21);
});

test('collection text alignment preserves full row origins through horizontal clipping and supplementary characters',()=>{
  const b=new CellBuffer(12,3);
  paintControl(b,{type:'ListView',rows:[
    {x:0,y:0,width:12,height:1,text:'A😀',alignment:'right'},
    {x:0,y:1,width:12,height:1,text:'1234',alignment:'center'},
    {x:-3,y:2,width:12,height:1,text:'ABCDEFGHIJKL',clip:{x:0,y:2,width:6,height:1}}
  ]});
  assert.equal(b.toText(),'          A😀\n    1234    \nDEFGHI      ');assert.equal(b.clips.length,1);
});

test('sticky headers overlay scrolled rows without clearing their next character row',()=>{
  const b=new CellBuffer(8,3);
  paintControl(b,{type:'DataGrid',rows:[
    {x:0,y:0,width:8,height:1,text:'Header',kind:'header'},
    {x:0,y:0,width:8,height:1,text:'Occluded',selected:true},
    {x:0,y:1,width:8,height:1,text:'Visible'}
  ]},'commander');
  assert.equal(b.toText(),'Header  \nVisible \n        ');
  const header=tuiAttribute('commander','menu');assert.equal(b.colors[0],header.foreground|(header.background<<4));
});

test('disabled collection items override selection and keep their native row alignment',()=>{
  const b=new CellBuffer(8,1);paintControl(b,{type:'StatusBar',rows:[{x:0,y:0,width:8,height:1,text:'Off',alignment:'right',selected:true,disabled:true}]},'commander');
  const a=tuiAttribute('commander','disabled');assert.equal(b.toText(),'     Off');assert.ok(b.colors.every(color=>color===(a.foreground|(a.background<<4))));
});

test('column separators reserve their own cell and never erase adjacent aligned values',()=>{
  const b=new CellBuffer(16,2);paintControl(b,{type:'ListView',rows:[
    {x:0,y:0,width:8,height:1,text:'7',alignment:'right',separator:true},
    {x:8,y:0,width:8,height:1,text:'Next',separator:true},
    {x:-4,y:1,width:12,height:1,text:'abcdefghijkl',separator:true,clip:{x:0,y:1,width:6,height:1}}
  ]});
  assert.equal(b.toText(),'      7│Next   │\nefghij          ');assert.equal(b.clips.length,1);
});

test('independently quantized browser rectangles preserve the first column and header row',()=>{
  const node={offsetWidth:280,offsetHeight:180,clientLeft:2,clientTop:2,clientWidth:276,clientHeight:176,
    getBoundingClientRect:()=>({left:285.3500061035156,top:166.8333282470703,width:273.45001220703125,height:175.78334045410156})};
  const grid=projectionGrid(node,35,11,{cellWidth:8,cellHeight:16});
  assert.deepEqual(grid.project({left:287.29998779296875,top:168.78334045410156,right:381.04998779296875,bottom:184.4166717529297}),{x:0,y:0,width:12,height:1});
  const genuinelyScrolled=grid.project({left:grid.x-1,top:grid.y-1,right:grid.x+95,bottom:grid.y+15});
  assert.equal(genuinelyScrolled.x,-1);assert.equal(genuinelyScrolled.y,-1);
});

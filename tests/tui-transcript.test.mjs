import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTranscript} from '../src/tui/transcript.js';
import {CellBuffer} from '../src/tui/cells.js';
import {paintChrome} from '../src/tui/chrome.js';
import {tuiAttribute} from '../src/tui/appearance.js';
import {ToolList} from '../src/ide/virtual-list.js';

function transcript(text,{width=80,left=0,top=0,wrap=false,start=0,end=0}={}){
  const textNode={textContent:text},node={textContent:text,clientWidth:width,scrollLeft:left,scrollTop:top,contains:n=>n===textNode};
  node.ownerDocument={defaultView:{getComputedStyle:()=>({whiteSpace:wrap?'pre-wrap':'pre'})},
    getSelection:()=>({rangeCount:1,isCollapsed:start===end,getRangeAt:()=>({startContainer:textNode,endContainer:textNode,startOffset:start,endOffset:end})}),
    createRange:()=>({selectNodeContents(){},comparePoint(){return 0;},setEnd(n,offset){this.end=offset;},toString(){return text.slice(0,this.end);}})};
  return node;
}
const metrics={cellWidth:8,cellHeight:16};

test('transcript projection combines native scroll offsets and full-width selection runs',()=>{
  const node=transcript('first\nsecond\nthird',{width:40,top:16,start:6,end:12});
  const state=captureTranscript(node,5,2,metrics),buffer=new CellBuffer(5,2);
  paintChrome(buffer,state,'turbo');assert.equal(buffer.toText(),'secon\nthird');
  const attr=tuiAttribute('turbo','selected');assert.ok(buffer.colors.slice(0,5).every(c=>c===(attr.foreground|attr.background<<4)));
  assert.ok(state.transcript&&state.source);
});

test('partial trailing pixels cannot introduce an extra wrapping character',()=>{
  const node=transcript('abcdefghijk',{width:43,wrap:true});
  const state=captureTranscript(node,6,3,metrics),buffer=new CellBuffer(6,3);
  paintChrome(buffer,state,'turbo');assert.equal(buffer.toText(),'abcde \nfghij \nk     ');
});

test('transcript tabs and supplementary character offsets stay in the canonical UTF-16 space',()=>{
  const node=transcript('A😀\tBC',{width:80,start:1,end:3});
  const state=captureTranscript(node,10,1,metrics),buffer=new CellBuffer(10,1);
  paintChrome(buffer,state,'turbo');assert.equal(buffer.toText(),'A😀      BC');
  assert.deepEqual(state.items.filter(i=>i.selected).map(i=>i.text),['😀']);
});

test('oversized transcripts fail closed under the shared source budget',()=>{
  assert.throws(()=>captureTranscript(transcript('x'.repeat(1048577)),10,1,metrics),/source budget/);
});

test('virtual tool row metrics remain backward compatible and reject invalid presentation values',()=>{
  const value=Object.create(ToolList.prototype);value.rowHeight=19;let css='';
  value.root={ownerDocument:{defaultView:{getComputedStyle:()=>({getPropertyValue:()=>css})}}};
  assert.equal(value.rowHeight,19);css='18px';assert.equal(value.rowHeight,18);
  for(const bad of ['NaN','Infinity','0px','-1','129px']){css=bad;assert.equal(value.rowHeight,19);}
  css='';value.rowHeight=21;assert.equal(value.rowHeight,21);
});

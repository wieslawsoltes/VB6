import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceEditor} from '../src/editor/editor.js';

class Element {
  constructor(document,tagName='div') {
    this.ownerDocument=document;this.tagName=tagName;this.dataset={};this.style={};
    this.className='';this.title='';this.childNodes=[];this.parentNode=null;this.detachments=0;
  }
  setAttribute(name,value) { if(name==='class')this.className=String(value);else this[name]=String(value); }
  append(...nodes) { for(const node of nodes)this.insertBefore(node,null); }
  insertBefore(node,next) {
    if(node instanceof Element){node.remove();node.parentNode=this;}
    const index=next===null?this.childNodes.length:this.childNodes.indexOf(next);
    assert.notEqual(index,-1);this.childNodes.splice(index,0,node);
  }
  remove() {
    if(!this.parentNode)return;
    this.detachments++;const siblings=this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this),1);this.parentNode=null;
  }
  replaceChildren(...nodes) {
    for(const node of [...this.childNodes])if(node instanceof Element)node.remove();
    this.childNodes=[];this.append(...nodes);
  }
}
function fixture() {
  const document={createElement(tag){return new Element(document,tag);}};
  const pane={gutter:new Element(document),range:{firstLine:0}};
  const editor=Object.assign(Object.create(SourceEditor.prototype),{
    module:{id:'form',name:'Form1'},showLineNumbers:true,lineHeight:17,
    metrics:{domUpdates:0},diagnosticMap:new Map(),diagnosticRevision:0
  });
  const paint=(first=0,last=5,top=0,breakpoints=new Set(),bookmarks=new Set())=>editor.paintGutter(pane,first,last,top,breakpoints,bookmarks);
  const rows=()=>pane.gutter.childNodes.filter(node=>node instanceof Element&&node.dataset.line);
  return {document,pane,editor,paint,rows};
}

test('diagnostics update visible gutter rows without detaching the pressed native hit target',()=>{
  const f=fixture();f.paint();const row=f.rows()[2],text=row.childNodes[0];
  f.editor.diagnosticMap.set('form1:3',{message:'Expected expression'});f.editor.diagnosticRevision++;f.paint();
  assert.equal(f.rows()[2],row);assert.equal(row.detachments,0);assert.equal(row.childNodes[0],text);
  assert.equal(row.className,'gutter-line has-error');assert.equal(row.title,'Expected expression');
  f.editor.diagnosticMap.clear();f.editor.diagnosticRevision++;f.paint();
  assert.equal(f.rows()[2],row);assert.equal(row.detachments,0);assert.equal(row.className,'gutter-line');
  assert.equal(row.title,'Set breakpoint');
});

test('breakpoint and bookmark decorations update within the stable gutter row',()=>{
  const f=fixture();f.paint();const row=f.rows()[2];
  f.paint(0,5,0,new Set([3]));assert.equal(f.rows()[2],row);assert.equal(row.detachments,0);
  assert.equal(row.childNodes[0].className,'breakpoint-dot');assert.equal(row.title,'Remove breakpoint');
  const dot=row.childNodes[0];f.editor.diagnosticRevision++;f.paint(0,5,0,new Set([3]));
  assert.equal(row.childNodes[0],dot);assert.equal(dot.detachments,0);
  f.paint(0,5,0,new Set(),new Set([3]));assert.equal(row.childNodes[0].className,'bookmark-symbol');
  f.paint();assert.equal(row.childNodes[0],'3');assert.equal(row.detachments,0);
});

test('scroll reconciliation stays bounded, retains overlapping rows and leaves the DOS canvas intact',()=>{
  const f=fixture();f.paint();const original=f.rows(),canvas=new Element(f.document,'canvas');
  canvas.style.top='0px';f.pane.gutter.append(canvas);
  f.paint(2,7,34);
  assert.deepEqual(f.rows().map(node=>node.dataset.line),['3','4','5','6','7']);
  assert.equal(f.rows()[0],original[2]);assert.equal(original[2].detachments,0);
  assert.equal(original[0].parentNode,null);assert.equal(f.pane.gutterRows.size,5);
  assert.equal(canvas.parentNode,f.pane.gutter);assert.equal(canvas.detachments,0);assert.equal(canvas.style.top,'0px');
  f.paint(2,7,35);assert.equal(original[2].style.top,'3px');assert.equal(canvas.style.top,'0px');
  f.paint(0,5,0);assert.deepEqual(f.rows().map(node=>node.dataset.line),['1','2','3','4','5']);
  assert.equal(f.rows()[2],original[2]);assert.equal(original[2].detachments,0);assert.equal(f.pane.gutterRows.size,5);
});

test('equal-sized procedure projections use their actual global line numbers',()=>{
  const f=fixture();f.paint(0,3);f.pane.range.firstLine=20;f.paint(0,3);
  assert.deepEqual(f.rows().map(node=>node.dataset.line),['21','22','23']);
  assert.deepEqual(f.rows().map(node=>node.style.top),['4px','21px','38px']);
  assert.equal(f.pane.gutterRows.size,3);
  f.paint(3,3);assert.equal(f.rows().length,0);assert.equal(f.pane.gutterRows.size,0);
});

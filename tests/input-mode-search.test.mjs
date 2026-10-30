import test from 'node:test';
import assert from 'node:assert/strict';
import {indexSource} from '../src/editor/projection.js';
import {InputModeSearchOverlay,searchLineRanges} from '../src/editor/input-modes/search-overlay.js';

test('search overlays preserve regex boundaries, flags and caller state',()=>{
  const query=/\bcat\b/gi;query.lastIndex=3;
  const index=indexSource('cat scatter CAT\nCat\ncat'),matches=searchLineRanges(index,[{startLineNumber:1,endLineNumber:2}],query);
  assert.deepEqual(matches,[{line:1,from:0,to:3},{line:1,from:12,to:15},{line:2,from:0,to:3}]);
  assert.equal(query.lastIndex,3);assert.deepEqual(searchLineRanges(index,[{startLineNumber:1,endLineNumber:3}],{source:'[',flags:''}),[]);
});

test('empty Unicode matches advance code points and respect a decoration budget',()=>{
  const index=indexSource('😀x\nend');
  assert.deepEqual(searchLineRanges(index,[{startLineNumber:1,endLineNumber:2}],/(?=)/u,3),[{line:1,from:0,to:0},{line:1,from:2,to:2},{line:1,from:3,to:3}]);
  const reads=[],lines=new Proxy({length:100001},{get(target,key){if(key==='length')return target.length;reads.push(Number(key));return 'needle';}});
  assert.equal(searchLineRanges({lines},[{startLineNumber:100000,endLineNumber:100001}],/needle/).length,2);
  assert.deepEqual(reads,[99999,100000]);
});

class Element {
  constructor(doc,rect={left:0,top:0}){this.ownerDocument=doc;this.rect=rect;this.children=[];this.style={};this.dataset={};this.clientWidth=400;this.clientHeight=80;this.scrollTop=0;this.scrollLeft=0;}
  append(node){node.remove();node.parentNode=this;this.children.push(node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  replaceChildren(...nodes){for(const child of [...this.children])child.remove();for(const node of nodes)this.append(node);}
  setAttribute(){}
  getBoundingClientRect(){return {...this.rect,width:this.clientWidth,height:this.clientHeight};}
}
function fixture(text){
  const doc={defaultView:{getComputedStyle:()=>({paddingLeft:'3px',paddingTop:'4px'})}};doc.createElement=()=>new Element(doc);
  const input=new Element(doc,{left:20,top:0}),viewport=new Element(doc),host={root:{ownerDocument:doc},mode:{mode:'normal'},index:indexSource(text),options:{lineHeight:10,charWidth:8,tabSize:4},scheduled:0,
    schedulePaint(){this.scheduled++;},visualColumn(text,offset){let col=0;for(const glyph of text.slice(0,offset))col+=glyph==='\t'?4-col%4:1;return col;},
    getSelections(){throw new Error('Search painting must not read or change selections');},apply(){throw new Error('Search painting must not edit source');}};
  const pane={input,viewport,range:{firstLine:0},lines:host.index.lines};host.editor={input,viewport,panes:[pane]};
  return {host,doc,input,viewport,pane,overlay:new InputModeSearchOverlay(host)};
}

test('native search paints projection offsets, tabs and every split without source selection changes',()=>{
  const f=fixture('hidden\nskipped\n\tneedle needle\nlast');f.pane.range.firstLine=2;f.pane.lines=f.host.index.lines.slice(2);
  f.overlay.set({query:/needle/g});f.overlay.paint();
  const first=f.viewport.children[0].children[0];assert.equal(first.style.left,'55px');assert.equal(first.style.top,'4px');assert.equal(first.style.width,'48px');
  assert.equal(first.dataset.searchStart,String(f.host.index.starts[2]+1));assert.equal(first.dataset.searchEnd,String(f.host.index.starts[2]+7));
  assert.equal(f.viewport.children[0].children.length,2);
  const viewport=new Element(f.doc),input=new Element(f.doc);f.host.editor.panes.push({input,viewport,range:{firstLine:0},lines:f.host.index.lines});f.overlay.paint();
  assert.equal(viewport.children[0].children.length,2);
  f.input.scrollLeft=32;f.overlay.paint();assert.equal(f.viewport.children[0].children[0].style.left,'23px');
  f.host.editor.panes.pop();f.overlay.paint();assert.equal(viewport.children.length,0);
  f.overlay.set(null);assert.equal(f.viewport.children.length,0);
});

test('Monaco highlights visible unfolded ranges with cached decorations and cleanup across backends',()=>{
  const f=fixture('needle\nneedle\nneedle\nneedle'),sets=[],listeners=[],collection={set(value){sets.push(value);},clear(){this.cleared=(this.cleared||0)+1;}};
  const view={createDecorationsCollection:()=>collection,getVisibleRanges:()=>[{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:7},{startLineNumber:4,startColumn:1,endLineNumber:4,endColumn:7}]};
  for(const event of ['onDidScrollChange','onDidLayoutChange','onDidChangeModelContent','onDidChangeHiddenAreas'])view[event]=callback=>{const listener={callback,dispose(){this.disposed=true;}};listeners.push(listener);return listener;};
  f.host.surface={views:[{view}]};f.overlay.set({query:/needle/});f.overlay.paint();
  assert.deepEqual(sets[0].map(value=>value.range.startLineNumber),[1,4]);assert.ok(sets[0].every(value=>value.options.className==='input-mode-search-match'));
  f.overlay.paint();assert.equal(sets.length,1);
  listeners[0].callback();assert.equal(f.host.scheduled,1);
  f.host.index=indexSource('different\nneedle\nneedle\nneedle');f.overlay.paint();assert.equal(sets.length,2);assert.deepEqual(sets[1].map(value=>value.range.startLineNumber),[4]);
  f.host.surface=null;f.overlay.paint();assert.equal(collection.cleared,1);assert.ok(listeners.every(value=>value.disposed));assert.equal(f.viewport.children[0].children.length,3);
  f.host.mode=null;f.overlay.paint();assert.equal(f.viewport.children.length,0);
  f.overlay.dispose();assert.equal(f.overlay.query,null);assert.equal(f.overlay.advanced.size,0);
});

test('XAML search uses full source positions and disposal removes all presentation',()=>{
  const f=fixture('<Grid>\n<Button />\n</Grid>');f.host.xaml=true;f.overlay.set({query:/Grid/});f.overlay.paint();
  assert.deepEqual(f.viewport.children[0].children.map(node=>Number(node.dataset.searchStart)),[1,20]);
  f.overlay.dispose();assert.equal(f.viewport.children.length,0);f.overlay.paint();assert.equal(f.viewport.children.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorHost} from '../src/editor/input-modes/editor-host.js';
import {SourceEditor} from '../src/editor/editor.js';
import {VirtualTextInput} from '../src/editor/virtual-input.js';
import {indexSource,positionAt,offsetAt} from '../src/editor/projection.js';
import {History} from '../src/core/history.js';

class Node extends EventTarget {
  constructor(document,tagName='DIV'){
    super();this.ownerDocument=document;this.tagName=tagName;this.children=[];this.dataset={};this.attributes=new Map();this.style={setProperty(){},removeProperty(){}};
    this.classList={add(){},remove(){},toggle(){}};this.value='';this.selectionStart=0;this.selectionEnd=0;this.selectionDirection='none';this.scrollTop=0;this.scrollLeft=0;this.clientHeight=200;this.clientWidth=400;
  }
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  setSelectionRange(start,end,direction='none'){this.selectionStart=Math.max(0,Math.min(this.value.length,start));this.selectionEnd=Math.max(this.selectionStart,Math.min(this.value.length,end));this.selectionDirection=direction;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
  get offsetHeight(){return parseFloat(this.style.height)||this.clientHeight;}
  matches(selector){return this.tagName==='TEXTAREA'&&this.className==='inputarea'&&selector.includes('textarea.inputarea');}
  querySelector(selector){return this.children.find(child=>child.matches(selector))||this.children.map(child=>child.querySelector(selector)).find(Boolean)||null;}
}
function documentFixture(){const doc={defaultView:{getComputedStyle:()=>({paddingLeft:'3px',paddingTop:'4px'})},activeElement:null};doc.createElement=tag=>new Node(doc,tag.toUpperCase());return doc;}

function sourceFixture(text,{mode='module',threshold=2000}={}){
  const doc=documentFixture(),root=new Node(doc),project={settings:{tabWidth:4},modules:[{id:'module',name:'Module1',code:text,bookmarks:[]}]},history=new History(),changes=[];
  const editor=Object.assign(Object.create(SourceEditor.prototype),{
    root,project,module:project.modules[0],listeners:new Map(),text:'',lastValue:'',index:indexSource(''),metrics:{indexedLines:0},panes:[],lineHeight:17,characterWidth:8,
    appearance:{},procedures:new Node(doc),objects:new Node(doc),paint(){},schedulePaint(){},updateSelectors(){},closeCompletion(){},closeInfo(){},refreshAssistance(){this.changingSource=false;},
    dispose(){this.disposed=true;this.root.remove();},setAppearance(){},setReadOnly(value){this.readOnly=value;for(const pane of this.panes)pane.input.readOnly=value;}
  });
  function addPane(){
    const input=new Node(doc,'TEXTAREA'),viewport=new Node(doc),node=new Node(doc);viewport.append(input);node.append(viewport);root.append(node);
    const pane={input,viewport,node,procedureButton:new Node(doc),moduleButton:new Node(doc),mode,range:{start:0,end:0,firstLine:0},lines:['']};
    pane.virtualizer=Object.assign(Object.create(VirtualTextInput.prototype),{editor,pane,active:false,threshold,windowSize:256,rail:new Node(doc),spacer:new Node(doc)});
    editor.panes.push(pane);editor.activePane??=pane;editor.syncPane(pane,0);return pane;
  }
  editor.primary=addPane();editor.assignSource(text,{start:0,end:0});editor.input.focus();
  const apply=(current,patches,undo)=>{const module=current.modules[0];for(const patch of undo?[...patches].reverse():patches){const before=undo?patch.after:patch.before,after=undo?patch.before:patch.after;assert.equal(module.code.slice(patch.start,patch.start+before.length),before);module.code=module.code.slice(0,patch.start)+after+module.code.slice(patch.start+before.length);}return current;};
  const ide={project,history,runState:'design',documents:{designers:new Map()},commands:[],command(id){this.commands.push(id);const next=history[id]?.(this.project);if(next){this.project=next;editor.setDocument(next.modules[0],next);}return next;}};
  editor.on('change',event=>{changes.push(event);event.module.code=event.newText;const change=event.change;history.recordPatch('module',{start:change.start,before:event.oldText.slice(change.start,change.oldEnd),after:event.newText.slice(change.start,change.newEnd)},apply,'Edit Module1',event.kind==='typing');});
  return {editor,ide,history,changes,doc,addPane,host:new EditorHost(editor,ide)};
}

test('full-buffer point motions change procedure projection without clipping virtual selections',()=>{
  const code='Option Explicit\n\nSub Alpha()\nA1\nA2\nEnd Sub\n\nSub Beta()\nB1\nB2\nEnd Sub\n';
  const f=sourceFixture(code,{mode:'procedure',threshold:2});
  const beta=code.indexOf('B1');f.host.setSelections([{anchor:beta,head:beta}]);
  assert.equal(f.editor.activePane.mode,'procedure');assert.equal(f.editor.activePane.virtualizer.full.name,'Beta');
  assert.deepEqual(f.host.getSelections(),[{anchor:beta,head:beta}]);assert.equal(f.editor.text,code);
  const alpha=code.indexOf('A1');f.host.setSelections([{anchor:beta+2,head:alpha}]);
  assert.equal(f.editor.activePane.mode,'module');assert.equal(f.editor.activePane.virtualizer.direction,'backward');
  assert.deepEqual(f.host.getSelections(),[{anchor:beta+2,head:alpha}]);f.host.dispose();
});

test('a distant Unicode edit preserves full source and split selection with one sparse history patch',()=>{
  const code='Option Explicit\n'+Array.from({length:12000},(_,i)=>`value${i} = ${i}\n`).join('');
  const f=sourceFixture(code),second=f.addPane();f.editor.syncPane(second,8,12);const originalOther=f.editor.selectionBounds(second);
  const start=f.editor.index.starts[10000]+2,next=code.slice(0,start)+'😀'+code.slice(start+1);
  assert.equal(f.host.apply(next,[{anchor:start+2,head:start+2}],{origin:'vim',kind:'command'}),true);
  assert.equal(f.editor.text,next);assert.equal(f.changes.length,1);assert.equal(f.changes[0].kind,'command');assert.equal(f.history.undoStack.length,1);
  assert.ok(f.history.undoStack[0].bytes<1000);assert.ok(f.editor.input.value.length<10000);assert.deepEqual(f.editor.selectionBounds(second),originalOther);
  assert.deepEqual(f.host.getSelections(),[{anchor:start+2,head:start+2}]);
  f.host.undo();assert.equal(f.host.getText(),code);f.host.redo();assert.equal(f.host.getText(),next);assert.deepEqual(f.ide.commands,['undo','redo']);f.host.dispose();
});

test('change and open commands join their following live insert session in canonical history',()=>{
  const f=sourceFixture('alpha beta\n'),end=f.history.beginCoalescing('module');
  f.host.apply(' beta\n',[{anchor:0,head:0}],{origin:'vim',kind:'command'});
  assert.equal(end.active,true);
  f.host.apply('new beta\n',[{anchor:3,head:3}],{origin:'typing',kind:'typing'});
  end();assert.equal(f.history.undoStack.length,1);assert.equal(f.history.transactionDepth,0);
  f.host.undo();assert.equal(f.host.getText(),'alpha beta\n');
  f.host.redo();assert.equal(f.host.getText(),'new beta\n');f.host.dispose();
});

test('secondary selections retain direction and cannot be mutated through the returned array',()=>{
  const f=sourceFixture('alpha\nbeta\ngamma\n'),selections=[{anchor:4,head:1},{anchor:9,head:7},{anchor:14,head:12}];
  f.host.setSelections(selections);assert.deepEqual(f.host.getSelections(),selections);
  const returned=f.host.getSelections();returned[1].head=0;assert.deepEqual(f.host.getSelections(),selections);
  f.editor.input.setSelectionRange(0,0);assert.deepEqual(f.host.getSelections(),[{anchor:0,head:0}]);f.host.dispose();
});

test('read-only and composition guards preserve source while still allowing motions',()=>{
  const f=sourceFixture('alpha\nbeta');f.editor.setReadOnly(true);
  f.host.setSelections([{anchor:6,head:6}]);assert.equal(f.host.primarySelection().head,6);assert.equal(f.host.apply('changed',[]),false);assert.equal(f.changes.length,0);
  f.editor.setReadOnly(false);f.editor.composing=true;assert.equal(f.host.apply('changed',[]),false);assert.equal(f.host.getText(),'alpha\nbeta');f.host.dispose();
});

test('XAML commands use one explicit non-typing designer transaction and retain selection direction',async()=>{
  const doc=documentFixture(),root=new Node(doc),input=new Node(doc,'TEXTAREA'),calls=[],editor={root,input,viewport:new Node(doc),text:'<A />',lineHeight:17,
    setDocument(text){this.text=text;input.value=text;},reveal(start,end){input.setSelectionRange(start,end);input.scrollTop=80;},cursor(){},dispose(){this.closed=true;}};
  root.append(input);editor.setDocument(editor.text);
  const ide={runState:'design',history:{stopMerging(){}},documents:{designers:new Map()},xaml:{tools:new Map([['form',{moduleId:'form',editor}]]),apply(id,text,options){calls.push({id,text,options});editor.setDocument(text);}}};
  const host=new EditorHost(editor,ide),events=[];host.subscribe(event=>events.push(event));
  assert.equal(host.apply('<Button />',[{anchor:7,head:1}],{origin:'vim',kind:'command'}),true);
  assert.deepEqual(calls,[{id:'form',text:'<Button />',options:{typing:false}}]);assert.deepEqual(host.getSelections(),[{anchor:7,head:1}]);
  input.scrollTop=19;host.setSelections([{anchor:0,head:0}],{reveal:false});assert.equal(input.scrollTop,19);
  await Promise.resolve();assert.equal(events.filter(event=>event.type==='change').length,1);
  ide.documents.designers.set('form',{locked:true});assert.equal(host.readOnly,true);assert.equal(host.apply('<C />',[]),false);host.dispose();
});

function attachMonaco(f){
  const doc=f.doc,pane=new Node(doc),input=new Node(doc,'TEXTAREA');input.className='inputarea';pane.append(input);f.editor.root.append(pane);
  const model={value:f.editor.text,valueReads:0,getValue(){this.valueReads++;return this.value;},getPositionAt(offset){const p=positionAt(indexSource(this.value),offset);return {lineNumber:p.line,column:p.column};},getOffsetAt(p){return offsetAt(indexSource(this.value),p.lineNumber,p.column);},getOptions(){return {tabSize:3,insertSpaces:false};}};
  const view={selections:[{selectionStartLineNumber:1,selectionStartColumn:1,positionLineNumber:1,positionColumn:1}],raw:{cursorStyle:'line-thin',cursorBlinking:'phase',lineHeight:20},
    getDomNode:()=>pane,getSelections(){return this.selections;},getSelection(){return this.selections[0];},setSelections(values){this.selections=values;},getRawOptions(){return this.raw;},updateOptions(options){Object.assign(this.raw,options);},focus(){input.focus();},revealPositionInCenterIfOutsideViewport(){}};
  const runtime={surfaces:new Map()},surface={view,views:[{view,pane}],record:{model,lastText:model.value,moduleId:'module'},runtime,readOnly:()=>!!f.editor.readOnly};runtime.surfaces.set(f.editor,surface);f.ide.advancedEditor={runtime};
  const original=f.editor.replaceGlobal;f.editor.replaceGlobal=function(text,start,end,kind){model.value=model.value.slice(0,start)+text+model.value.slice(end);surface.record.lastText=model.value;return original.call(this,text,start,end,kind);};
  return {model,view,pane,input,surface,runtime};
}

test('host follows a dynamically enabled Monaco surface and restores its exact cursor options',()=>{
  const f=sourceFixture('alpha\nbeta\n'),advanced=attachMonaco(f);
  const selections=[{anchor:9,head:6},{anchor:4,head:1}];f.host.setSelections(selections);assert.deepEqual(f.host.getSelections(),selections);assert.equal(f.host.options.tabSize,3);assert.equal(f.host.options.indentWithTabs,true);
  assert.equal(f.host.ownsEvent({target:advanced.input}),true);assert.equal(f.host.ownsEvent({target:f.editor.input}),false);
  f.host.focus();assert.equal(f.doc.activeElement,advanced.input);
  f.host.setMode({mode:'normal'});assert.equal(advanced.view.raw.cursorStyle,'block');assert.equal(advanced.view.raw.cursorBlinking,'solid');
  f.host.setMode({mode:'insert'});assert.equal(advanced.view.raw.cursorStyle,'line');
  assert.equal(f.host.apply('ALPHA\nbeta\n',[{anchor:5,head:5}],{kind:'command'}),true);assert.equal(f.changes.length,1);assert.equal(advanced.model.value,f.editor.text);
  f.host.dispose();assert.equal(advanced.view.raw.cursorStyle,'line-thin');assert.equal(advanced.view.raw.cursorBlinking,'phase');assert.equal(f.editor.input.dataset.vimMode,undefined);
});

test('backend transitions preserve backward and block selections without stealing another split or module selection',()=>{
  const f=sourceFixture('alpha\nbeta\ngamma\n'),values=[{anchor:4,head:1},{anchor:9,head:7}];
  f.host.setMode({mode:'visual',subMode:'blockwise'});f.host.setSelections(values);
  const second=f.addPane();second.input.setSelectionRange(10,10);f.editor.activePane=second;
  assert.deepEqual(f.host.getSelections(),[{anchor:10,head:10}]);
  f.editor.activePane=f.editor.primary;assert.deepEqual(f.host.getSelections(),values);
  for(let cycle=0;cycle<2;cycle++){
    const a=attachMonaco(f);
    a.view.setSelections([{selectionStartLineNumber:1,selectionStartColumn:2,positionLineNumber:1,positionColumn:5}]);
    assert.deepEqual(f.host.getSelections(),values);
    assert.equal(a.view.getSelections().length,2);
    a.runtime.surfaces.delete(f.editor);a.pane.remove();f.editor.input.setSelectionRange(1,4);
    assert.deepEqual(f.host.getSelections(),values);assert.equal(f.editor.input.selectionDirection,'backward');
  }
  const a=attachMonaco(f);a.view.setSelections([{selectionStartLineNumber:1,selectionStartColumn:2,positionLineNumber:1,positionColumn:5}]);
  f.editor.module={...f.editor.module,id:'other'};
  assert.deepEqual(f.host.getSelections(),[{anchor:1,head:4}]);f.host.dispose();
});

test('Monaco native selection changes are retained before a same-turn backend teardown',()=>{
  const f=sourceFixture('alpha\nbeta\ngamma\n'),a=attachMonaco(f);f.host.setMode({mode:'visual',subMode:'blockwise'});f.host.getSelections();
  a.view.setSelections([{selectionStartLineNumber:2,selectionStartColumn:4,positionLineNumber:2,positionColumn:2},{selectionStartLineNumber:3,selectionStartColumn:4,positionLineNumber:3,positionColumn:2}]);
  f.editor.emit('cursor',{});
  a.surface.disposed=true;a.view.selections=[];f.editor.input.setSelectionRange(0,0);f.editor.emit('cursor',{});
  a.runtime.surfaces.delete(f.editor);a.pane.remove();f.editor.input.setSelectionRange(7,9);
  assert.deepEqual(f.host.getSelections(),[{anchor:9,head:7},{anchor:14,head:12}]);f.host.dispose();
});

test('shared method hooks remain observable after detach while another surface wraps a method',async()=>{
  const f=sourceFixture('alpha'),under=f.editor.setDocument,appearance=f.editor.setAppearance;
  f.editor.setDocument=function(...args){return under.apply(this,args);};f.host.dispose();
  const next=new EditorHost(f.editor,f.ide),events=[];next.subscribe(event=>events.push(event));
  f.editor.setDocument({...f.editor.module,code:'beta'},f.editor.project);f.editor.setAppearance({});await Promise.resolve();
  assert.ok(events.some(event=>event.type==='change'&&event.newText==='beta'));assert.ok(events.some(event=>event.type==='surface'));
  assert.equal(f.editor.setAppearance,appearance);next.dispose();const count=events.length;f.editor.setAppearance({});await Promise.resolve();assert.equal(events.length,count);
});

test('classic presentation paints a block caret and secondary range without adding editable DOM',()=>{
  const f=sourceFixture('alpha\nbeta\n');f.editor.overwrite=true;f.host.setSelections([{anchor:0,head:0},{anchor:6,head:9}]);f.host.setMode({mode:'normal'});assert.equal(f.editor.overwrite,false);f.host.paintSelections();
  assert.equal(f.host.overlay.children.length,2);assert.equal(f.host.overlay.children[0].className,'input-mode-cursor');assert.equal(f.host.overlay.children[1].className,'input-mode-selection');assert.equal(f.host.overlay.attributes.get('aria-hidden'),'true');
  const overlay=f.host.overlay;f.host.dispose();assert.equal(overlay.parentNode,null);assert.equal(f.editor.input.dataset.vimMode,undefined);assert.equal(f.editor.overwrite,true);
});

test('adopting an editor into another window reschedules a pending caret frame',()=>{
  const f=sourceFixture('alpha'),cancelled=[],scheduled=[];
  f.doc.defaultView.requestAnimationFrame=callback=>{scheduled.push(callback);return 11;};f.doc.defaultView.cancelAnimationFrame=id=>cancelled.push(id);
  f.host.setMode({mode:'normal'});assert.equal(scheduled.length,1);
  const adopted=documentFixture();adopted.defaultView.requestAnimationFrame=callback=>{scheduled.push(callback);return 22;};adopted.defaultView.cancelAnimationFrame=id=>cancelled.push(id);
  f.editor.root.ownerDocument=adopted;f.host.schedulePaint();
  assert.deepEqual(cancelled,[11]);assert.equal(scheduled.length,2);
  f.host.dispose();assert.deepEqual(cancelled,[11,22]);
});

test('geometry retains UTF-16 offsets around astral characters and expands tabs consistently',()=>{
  const f=sourceFixture('\t😀alpha\nbeta');const at=f.host.charCoords(3,'window');
  assert.equal(at.left,3+5*8);assert.equal(f.host.coordsChar({left:at.left,top:at.top},'window'),3);
  const before=f.host.getSelections();f.host.scrollIntoView(9);assert.deepEqual(f.host.getSelections(),before);f.host.dispose();
});

test('procedure and virtual coordinates stay in full-document space while page coordinates follow the window',()=>{
  const code='Option Explicit\nSub Alpha()\n'+Array.from({length:300},()=>"\t😀alpha\n").join('')+'End Sub\nSub Beta()\n'+Array.from({length:300},()=>"\t😀beta\n").join('')+'End Sub\n';
  for(const threshold of [2000,2]){
    const f=sourceFixture(code,{mode:'procedure',threshold}),offset=f.editor.index.starts[350]+3;
    f.host.setSelections([{anchor:offset,head:offset}]);
    const pane=f.editor.activePane,origin=(pane.virtualizer.full.firstLine)*17;
    pane.input.getBoundingClientRect=()=>({left:100,top:220,right:500,bottom:420});
    f.doc.defaultView.scrollX=7;f.doc.defaultView.scrollY=19;
    f.host.scrollTo(11,origin+70);
    assert.equal(f.host.getScrollInfo().top,origin+70);assert.equal(pane.mode,'procedure');
    assert.equal(f.host.getScrollInfo().height,f.editor.index.lines.length*17+8);
    const local=f.host.charCoords(offset,'local'),div=f.host.charCoords(offset,'div'),window=f.host.charCoords(offset,'window'),page=f.host.charCoords(offset,'page');
    assert.deepEqual(local,div);assert.equal(local.top,4+350*17);assert.equal(local.left,3+5*8);
    assert.equal(window.top,220+local.top-origin-70);assert.equal(window.left,100+local.left-11);
    assert.equal(page.top,window.top+19);assert.equal(page.left,window.left+7);
    for(const [coords,mode]of [[local,'local'],[div,'div'],[window,'window'],[page,'page']])assert.equal(f.host.coordsChar(coords,mode),offset);
    const selections=f.host.getSelections();f.host.scrollTo(null,0);
    assert.equal(pane.mode,'module');assert.equal(f.host.getScrollInfo().top,0);assert.deepEqual(f.host.getSelections(),selections);f.host.dispose();
  }
});

test('Monaco document coordinates include scroll offsets and screen motions target the text lane',()=>{
  const f=sourceFixture(Array.from({length:100},(_,i)=>`line${i}`).join('\n')),a=attachMonaco(f),view=a.view;
  a.pane.getBoundingClientRect=()=>({left:120,top:230,right:520,bottom:430});
  Object.assign(view,{
    getScrollLeft:()=>11,getScrollTop:()=>117,getScrollHeight:()=>2010,getScrollWidth:()=>600,
    getLayoutInfo:()=>({contentLeft:45}),getTopForLineNumber:line=>5+(line-1)*20,
    getScrolledVisiblePosition:({lineNumber,column})=>({left:45+(column-1)*8-11,top:5+(lineNumber-1)*20-117,height:20}),
    getTargetAtClientPoint(x,y){if(x<165||y<230||y>=430)return null;return {position:{lineNumber:Math.floor((y-230+117-5)/20)+1,column:Math.max(1,Math.round((x-120+11-45)/8)+1)}};}
  });
  f.doc.defaultView.scrollX=7;f.doc.defaultView.scrollY=19;
  const offset=f.editor.index.starts[10]+3,local=f.host.charCoords(offset,'local'),window=f.host.charCoords(offset,'window'),page=f.host.charCoords(offset,'page');
  assert.equal(local.left,69);assert.equal(local.top,205);assert.equal(window.left,178);assert.equal(window.top,318);
  assert.equal(page.left,185);assert.equal(page.top,337);
  for(const [coords,mode]of [[local,'local'],[window,'window'],[page,'page']])assert.equal(f.host.coordsChar(coords,mode),offset);
  assert.equal(f.host.coordsChar({left:0,top:205},'local'),f.editor.index.starts[10]);
  assert.equal(f.host.coordsChar({left:0,top:1605},'local'),f.editor.index.starts[80]);
  view.getScrolledVisiblePosition=()=>null;view.getOffsetForColumn=(_line,column)=>(column-1)*8;
  assert.deepEqual(f.host.charCoords(offset,'local'),local);f.host.dispose();
});

test('100k-line presentation reuses the canonical source index and cached Monaco text',()=>{
  const code=Array.from({length:100000},(_,i)=>`line${i}`).join('\n'),f=sourceFixture(code),index=f.editor.index,offset=index.starts[50000];
  f.host.setSelections([{anchor:offset,head:offset},{anchor:offset+10,head:offset+13}]);f.host.setMode({mode:'normal'});
  for(let i=0;i<5;i++){f.host.paintSelections();assert.equal(f.host.index,index);assert.ok(f.host.overlay.children.length<=3);}
  assert.ok(f.editor.input.value.length<4000);
  const a=attachMonaco(f);
  for(let i=0;i<10;i++){assert.equal(f.host.getText(),code);assert.equal(f.host.index,index);f.host.paintSelections();}
  assert.equal(a.model.valueReads,0);f.host.dispose();
});

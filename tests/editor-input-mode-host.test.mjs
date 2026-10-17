import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorHost} from '../src/editor/input-modes/editor-host.js';
import {SourceEditor} from '../src/editor/editor.js';
import {VirtualTextInput} from '../src/editor/virtual-input.js';
import {indexSource,positionAt,offsetAt} from '../src/editor/projection.js';
import {History} from '../src/core/history.js';
import {createVimSession} from '../src/editor/input-modes/vim-adapter.js';

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
function dispatchNativeFocus(root,input){
  // Node's EventTarget resets eventPhase between listeners. A DOM event keeps
  // its dispatch phase until every capture/target/bubble listener has returned.
  let phase=2;const event=new Event('focusin',{bubbles:true});
  Object.defineProperties(event,{target:{value:input},eventPhase:{get:()=>phase}});
  try{root.dispatchEvent(event);}finally{phase=0;}
}

test('native XAML geometry measures the displayed font and refreshes after style or owning-window changes',()=>{
  let measured=0,style={font:'13px monospace',letterSpacing:'normal'};
  const makeDocument=width=>({defaultView:{getComputedStyle:()=>style},createElement:()=>({getContext:()=>({measureText:()=>{measured++;return {width};}})})});
  const host=Object.assign(Object.create(EditorHost.prototype),{root:{ownerDocument:makeDocument(7.8)},editor:{input:{}},xaml:true});
  assert.equal(host.nativeCharacterWidth(8.16),7.8);assert.equal(host.nativeCharacterWidth(8.16),7.8);assert.equal(measured,1);
  style={font:'13px monospace',letterSpacing:'1px'};assert.equal(host.nativeCharacterWidth(8.16),8.8);assert.equal(measured,2);
  host.root.ownerDocument=makeDocument(8);assert.equal(host.nativeCharacterWidth(8.16),9);assert.equal(measured,3);
});

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

test('a transient native focus selection cannot turn a restored Vim block into characterwise selection',async()=>{
  const f=sourceFixture('alpha\nbeta\ngamma\n'),session=createVimSession(f.host,{onStatus:state=>f.host.setMode(state)});
  const unsubscribe=f.host.subscribe(event=>session.sync(event));
  try{
    for(const key of ['l','l','<C-v>','j','h'])assert.equal(session.handleKey(key),true);
    const selections=[{anchor:3,head:1},{anchor:9,head:7}];assert.deepEqual(f.host.getSelections(),selections);
    const a=attachMonaco(f);a.view.setSelections([{selectionStartLineNumber:1,selectionStartColumn:2,positionLineNumber:1,positionColumn:4}]);
    assert.deepEqual(f.host.getSelections(),selections);session.sync();
    a.runtime.surfaces.delete(f.editor);a.pane.remove();f.editor.input.setSelectionRange(1,3);
    assert.deepEqual(f.host.getSelections(),selections);session.sync();
    let during;
    f.editor.root.addEventListener('focusin',()=>{during=f.host.getSelections();session.sync();},true);
    // WebKit reports an empty range to synchronous focus listeners, then
    // restores its native selection before input.focus() returns.
    f.editor.input.setSelectionRange(0,0,'forward');
    dispatchNativeFocus(f.editor.root,f.editor.input);f.editor.input.setSelectionRange(1,3,'backward');
    assert.deepEqual(during,selections);assert.equal(session.state.subMode,'blockwise');
    await Promise.resolve();assert.deepEqual(f.host.getSelections(),selections);assert.equal(session.state.subMode,'blockwise');
    assert.equal(session.handleKey('x'),true);assert.equal(f.editor.text,'aha\nba\ngamma\n');
  }finally{unsubscribe();session.dispose();f.host.dispose();}
});

test('native focus protection ends with dispatch and never overrides another module or default editing',()=>{
  for(const mode of [null,{mode:'normal'}]){
    const f=sourceFixture('alpha\nbeta\n');f.host.setMode(mode);f.host.setSelections([{anchor:7,head:7}]);
    const observed=[];f.editor.root.addEventListener('focusin',()=>observed.push(f.host.getSelections()),true);
    const focus=()=>dispatchNativeFocus(f.editor.root,f.editor.input);
    f.editor.input.setSelectionRange(0,0);focus();
    assert.deepEqual(observed.pop(),mode?[{anchor:7,head:7}]:[{anchor:0,head:0}]);
    f.editor.input.setSelectionRange(2,4,'backward');
    assert.deepEqual(f.host.getSelections(),[{anchor:4,head:2}],'settled focus/navigation is immediately visible');
    f.editor.module={...f.editor.module,id:'other'};f.editor.input.setSelectionRange(5,5);focus();
    assert.deepEqual(observed.pop(),[{anchor:5,head:5}],'an identical-text module owns its own selection');
    f.host.dispose();
  }
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

function attachMotionMonaco(f){
  const a=attachMonaco(f),view=a.view,index=f.editor.index;
  // Variable-length display rows and a wrapped fold header. Hidden model lines
  // 5 and 6 have no display rows; a native cursor can cross them in one step.
  const rows=[{line:1,start:1,end:10},{line:2,start:1,end:9},{line:2,start:9,end:12},{line:2,start:12,end:21},
    {line:3,start:1,end:2},{line:4,start:1,end:9},{line:4,start:9,end:10},
    {line:7,start:1,end:9},{line:7,start:9,end:13},{line:8,start:1,end:4}];
  const rowAt=p=>{let result=-1;for(let i=0;i<rows.length;i++)if(rows[i].line===p.lineNumber&&rows[i].start<=p.column)result=i;return Math.max(0,result);};
  a.model.getPositionAt=offset=>{const p=positionAt(index,offset);return {lineNumber:p.line,column:p.column};};
  a.model.getOffsetAt=p=>offsetAt(index,p.lineNumber,p.column);
  const observed=[],commands=[];let scrollTop=17,scrollLeft=3;
  Object.assign(view,{
    getPosition(){const s=this.getSelection();return {lineNumber:s.positionLineNumber,column:s.positionColumn};},
    setSelections(values){this.selections=structuredClone(values);if(!a.surface.syncCursor){observed.push(structuredClone(values));f.editor.emit('cursor',{});}},
    getScrollTop:()=>scrollTop,getScrollLeft:()=>scrollLeft,setScrollPosition(value){scrollTop=value.scrollTop??scrollTop;scrollLeft=value.scrollLeft??scrollLeft;},
    getLayoutInfo:()=>({contentLeft:40,contentWidth:240}),getTopForPosition:(lineNumber,column)=>5+rowAt({lineNumber,column})*20,
    getScrolledVisiblePosition(p){const n=rowAt(p);return {left:40+(p.column-rows[n].start)*8-scrollLeft,top:5+n*20-scrollTop,height:20};},
    getLineHeightForPosition:()=>20,render(){this.renders=(this.renders||0)+1;},
    getTargetAtClientPoint(x,y){const n=Math.max(0,Math.min(rows.length-1,Math.floor((y+scrollTop-5)/20))),row=rows[n];return {position:{lineNumber:row.line,column:Math.max(row.start,Math.min(row.end,row.start+Math.round((x+scrollLeft-40)/8)))}};},
    trigger(source,id,args){
      commands.push({source,id,args});assert.equal(id,'cursorMove');assert.equal(args.select,false);assert.equal(args.noHistory,true);
      const p=this.getPosition(),n=rowAt(p),row=rows[n];let next;
      if(args.to==='wrappedLineStart')next={lineNumber:row.line,column:row.start};
      else if(args.by==='foldedLine'){
        const lines=[...new Set(rows.map(r=>r.line))],target=Math.max(0,Math.min(lines.length-1,lines.indexOf(p.lineNumber)+(args.to==='up'?-1:1)*args.value)),line=lines[target];
        next={lineNumber:line,column:Math.min(index.lines[line-1].length+1,p.column)};
      }else{
        assert.equal(args.by,'wrappedLine');const to=Math.max(0,Math.min(rows.length-1,n+(args.to==='up'?-1:1)*args.value)),destination=rows[to];
        next={lineNumber:destination.line,column:Math.min(destination.end,destination.start+p.column-row.start)};
      }
      this.setSelections([{selectionStartLineNumber:next.lineNumber,selectionStartColumn:next.column,positionLineNumber:next.lineNumber,positionColumn:next.column}]);
      scrollTop=Math.max(0,this.getTopForPosition(next.lineNumber,next.column)-40);
    }
  });
  return {...a,observed,commands};
}

const motionSource='😀 header\nabcdefghijklmnopqrst\nx\nabcdefghi\nfold one\nfold two\nuvwxyzabcdef\nend';

test('Monaco visual-row probes preserve pixel goals, backward block selections, scroll and canonical history',()=>{
  const f=sourceFixture(motionSource),a=attachMotionMonaco(f),values=[{anchor:f.editor.index.starts[6]+6,head:f.editor.index.starts[6]+2},{anchor:6,head:2}];
  f.host.setMode({mode:'visual',subMode:'blockwise'});f.host.setSelections(values);a.observed.length=0;
  const scroll=f.host.getScrollInfo(),goal=40+6*8,at=column=>f.editor.index.starts[1]+column-1;
  // The middle row is shorter than the goal. A boundary shared with the next
  // row stays on the middle row; the following motion recovers the saved goal.
  assert.deepEqual(f.host.findPosV(at(7),1,'line',goal,{text:motionSource}),{offset:at(11),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(11),1,'line',goal,{text:motionSource}),{offset:at(18),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(7),2,'line',goal,{text:motionSource}),{offset:at(18),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(18),-1,'line',goal,{text:motionSource}),{offset:at(11),hitSide:false});
  assert.deepEqual(f.host.getSelections(),values);assert.deepEqual(f.host.getScrollInfo(),scroll);assert.deepEqual(a.observed,[]);
  assert.equal(f.history.undoStack.length,0);assert.equal(f.changes.length,0);assert.equal(a.model.valueReads,0);assert.ok(a.view.renders>=4);
  assert.equal(f.host.findPosV(0,-1,'line',40,{text:motionSource}).hitSide,true);f.host.dispose();
});

test('Monaco logical motions skip hidden regions even when the fold header wraps and editing is read-only',()=>{
  const f=sourceFixture(motionSource),a=attachMotionMonaco(f),at=(line,column=1)=>f.editor.index.starts[line-1]+column-1;
  f.editor.setReadOnly(true);const saved=f.host.getSelections();
  assert.deepEqual(f.host.findPosV(at(4,3),1,'line',56,{text:motionSource,logical:true}),{offset:at(7,3),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(4,3),2,'line',56,{text:motionSource,logical:true}),{offset:at(8,3),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(7,3),-1,'line',56,{text:motionSource,logical:true}),{offset:at(4,3),hitSide:false});
  assert.deepEqual(f.host.findPosV(at(4),1,'line',40,{text:motionSource}),{offset:at(4,9),hitSide:false});
  assert.deepEqual(f.host.getSelections(),saved);assert.equal(f.host.getText(),motionSource);assert.equal(f.changes.length,0);
  assert.equal(a.commands.filter(c=>c.args.by==='foldedLine').length,3);f.host.dispose();
});

test('Monaco motion probes reject stale staged text and restore nested guards after a native failure',()=>{
  const f=sourceFixture(motionSource);assert.equal(f.host.findPosV(0,1,'line'),undefined);
  const a=attachMotionMonaco(f),values=[{anchor:6,head:2},{anchor:18,head:15}];f.host.setSelections(values);a.observed.length=0;
  assert.equal(f.host.findPosV(0,1,'line',40,{text:motionSource+'\n'}),undefined);assert.equal(a.commands.length,0);
  const scroll=f.host.getScrollInfo(),trigger=a.view.trigger;
  f.host.settingSelection=true;a.surface.syncCursor=true;
  a.view.trigger=function(...args){trigger.apply(this,args);throw new Error('Native motion failed');};
  assert.throws(()=>f.host.findPosV(0,1,'line',40),/Native motion failed/);
  assert.deepEqual(f.host.getSelections(),values);assert.deepEqual(f.host.getScrollInfo(),scroll);assert.deepEqual(a.observed,[]);
  assert.equal(f.host.settingSelection,true);assert.equal(a.surface.syncCursor,true);assert.equal(f.history.undoStack.length,0);
  f.host.settingSelection=false;a.surface.syncCursor=false;f.host.dispose();
});

function stagedContext(text,changes=[],operation={}){
  const index=indexSource(text),reads=[];
  return {text,changes,operation,revision:changes.length,lineCount:index.lines.length,reads,
    getLine(line){reads.push(line);return index.lines[line];},offsetAt:(line,ch)=>offsetAt(index,line+1,ch+1),positionAt(offset){const p=positionAt(index,offset);return {line:p.line-1,ch:p.column-1};}};
}
function attachStagedLayout(a,width=8){
  a.runtime.assets={createVimLineLayout:()=>({line(text){
    const count=Math.max(1,Math.ceil(text.length/width)),rowAt=ch=>Math.min(count-1,Math.floor(ch/width));
    return {count,rowAt,left:ch=>(ch-rowAt(ch)*width)*8,character:(row,goal)=>Math.min(text.length,(row+1)*width-(row<count-1?1:0),row*width+Math.max(0,Math.round(goal/8)))};
  }})};
}

test('staged Vim rows use the pending text and pixel goal without probing or committing the Monaco model',()=>{
  const source='abcdefghijklmnopqrstuvwxyz0123456789\nsecond',f=sourceFixture(source),a=attachMonaco(f);attachStagedLayout(a);
  a.view.trigger=()=>assert.fail('Staged geometry must not move native cursors');a.view.getPosition=()=>({lineNumber:1,column:1});a.view.getLayoutInfo=()=>({contentLeft:40});a.view.getTopForLineNumber=line=>(line-1)*20;
  const values=[{anchor:18,head:15},{anchor:6,head:2}];f.host.setSelections(values);
  const change={from:{line:0,ch:0},to:{line:0,ch:1},text:[''],removed:['a']},context=stagedContext(source.slice(1),[change]);
  assert.deepEqual(f.host.findPosV(0,1,'line',40,context),{offset:8,hitSide:false});
  assert.equal(f.host.charCoords(10,'local',context).left,56);
  assert.deepEqual(f.host.findPosV(0,2,'line',56,context),{offset:18,hitSide:false});
  assert.deepEqual(f.host.findPosV(18,-1,'line',56,context),{offset:10,hitSide:false});
  assert.deepEqual(f.host.getSelections(),values);assert.equal(f.host.getText(),source);assert.equal(a.model.value,source);
  assert.equal(a.model.valueReads,0);assert.equal(f.history.undoStack.length,0);assert.equal(f.changes.length,0);f.host.dispose();
});

test('staged fold ranges follow inserted and removed lines within the same atomic operation',()=>{
  const f=sourceFixture(motionSource),a=attachMotionMonaco(f);attachStagedLayout(a);
  a.model.getLineMaxColumn=line=>f.editor.index.lines[line-1].length+1;let snapshots=0;
  a.view.saveViewState=()=>{snapshots++;return {contributionsState:{'editor.contrib.folding':{collapsedRegions:[{startLineNumber:4,endLineNumber:6,isCollapsed:true}]}}};};
  const insertion={from:{line:1,ch:0},to:{line:1,ch:0},text:['new',''],removed:['']},changes=[insertion],operation={};
  const text=motionSource.slice(0,f.editor.index.starts[1])+'new\n'+motionSource.slice(f.editor.index.starts[1]),context=stagedContext(text,changes,operation);
  context.logical=true;context.goalCharacter=2;
  assert.deepEqual(f.host.findPosV(context.offsetAt(4,2),1,'line',56,context),{offset:context.offsetAt(7,2),hitSide:false});
  assert.deepEqual(f.host.findPosV(context.offsetAt(7,2),-1,'line',56,context),{offset:context.offsetAt(4,2),hitSide:false});
  const from=context.offsetAt(4,0),to=context.offsetAt(7,0),removed=text.slice(from,to).split('\n');
  changes.push({from:{line:4,ch:0},to:{line:7,ch:0},text:[''],removed});
  const next=stagedContext(text.slice(0,from)+text.slice(to),changes,operation);next.logical=true;next.goalCharacter=2;
  assert.deepEqual(f.host.findPosV(next.offsetAt(4,2),1,'line',56,next),{offset:next.offsetAt(5,2),hitSide:false});
  assert.equal(snapshots,1);assert.equal(a.commands.length,0);assert.equal(f.changes.length,0);f.host.dispose();
});

test('staged navigation in 100k lines projects only the nearby requested rows',()=>{
  const source=Array.from({length:100000},(_,i)=>`line${i}`).join('\n'),f=sourceFixture(source),a=attachMonaco(f);attachStagedLayout(a,24);
  a.view.trigger=()=>assert.fail('A staged motion must not probe the native model');a.view.getPosition=()=>({lineNumber:1,column:1});a.view.getLayoutInfo=()=>({contentLeft:40});
  const context=stagedContext('X'+source,[{from:{line:0,ch:0},to:{line:0,ch:0},text:['X'],removed:['']}]),from=context.offsetAt(90000,2),to=context.offsetAt(90001,2);
  assert.deepEqual(f.host.findPosV(from,1,'line',56,context),{offset:to,hitSide:false});
  assert.deepEqual([...new Set(context.reads)],[90000,90001]);assert.equal(a.model.valueReads,0);assert.equal(f.changes.length,0);f.host.dispose();
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

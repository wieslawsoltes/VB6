import test from 'node:test';
import assert from 'node:assert/strict';
import {CellBuffer,TUI_PROFILES} from '../src/tui/cells.js';
import {layoutText,paintText} from '../src/tui/text-layout.js';
import {paintControl} from '../src/tui/controls.js';
import {tuiAttribute} from '../src/tui/appearance.js';

const focused=(text,options={})=>layoutText(text,{columns:10,rows:3,focused:true,selectionStart:text.length,selectionEnd:text.length,...options});
const glyphPositions=layout=>layout.cells.filter(cell=>cell.glyph!==' ').map(({x,y,glyph,sourceStart,sourceEnd})=>({x,y,glyph,sourceStart,sourceEnd}));

test('empty and trailing empty lines retain center/right caret alignment',()=>{
  for(const [alignment,x] of [['left',0],['center',5],['right',9]]){
    assert.deepEqual(focused('',{alignment}).caret,{x,y:0});
    assert.deepEqual(focused('abc\r\n',{alignment}).caret,{x,y:1});
    assert.deepEqual(focused('\n\n',{alignment,scrollRow:1,rows:2}).caret,{x,y:1});
  }
});

test('right edge insertion points remain visible without moving aligned text',()=>{
  const layout=focused('abc',{alignment:'right'});
  assert.deepEqual(layout.cells.map(cell=>[cell.x,cell.glyph]),[[7,'a'],[8,'b'],[9,'c']]);
  assert.deepEqual(layout.caret,{x:9,y:0});
  assert.deepEqual(focused('abc',{alignment:'right',selectionStart:0,selectionEnd:0}).caret,{x:7,y:0});
  assert.deepEqual(focused('abc',{alignment:'center'}).caret,{x:6,y:0});
  assert.deepEqual(focused('abcdefghij',{rows:1}).caret,{x:9,y:0});
  assert.equal(focused('abcdefghijk',{rows:1}).caret,null);
  assert.equal(focused('abc',{rows:1,scrollColumn:1,selectionStart:0,selectionEnd:0}).caret,null);
  assert.deepEqual(focused('abcdefghijk',{rows:1,scrollColumn:1}).caret,{x:9,y:0});
});

test('selecting CRLF never repositions center/right-aligned glyphs',()=>{
  for(const alignment of ['left','center','right']){
    const text='A😀C\r\nnext';
    const normal=focused(text,{alignment,selectionStart:0,selectionEnd:0});
    for(const selectionDirection of ['forward','backward']){
      const selected=focused(text,{alignment,selectionStart:0,selectionEnd:6,selectionDirection});
      assert.deepEqual(glyphPositions(selected),glyphPositions(normal),alignment);
      assert.deepEqual(selected.cells.filter(cell=>cell.selected&&cell.glyph!==' ').map(cell=>cell.glyph),['A','😀','C']);
      assert.equal(selected.caret,null);
      const highlightedNewline=selected.cells.filter(cell=>cell.sourceStart===4);
      assert.equal(highlightedNewline.length,alignment==='left'?7:alignment==='center'?4:0);
      assert.ok(highlightedNewline.every(cell=>cell.sourceEnd===6&&cell.selected));
    }
  }
});

test('alignment uses logical extents when text or selected newlines are scrolled',()=>{
  const layout=focused('abcdefghijk\n',{columns:5,rows:1,scrollColumn:7,alignment:'right',selectionStart:0,selectionEnd:12});
  assert.equal(layout.cells.map(cell=>cell.glyph).join(''),'hijk ');
  assert.deepEqual(layout.cells.map(cell=>cell.x),[0,1,2,3,4]);
  assert.ok(layout.cells.every(cell=>cell.selected));
  assert.equal(layout.cells.at(-1).sourceStart,11);
  assert.equal(layout.cells.at(-1).sourceEnd,12);
  assert.deepEqual(focused('\tX',{columns:10,tabSize:4,alignment:'right',selectionStart:0,selectionEnd:0}).caret,{x:5,y:0});
});

test('aligned block caret paints only its visible cell and retains read-only behavior',()=>{
  const profile=TUI_PROFILES.turbo,buffer=new CellBuffer(10,1,{foreground:profile.foreground,background:profile.background});
  paintText(buffer,{text:'abc',alignment:'right',cellEditing:true,selectionStart:3,selectionEnd:3},profile);
  assert.equal(buffer.toText(),'       abc');
  assert.equal(buffer.colors[9],profile.background|(profile.foreground<<4));
  assert.equal(buffer.colors[8],profile.foreground|(profile.background<<4));
  const readOnly=new CellBuffer(10,1,{foreground:profile.foreground,background:profile.background});
  paintText(readOnly,{text:'abc',alignment:'right',cellEditing:true,readOnly:true,selectionStart:3,selectionEnd:3},profile);
  assert.equal(readOnly.colors[9],profile.foreground|(profile.background<<4));
});

test('checkbox/radio keyboard focus is visible in every palette and disabled state wins',()=>{
  const snapshot=(state,profile)=>paintControl(new CellBuffer(14,1),state,profile).snapshot();
  for(const profile of Object.keys(TUI_PROFILES))for(const type of ['CheckBox','OptionButton']){
    const state={type,caption:'&Choice',checked:true};
    const normal=snapshot(state,profile),focused=snapshot({...state,focused:true},profile);
    assert.notDeepEqual(focused,normal,`${profile} ${type}`);
    assert.deepEqual(focused.glyphs,normal.glyphs);
    const selected=tuiAttribute(profile,'selected');
    assert.equal(focused.colors[0],selected.foreground|(selected.background<<4));
    assert.equal(focused.colors[4],selected.hotkey|(selected.background<<4));
    assert.deepEqual(snapshot({...state,disabled:true,focused:true},profile),snapshot({...state,disabled:true},profile));
  }
});

test('range keyboard focus is visible without moving its thumb and disabled state wins',()=>{
  const snapshot=(state,profile)=>paintControl(new CellBuffer(state.vertical?3:14,state.vertical?12:3),state,profile).snapshot();
  for(const profile of Object.keys(TUI_PROFILES))for(const state of [
    {type:'HScrollBar'},{type:'VScrollBar',vertical:true},{type:'Slider'},{type:'Slider',vertical:true}
  ]){
    Object.assign(state,{value:4,min:0,max:10});
    const normal=snapshot(state,profile),focused=snapshot({...state,focused:true},profile);
    assert.notDeepEqual(focused.colors,normal.colors,`${profile} ${state.type} vertical=${!!state.vertical}`);
    assert.deepEqual(focused.glyphs,normal.glyphs);
    const selected=tuiAttribute(profile,'selected');
    assert.equal(focused.colors[0],selected.foreground|(selected.background<<4));
    assert.deepEqual(snapshot({...state,disabled:true,focused:true},profile),snapshot({...state,disabled:true},profile));
    const progress={...state,type:'ProgressBar'};
    assert.deepEqual(snapshot({...progress,focused:true},profile),snapshot(progress,profile));
  }
});

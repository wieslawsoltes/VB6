import test from 'node:test';
import assert from 'node:assert/strict';
import {paintTuiGlyph} from '../src/tui/raster.js';
import {CellBuffer,CanvasCellRenderer} from '../src/tui/cells.js';
import {FrameCellRenderer} from '../src/tui/frame.js';
import {CP437} from '../src/tui/screen.js';

for(let style=0;style<16;style++)test(`style ${style}: every CP437 display recipe clips transformed ink to its cell`,()=>{
  for(const glyph of Array.from(CP437).slice(1))for(const [width,height] of [[1,1],[5,11],[8,14],[8,16],[9,18],[12,24],[32,64]]){
    let painted=0;
    const context={fillRect(x,y,w,h){
      assert.ok([x,y,w,h].every(Number.isSafeInteger),glyph);
      assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height,`${glyph}: ${x},${y},${w},${h} outside ${width}x${height}`);
      painted++;
    }};
    assert.equal(paintTuiGlyph(context,glyph.codePointAt(0),width,height,style),true);
    if(glyph==='█')assert.ok(painted>0);
  }
});

function fixture(){
  const state={calls:0,failAt:Infinity,contexts:[]};
  const document={createElement(){
    const context={depth:0,draws:0,save(){this.depth++;},restore(){this.depth--;},beginPath(){},rect(){},clip(){},
      clearRect(){state.calls++;if(state.calls===state.failAt)throw Error('injected clear');},
      drawImage(){state.calls++;if(state.calls===state.failAt)throw Error('injected draw');this.draws++;},
      fillRect(){},fillText(){}};
    state.contexts.push(context);
    return {ownerDocument:document,style:{},width:300,height:150,setAttribute(){},append(){},remove(){},getContext:()=>context};
  }};
  const atlas={glyph(){return {width:8,height:16};}};
  return {document,atlas,state};
}
for(const opaque of [true,false])test(`cell renderer retries the full retained buffer after partial ${opaque?'opaque':'transparent'} submission`,()=>{
  const {document,atlas,state}=fixture(),canvas=document.createElement('canvas');
  const renderer=new CanvasCellRenderer(canvas,{atlas,opaque}),buffer=new CellBuffer(4,3);
  buffer.text(0,0,'ABCD');renderer.render(buffer);const initial=canvas.getContext().draws;
  buffer.put(1,0,'Z');buffer.put(1,2,'W');state.failAt=state.calls+2;
  assert.throws(()=>renderer.render(buffer),/injected/);
  assert.equal(renderer.key,'');assert.ok(buffer.damageLeft.every(x=>x===0));
  assert.ok(buffer.damageRight.every(x=>x===4));
  state.failAt=Infinity;const before=canvas.getContext().draws;renderer.render(buffer);
  assert.equal(canvas.getContext().draws-before,12);assert.ok(canvas.getContext().draws>initial);
  const warm=state.calls;renderer.render(buffer);assert.equal(state.calls,warm);renderer.dispose();
});
test('glyph-atlas failures retain damage and preserve the original error object',()=>{
  const {document}=fixture(),error=Error('glyph raster failed'),buffer=new CellBuffer(3,2);
  let fail=true;const atlas={glyph(){if(fail)throw error;return {};}};
  const painter=new CanvasCellRenderer(document.createElement('canvas'),{atlas});
  assert.throws(()=>painter.render(buffer),value=>value===error);
  assert.equal(buffer.damageLeft[1],0);fail=false;painter.render(buffer);assert.equal(buffer.takeDamage().length,0);
});
test('a failed replacement frame invalidates both old and proposed keys and restores the clip stack',()=>{
  const {document,atlas,state}=fixture(),element=document.createElement('div');
  const painter=new FrameCellRenderer(element,{atlas}),buffer=new CellBuffer(16,5);
  buffer.frame(0,0,16,5);painter.render(buffer);const key=painter.key;
  buffer.frame(0,0,16,5,{double:true});state.failAt=state.calls+2;
  assert.throws(()=>painter.render(buffer),/injected/);assert.equal(painter.key,'');
  assert.ok(state.contexts.every(ctx=>ctx.depth===0),'a throwing draw leaked a canvas clip stack');
  // Returning to the previous model cannot reuse its now partially overwritten bitmap.
  buffer.frame(0,0,16,5);state.failAt=Infinity;const calls=state.calls;painter.render(buffer);
  assert.equal(painter.key,key);assert.ok(state.calls>calls);
  const idle=state.calls;painter.render(buffer);assert.equal(state.calls,idle);painter.dispose();
});

test('coordinate projection shares one current measurement across local-point and layout consumers',async()=>{
  const {displayScale,localPoint}=await import('../src/rendering/coordinate-space.js');let reads=0;
  const bounds={left:10,top:20,width:300,height:80},node={offsetWidth:100,offsetHeight:40,clientLeft:1,clientTop:2,scrollLeft:3,scrollTop:4,
    getBoundingClientRect(){reads++;return bounds;}};
  assert.deepEqual(displayScale(node,1,bounds),{x:3,y:2});assert.equal(reads,0);
  assert.deepEqual(localPoint(node,40,40),{x:12,y:12});assert.equal(reads,1);
  assert.deepEqual(displayScale(node),{x:3,y:2});assert.equal(reads,2);
});

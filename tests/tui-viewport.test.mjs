import test from 'node:test';
import assert from 'node:assert/strict';
import {CellBuffer,CanvasCellRenderer} from '../src/tui/cells.js';
import {captureTranscript} from '../src/tui/transcript.js';

function fixture(){
  const context={draws:[],drawImage(...args){this.draws.push(args);},clearRect(){}};
  const canvas={width:300,height:150,getContext:()=>context};
  const atlas={glyph(code,color,width,height){return {code,color,width,height};}};
  return {context,canvas,atlas};
}
for(const dpr of [1,1.25,1.5,2,4])test(`partial viewport clips the bitmap, not the cell lattice at DPR ${dpr}`,()=>{
  const {canvas,context,atlas}=fixture(),painter=new CanvasCellRenderer(canvas,{cellWidth:9,cellHeight:18,atlas});
  const buffer=new CellBuffer(4,3);buffer.text(0,0,'TEST');painter.setExtent(31,43);painter.render(buffer,dpr);
  assert.equal(canvas.width,Math.round(31*dpr));assert.equal(canvas.height,Math.round(43*dpr));
  for(let y=0;y<3;y++)for(let x=0;x<4;x++){
    const [tile,left,top]=context.draws[y*4+x];
    assert.equal(left,Math.round(x*9*dpr));assert.equal(top,Math.round(y*18*dpr));
    assert.equal(tile.width,Math.round((x+1)*9*dpr)-left);
    assert.equal(tile.height,Math.round((y+1)*18*dpr)-top);
  }
  const count=context.draws.length;painter.render(buffer,dpr);assert.equal(context.draws.length,count);
  // Extent-only changes must repaint even when source glyphs did not change.
  painter.setExtent(30,42);painter.render(buffer,dpr);assert.equal(context.draws.length,count+12);
  assert.equal(canvas.width,Math.round(30*dpr));painter.dispose();
});
test('extent admission is atomic and never consumes pending damage',()=>{
  const {canvas,atlas}=fixture(),painter=new CanvasCellRenderer(canvas,{atlas}),buffer=new CellBuffer(2,2);
  painter.setExtent(13,25);
  for(const [width,height] of [[0,1],[1,-1],[NaN,1],[1,Infinity]]){
    assert.throws(()=>painter.setExtent(width,height),RangeError);
    assert.deepEqual(painter.extent,{width:13,height:25});
  }
  assert.equal(buffer.takeDamage().length,2);assert.equal(canvas.width,300);
  painter.setExtent(10000,10000);assert.deepEqual(painter.dimensions(buffer),{width:16,height:32,dpr:1});
});

function transcript(startKind,endKind,start=0,end=5){
  const text='ABCDE',inside={},before={},after={},node={textContent:text,clientWidth:40,scrollLeft:0,scrollTop:0};
  const points={inside,before,after};
  node.ownerDocument={defaultView:{getComputedStyle:()=>({whiteSpace:'pre'})},
    getSelection:()=>({rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:points[startKind],startOffset:start,endContainer:points[endKind],endOffset:end})}),
    createRange:()=>({selectNodeContents(){this.end=text.length;},comparePoint(n){return n===before?-1:n===after?1:0;},
      setEnd(n,offset){assert.equal(n,inside);this.end=offset;},toString(){return text.slice(0,this.end);}})};
  return captureTranscript(node,5,1,{cellWidth:8,cellHeight:16}).items.filter(i=>i.selected).map(i=>i.text).join('');
}
for(const [first,last,start,end,expected] of [
  ['inside','inside',1,4,'BCD'],['before','inside',0,3,'ABC'],['inside','after',2,0,'CDE'],
  ['before','after',0,0,'ABCDE'],['before','before',0,0,''],['after','after',0,0,'']
])test(`transcript intersects ${first}/${last} selection endpoints`,()=>{
  assert.equal(transcript(first,last,start,end),expected);
});

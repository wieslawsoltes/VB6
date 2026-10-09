import test from 'node:test';import assert from 'node:assert/strict';
import {drawingMachine} from './support/native-surface-drawing.mjs';
for(const optimization of[0,1,2]){
 test(`compiled GDI primitive coordinates, cursors and ownership O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),count=m.count();
  assert.equal(m.draw(0,[1.5,2.5,6.5,4.5]),0);assert.deepEqual(m.draws.at(-1).coords,[2,2,6,4]);assert.equal(m.readFloat('x'),6.5);assert.equal(m.readFloat('y'),4.5);
  assert.equal(m.draw(2,[6,5,2,1]),0);assert.deepEqual(m.draws.at(-1).coords,[2,1,7,6]);assert.equal(m.draws.at(-1).brush.color,0x123456);assert.equal(m.readFloat('x'),2);
  m.set('scale',1);assert.equal(m.draw(3,[150,90,45]),0);assert.deepEqual(m.draws.at(-1).coords,[7,3,14,10]);assert.equal(m.readFloat('x'),150);assert.equal(m.readFloat('y'),90);
  m.set('scale',3);m.set('penWidth',4);assert.equal(m.draw(4,[3,3]),0);assert.deepEqual(m.draws.at(-1).coords,[2,2,6,6]);
  assert.equal(m.count(),count);assert.equal(m.dc().saved.length,0);assert.equal(m.dc().pen,m.stockPen);assert.equal(m.dc().brush,m.stockBrush);assert.equal(m.dc().rop,13);
 });
 test(`PSet applies all sixteen independent Boolean raster modes O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),p=0x123456,d=0xabcdef,expected=[0,~(d|p),d&~p,~p,p&~d,~d,d^p,~(d&p),d&p,~(d^p),d,d|~p,p,p|~d,d|p,0xffffff];
  for(let i=0;i<16;i++){m.pixels().pixels[1]=d;m.set('drawMode',i+1);assert.equal(m.draw(4,[1,0],p),0);assert.equal(m.pixels().pixels[1],expected[i]&0xffffff);}
  const before=m.draws.length;assert.equal(m.draw(4,[-1,0]),0);assert.equal(m.draws.length,before);
 });
 for(const api of['SaveDC','SetROP2','CreatePen','CreateSolidBrush','SelectObject','Rectangle'])test(`primitive ${api} failure restores selected GDI ownership O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),count=m.count();m.fail(api);assert.ok([5,7].includes(m.draw(2,[1,1,5,4])));assert.equal(m.count(),count);assert.equal(m.dc().saved.length,0);assert.equal(m.dc().pen,m.stockPen);assert.equal(m.dc().brush,m.stockBrush);assert.equal(m.readFloat('x'),0);
  assert.equal(m.draw(2,[1,1,5,4]),0);
 });
 test(`draw scale/bounds/lifetime validation runs before pixel writes O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),count=m.count();assert.equal(m.draw(3,[2,2,-1]),5);assert.equal(m.draw(0,[2**25,0,1,1]),6);m.epoch(0);assert.equal(m.draw(0,[0,0,1,1]),91);assert.equal(m.draws.length,0);assert.equal(m.count(),count);
 });
 test(`counted Unicode text, CRLF and font state use scoped native calls O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),count=m.count();m.setFloat('x',1.5);m.setFloat('y',3.25);m.dc().textColor=0xff00;m.dc().alignment=6;
  assert.equal(m.text('A\0Ω中\r\nB\nC\rD'),0);assert.deepEqual(m.texts.map(v=>[v.text,v.x,v.y]),[['A\0Ω中',2,3],['B',0,17],['C',0,31],['D',0,45]]);
  assert.equal(m.readFloat('x'),7);assert.equal(m.readFloat('y'),45.25);assert.equal(m.dc().textColor,0xff00);assert.equal(m.dc().alignment,6);assert.equal(m.dc().saved.length,0);assert.equal(m.count(),count);
 });
 for(const api of['SaveDC','SelectObject','GetTextMetricsW','GetTextExtentPoint32W','TextOutW'])test(`text ${api} failure restores the DC and does not move the cursor O${optimization}`,t=>{
  const m=drawingMachine(t,optimization),count=m.count();m.fail(api);assert.ok([5,7].includes(m.text('snapshot')));assert.equal(m.dc().saved.length,0);assert.equal(m.count(),count);assert.equal(m.readFloat('x'),0);assert.equal(m.readFloat('y'),0);assert.equal(m.text('recovered'),0);
 });
}

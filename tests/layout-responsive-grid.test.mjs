import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
const item=(id,p={})=>({id,bounds:{width:20,height:20},widthMode:'fill',...p});
const engine=(items,props={})=>new LayoutEngine(items,{width:450,height:120,layout:'Grid',gap:10,...props});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('auto-fill changes the track count on resize without a configuration revision',()=>{
 const e=engine([item('a'),item('b')],{columns:'repeat(auto-fill, minmax(100, 1fr))'});e.arrange();
 const revision=e.revision;assert.equal(e.getGridLayout().columns.length,4);close(e.getBounds('a').width,105);
 e.arrange(230,120);assert.equal(e.revision,revision);assert.equal(e.getGridLayout().columns.length,2);close(e.getBounds('a').width,110);
 e.arrange(450,120);assert.equal(e.getGridLayout().columns.length,4);
});
test('auto-fit collapses only unused repeated tracks and their gutters',()=>{
 const e=engine([item('a'),item('b')],{columns:'repeat(auto-fit, minmax(100, 1fr))'});e.arrange();
 assert.equal(e.getGridLayout().columns.length,4);assert.deepEqual(e.getGridLayout().columns.map(t=>!!t.collapsed),[false,false,true,true]);
 close(e.getBounds('a').width,220);close(e.getBounds('b').x,230);
 e.update('b',{visible:false}).arrange();close(e.getBounds('a').width,450);
});
test('auto-fit spanning items keep every spanned track and fixed suffixes',()=>{
 const e=engine([item('a',{columnSpan:2})],{columns:'30 repeat(auto-fit, minmax(90, 1fr)) 40'});e.arrange();
 const g=e.getGridLayout();assert.equal(g.columns[0].size,30);assert.equal(g.columns.at(-1).size,40);
 assert.equal(g.columns[1].collapsed,false);assert.equal(g.columns[2].collapsed,true);
});
test('named lines and negative ends resolve against explicit tracks',()=>{
 const e=engine([item('a',{gridColumnStart:'body',gridColumnEnd:-1})],{columns:'[start] 50 [body] 1fr [middle] 2fr [end]'});e.arrange();
 const c=e.getGridLayout().cells[0];assert.equal(c.column,1);assert.equal(c.columnSpan,2);close(c.x,60);close(c.width,390);
 const g=e.getGridLayout();g.columns[1].names.push('intruder');assert.ok(!e.getGridLayout().columns[1].names.includes('intruder'));
});
test('repeated named occurrences and named spans include boundary aliases',()=>{
 const e=engine([item('a',{gridColumnStart:'slot 2',gridColumnEnd:'span 2 slot'})],{columns:'repeat(4, [slot] 50) [slot]'});e.arrange();
 const c=e.getGridLayout().cells[0];assert.equal(c.column,1);assert.equal(c.columnSpan,2);
});
test('named rectangular areas resolve spans with explicit selectors taking precedence',()=>{
 const e=engine([item('header',{gridArea:'head'}),item('body',{gridArea:'body'})],{columns:'80 1fr',rows:'30 1fr',gridTemplateAreas:'"head head" "side body"'});e.arrange();
 const cells=e.getGridLayout().cells;assert.equal(cells[0].columnSpan,2);assert.deepEqual([cells[1].row,cells[1].column],[1,1]);
 assert.throws(()=>e.configure({gridTemplateAreas:'"a a" "a b"'}),/rectangular/);
});
test('unknown line names fail atomically and the next valid configuration recovers',()=>{
 const e=engine([item('a')],{columns:'[start] 1fr 1fr [end]'});e.arrange();const before=e.getGridLayout(),rect=Array.from(e.rects);
 e.update('a',{gridColumnStart:'missing'});assert.throws(()=>e.arrange(),/Unknown grid line/);
 assert.deepEqual(e.getGridLayout(),before);assert.deepEqual(Array.from(e.rects),rect);
 e.update('a',{gridColumnStart:'start'}).arrange();assert.equal(e.getGridLayout().cells[0].column,0);
});
test('percentage, calc and clamp track dimensions recompute without eval',()=>{
 const e=engine([item('a'),item('b'),item('c')],{width:500,columns:'25% calc(25% - 10) clamp(50, 20%, 120)'});e.arrange();
 assert.deepEqual(e.getGridLayout().columns.map(t=>t.size),[125,115,100]);
 e.arrange(1000,120);assert.deepEqual(e.getGridLayout().columns.map(t=>t.size),[250,240,120]);
 assert.throws(()=>e.configure({columns:'calc(globalThis.process.exit())'}));
});
test('RTL reverses physical columns without changing logical cells or authored anchors',()=>{
 const e=engine([item('a'),item('b')],{width:220,columns:'1fr 1fr',direction:'rtl'});e.arrange();
 assert.equal(e.getBounds('a').x,115);assert.equal(e.getBounds('b').x,0);assert.equal(e.getGridLayout().cells[0].column,0);
 assert.equal(e.getGridLayout().direction,'rtl');
});
test('bounded invalid responsive templates do not replace live configuration',()=>{
 const e=engine([item('a')]);e.arrange();const before=e.options;
 for(const columns of ['repeat(auto-fit, 1fr)','repeat(auto-fill, 20) repeat(auto-fit, 30)','repeat(99999, 20)','[auto] 20','minmax(90, 20)'])assert.throws(()=>e.configure({columns}));
 assert.equal(e.options,before);
});

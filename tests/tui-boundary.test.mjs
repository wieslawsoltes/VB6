import test from 'node:test';
import assert from 'node:assert/strict';
import {displayScale,localPoint} from '../src/rendering/coordinate-space.js';
import {readableFormScale} from '../src/tui/form-space.js';
import {CellBuffer,TUI_SURFACE_PIXEL_BUDGET} from '../src/tui/cells.js';
import {serializeScreen,deserializeScreen,serializeANSI,serializeB800,composeCellLayers} from '../src/tui/screen.js';
import {registerTextView,textViewFor} from '../src/rendering/text-view.js';
import {paintTextView,TuiTextViews} from '../src/tui/text-view.js';
import {TUI_APPEARANCE,tuiAttribute} from '../src/tui/appearance.js';
import {parseCalendarDate,calendarISO,calendarMove} from '../src/tui/pickers.js';

test('authored coordinate inverses account for independent scaling, client borders and scrolling',()=>{
 const node={offsetWidth:100,offsetHeight:50,clientLeft:2,clientTop:3,scrollLeft:4,scrollTop:5,getBoundingClientRect:()=>({left:10,top:20,width:250,height:75})};
 assert.deepEqual(displayScale(node),{x:2.5,y:1.5});assert.deepEqual(localPoint(node,35,35),{x:12,y:12});
 node.offsetWidth=0;assert.equal(displayScale(node,2).x,2);
});
test('readable density fits mnemonic captions without changing the input inventory',()=>{
 const captions=[{text:'&CommandButton',width:80,height:12,padding:2}];const before=structuredClone(captions);
 assert.deepEqual(readableFormScale(captions),{x:1.5,y:1.375});assert.deepEqual(captions,before);
 assert.deepEqual(readableFormScale([]),{x:1,y:1});
 assert.deepEqual(readableFormScale([{text:'x'.repeat(1000000),width:1,height:1}]),{x:3,y:2});
 assert.deepEqual(readableFormScale([{text:'\n'.repeat(1000000),width:100,height:16}]),{x:1,y:1});
 assert.throws(()=>readableFormScale(new Array(10001)),RangeError);
});
for(const value of ['2025-02-29','2026-13-01','0000-01-01','10000-01-01','2026-00-01','2026-01-00','2026-02-31','oops'])test('calendar rejects '+value,()=>assert.equal(parseCalendarDate(value),null));
for(const [start,days,months,expected]of [['2024-01-31',0,1,'2024-02-29'],['2025-01-31',0,1,'2025-02-28'],['2024-02-29',0,12,'2025-02-28'],['0099-12-31',1,0,'0100-01-01'],['2026-03-01',-1,0,'2026-02-28'],['2026-01-31',0,-1,'2025-12-31']])test('calendar arithmetic '+start+':'+days+':'+months,()=>{
 const date=parseCalendarDate(start);assert.equal(calendarISO(calendarMove(date,days,months)),expected);assert.equal(calendarISO(date),start);
});
for(let style=0;style<16;style++)test('cell style '+style+' retains damage, copy, JSON and explicit B800 downgrade',()=>{
 const a=new CellBuffer(3,1);a.takeDamage();a.put(0,0,'A',7,0,style);assert.equal(a.styles[0],style);
 const b=new CellBuffer(3,1);b.blit(a,0,0);assert.equal(b.styles[0],style);
 b.blit(b,1,0);assert.equal(b.styles[1],style);
 const c=deserializeScreen(serializeScreen(b));assert.deepEqual(c.styles,b.styles);
 const d=composeCellLayers(3,1,[{x:0,y:0,buffer:c}]);assert.deepEqual(d.styles,c.styles);
 if(style)assert.throws(()=>serializeB800(a,{styles:'error'}),/styles/);else assert.equal(serializeB800(a,{styles:'error'}).length,6);
 const ansi=serializeANSI(a);if(style&1)assert.match(ansi,/\x1b\[[\d;]*1[;m]/);if(style&4)assert.match(ansi,/\x1b\[[\d;]*4[;m]/);
 a.fill(0,0,3,1);assert.equal(a.styles.some(Boolean),false);
});
test('style changes alone damage cells and invalid style input is rejected',()=>{
 const b=new CellBuffer(2,1);b.put(0,0,'A');b.takeDamage();b.put(0,0,'A',7,0,4);assert.equal(b.takeDamage().length,1);
 assert.throws(()=>b.put(0,0,'A',7,0,16));const json=JSON.parse(serializeScreen(b));json.styles=[256,0];assert.throws(()=>deserializeScreen(JSON.stringify(json)));
 assert.equal(TUI_SURFACE_PIXEL_BUDGET,16777216);
});
test('independent editor bundles share node-bound registration with replacement-safe retirement',()=>{
 const events=[],node={ownerDocument:{defaultView:{CustomEvent:class{constructor(type){this.type=type;}}}},setAttribute(){},removeAttribute(){},dispatchEvent(e){events.push(e.type);}};
 const first={read:()=>1,subscribe:()=>()=>{}},last={read:()=>2,subscribe:()=>()=>{}};
 const off=registerTextView(node,first),end=registerTextView(node,last);off();assert.equal(textViewFor(node).read(),2);end();end();assert.equal(textViewFor(node),null);assert.equal(events.length,3);
 assert.throws(()=>registerTextView(node,{}));
});
test('bounded text view snapshots preserve selection and all native caret positions',()=>{
 const b=new CellBuffer(12,4),state={cellWidth:8,cellHeight:16,items:[{x:16,y:0,text:'A',selected:true},{x:24,y:16,text:'B',color:11}],focused:true,carets:[{x:24,y:16}]};
 paintTextView(b,state,'turbo');assert.equal(b.toText().split('\n')[0][2],'A');assert.equal(b.colors[2]>>4,3);assert.equal(b.colors[15]>>4,14);
 assert.throws(()=>paintTextView(b,{...state,cellWidth:NaN},'turbo'),RangeError);
 assert.throws(()=>paintTextView(b,{...state,items:new Array(70001)},'turbo'),RangeError);
});

for(const profile of Object.keys(TUI_APPEARANCE))test(`${profile}: search cells preserve selection and caret priority`,()=>{
 const b=new CellBuffer(4,1),search=tuiAttribute(profile,'search'),selected=tuiAttribute(profile,'selected'),editor=tuiAttribute(profile,'editor');
 const state={cellWidth:8,cellHeight:16,items:[{x:0,y:0,text:'a',searchMatch:true,color:15},
   {x:8,y:0,text:'b',searchMatch:true,selected:true},{x:16,y:0,text:'c',searchMatch:true}],focused:true,carets:[{x:16,y:0}]};
 paintTextView(b,state,profile);assert.equal(b.toText(),'abc ');
 assert.equal(b.colors[0],search.foreground|(search.background<<4));
 assert.equal(b.colors[1],selected.foreground|(selected.background<<4));
 assert.equal(b.colors[2],editor.background|(editor.foreground<<4));
 paintTextView(b,{...state,focused:false,items:state.items.map(i=>({...i,searchMatch:false,selected:false}))},profile);
 assert.equal(b.colors[0]>>4,editor.background);assert.equal(b.toText(),'abc ');
});

test('palette transitions retire old text-view allocation before the aggregate budget resets',()=>{
 let retired=0,configured=0;
 const owner={surfacePixels:1234,settings:{profile:'turbo'}},views=new TuiTextViews(owner),node={};
 const entry={pixels:1234,provider:{configure(){configured++;}},painter:{dispose(){retired++;}},buffer:{},next:{}};
 views.entries.set(node,entry);views.configure();
 assert.equal(owner.surfacePixels,0);assert.equal(entry.pixels,0);assert.equal(entry.painter,null);
 assert.equal(entry.buffer,null);assert.equal(entry.next,null);assert.equal(retired,1);assert.equal(configured,1);assert.ok(views.dirty.has(node));
 views.configure();assert.equal(owner.surfacePixels,0);assert.equal(retired,1);
});

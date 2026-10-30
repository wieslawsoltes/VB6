import test from 'node:test';
import assert from 'node:assert/strict';
import {CellBuffer,EGA} from '../src/tui/cells.js';
import {FrameCellRenderer} from '../src/tui/frame.js';
import {paintControl} from '../src/tui/controls.js';
import {paintChrome} from '../src/tui/chrome.js';
import {TUI_APPEARANCE,tuiAttribute,partitionTracks,fitLabel,commandLabel} from '../src/tui/appearance.js';
import {desktopPattern} from '../src/tui/texture.js';
import {bindControlPaintProperties,readControlPaintProperties} from '../src/rendering/invalidation.js';

for(const profile of Object.keys(TUI_APPEARANCE))test(`${profile}: interactive semantic roles always retain foreground contrast`,()=>{
  for(const role of ['panel','title','menu','selected','field','button','focusedButton','disabled','editor','search','status']){
    const a=tuiAttribute(profile,role);assert.notEqual(a.foreground,a.background,role);
    for(const value of Object.values(a))assert.ok(Number.isInteger(value)&&value>=0&&value<16);
    assert.ok(Object.isFrozen(a));
  }
  assert.match(desktopPattern(profile),/^url\("data:image\/svg\+xml,/);
  assert.equal(desktopPattern(profile),desktopPattern(profile));
});

for(const profile of Object.keys(TUI_APPEARANCE))test(`${profile}: native source search recolors glyphs without obscuring selections`,()=>{
  const buffer=new CellBuffer(8,1),match=tuiAttribute(profile,'search'),selected=tuiAttribute(profile,'selected');
  const state={source:true,items:[{x:0,y:0,width:8,height:1,text:'abc defg',kind:'text'},
    {x:1,y:0,width:1,height:1,text:'b',kind:'text',selected:true}],search:[{x:-1,y:0,width:5,height:1}]};
  paintChrome(buffer,state,profile);
  assert.equal(buffer.toText(),'abc defg');
  assert.equal(buffer.colors[0],match.foreground|(match.background<<4));
  assert.equal(buffer.colors[1],selected.foreground|(selected.background<<4));
  assert.equal(buffer.colors[2],match.foreground|(match.background<<4));
  paintChrome(buffer,{...state,search:[]},profile);
  assert.equal(buffer.colors[0]>>4,tuiAttribute(profile,'editor').background);
  assert.equal(buffer.toText(),'abc defg');
});

test('semantic defaults and label sizing do not expose inherited keys or split Unicode scalars',()=>{
  assert.equal(tuiAttribute('__proto__','constructor'),tuiAttribute('turbo','panel'));
  assert.equal(commandLabel('viewForm'),'Design');assert.equal(commandLabel('__proto__','Safe label'),'Safe label');
  assert.equal(fitLabel('A😀BC',3),'A😀…');assert.equal(fitLabel('abcdef',0),'');
  assert.throws(()=>fitLabel('abc',1.5));
});

test('cell-track partition has no accumulated drift over unequal resizes',()=>{
  for(let size=100;size<500;size++){
    const tracks=partitionTracks(size,[2,1,3],16,16);
    assert.equal(tracks.reduce((a,b)=>a+b,0)+32,size);
    assert.ok(tracks.slice(0,-1).every(n=>n%16===0));
    assert.ok(tracks.every(n=>n>=0));
  }
  assert.deepEqual(partitionTracks(0,[1,1],16,16),[0,0]);
  assert.deepEqual(partitionTracks(100,[],16),[]);
  for(const args of [[-1,[1],8],[20,[0],8],[20,[Infinity],8],[20,[1],0]])assert.throws(()=>partitionTracks(...args));
});

test('paint property snapshots expose primitives, never accessors or live VM objects',()=>{
  const node={},props={Caption:'&Run',Value:0,Enabled:-1,Collection:{unsafe:true},Bad:Infinity};let reads=0;
  Object.defineProperty(props,'Access',{get(){assert.fail('renderer invoked an accessor');}});
  const old=bindControlPaintProperties(node,()=>{reads++;return props;});
  const snapshot=readControlPaintProperties(node,['Caption','Value','Enabled','Collection','Bad','Access']);
  assert.deepEqual({...snapshot},{Caption:'&Run',Value:0,Enabled:-1});assert.ok(Object.isFrozen(snapshot));
  props.Value=9;assert.equal(snapshot.Value,0);assert.equal(readControlPaintProperties(node,['Value']).Value,9);assert.equal(reads,2);
  const current=bindControlPaintProperties(node,()=>({Value:27}));old();assert.equal(readControlPaintProperties(node,['Value']).Value,27);
  current();current();assert.deepEqual({...readControlPaintProperties(node,['Value'])},{});
  assert.throws(()=>readControlPaintProperties(node,Array(65).fill('Value')));
});

for(const profile of Object.keys(TUI_APPEARANCE))test(`${profile}: selected lists, disabled buttons and default buttons retain state`,()=>{
  const b=new CellBuffer(20,3),selected=tuiAttribute(profile,'selected');
  paintControl(b,{type:'ListBox',rows:[{x:0,y:0,width:20,height:1,text:'Selected',selected:true}]},profile);
  assert.equal(b.colors[0],selected.foreground|(selected.background<<4));
  paintControl(b,{type:'CommandButton',caption:'&Save',focused:true,defaultButton:true},profile);
  assert.equal(b.toText().split('\n')[1][0],'[');assert.equal(b.toText().split('\n')[1].at(-1),']');
  assert.match(b.toText(),/Save/);
  paintControl(b,{type:'CommandButton',caption:'Disabled',focused:true,disabled:true},profile);
  const a=tuiAttribute(profile,'disabled');assert.ok(b.colors.every(c=>c===(a.foreground|(a.background<<4))));
});

test('mnemonics follow original scalar positions across explicit newlines, wrapping and surrogate pairs',()=>{
  const b=new CellBuffer(8,3);paintControl(b,{type:'Label',caption:'A😀\r\n&Caption',mnemonics:true});
  assert.match(b.toText(),/Caption/);assert.equal(b.colors[8]&15,tuiAttribute('turbo','panel').hotkey);
  const text=new CellBuffer(5,3);paintControl(text,{type:'Label',caption:'abcdefghijk'});assert.equal(text.toText(),'abcde\nfghij\nk    ');
});

test('intrinsic shape variants and patterns are distinct, bounded and preserve no-border transparency',()=>{
  const signatures=new Set();
  for(let shape=0;shape<6;shape++){
    const b=new CellBuffer(24,7);paintControl(b,{type:'Shape',shape,fillStyle:1});
    signatures.add(b.toText());assert.ok(b.glyphs.some(c=>c!==32));assert.equal(b.clips.length,1);
  }
  assert.equal(signatures.size,6);
  const patterns=new Set();for(let fillStyle=0;fillStyle<8;fillStyle++){const b=new CellBuffer(12,8);paintControl(b,{type:'Shape',fillStyle});patterns.add(b.toText());}
  assert.equal(patterns.size,8);
  const b=new CellBuffer(4,2);paintControl(b,{type:'Shape',borderStyle:0,fillStyle:1});assert.ok(b.glyphs.every(c=>c===32));
});

test('vertical progress fills from the bottom without overwriting adjacent columns',()=>{
  const b=new CellBuffer(3,10);paintControl(b,{type:'ProgressBar',vertical:true,min:0,max:100,value:30});
  const full='█'.codePointAt(0);assert.equal([...b.glyphs].filter(g=>g===full).length,3);
  assert.equal(b.glyphs[7*3+1],full);assert.equal(b.glyphs[9*3+1],full);
  assert.ok([...b.glyphs].filter((_,i)=>i%3!==1).every(g=>g===32));
});

function frameFixture(){
  const document={createElement(){const g={draws:[],save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(tile,x,y){this.draws.push({tile,x,y});}};return{style:{},setAttribute(){},getContext:()=>g,context:g,remove(){this.removed=true;}};}};
  const root={ownerDocument:document,children:[],append(n){this.children.push(n);}};
  const atlas={glyph:(code,color,width,height,palette,opaque)=>({code,color,width,height,opaque})};return {root,atlas};
}
for(const dpr of [1,1.25,1.5,2,4])test(`sparse frame corners and exact perimeter budget at DPR ${dpr}`,()=>{
  const {root,atlas}=frameFixture(),p=new FrameCellRenderer(root,{atlas,cellWidth:9,cellHeight:18});p.setExtent(613,257);
  const b=new CellBuffer(69,15);b.frame(0,0,69,15,{double:true});p.render(b,dpr);
  const size=p.dimensions(b,dpr);assert.equal(root.children.reduce((n,c)=>n+c.width*c.height,0),size.pixels);
  assert.ok(size.pixels<size.width*size.height/3);
  const top=root.children[0],right=top.context.draws.at(-1);assert.equal(right.x+right.tile.width,size.width);assert.equal(right.tile.code,'╗'.codePointAt(0));assert.equal(right.tile.opaque,false);
  const bottom=root.children[1];assert.ok(Math.abs(parseFloat(bottom.style.top)+parseFloat(bottom.style.height)-size.height/size.dpr)<1e-10);
  const paints=root.children.map(c=>c.context.draws.length);p.render(b,dpr);assert.deepEqual(root.children.map(c=>c.context.draws.length),paints);
  p.dispose();p.dispose();assert.ok(root.children.every(c=>c.removed&&c.width===1&&c.height===1));assert.throws(()=>p.render(b),/disposed/);
});

test('sparse frame validates metrics/palettes before creating canvas resources',()=>{
  const {root,atlas}=frameFixture();
  for(const options of [{cellWidth:NaN},{cellHeight:0},{maxPixels:Infinity},{palette:['#000000']}])assert.throws(()=>new FrameCellRenderer(root,{atlas,...options}));
  assert.equal(root.children.length,0);
  const p=new FrameCellRenderer(root,{atlas,maxPixels:128});p.setExtent(1000,1000);assert.throws(()=>p.render(new CellBuffer(1,1)),/budget/);
});

test('dialog paint respects wrapped text, disabled rows and checkbox state without drawing outside clips',()=>{
  const b=new CellBuffer(18,6);
  paintChrome(b,{items:[{x:1,y:0,width:3,height:1,kind:'field',check:true,checked:true},{x:5,y:0,width:10,height:1,text:'Enabled',kind:'text'},
    {x:1,y:2,width:8,height:2,kind:'text',wrap:true,text:'Wrap these words'},
    {x:1,y:5,width:15,height:1,text:'Disabled',kind:'button',disabled:true}]},'monochrome');
  assert.match(b.toText(),/\[X\]/);assert.equal(b.toText().split('\n')[2].slice(1,9),'Wrap the');assert.equal(b.clips.length,1);
  assert.equal(b.colors[5*18+1]&15,tuiAttribute('monochrome','disabled').foreground);
});

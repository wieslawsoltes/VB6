import test from 'node:test';
import assert from 'node:assert/strict';
import {MACOS26_RESOURCE_NAMES,macos26ColorToken,readMacOS26ColorToken,macos26Resource} from '../src/theme/macos26-resources.js';
import {colorValue,cssColor} from '../src/theme/theme.js';
import {graphicsColor} from '../src/graphics/contract.js';
import {drawControl,printControl} from '../src/graphics/control-graphics.js';
import {RetainedGraphics} from '../src/graphics/retained.js';
import {RasterCache} from '../src/graphics/raster.js';

// Record actual RasterCache/RasterPainter output without a browser dependency.
// Font metrics are deterministic; paint decisions and cache invalidation still
// run through the production retained-graphics implementation.
function fixture() {
  const paint=[];
  const document={createElement(type){
    assert.equal(type,'canvas');
    const canvas={width:1,height:1},stack=[];
    const context={canvas,font:'12px Arial',fillStyle:'#000000',strokeStyle:'#000000',
      save(){stack.push({font:this.font,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle});},
      restore(){Object.assign(this,stack.pop());},setTransform(){},transform(){},clearRect(){},setLineDash(){},
      measureText(text){return {width:String(text).length*7,fontBoundingBoxAscent:9,fontBoundingBoxDescent:3};},
      fillRect(...bounds){paint.push({kind:'rect',color:this.fillStyle,bounds});},
      fillText(text,x,y){paint.push({kind:'text',color:this.fillStyle,text,x,y});}};
    canvas.getContext=kind=>{assert.equal(kind,'2d');return context;};return canvas;
  }};
  const surface=new RetainedGraphics({ownerDocument:document});
  Object.assign(surface,{width:100,height:80,theme:'macos26',background:0xffffff,invalidate(){}});
  const control={props:{ScaleMode:3,ForeColor:0x563412,BackColor:0xefcdab,FillColor:0x332211,
      FontName:'Arial',FontSize:12,FontTransparent:0,MacOSForegroundRole:'destructiveColor',MacOSBackgroundRole:'textBackgroundColor'},
    node:{clientWidth:100,clientHeight:80},currentX:3,currentY:5,ensureSurface:()=>surface};
  return {control,surface,paint,cache:new RasterCache(document)};
}

test('semantic graphics tokens preserve all roles and exact OLE fallbacks across palettes',()=>{
  for(const role of MACOS26_RESOURCE_NAMES) {
    const token=macos26ColorToken(role,0x563412);
    assert.equal(typeof token,'string');assert.ok(token.length<96);assert.equal(graphicsColor(token),token);
    assert.equal(JSON.parse(JSON.stringify(token)),token);
    assert.deepEqual(readMacOS26ColorToken(token),{role,fallback:0x563412});
    assert.equal(colorValue(token,'#badbad','macos26'),macos26Resource(role,'light'));
    assert.equal(colorValue(token,'#badbad','macos26-dark'),macos26Resource(role,'dark'));
    for(const theme of ['classic','contrast','fluent','x11-dark'])assert.equal(colorValue(token,'#badbad',theme),'#123456');
  }
  const token=macos26ColorToken('secondaryLabelColor',-2147483631);
  for(const theme of ['classic','standard','contrast','fluent-dark'])assert.equal(colorValue(token,'#badbad',theme),colorValue(-2147483631,'#badbad',theme));
  assert.equal(cssColor(token),'var(--macos26-secondaryLabelColor, var(--vb-sys-17, #808080))');
  assert.equal(readMacOS26ColorToken(macos26ColorToken('labelColor',-2147483648)).fallback,0x80000000);
  assert.equal(readMacOS26ColorToken(macos26ColorToken('labelColor',0xffffffff)).fallback,0xffffffff);
});

test('semantic token creation rejects mutable values, invalid roles and invalid OLE fallbacks',()=>{
  let coercions=0;const mutable={valueOf(){coercions++;return 0;},toString(){coercions++;return 'labelColor';}};
  for(const role of [mutable,null,'','__proto__','unknown','labelColor);color:red'])assert.throws(()=>macos26ColorToken(role,0),TypeError);
  for(const value of [mutable,[],null,true,'0','#fff',NaN,Infinity,0.5,-2147483649,0x100000000])
    assert.throws(()=>macos26ColorToken('labelColor',value),/OLE_COLOR/);
  assert.equal(coercions,0);
  for(const token of [null,{},'macos26-color:__proto__:0','macos26-color:labelColor:4294967296',
    'macos26-color:labelColor:-1','macos26-color:labelColor:01','macos26-color:labelColor:0;color:red',
    'macos26-color:labelColor:0\n','macos26-color:'+ 'x'.repeat(100)]) {
    assert.equal(readMacOS26ColorToken(token),null);
    if(typeof token==='string') {assert.equal(colorValue(token,'#102030','macos26'),'#102030');assert.equal(cssColor(token,'#102030'),'#102030');}
  }
});

test('implicit drawing and opaque Print capture roles while explicit colors and FillColor remain authored',()=>{
  const {control:c,surface}=fixture();
  drawControl(c,'line',[1,2,3,4]);drawControl(c,'pixel',[6,7],0);drawControl(c,'pixel',[8,9],'#2468ac');
  printControl(c,['Hello','world']);
  const [line,black,css,text]=surface.commands;
  assert.equal(line.color,macos26ColorToken('destructiveColor',0x563412));
  assert.equal(line.style.fillColor,0x332211);assert.deepEqual(line.coords,[1,2,3,4]);
  assert.equal(black.color,0);assert.equal(css.color,'#2468ac');
  assert.equal(text.color,line.color);assert.equal(text.background,macos26ColorToken('textBackgroundColor',0xefcdab));
  assert.equal(text.opaque,true);assert.equal(text.text,'Hello world');assert.deepEqual(text.coords,[8,9]);
  assert.ok(surface.commands.every(Object.isFrozen));
  const captured=surface.commands.map(command=>JSON.stringify(command));
  Object.assign(c.props,{ForeColor:0xffffff,BackColor:0,MacOSForegroundRole:'labelColor',MacOSBackgroundRole:'windowBackgroundColor'});
  assert.deepEqual(surface.commands.map(command=>JSON.stringify(command)),captured,'property edits cannot mutate retained colors');
  drawControl(c,'pixel',[10,11]);assert.equal(surface.commands.at(-1).color,macos26ColorToken('labelColor',0xffffff));
  delete c.props.MacOSForegroundRole;delete c.props.MacOSBackgroundRole;
  drawControl(c,'pixel',[12,13]);printControl(c,['Unbound']);
  assert.equal(surface.commands.at(-2).color,0xffffff);assert.equal(surface.commands.at(-1).background,0);
});

test('retained raster replay updates semantic ink and opaque text backing without changing explicit pixels',()=>{
  const {control,surface,paint,cache}=fixture();
  drawControl(control,'pixel',[1,2]);drawControl(control,'pixel',[3,4],0x332211);printControl(control,['Retained']);
  const commands=surface.commands.slice(),captured=JSON.stringify(commands);
  for(const [theme,ink,background] of [['macos26',macos26Resource('destructiveColor','light'),macos26Resource('textBackgroundColor','light')],
    ['macos26-dark',macos26Resource('destructiveColor','dark'),macos26Resource('textBackgroundColor','dark')],
    ['classic','#123456','#abcdef']]) {
    surface.theme=theme;paint.length=0;cache.render(surface);
    assert.equal(paint.find(item=>item.kind==='text').color,ink);
    assert.equal(paint.find(item=>item.kind==='rect'&&item.bounds[0]===1&&item.bounds[1]===2).color,ink);
    assert.equal(paint.find(item=>item.kind==='rect'&&item.bounds[0]===3&&item.bounds[1]===4&&item.bounds[2]===1).color,'#112233');
    assert.equal(paint.find(item=>item.kind==='rect'&&item.bounds[2]>1&&item.bounds[2]<100).color,background);
    assert.equal(JSON.stringify(surface.commands),captured);assert.ok(commands.every((command,index)=>command===surface.commands[index]));
    const rebuilds=cache.rebuilds;paint.length=0;cache.render(surface);assert.equal(cache.rebuilds,rebuilds);assert.deepEqual(paint,[]);
  }
  cache.dispose();surface.disposeRetained();
});

test('invalid implicit role colors fail before retaining a command or moving the drawing cursor',()=>{
  const {control,surface}=fixture();const position=[control.currentX,control.currentY];
  control.props.ForeColor={valueOf:()=>0};
  assert.throws(()=>drawControl(control,'pixel',[80,70]),/OLE_COLOR/);
  assert.equal(surface.commands.length,0);assert.deepEqual([control.currentX,control.currentY],position);
  drawControl(control,'pixel',[1,2],0x123456);assert.equal(surface.commands.length,1,'explicit color does not read the unused implicit role');
  control.props.ForeColor=0;control.props.BackColor='url(untrusted)';
  assert.throws(()=>printControl(control,['Invalid background']),/OLE_COLOR/);
  assert.equal(surface.commands.length,1);assert.deepEqual([control.currentX,control.currentY],[1,2]);
});
